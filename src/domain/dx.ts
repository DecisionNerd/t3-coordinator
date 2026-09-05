import { Connection, Client } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { resolveAssignWork } from '../activities';
import { TASK_QUEUE } from './contracts';
import { requireDefaults, type ProjectDefaults } from './defaults';
import { parseIntent } from './intent';
import { runIssueCommand, runMilestoneCommand } from './backlog';
import { EPIC_BODY_TEMPLATE, epicStatus, listEpicChildren } from './epic';
import { assignmentWorkflow } from '../workflows';
import {
  getIssue,
  listOpenIssuesInMilestone,
  resolveMilestone,
  type GhIssue,
  type GhMilestone,
} from '../github/gh';
import { buildIssueGoal, commitIssueSpec } from './specFromIssue';

function workflowIdFor(assignmentId: string): string {
  return `assignment-${assignmentId}`;
}

async function temporalClient(): Promise<Client> {
  const config = loadClientConnectConfig();
  const connection = await Connection.connect(config.connectionOptions);
  return new Client({ connection });
}

export async function startAssignmentForIssue(input: {
  issue: GhIssue;
  defaults?: ProjectDefaults;
}): Promise<{
  ok: true;
  path: 'C';
  issue: { number: number; title: string; url: string };
  assignmentId: string;
  workflowId: string;
  supervisorThreadId: string;
  specSha: string;
  baseCommit: string;
  specPath: string;
}> {
  const defaults = input.defaults ?? requireDefaults();
  const { specSha, baseCommit, specPath } = commitIssueSpec(defaults.projectCwd, input.issue);
  const goal = buildIssueGoal(input.issue, defaults);
  const assign = {
    repo: defaults.t3ProjectId,
    specSha,
    baseCommit,
    environmentId: defaults.environmentId,
    instanceId: defaults.instanceId,
    modelId: defaults.modelId,
    goal,
    projectCwd: defaults.projectCwd,
    baseBranch: defaults.baseBranch,
  };
  const resolved = await resolveAssignWork(assign);
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  const client = await temporalClient();
  const handle = await client.workflow.start(assignmentWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId: workflowIdFor(resolved.assignmentId),
    args: [
      {
        ...assign,
        assignmentId: resolved.assignmentId,
        supervisorThreadId: resolved.supervisorThreadId,
      },
    ],
  });
  return {
    ok: true,
    path: 'C',
    issue: {
      number: input.issue.number,
      title: input.issue.title,
      url: input.issue.url,
    },
    assignmentId: resolved.assignmentId,
    workflowId: handle.workflowId,
    supervisorThreadId: resolved.supervisorThreadId,
    specSha,
    baseCommit,
    specPath,
  };
}

export async function pushIssue(issueNumber: number, defaults?: ProjectDefaults) {
  const d = defaults ?? requireDefaults();
  const issue = getIssue(d.githubRepo, issueNumber);
  if (issue.state.toUpperCase() !== 'OPEN') {
    return {
      ok: false as const,
      error: 'issue_not_open',
      issue: { number: issue.number, title: issue.title, state: issue.state, url: issue.url },
    };
  }
  // If this issue is an epic parent with open children, don't push the parent — point at complete epic.
  const { openChildren } = listEpicChildren(issueNumber);
  if (openChildren.length > 0) {
    return {
      ok: false as const,
      error: 'issue_is_epic_parent',
      issue: { number: issue.number, title: issue.title, url: issue.url },
      openChildren,
      hint: `Use complete epic ${issueNumber} (or run "complete epic ${issueNumber}") to push the next child. Push a child number directly to implement one child.`,
    };
  }
  return startAssignmentForIssue({ issue, defaults: d });
}

export async function completeMilestone(milestoneQuery: string, defaults?: ProjectDefaults) {
  const d = defaults ?? requireDefaults();
  const milestone: GhMilestone = resolveMilestone(d.githubRepo, milestoneQuery);
  if (milestone.state === 'closed') {
    return {
      ok: true as const,
      path: 'B' as const,
      done: true as const,
      milestone: {
        number: milestone.number,
        title: milestone.title,
        openIssues: milestone.open_issues,
        state: milestone.state,
      },
      message: `Milestone ${milestone.title} is already closed.`,
    };
  }
  const open = listOpenIssuesInMilestone(d.githubRepo, milestone.number);
  if (open.length === 0) {
    return {
      ok: true as const,
      path: 'B' as const,
      done: true as const,
      milestone: {
        number: milestone.number,
        title: milestone.title,
        openIssues: 0,
        state: milestone.state,
      },
      message: `No open issues left on ${milestone.title}. Close with: milestone close ${milestoneQuery} (apply:true).`,
    };
  }
  const next = [...open].sort((a, b) => a.number - b.number)[0]!;
  const started = await startAssignmentForIssue({ issue: next, defaults: d });
  return {
    ok: true as const,
    path: 'B' as const,
    done: false as const,
    milestone: {
      number: milestone.number,
      title: milestone.title,
      openIssues: open.length,
      state: milestone.state,
    },
    remainingIssues: open.map((i) => ({ number: i.number, title: i.title })),
    started,
    message: `Started next critical-path issue #${next.number}. After ACCEPT, run "complete ${milestoneQuery}" again.`,
  };
}

