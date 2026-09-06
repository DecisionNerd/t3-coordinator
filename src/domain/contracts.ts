/**
 * Pure domain helpers for assignment identity, delivery observation, and binding.
 * No Temporal or T3 I/O here — keep these unit-testable.
 */

export const COORDINATED_BY_PREFIX = 'Coordinated-By:';
export const DEFAULT_DELIVERY_GRACE_MS = 5 * 60 * 1000;
export const TASK_QUEUE = 't3-coordinator';

export type AssignmentState =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'delivered'
  | 'in_review'
  | 'revise'
  | 'accepted'
  | 'blocked'
  | 'paused'
  | 'cancelled';

export type BlockedReason =
  | 'supervisor_blocked'
  | 'no_delivery'
  | 'delivery_unbound'
  | 'dispatch_failed'
  | 'turn_timeout'
  | 'worker_turn_failed'
  | 'stale_review'
  | 'cancelled'
  | string;

export interface AssignWorkInput {
  repo: string;
  specSha: string;
  baseCommit: string;
  environmentId: string;
  /** Optional; must match binding when present. */
  supervisorThreadId?: string;
  instanceId: string;
  modelId: string;
  goal: string;
  assignmentId?: string;
  role?: 'investigate' | 'implement' | 'review' | 'check';
  workerThreadId?: string;
  processInstanceId?: string;
  stepId?: string;
  attempt?: number;
  timeoutMs?: number;
  maxRevise?: number;
}

export interface SupervisorBinding {
  environmentId: string;
  supervisorThreadId: string;
  boundAt: string;
}

export interface BindingsFile {
  version: 1;
  supervisors: Record<string, SupervisorBinding>;
}

export interface DeliveryObservation {
  headSha: string;
  baseCommit: string;
  commitMessage: string;
  dirty: boolean;
  observedAt: string;
}

export type DeliveryVerdict =
  | { status: 'delivered'; deliverySha: string; dirty: boolean }
  | { status: 'pending' }
  | { status: 'unbound'; headSha: string; dirty: boolean };

export function coordinatedByTrailer(assignmentId: string): string {
  return `${COORDINATED_BY_PREFIX} ${assignmentId}`;
}

export function commitMessageHasTrailer(message: string, assignmentId: string): boolean {
  const needle = coordinatedByTrailer(assignmentId).toLowerCase();
  return message
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .some((line) => line === needle);
}

export function evaluateDelivery(input: {
  assignmentId: string;
  baseCommit: string;
  observation: DeliveryObservation;
}): DeliveryVerdict {
  const { assignmentId, baseCommit, observation } = input;
  if (observation.headSha === baseCommit) {
    return { status: 'pending' };
  }
  if (!commitMessageHasTrailer(observation.commitMessage, assignmentId)) {
    return {
      status: 'unbound',
      headSha: observation.headSha,
      dirty: observation.dirty,
    };
  }
  return {
    status: 'delivered',
    deliverySha: observation.headSha,
    dirty: observation.dirty,
  };
}

export function workerPromptContract(assignmentId: string, goal: string, specSha: string): string {
  return [
    goal.trim(),
    '',
    `Specification object: ${specSha}`,
    `Assignment id: ${assignmentId}`,
    '',
    'When finished, create a git commit on this worktree whose message body contains exactly:',
    coordinatedByTrailer(assignmentId),
    'Do not claim success without that commit. The coordinator verifies git, not your summary.',
  ].join('\n');
}

/** Stable idempotency material for assignment id derivation. */
export function assignmentIdempotencyKey(input: AssignWorkInput): string {
  return [
    input.repo,
    input.specSha,
    input.baseCommit,
    input.environmentId,
    input.instanceId,
    input.modelId,
  ].join('\0');
}

/**
 * Resolve which T3 thread owns mailbox follow-ups for an assignment.
 * Prefer the calling thread id, else the saved binding.
 * Sticky bind is optional for MCP visibility. When both are absent, the activity
 * layer creates a durable operator inbox (not model-invented ids) — see ensureOperatorInbox.
 */
export function resolveSupervisorThread(input: {
  binding: SupervisorBinding | undefined;
  requestedThreadId?: string;
}):
  | { ok: true; supervisorThreadId: string; shouldBind: boolean }
  | { ok: false; error: 'supervisor_unbound' } {
  if (input.requestedThreadId) {
    const shouldBind =
      !input.binding || input.binding.supervisorThreadId !== input.requestedThreadId;
    return { ok: true, supervisorThreadId: input.requestedThreadId, shouldBind };
  }
  if (input.binding) {
    return {
      ok: true,
      supervisorThreadId: input.binding.supervisorThreadId,
      shouldBind: false,
    };
  }
  return { ok: false, error: 'supervisor_unbound' };
}

export function isThreadBusy(snapshot: {
  latestTurnState: string | null;
  sessionStatus: string | null;
  hasQueuedTurnStart: boolean;
  hasRaisedHand: boolean;
}): boolean {
  if (snapshot.latestTurnState === 'running') return true;
  if (snapshot.sessionStatus === 'starting' || snapshot.sessionStatus === 'running') return true;
  if (snapshot.hasQueuedTurnStart) return true;
  if (snapshot.hasRaisedHand) return true;
  return false;
}
