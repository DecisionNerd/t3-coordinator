import {
  ActivityCancellationType,
  CancellationScope,
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
import { MAX_REVISE_DISPATCHES, type FailureClass, type StepFailure } from '../domain/process/types';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 5 },
});

const waitActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 hours',
  heartbeatTimeout: '30 seconds',
  cancellationType: ActivityCancellationType.TRY_CANCEL,
  retry: { maximumAttempts: 1 },
});

const onceActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 1 },
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
  failureClass?: FailureClass;
  paused: boolean;
  attempt: number;
}

export const statusQuery = defineQuery<AssignmentStatusView>('status');

export interface AssignmentWorkflowInput extends AssignWorkInput {
  projectCwd: string;
  baseBranch: string;
  worktreePath?: string;
  deliveryGraceMs?: number;
  awaitReview?: boolean;
  onFail?: StepFailure['allowedNext'];
  exclude?: Array<{ instanceId?: string; modelId?: string }>;
}

export interface AssignmentWorkflowResult {
  assignmentId: string;
  state: AssignmentState;
  deliverySha?: string;
  blockedReason?: BlockedReason;
  mailboxId?: string;
  workerThreadId?: string;
  failure?: StepFailure;
}

function dispatchCommandId(assignmentId: string, workerThreadId: string, attempt: number): string {
  return `cmd_${assignmentId}_${workerThreadId}_dispatch_rev${attempt}`;
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
    attempt: input.attempt ?? 0,
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

  const resolved = await acts.resolveAssignWork(input);
  if (!resolved.ok) {
    const assignmentId = input.assignmentId ?? 'unknown';
    const failure: StepFailure = {
      kind: 'StepFailure',
      processInstanceId: input.processInstanceId,
      stepId: input.stepId,
      assignmentId,
      failureClass: 'dispatch_failed',
      attempted: input.attempt ?? 0,
      allowedNext: input.onFail ?? ['retry_same', 'retry_role', 'block', 'cancel_graph'],
      evidence: resolved.error,
    };
    status = {
      ...status,
      assignmentId,
      state: 'blocked',
      blockedReason: resolved.error,
      failureClass: 'dispatch_failed',
    };
    // No supervisor thread to mail when unbound — still return StepFailure to the parent.
    return {
      assignmentId,
      state: 'blocked',
      blockedReason: resolved.error,
      failure,
    };
  }

  const { assignmentId, supervisorThreadId } = resolved;
  const role = input.role ?? 'implement';
  const timeoutMs = input.timeoutMs ?? 2 * 60 * 60 * 1000;
  const maxRevise = input.maxRevise ?? MAX_REVISE_DISPATCHES;
  let workerThreadId = input.workerThreadId;
  let instanceId = input.instanceId;
  let modelId = input.modelId;
  let attempt = input.attempt ?? 0;
  status = { ...status, assignmentId, supervisorThreadId, state: 'dispatched', attempt };

  const fail = async (
    failureClass: FailureClass,
    extra?: { evidence?: string; deliverySha?: string },
  ): Promise<AssignmentWorkflowResult> => {
    const failure: StepFailure = {
      kind: 'StepFailure',
      processInstanceId: input.processInstanceId,
      stepId: input.stepId,
      assignmentId,
      workerThreadId,
      instanceId,
      modelId,
      failureClass,
      attempted: attempt,
      allowedNext: input.onFail ?? ['retry_same', 'retry_role', 'block', 'cancel_graph'],
      evidence: extra?.evidence,
    };
    const mailbox = await mailUntilSent({
      assignmentId,
      supervisorThreadId,
      specSha: input.specSha,
      deliverySha: extra?.deliverySha,
      failure,
      processInstanceId: input.processInstanceId,
      stepId: input.stepId,
      cancelled: () => cancelled,
      paused: () => paused,
    });
    status = {
      ...status,
      state: failureClass === 'cancelled' ? 'cancelled' : 'blocked',
      blockedReason: failureClass,
      failureClass,
      mailboxId: mailbox.mailboxId,
      workerThreadId,
    };
    return {
      assignmentId,
      state: status.state,
      blockedReason: failureClass,
      mailboxId: mailbox.mailboxId,
      workerThreadId,
      deliverySha: extra?.deliverySha,
      failure,
    };
  };

  while (attempt < maxRevise) {
    if (cancelled) {
      if (workerThreadId) {
        await acts.interruptWorker({ assignmentId, workerThreadId });
      }
      return fail('cancelled');
    }

    const selected = await acts.selectWorkerModelForAttempt({
      role,
      projectCwd: input.projectCwd,
      mode: workerThreadId ? 'regate' : input.exclude?.length ? 'retry_role' : 'select',
      current: workerThreadId ? { instanceId, modelId } : undefined,
      exclude: input.exclude,
      allowReviewFallback: Boolean(input.exclude?.length) && role === 'review',
    });
    if (!selected.ok) {
      return fail(selected.failureClass, { evidence: selected.detail });
    }
    instanceId = selected.selection.instanceId;
    modelId = selected.selection.modelId;
    if (!workerThreadId) workerThreadId = uuid4();
    status = { ...status, workerThreadId, attempt, state: 'dispatched' };

    const assign: AssignWorkInput = { ...input, assignmentId, instanceId, modelId, role };
    const commandId = dispatchCommandId(assignmentId, workerThreadId, attempt);
    let dispatched: Awaited<ReturnType<typeof acts.dispatchWorker>>;
    try {
      dispatched = await acts.dispatchWorker({
        assignmentId,
        supervisorThreadId,
        workerThreadId,
        commandId,
        assign,
        projectCwd: input.projectCwd,
        baseBranch: input.baseBranch,
        worktreePath: input.worktreePath,
      });
    } catch (err) {
      return fail('dispatch_failed', { evidence: String(err) });
    }
    workerThreadId = dispatched.workerThreadId;
    status = { ...status, workerThreadId, state: 'running' };

    const turn = await waitTurnOrCancel({
      threadId: workerThreadId,
      timeoutMs,
      isCancelled: () => cancelled,
    });
    if (turn.kind === 'cancel') {
      await acts.interruptWorker({ assignmentId, workerThreadId });
      return fail('cancelled');
    }

    const turnState = turn.turn.state;
    if (turnState === 'timeout' || turnState === 'turn_timeout') {
      return fail('turn_timeout');
    }
    if (turnState !== 'completed') {
      return fail('worker_turn_failed', { evidence: `turn state ${turnState}` });
    }

    const grace = input.deliveryGraceMs ?? DEFAULT_DELIVERY_GRACE_MS;
    const pollEveryMs = 5_000;
    const iterations = Math.max(1, Math.ceil(grace / pollEveryMs));
    let deliverySha: string | undefined;
    for (let i = 0; i < iterations; i++) {
      if (cancelled) {
        await acts.interruptWorker({ assignmentId, workerThreadId });
        return fail('cancelled');
      }
      const { verdict } = await acts.observeDelivery({
        worktreePath: dispatched.worktreePath,
        baseCommit: input.baseCommit,
        assignmentId,
      });
      if (verdict.status === 'delivered') {
        deliverySha = verdict.deliverySha;
        break;
      }
      if (i < iterations - 1) await sleep(pollEveryMs);
    }

    if (!deliverySha) {
      const last = await acts.observeDelivery({
        worktreePath: dispatched.worktreePath,
        baseCommit: input.baseCommit,
        assignmentId,
      });
      const reason: FailureClass =
        last.verdict.status === 'unbound' ? 'delivery_unbound' : 'no_delivery';
      return fail(reason);
    }

    status = { ...status, state: 'delivered', deliverySha };
    await condition(() => !paused || cancelled);
    if (cancelled) return fail('cancelled', { deliverySha });

    const mailbox = await mailUntilSent({
      assignmentId,
      supervisorThreadId,
      specSha: input.specSha,
      deliverySha,
      cancelled: () => cancelled,
      paused: () => paused,
    });
    const awaitReview = input.awaitReview ?? !input.processInstanceId;
    if (!awaitReview) {
      status = { ...status, state: 'delivered', mailboxId: mailbox.mailboxId };
      return {
        assignmentId,
        state: 'delivered',
        deliverySha,
        mailboxId: mailbox.mailboxId,
        workerThreadId,
      };
    }
    status = { ...status, state: 'in_review', mailboxId: mailbox.mailboxId };

    await condition(() => review !== undefined || cancelled);
    if (cancelled) return fail('cancelled', { deliverySha });
    const submitted = review as
      | { verdict: 'ACCEPT' | 'REVISE' | 'BLOCKED'; deliverySha: string; notes?: string }
      | undefined;
    if (!submitted) {
      return {
        assignmentId,
        state: 'in_review',
        deliverySha,
        mailboxId: mailbox.mailboxId,
        workerThreadId,
      };
    }
    if (submitted.deliverySha !== deliverySha) {
      return fail('stale_review', { deliverySha });
    }
    if (submitted.verdict === 'ACCEPT') {
      status = { ...status, state: 'accepted' };
      return {
        assignmentId,
        state: 'accepted',
        deliverySha,
        mailboxId: mailbox.mailboxId,
        workerThreadId,
      };
    }
    if (submitted.verdict === 'BLOCKED') {
      return fail('worker_turn_failed', {
        deliverySha,
        evidence: 'supervisor_blocked',
      });
    }

    attempt += 1;
    review = undefined;
    status = { ...status, state: 'revise', attempt };
    if (attempt >= maxRevise) {
      return fail('worker_turn_failed', { deliverySha, evidence: 'revise_cap' });
    }
  }

  return fail('worker_turn_failed', { evidence: 'revise_cap' });
}

