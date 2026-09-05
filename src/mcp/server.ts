/**
 * Minimal stdio MCP server exposing coordinator tools.
 * Configure this on the supervisor provider instance only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Connection, Client } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { getSupervisorBinding } from '../domain/bindings';
import { TASK_QUEUE } from '../domain/contracts';
import { resolveAssignWork } from '../activities';
import {
  assignmentWorkflow,
  cancelSignal,
  pauseSignal,
  resumeSignal,
  reviewSignal,
  statusQuery,
} from '../workflows';

function jsonResult(payload: unknown, isError = false) {
  return {
    isError,
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
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
  'get_binding',
  'Show the durable supervisor thread binding for an environment',
  { environmentId: z.string() },
  async ({ environmentId }) => jsonResult({ binding: getSupervisorBinding(environmentId) ?? null }),
);

server.tool(
  'assign_work',
  'Start a durable assignment workflow for an isolated worker',
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
      return jsonResult({ error: resolved.error }, true);
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
    });
  },
);

server.tool(
  'get_work_status',
  'Describe Temporal workflow status for an assignment',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    const handle = client.workflow.getHandle(workflowIdFor(assignmentId));
    const desc = await handle.describe();
    let view: unknown = null;
    try {
      view = await handle.query(statusQuery);
    } catch {
      view = null;
    }
    return jsonResult({
      assignmentId,
      status: desc.status.name,
      workflowId: desc.workflowId,
      view,
    });
  },
);

server.tool(
  'get_delivery',
  'Return delivery SHA / blocked reason from the assignment workflow query',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    const handle = client.workflow.getHandle(workflowIdFor(assignmentId));
    const view = await handle.query(statusQuery);
    return jsonResult({
      assignmentId,
      deliverySha: view.deliverySha ?? null,
      state: view.state,
      blockedReason: view.blockedReason ?? null,
    });
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
  'Pause mailbox auto-send for an assignment',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(pauseSignal);
    return jsonResult({ ok: true });
  },
);

server.tool(
  'resume_work',
  'Resume a paused assignment',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(resumeSignal);
    return jsonResult({ ok: true });
  },
);

server.tool(
  'cancel_work',
  'Cancel an assignment',
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const client = await temporalClient();
    await client.workflow.getHandle(workflowIdFor(assignmentId)).signal(cancelSignal);
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
