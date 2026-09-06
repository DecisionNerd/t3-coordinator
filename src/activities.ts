import { nanoid } from 'nanoid';
import { bindSupervisor, getSupervisorBinding } from './domain/bindings';
import {
  resolveSupervisorThread,
  workerPromptContract,
  type AssignWorkInput,
  isThreadBusy,
} from './domain/contracts';
import { deriveAssignmentId, observeWorktreeDelivery } from './domain/gitDelivery';
import {
  ensureOperatorInbox,
  OPERATOR_INBOX_FAIL_ASK,
  type MailboxSource,
} from './domain/operatorInbox';
import { getT3Adapter } from './t3/adapter';

export async function greet(name: string): Promise<string> {
  return `Hello, ${name}!`;
}
export async function resolveAssignWork(
  input: AssignWorkInput,
): Promise<
  | {
      ok: true;
      assignmentId: string;
      supervisorThreadId: string;
      mailboxSource: MailboxSource;
    }
  | { ok: false; error: 'supervisor_unbound'; ask: string }
> {
  const envThread =
    input.supervisorThreadId ??
    process.env.T3_THREAD_ID ??
    process.env.T3_SUPERVISOR_THREAD_ID ??
    process.env.COORD_SUPERVISOR_THREAD_ID;
  const binding = getSupervisorBinding(input.environmentId);
  const resolved = resolveSupervisorThread({
    binding,
    requestedThreadId: envThread,
  });

  if (resolved.ok) {
    if (resolved.shouldBind) {
      bindSupervisor({
        environmentId: input.environmentId,
        supervisorThreadId: resolved.supervisorThreadId,
      });
    }
    const mailboxSource: MailboxSource = envThread ? 'caller' : 'binding';
    return {
      ok: true,
      assignmentId: deriveAssignmentId(input),
      supervisorThreadId: resolved.supervisorThreadId,
      mailboxSource,
    };
  }

  try {
    const inbox = await ensureOperatorInbox({
      environmentId: input.environmentId,
      projectId: input.repo,
      instanceId: input.instanceId,
      modelId: input.modelId,
    });
    return {
      ok: true,
      assignmentId: deriveAssignmentId(input),
      supervisorThreadId: inbox.supervisorThreadId,
      mailboxSource: 'operator_inbox',
    };
  } catch {
    return {
      ok: false,
      error: 'supervisor_unbound',
      ask: OPERATOR_INBOX_FAIL_ASK,
    };
  }
}

export async function dispatchWorker(input: {
  assignmentId: string;
  supervisorThreadId: string;
  workerThreadId: string;
  assign: AssignWorkInput;
  projectCwd: string;
  baseBranch: string;
  worktreePath?: string;
}): Promise<{
  commandId: string;
  workerThreadId: string;
  sequence: number;
  adopted: boolean;
  worktreePath: string;
}> {
  const adapter = getT3Adapter();
  const commandId = `cmd_${input.assignmentId}_${input.workerThreadId}_dispatch`;
  const workerThreadId = input.workerThreadId;
  const worktreePath =
    input.worktreePath ?? `${process.env.HOME}/.t3-coordinator/worktrees/${workerThreadId}`;
  const branch = `coord/${workerThreadId}`;
  const messageText = workerPromptContract(
    input.assignmentId,
    input.assign.goal,
    input.assign.specSha,
  );
  const result = await adapter.dispatchTurn({
    commandId,
    threadId: workerThreadId,
    messageText,
    instanceId: input.assign.instanceId,
    modelId: input.assign.modelId,
    prepareWorktree: {
      projectCwd: input.projectCwd,
      baseBranch: input.baseBranch,
      branch,
    },
    createThread: {
      projectId: input.assign.repo,
      title: `coord:${input.assignmentId}`,
      instanceId: input.assign.instanceId,
      modelId: input.assign.modelId,
      worktreePath,
    },
  });
  return {
    commandId,
    workerThreadId,
    sequence: result.sequence,
    adopted: result.adopted,
    worktreePath,
  };
}

export async function waitWorkerTurnEnd(threadId: string): Promise<{ turnId: string | null; state: string }> {
  return getT3Adapter().waitForTurnEnd({ threadId });
}

export async function observeDelivery(input: {
  worktreePath: string;
  baseCommit: string;
  assignmentId: string;
}): Promise<Awaited<ReturnType<typeof observeWorktreeDelivery>>> {
  return observeWorktreeDelivery(input);
}

export async function sendSupervisorFollowUp(input: {
  assignmentId: string;
  supervisorThreadId: string;
  deliverySha: string;
  specSha: string;
  mailboxId?: string;
}): Promise<{ mailboxId: string; sent: boolean; deferredBusy: boolean }> {
  const adapter = getT3Adapter();
  const mailboxId = input.mailboxId ?? `mbx_${input.assignmentId}_${input.deliverySha.slice(0, 8)}`;
  const busy = isThreadBusy(await adapter.getThreadBusy(input.supervisorThreadId));
  if (busy) {
    return { mailboxId, sent: false, deferredBusy: true };
  }
  const commandId = `cmd_${mailboxId}`;
  await adapter.dispatchTurn({
    commandId,
    threadId: input.supervisorThreadId,
    messageText: [
      `Delivery ready for assignment ${input.assignmentId}.`,
      `specSha: ${input.specSha}`,
      `deliverySha: ${input.deliverySha}`,
      'Call submit_review with ACCEPT, REVISE, or BLOCKED.',
    ].join('\n'),
  });
  return { mailboxId, sent: true, deferredBusy: false };
}

export async function interruptWorker(input: {
  assignmentId: string;
  workerThreadId: string;
}): Promise<void> {
  await getT3Adapter().interruptTurn({
    commandId: `cmd_${input.assignmentId}_interrupt_${nanoid(6)}`,
    threadId: input.workerThreadId,
  });
}
