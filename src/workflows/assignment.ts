import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  uuid4,
} from '@temporalio/workflow';
import type * as activities from '../activities';
import {
  DEFAULT_DELIVERY_GRACE_MS,
  type AssignWorkInput,
  type AssignmentState,
  type BlockedReason,
} from '../domain/contracts';

const {
  resolveAssignWork,
  dispatchWorker,
  waitWorkerTurnEnd,
  observeDelivery,
  sendSupervisorFollowUp,
  interruptWorker,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 5,
  },
});

export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');
export const cancelSignal = defineSignal('cancel');
export const reviewSignal = defineSignal<
  [{ verdict: 'ACCEPT' | 'REVISE' | 'BLOCKED'; deliverySha: string; notes?: string }]
>('review');

export interface AssignmentStatusView {
  assignmentId: string;
  state: AssignmentState;
  supervisorThreadId?: string;
  workerThreadId?: string;
  deliverySha?: string;
  mailboxId?: string;
  blockedReason?: BlockedReason;
  paused: boolean;
}

export const statusQuery = defineQuery<AssignmentStatusView>('status');

export interface AssignmentWorkflowInput extends AssignWorkInput {
  projectCwd: string;
  baseBranch: string;
  worktreePath?: string;
  deliveryGraceMs?: number;
}

export interface AssignmentWorkflowResult {
  assignmentId: string;
  state: AssignmentState;
  deliverySha?: string;
  blockedReason?: BlockedReason;
  mailboxId?: string;
}

