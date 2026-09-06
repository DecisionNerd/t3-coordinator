/**
 * MCP server for supervisor provider only.
 *
 * DX via `run(phrase)` or typed tools:
 * - Issues: create → plan/critique/refine → push → close (and epic parents)
 * - Milestones: create → plan/critique → complete → close
 * - Epics: parent issue trackers with children (task-list / sub-issues), milestone optional
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Connection, Client } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { getSupervisorBinding } from '../domain/bindings';
import { TASK_QUEUE } from '../domain/contracts';
import { resolveAssignWork } from '../activities';
import { completeEpic, completeMilestone, pushIssue, runDxIntent } from '../domain/dx';
import { runIssueCommand, runMilestoneCommand } from '../domain/backlog';
import { epicStatus, EPIC_BODY_TEMPLATE } from '../domain/epic';
import { orientNext } from '../domain/orient';
import { sitrep } from '../domain/sitrep';
import { readDefaults } from '../domain/defaults';
import { needRepoResult, tryResolveProjectContext } from '../domain/repoContext';
import {
  assignmentWorkflow,
  cancelSignal,
  pauseSignal,
  resumeSignal,
  reviewSignal,
  statusQuery,
  processStatusQuery,
  processCancelSignal,
  processPauseSignal,
  processResumeSignal,
} from '../workflows';

function jsonResult(payload: unknown, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function workflowIdFor(assignmentId: string): string {
  return `assignment-${assignmentId}`;
}

async function temporalClient(): Promise<Client> {
  const config = loadClientConnectConfig();
  const connection = await Connection.connect(config.connectionOptions);
  return new Client({ connection });
}

const server = new McpServer({
  name: 't3-coordinator',
  version: '0.1.0',
});

server.tool(
  'run',
  'Primary DX entry after @t3-coordinator. Thin supervisor: classify or start; do not plan or implement. Empty/"next" = decide. Freeform goal = classify only. "start <processId>" instantiates. "192" / complete skip classify (ImplementSlice). On StepFailed pick only allowedNext (retry / block / cancel).',
  { phrase: z.string().optional().default('') },
  async ({ phrase }) => {
    try {
      const out = await runDxIntent(phrase ?? '');
      const failed =
        out.result &&
        typeof out.result === 'object' &&
        'ok' in out.result &&
        (out.result as { ok: boolean }).ok === false;
      return jsonResult(out, Boolean(failed));
    } catch (err) {
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'next',
  'Orient only: goals + backlog + supervisorInstructions. Thin supervisor decides next phrase; does not start work or investigate the repo.',
  {},
  async () => {
    try {
      return jsonResult({ intent: { kind: 'next' }, result: orientNext() });
    } catch (err) {
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'sitrep',
  'Standup check-in: recently closed issues + merged PRs, blockers (labels/notes/open PRs), and coming-up (milestones/epics/suggested next). Optional windowDays (default 7). Does not start work.',
  { windowDays: z.number().int().min(1).max(90).optional() },
  async ({ windowDays }) => {
    try {
      return jsonResult({
        intent: { kind: 'sitrep', windowDays },
        result: sitrep(windowDays),
      });
    } catch (err) {
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'issue',
  'Full issue lifecycle: status|plan|critique|refine|update|narrow|widen|explain|close|reopen|create. Set apply:true to mutate GitHub. For epics use create with epic-style body or epic tool.',
  {
    command: z.enum([
      'status',
      'plan',
      'critique',
      'review',
      'refine',
      'update',
      'narrow',
      'widen',
      'explain',
      'close',
      'reopen',
      'create',
      'push',
    ]),
    issueNumber: z.number().int().positive().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    comment: z.string().optional(),
    planText: z.string().optional(),
    commitSpec: z.boolean().optional(),
    apply: z.boolean().optional(),
  },
  async (args) => {
    try {
      if (args.command === 'push') {
        if (args.issueNumber == null) throw new Error('push requires issueNumber');
        return jsonResult(await pushIssue(args.issueNumber));
      }
      return jsonResult(runIssueCommand(args));
    } catch (err) {
      const need = needRepoResult(err);
      if (need) return jsonResult(need, true);
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'milestone',
  'Full milestone lifecycle: list|status|plan|critique|refine|update|narrow|widen|explain|close|create|complete. apply:true to mutate.',
  {
    command: z.enum([
      'status',
      'plan',
      'critique',
      'review',
      'refine',
      'update',
      'narrow',
      'widen',
      'explain',
      'close',
      'list',
      'create',
      'complete',
    ]),
    milestone: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    dueOn: z.string().optional(),
    apply: z.boolean().optional(),
  },
  async (args) => {
    try {
      if (args.command === 'complete') {
        if (!args.milestone) throw new Error('complete requires milestone');
        return jsonResult(await completeMilestone(args.milestone));
      }
      return jsonResult(runMilestoneCommand(args));
    } catch (err) {
      const need = needRepoResult(err);
      if (need) return jsonResult(need, true);
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'epic',
  'Epic/parent issue tracker (children via task-list or sub-issues; milestone optional). status|plan|critique|complete|close|create.',
  {
    command: z.enum(['status', 'plan', 'critique', 'review', 'explain', 'complete', 'close', 'create']),
    epicNumber: z.number().int().positive().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    apply: z.boolean().optional(),
  },
  async (args) => {
    try {
      if (args.command === 'complete') {
        if (args.epicNumber == null) throw new Error('complete requires epicNumber');
        return jsonResult(await completeEpic(args.epicNumber));
      }
      if (args.command === 'create') {
        const title = args.title?.trim() || 'New epic';
        return jsonResult(
          runIssueCommand({
            command: 'create',
            title: title.startsWith('[Epic]') ? title : `[Epic] ${title}`,
            body: args.body?.trim() || EPIC_BODY_TEMPLATE,
            apply: Boolean(args.apply),
          }),
        );
      }
      if (args.epicNumber == null) throw new Error(`${args.command} requires epicNumber`);
      if (args.command === 'status' || args.command === 'explain') {
        return jsonResult(epicStatus(args.epicNumber));
      }
      if (args.command === 'close') {
        return jsonResult(
          runIssueCommand({
            command: 'close',
            issueNumber: args.epicNumber,
            apply: Boolean(args.apply),
          }),
        );
      }
      // plan / critique / review
      return jsonResult(await runDxIntent(`${args.command} epic ${args.epicNumber}`));
    } catch (err) {
      const need = needRepoResult(err);
      if (need) return jsonResult(need, true);
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'push_issue',
  'Path C: dispatch one issue to a worker (same as run("192")). Supervisor does not implement. Refuses if the issue is an epic with open children — use complete_epic.',
  { issueNumber: z.number().int().positive() },
  async ({ issueNumber }) => {
    try {
      return jsonResult(await pushIssue(issueNumber));
    } catch (err) {
      const need = needRepoResult(err);
      if (need) return jsonResult(need, true);
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'complete_milestone',
  'Path B: dispatch next open milestone issue to a worker (same as run("complete M2")). Supervisor does not implement. Repeat after ACCEPT.',
  { milestone: z.string() },
  async ({ milestone }) => {
    try {
      return jsonResult(await completeMilestone(milestone));
    } catch (err) {
      const need = needRepoResult(err);
      if (need) return jsonResult(need, true);
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'complete_epic',
  'Path D: dispatch next open child of a parent/epic issue to a worker (same as run("complete epic 50")). Supervisor does not implement. Milestone not required.',
  { epicNumber: z.number().int().positive() },
  async ({ epicNumber }) => {
    try {
      return jsonResult(await completeEpic(epicNumber));
    } catch (err) {
      const need = needRepoResult(err);
      if (need) return jsonResult(need, true);
      return jsonResult({ ok: false, error: String(err) }, true);
    }
  },
);

server.tool(
  'get_defaults',
  'Show optional worker prefs (~/.t3-coordinator/defaults.json) plus the GitHub repo detected from the current checkout. There is no sticky default github repo.',
  {},
  async () => {
    const detected = tryResolveProjectContext();
    return jsonResult({
      defaults: readDefaults(),
      path: '~/.t3-coordinator/defaults.json',
      detectedRepo: detected.ok
        ? {
            githubRepo: detected.context.githubRepo,
            projectCwd: detected.context.projectCwd,
            source: detected.context.source,
          }
        : { error: detected.error, ask: detected.ask, detail: detected.detail },
    });
  },
);

server.tool(
  'get_binding',
  'Show the durable mailbox thread binding for an environment (caller / sticky / operator inbox)',
  { environmentId: z.string() },
  async ({ environmentId }) => jsonResult({ binding: getSupervisorBinding(environmentId) ?? null }),
);

server.tool(
  'assign_work',
  'Low-level: start a durable worker assignment when you already have specSha/baseCommit (prefer run / push_issue / complete_milestone). Auto-binds an operator mailbox if needed. Supervisor does not implement.',
  {
    repo: z.string(),
    specSha: z.string(),
    baseCommit: z.string(),
    environmentId: z.string(),
    supervisorThreadId: z.string().optional(),
    instanceId: z.string(),
    modelId: z.string(),
    goal: z.string(),
    projectCwd: z.string(),
    baseBranch: z.string().default('main'),
    worktreePath: z.string().optional(),
    deliveryGraceMs: z.number().optional(),
  },
  async (args) => {
    const resolved = await resolveAssignWork(args);
    if (!resolved.ok) {
      return jsonResult(
        { ok: false, error: resolved.error, ask: 'ask' in resolved ? resolved.ask : undefined },
        true,
      );
    }
    const client = await temporalClient();
    const handle = await client.workflow.start(assignmentWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: workflowIdFor(resolved.assignmentId),
      args: [
        {
          ...args,
          assignmentId: resolved.assignmentId,
          supervisorThreadId: resolved.supervisorThreadId,
        },
      ],
    });
    return jsonResult({
      assignmentId: resolved.assignmentId,
      workflowId: handle.workflowId,
      supervisorThreadId: resolved.supervisorThreadId,
      mailboxSource: resolved.mailboxSource,
    });
  },
);

server.tool(
  'get_work_status',
  'Describe Temporal workflow status for an assignment or process instance (includes failed steps / allowedNext)',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    const ids = assignmentId.startsWith('proc_')
      ? [`process-${assignmentId}`, workflowIdFor(assignmentId)]
      : [workflowIdFor(assignmentId), `process-${assignmentId}`];
    for (const workflowId of ids) {
      try {
        const handle = client.workflow.getHandle(workflowId);
        const desc = await handle.describe();
        let view: unknown = null;
        try {
          view = workflowId.startsWith('process-')
            ? await handle.query(processStatusQuery)
            : await handle.query(statusQuery);
        } catch {
          view = null;
        }
        return jsonResult({
          assignmentId,
          status: desc.status.name,
          workflowId: desc.workflowId,
          view,
        });
      } catch {
        /* try next id */
      }
    }
    return jsonResult({ ok: false, error: 'not_found', assignmentId }, true);
  },
);