/** Path D — epic/parent tracker (children may be outside any milestone). */
export async function completeEpic(epicNumber: number, defaults?: ProjectDefaults) {
  const d = defaults ?? requireDefaults();
  const { parent, children, openChildren } = listEpicChildren(epicNumber);
  if (String(parent.state).toUpperCase() === 'CLOSED') {
    return {
      ok: true as const,
      path: 'D' as const,
      done: true as const,
      parent: { number: parent.number, title: parent.title, state: parent.state, url: parent.url },
      children,
      message: `Epic #${epicNumber} is already closed.`,
    };
  }
  if (openChildren.length === 0) {
    return {
      ok: true as const,
      path: 'D' as const,
      done: true as const,
      parent: { number: parent.number, title: parent.title, state: parent.state, url: parent.url },
      children,
      message: `No open children on epic #${epicNumber}. Close the parent when ready (issue close ${epicNumber} apply:true).`,
    };
  }
  const nextMeta = [...openChildren].sort((a, b) => a.number - b.number)[0]!;
  const next = getIssue(d.githubRepo, nextMeta.number);
  const started = await startAssignmentForIssue({ issue: next, defaults: d });
  return {
    ok: true as const,
    path: 'D' as const,
    done: false as const,
    parent: { number: parent.number, title: parent.title, state: parent.state, url: parent.url },
    remainingChildren: openChildren.map((c) => ({ number: c.number, title: c.title })),
    started,
    message: `Started next epic child #${next.number}. After ACCEPT, run "complete epic ${epicNumber}" again.`,
  };
}

export async function runDxIntent(raw: string) {
  const intent = parseIntent(raw);

  if (intent.kind === 'push_issue') {
    return { intent, result: await pushIssue(intent.issueNumber) };
  }
  if (intent.kind === 'complete_milestone') {
    return { intent, result: await completeMilestone(intent.milestone) };
  }
  if (intent.kind === 'complete_epic') {
    return { intent, result: await completeEpic(intent.epicNumber) };
  }
  if (intent.kind === 'issue_admin') {
    if (intent.command === 'push' && intent.issueNumber != null) {
      return { intent, result: await pushIssue(intent.issueNumber) };
    }
    if (intent.command === 'create') {
      // rest may be "Title | body" or just title — supervisor should use issue tool with fields for rich create
      const rest = intent.rest?.trim() ?? '';
      const [titlePart, ...bodyParts] = rest.split('|').map((s) => s.trim());
      const title = titlePart || 'New issue';
      const body = bodyParts.join('|') || 'TBD';
      return {
        intent,
        result: runIssueCommand({
          command: 'create',
          title,
          body,
          apply: false,
        }),
      };
    }
    return {
      intent,
      result: runIssueCommand({
        command: intent.command,
        issueNumber: intent.issueNumber,
        apply: false,
      }),
    };
  }
  if (intent.kind === 'milestone_admin') {
    if (intent.command === 'complete' && intent.milestone) {
      return { intent, result: await completeMilestone(intent.milestone) };
    }
    if (intent.command === 'create') {
      const title = intent.rest?.trim() || intent.milestone?.trim() || 'New milestone';
      return {
        intent,
        result: runMilestoneCommand({ command: 'create', title, apply: false }),
      };
    }
    return {
      intent,
      result: runMilestoneCommand({
        command: intent.command,
        milestone: intent.milestone,
        apply: false,
      }),
    };
  }
  if (intent.kind === 'epic_admin') {
    if (intent.command === 'create') {
      const title = intent.rest?.trim() || 'New epic';
      return {
        intent,
        result: runIssueCommand({
          command: 'create',
          title: title.startsWith('[Epic]') ? title : `[Epic] ${title}`,
          body: EPIC_BODY_TEMPLATE,
          apply: false,
        }),
      };
    }
    if (intent.command === 'status' && intent.epicNumber != null) {
      return { intent, result: epicStatus(intent.epicNumber) };
    }
    if (intent.command === 'plan' && intent.epicNumber != null) {
      const status = epicStatus(intent.epicNumber);
      const next = status.openChildren.sort((a, b) => a.number - b.number)[0] ?? null;
      return {
        intent,
        result: {
          ...status,
          command: 'plan' as const,
          suggestedCriticalPath: next,
          next: [
            next
              ? `Plan/refine child #${next.number}, then complete epic ${intent.epicNumber}`
              : `No open children — add task-list items (- [ ] #N) or close epic ${intent.epicNumber}`,
          ],
        },
      };
    }
    if ((intent.command === 'critique' || intent.command === 'review') && intent.epicNumber != null) {
      const status = epicStatus(intent.epicNumber);
      return {
        intent,
        result: {
          ...status,
          command: 'critique' as const,
          rubric: [
            'Is the epic outcome clear without a milestone?',
            'Are children atomic and independently deliverable?',
            'Is the critical path obvious?',
            'Any child missing AC?',
            'Ready to complete epic (push next child)?',
          ],
        },
      };
    }
    if (intent.command === 'explain' && intent.epicNumber != null) {
      return { intent, result: { ...epicStatus(intent.epicNumber), command: 'explain' as const } };
    }
    if (intent.command === 'close' && intent.epicNumber != null) {
      return {
        intent,
        result: runIssueCommand({
          command: 'close',
          issueNumber: intent.epicNumber,
          apply: false,
        }),
      };
    }
  }

  return {
    intent,
    result: {
      ok: false as const,
      error: 'unknown_intent',
      hint: [
        'Execute: "192" | "complete M2" | "complete epic 50"',
        'Issue lifecycle: status|plan|critique|refine|update|narrow|widen|explain|close|reopen|create + #N',
        'Milestone lifecycle: status|plan|critique|refine|update|narrow|widen|explain|close|list|create + M2',
        'Epic lifecycle: "epic 50" | "status epic 50" | "create epic …" | "complete epic 50"',
        'Mutations: use issue / milestone MCP tools with apply:true (run phrases preview by default).',
      ].join(' · '),
    },
  };
}
