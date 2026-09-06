import { randomUUID } from 'node:crypto';
import { bindSupervisor, bindingsPath, getSupervisorBinding } from './bindings';
import type { T3Adapter } from '../t3/adapter';
import { getT3Adapter } from '../t3/adapter';

export type MailboxSource = 'caller' | 'binding' | 'operator_inbox';

/**
 * Ensure a durable T3 mailbox thread exists for this environment.
 * Used when assign/complete has no caller thread id and no sticky bind
 * (e.g. Cursor MCP) so workers still get FR-4 follow-ups somewhere durable.
 * Idempotent: reuses existing binding; never invents an LLM-supplied thread id.
 */
export async function ensureOperatorInbox(input: {
  environmentId: string;
  projectId: string;
  instanceId: string;
  modelId: string;
  bindingsFilePath?: string;
  adapter?: T3Adapter;
}): Promise<{ supervisorThreadId: string; created: boolean }> {
  const filePath = input.bindingsFilePath ?? bindingsPath();
  const existing = getSupervisorBinding(input.environmentId, filePath);
  if (existing) {
    return { supervisorThreadId: existing.supervisorThreadId, created: false };
  }

  const adapter = input.adapter ?? getT3Adapter();
  const threadId = randomUUID();
  const commandId = `cmd_operator_inbox_${input.environmentId}_${threadId.slice(0, 8)}`;
  await adapter.dispatchTurn({
    commandId,
    threadId,
    messageText: [
      `Operator inbox for environment ${input.environmentId}.`,
      'Coordinator posts delivery follow-ups here.',
      'Review from any MCP chat with get_work_status / submit_review — do not implement in the supervisor session.',
    ].join('\n'),
    instanceId: input.instanceId,
    modelId: input.modelId,
    createThread: {
      projectId: input.projectId,
      title: `coord:operator-inbox:${input.environmentId}`,
      instanceId: input.instanceId,
      modelId: input.modelId,
      worktreePath: null,
    },
  });

  const binding = bindSupervisor({
    environmentId: input.environmentId,
    supervisorThreadId: threadId,
    filePath,
  });
  return { supervisorThreadId: binding.supervisorThreadId, created: true };
}

export const OPERATOR_INBOX_FAIL_ASK =
  'Could not create the operator mailbox in T3. Run t3-coordinator doctor (and auth-issue if needed), then retry the same complete/assign. Do not investigate binding or implement in this chat — workers do that work.';