export async function assignmentWorkflow(
  input: AssignmentWorkflowInput,
): Promise<AssignmentWorkflowResult> {
  let paused = false;
  let cancelled = false;
  let review:
    | { verdict: 'ACCEPT' | 'REVISE' | 'BLOCKED'; deliverySha: string; notes?: string }
    | undefined;
  let status: AssignmentStatusView = {
    assignmentId: input.assignmentId ?? 'pending',
    state: 'queued',
    paused: false,
  };

  setHandler(pauseSignal, () => {
    paused = true;
    status = { ...status, paused: true, state: 'paused' };
  });
  setHandler(resumeSignal, () => {
    paused = false;
    status = { ...status, paused: false };
  });
  setHandler(cancelSignal, () => {
    cancelled = true;
  });
  setHandler(reviewSignal, (payload) => {
    review = payload;
  });
  setHandler(statusQuery, () => status);

  const resolved = await resolveAssignWork(input);
  if (!resolved.ok) {
    status = {
      ...status,
      assignmentId: input.assignmentId ?? 'unknown',
      state: 'blocked',
      blockedReason: resolved.error,
    };
    return {
      assignmentId: status.assignmentId,
      state: 'blocked',
      blockedReason: resolved.error,
    };
  }

  const { assignmentId, supervisorThreadId } = resolved;
  status = { ...status, assignmentId, supervisorThreadId, state: 'dispatched' };

  if (cancelled) {
    status = { ...status, state: 'cancelled' };
    return { assignmentId, state: 'cancelled' };
  }

  const workerThreadId = uuid4();
  const dispatched = await dispatchWorker({
    assignmentId,
    supervisorThreadId,
    workerThreadId,
    assign: input,
    projectCwd: input.projectCwd,
    baseBranch: input.baseBranch,
    worktreePath: input.worktreePath,
  });
  status = {
    ...status,
    workerThreadId: dispatched.workerThreadId,
    state: 'running',
  };

  if (cancelled) {
    await interruptWorker({
      assignmentId,
      workerThreadId: dispatched.workerThreadId,
    });
    status = { ...status, state: 'cancelled' };
    return { assignmentId, state: 'cancelled' };
  }

  await waitWorkerTurnEnd(dispatched.workerThreadId);

  const grace = input.deliveryGraceMs ?? DEFAULT_DELIVERY_GRACE_MS;
  const pollEveryMs = 5_000;
  const iterations = Math.max(1, Math.ceil(grace / pollEveryMs));
  let deliverySha: string | undefined;
  const observedWorktree = dispatched.worktreePath;

  for (let i = 0; i < iterations; i++) {
    if (cancelled) {
      await interruptWorker({
        assignmentId,
        workerThreadId: dispatched.workerThreadId,
      });
      status = { ...status, state: 'cancelled' };
      return { assignmentId, state: 'cancelled' };
    }

    const { verdict } = await observeDelivery({
      worktreePath: observedWorktree,
      baseCommit: input.baseCommit,
      assignmentId,
    });

    if (verdict.status === 'delivered') {
      deliverySha = verdict.deliverySha;
      break;
    }
    if (i < iterations - 1) {
      await sleep(pollEveryMs);
    }
  }

  if (!deliverySha) {
    const last = await observeDelivery({
      worktreePath: observedWorktree,
      baseCommit: input.baseCommit,
      assignmentId,
    });
    const reason: BlockedReason =
      last.verdict.status === 'unbound' ? 'delivery_unbound' : 'no_delivery';
    status = { ...status, state: 'blocked', blockedReason: reason };
    return { assignmentId, state: 'blocked', blockedReason: reason };
  }

  status = { ...status, state: 'delivered', deliverySha };

  // Pause defers mailbox until resume.
  await condition(() => !paused || cancelled);
  if (cancelled) {
    status = { ...status, state: 'cancelled' };
    return { assignmentId, state: 'cancelled', deliverySha };
  }

  let mailbox = await sendSupervisorFollowUp({
    assignmentId,
    supervisorThreadId,
    deliverySha,
    specSha: input.specSha,
  });

  while (!mailbox.sent) {
    if (cancelled) {
      status = { ...status, state: 'cancelled', mailboxId: mailbox.mailboxId };
      return { assignmentId, state: 'cancelled', deliverySha, mailboxId: mailbox.mailboxId };
    }
    await sleep(5_000);
    await condition(() => !paused || cancelled);
    if (cancelled) {
      status = { ...status, state: 'cancelled', mailboxId: mailbox.mailboxId };
      return { assignmentId, state: 'cancelled', deliverySha, mailboxId: mailbox.mailboxId };
    }
    mailbox = await sendSupervisorFollowUp({
      assignmentId,
      supervisorThreadId,
      deliverySha,
      specSha: input.specSha,
      mailboxId: mailbox.mailboxId,
    });
  }

  status = { ...status, state: 'in_review', mailboxId: mailbox.mailboxId };

  // Wait for supervisor review signal (or cancel).
  await condition(() => review !== undefined || cancelled);
  if (cancelled) {
    status = { ...status, state: 'cancelled' };
    return {
      assignmentId,
      state: 'cancelled',
      deliverySha,
      mailboxId: mailbox.mailboxId,
    };
  }

  if (!review) {
    return {
      assignmentId,
      state: 'in_review',
      deliverySha,
      mailboxId: mailbox.mailboxId,
    };
  }

  if (review.deliverySha !== deliverySha) {
    status = { ...status, state: 'blocked', blockedReason: 'stale_review' };
    return {
      assignmentId,
      state: 'blocked',
      deliverySha,
      blockedReason: 'stale_review',
      mailboxId: mailbox.mailboxId,
    };
  }

  if (review.verdict === 'ACCEPT') {
    status = { ...status, state: 'accepted' };
    return {
      assignmentId,
      state: 'accepted',
      deliverySha,
      mailboxId: mailbox.mailboxId,
    };
  }
  if (review.verdict === 'BLOCKED') {
    status = { ...status, state: 'blocked', blockedReason: 'supervisor_blocked' };
    return {
      assignmentId,
      state: 'blocked',
      deliverySha,
      blockedReason: 'supervisor_blocked',
      mailboxId: mailbox.mailboxId,
    };
  }

  // REVISE: v0 records revise intent; a follow-up workflow/turn is a later enhancement.
  status = { ...status, state: 'revise' };
  return {
    assignmentId,
    state: 'revise',
    deliverySha,
    mailboxId: mailbox.mailboxId,
  };
}

/** Keep hello-world example for Temporal smoke checks. */
export { example } from './example';