server.tool(
  'get_delivery',
  'Return delivery SHA / blocked reason / failed step from an assignment or process instance',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    const ids = assignmentId.startsWith('proc_')
      ? [`process-${assignmentId}`, workflowIdFor(assignmentId)]
      : [workflowIdFor(assignmentId), `process-${assignmentId}`];
    for (const workflowId of ids) {
      try {
        const handle = client.workflow.getHandle(workflowId);
        if (workflowId.startsWith('process-')) {
          const view = await handle.query(processStatusQuery);
          return jsonResult({
            assignmentId,
            workflowId,
            deliverySha: null,
            state: view.state,
            blockedReason: view.failureClass ?? null,
            failureClass: view.failureClass ?? null,
            allowedNext: view.allowedNext ?? null,
            stepId: view.stepId ?? null,
          });
        }
        const view = await handle.query(statusQuery);
        return jsonResult({
          assignmentId,
          workflowId,
          deliverySha: view.deliverySha ?? null,
          state: view.state,
          blockedReason: view.blockedReason ?? null,
          failureClass: view.failureClass ?? null,
        });
      } catch {
        /* try next id */
      }
    }
    return jsonResult({ ok: false, error: 'not_found', assignmentId }, true);
  },
);

server.tool(
  'submit_review',
  'Submit ACCEPT | REVISE | BLOCKED for a delivered assignment',
  {
    assignmentId: z.string(),
    verdict: z.enum(['ACCEPT', 'REVISE', 'BLOCKED']),
    deliverySha: z.string(),
    notes: z.string().optional(),
  },
  async ({ assignmentId, verdict, deliverySha, notes }) => {
    const client = await temporalClient();
    await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(reviewSignal, {
      verdict,
      deliverySha,
      notes,
    });
    return jsonResult({ ok: true, assignmentId, verdict });
  },
);

server.tool(
  'pause_work',
  'Pause mailbox auto-send for an assignment or process instance',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    if (assignmentId.startsWith('proc_')) {
      await client.workflow.getHandle(`process-${assignmentId}`).signal(processPauseSignal);
    } else {
      await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(pauseSignal);
    }
    return jsonResult({ ok: true });
  },
);

server.tool(
  'resume_work',
  'Resume a paused assignment or process instance',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    if (assignmentId.startsWith('proc_')) {
      await client.workflow.getHandle(`process-${assignmentId}`).signal(processResumeSignal);
    } else {
      await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(resumeSignal);
    }
    return jsonResult({ ok: true });
  },
);

server.tool(
  'cancel_work',
  'Cancel an assignment or process instance',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    if (assignmentId.startsWith('proc_')) {
      await client.workflow.getHandle(`process-${assignmentId}`).signal(processCancelSignal);
    } else {
      await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(cancelSignal);
    }
    return jsonResult({ ok: true });
  },
);

export async function runMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  runMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