async function waitTurnOrCancel(input: {
  threadId: string;
  timeoutMs: number;
  isCancelled: () => boolean;
}): Promise<
  | { kind: 'turn'; turn: { turnId: string | null; state: string } }
  | { kind: 'cancel' }
> {
  const scope = new CancellationScope();
  const waitP = scope.run(() =>
    waitActs.waitWorkerTurnEnd({ threadId: input.threadId, timeoutMs: input.timeoutMs }),
  );
  const cancelP = condition(input.isCancelled);
  const raced = await Promise.race([
    waitP.then((turn) => ({ kind: 'turn' as const, turn })),
    cancelP.then(() => ({ kind: 'cancel' as const })),
  ]);
  if (raced.kind === 'cancel') {
    scope.cancel();
    try {
      await waitP;
    } catch {
      /* cancelled */
    }
    return raced;
  }
  return raced;
}

async function mailUntilSent(input: {
  assignmentId: string;
  supervisorThreadId: string;
  specSha: string;
  deliverySha?: string;
  failure?: StepFailure;
  processInstanceId?: string;
  stepId?: string;
  cancelled: () => boolean;
  paused: () => boolean;
}): Promise<{ mailboxId: string; sent: boolean }> {
  let mailbox = await onceActs.sendSupervisorFollowUp({
    assignmentId: input.assignmentId,
    supervisorThreadId: input.supervisorThreadId,
    specSha: input.specSha,
    deliverySha: input.deliverySha,
    failure: input.failure,
    processInstanceId: input.processInstanceId,
    stepId: input.stepId,
  });
  while (!mailbox.sent) {
    if (input.cancelled()) return mailbox;
    await sleep(5_000);
    await condition(() => !input.paused() || input.cancelled());
    if (input.cancelled()) return mailbox;
    mailbox = await onceActs.sendSupervisorFollowUp({
      assignmentId: input.assignmentId,
      supervisorThreadId: input.supervisorThreadId,
      specSha: input.specSha,
      deliverySha: input.deliverySha,
      failure: input.failure,
      processInstanceId: input.processInstanceId,
      stepId: input.stepId,
      mailboxId: mailbox.mailboxId,
    });
  }
  return mailbox;
}

/** Keep hello-world example for Temporal smoke checks. */
export { example } from './example';
