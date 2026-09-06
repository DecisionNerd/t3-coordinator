import {
  MAX_RETRY_ROLE,
  MAX_RETRY_SAME,
  type OnFailAction,
  type RecoveryDecision,
  type StepRole,
} from './types';

const ROLE_CAPS: Record<StepRole, { retrySameMax: number; retryRoleMax: number }> = {
  implement: { retrySameMax: MAX_RETRY_SAME, retryRoleMax: MAX_RETRY_ROLE },
  investigate: { retrySameMax: MAX_RETRY_SAME, retryRoleMax: MAX_RETRY_ROLE },
  review: { retrySameMax: 0, retryRoleMax: MAX_RETRY_ROLE },
  check: { retrySameMax: 0, retryRoleMax: 0 },
};

export type EngineCapsByRole = Record<StepRole, { maxRetrySame: number; maxRetryRole: number }>;

/**
 * Catalog may lower the role default via step fields. Optional `engineCaps` come from
 * role-policies.json (loaded outside the workflow isolate).
 */
export function retryCaps(
  role: StepRole,
  step?: { retrySameMax?: number; retryRoleMax?: number },
  engineCaps?: EngineCapsByRole,
): {
  retrySameMax: number;
  retryRoleMax: number;
} {
  const fromPolicy = engineCaps?.[role];
  const defaults = fromPolicy
    ? { retrySameMax: fromPolicy.maxRetrySame, retryRoleMax: fromPolicy.maxRetryRole }
    : ROLE_CAPS[role];
  return {
    retrySameMax: step?.retrySameMax ?? defaults.retrySameMax,
    retryRoleMax: step?.retryRoleMax ?? defaults.retryRoleMax,
  };
}

/**
 * Walk declared onFail in order. Never invent actions. escalate waits for supervisor
 * to pick from allowedNext (the remaining declared actions except escalate itself).
 * When only retries were declared and spent, escalate with the closed stop set so the
 * parent does not silently continue or invent `block`.
 */
export function decideOnFail(input: {
  onFail: OnFailAction[];
  retrySameUsed: number;
  retryRoleUsed: number;
  retrySameMax: number;
  retryRoleMax: number;
}): RecoveryDecision {
  const retrySameSkipped =
    !input.onFail.includes('retry_same') || input.retrySameMax <= 0 || input.retrySameUsed > 0;
  const allowedNext = input.onFail;
  for (const action of input.onFail) {
    if (action === 'retry_same' && input.retrySameUsed < input.retrySameMax) {
      return { kind: 'RecoveryDecision', action, allowedNext };
    }
    if (
      action === 'retry_role' &&
      retrySameSkipped &&
      input.retryRoleUsed < input.retryRoleMax
    ) {
      return { kind: 'RecoveryDecision', action, allowedNext };
    }
    if (action === 'escalate') {
      const remaining = input.onFail.filter((a) => a !== 'escalate');
      return {
        kind: 'RecoveryDecision',
        action,
        allowedNext: remaining.length > 0 ? remaining : ['block', 'cancel_graph'],
      };
    }
    if (action === 'block' || action === 'cancel_graph') {
      return { kind: 'RecoveryDecision', action, allowedNext };
    }
  }
  // Retries spent and no declared terminal — escalate rather than invent silent block.
  return {
    kind: 'RecoveryDecision',
    action: 'escalate',
    allowedNext: ['block', 'cancel_graph'],
  };
}

export function formatStepFailed(failure: {
  processInstanceId?: string;
  stepId?: string;
  assignmentId: string;
  workerThreadId?: string;
  failureClass: string;
  attempted: number;
  allowedNext: string[];
  evidence?: string;
}): string {
  return [
    'StepFailed',
    `  processInstanceId ${failure.processInstanceId ?? '-'}`,
    `  stepId ${failure.stepId ?? '-'}`,
    `  assignmentId ${failure.assignmentId}`,
    `  workerThreadId ${failure.workerThreadId ?? '-'}`,
    `  failureClass ${failure.failureClass}`,
    `  attempted ${failure.attempted}`,
    `  allowedNext ${failure.allowedNext.join(', ')}`,
    failure.evidence ? `  evidence ${failure.evidence}` : '',
    'Pick only an allowedNext action (retry, block, cancel). Do not invent a new plan.',
  ]
    .filter(Boolean)
    .join('\n');
}
