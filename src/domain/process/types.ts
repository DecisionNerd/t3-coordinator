export const ON_FAIL_ACTIONS = [
  'retry_same',
  'retry_role',
  'block',
  'cancel_graph',
  'escalate',
] as const;
export type OnFailAction = (typeof ON_FAIL_ACTIONS)[number];

export const STEP_ROLES = ['investigate', 'implement', 'review', 'check'] as const;
export type StepRole = (typeof STEP_ROLES)[number];

export const FAILURE_CLASSES = [
  'dispatch_failed',
  'turn_timeout',
  'worker_turn_failed',
  'no_delivery',
  'delivery_unbound',
  'constraint_fail',
  'child_failed',
  'cancelled',
  'stale_review',
  'process_map_gap',
  'provider_unavailable',
  'model_missing',
  'usage_exhausted',
  'usage_unknown',
  'ranking_unavailable',
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export interface ProcessClassification {
  signals: string[];
  excludes: string[];
  threshold: number;
}

export interface ProcessStep {
  id: string;
  process: string;
  role: StepRole;
  engine?: 'native' | 'worker';
  in: string[];
  out: string[];
  timeoutMs: number;
  dependsOn?: string[];
  onFail: OnFailAction[];
  retrySameMax?: number;
  retryRoleMax?: number;
  goalTemplate?: string;
}

export interface ProcessDefinition {
  id: string;
  consumes: string[];
  produces: string[];
  classify?: boolean;
  classification?: ProcessClassification;
  steps: ProcessStep[];
}

export interface ProcessSelectionScore {
  processId: string;
  score: number;
  matchedSignals: string[];
  matchedExcludes: string[];
}

export interface ProcessSelection {
  kind: 'ProcessSelection';
  goal: string;
  threshold: number;
  candidates: ProcessSelectionScore[];
  selected: string | null;
  unmappedCharacteristics: string[];
}

export interface ProcessMapGap {
  kind: 'ProcessMapGap';
  goal: string;
  bestProcessId: string | null;
  bestScore: number;
  threshold: number;
  unmappedCharacteristics: string[];
  message: string;
}

export interface StepFailure {
  kind: 'StepFailure';
  processInstanceId?: string;
  stepId?: string;
  assignmentId: string;
  workerThreadId?: string;
  instanceId?: string;
  modelId?: string;
  failureClass: FailureClass;
  attempted: number;
  allowedNext: OnFailAction[];
  evidence?: string;
}

export interface RecoveryDecision {
  kind: 'RecoveryDecision';
  action: OnFailAction;
  allowedNext: OnFailAction[];
}

export interface ModelSelection {
  kind: 'ModelSelection';
  instanceId: string;
  modelId: string;
  aaId?: string;
  role: StepRole;
  Q?: number;
  C?: number;
  Q_over_C?: number;
  rankingSource: 'aa' | 'aa_stale' | 'unranked';
  reviewFallback?: boolean;
  frontierPeers?: string[];
  remainingWindowPercents?: number[];
  attribution?: string;
}

export const AA_ATTRIBUTION = 'https://artificialanalysis.ai/';
export const AA_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_USAGE_MAX_PERCENT = 100;
export const WORKER_USAGE_MAX_PERCENT = 90;
export const MAX_RETRY_SAME = 1;
export const MAX_RETRY_ROLE = 1;
export const MAX_REVISE_DISPATCHES = 2;
