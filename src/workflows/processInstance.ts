import {
  condition,
  defineQuery,
  defineSignal,
  executeChild,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type * as activities from '../activities';
import { decideOnFail, retryCaps, type EngineCapsByRole } from '../domain/process/onFail';
import { nextReadyStep } from '../domain/process/dag';
import { stepGoal } from '../domain/process/prompts';
import type {
  FailureClass,
  OnFailAction,
  ProcessDefinition,
  ProcessStep,
  StepFailure,
} from '../domain/process/types';
import {
  assignmentWorkflow,
  type AssignmentWorkflowResult,
} from './assignment';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});

export const processPauseSignal = defineSignal('processPause');
export const processResumeSignal = defineSignal('processResume');
export const processCancelSignal = defineSignal('processCancel');
export const processRecoverSignal = defineSignal<[{ action: OnFailAction }]>(
  'processRecovery',
);
export const processRecoverySignal = processRecoverSignal;

export interface ProcessInstanceStatusView {
  processInstanceId: string;
  processId: string;
  state: 'running' | 'blocked' | 'cancelled' | 'completed' | 'paused';
  stepId?: string;
  failureClass?: FailureClass;
  allowedNext?: OnFailAction[];
  assignmentId?: string;
  paused: boolean;
}

export const processStatusQuery = defineQuery<ProcessInstanceStatusView>('processStatus');

export interface ProcessInstanceInput {
  processInstanceId: string;
  processId: string;
  goal: string;
  repo: string;
  specSha: string;
  baseCommit: string;
  environmentId: string;
  projectCwd: string;
  baseBranch: string;
  supervisorThreadId?: string;
  instanceId?: string;
  modelId?: string;
  selection?: unknown;
}

export type ProcessInstanceWorkflowInput = ProcessInstanceInput;

export interface ProcessInstanceResult {
  processInstanceId: string;
  processId: string;
  state: ProcessInstanceStatusView['state'];
  failure?: StepFailure;
}

export type ProcessInstanceWorkflowResult = ProcessInstanceResult;

export async function processInstanceWorkflow(
  input: ProcessInstanceInput,
): Promise<ProcessInstanceResult> {
  let paused = false;
  let cancelled = false;
  let recovery: { action: OnFailAction } | undefined;
  let view: ProcessInstanceStatusView = {
    processInstanceId: input.processInstanceId,
    processId: input.processId,
    state: 'running',
    paused: false,
  };

  setHandler(processPauseSignal, () => {
    paused = true;
    view = { ...view, paused: true, state: 'paused' };
  });
  setHandler(processResumeSignal, () => {
    paused = false;
    view = { ...view, paused: false, state: view.state === 'paused' ? 'running' : view.state };
  });
  setHandler(processCancelSignal, () => {
    cancelled = true;
  });
  setHandler(processRecoverSignal, (payload) => {
    recovery = payload;
  });
  setHandler(processStatusQuery, () => view);

  const catalog = await acts.loadCatalog(input.projectCwd);
  const engineCaps = await acts.loadEngineCaps(input.projectCwd);
  const def = catalog.find((p) => p.id === input.processId);
  if (!def) {
    return terminal(input, 'blocked', {
      kind: 'StepFailure',
      processInstanceId: input.processInstanceId,
      stepId: 'start',
      assignmentId: input.processInstanceId,
      failureClass: 'process_map_gap',
      attempted: 0,
      allowedNext: ['block', 'cancel_graph'],
      evidence: `Unknown process ${input.processId}`,
    });
  }
  const missing = def.steps.filter((s) => !s.onFail || s.onFail.length === 0);
  if (missing.length > 0) {
    throw new Error(
      `Catalog error: every step must declare onFail (${def.id}: ${missing.map((s) => s.id).join(', ')})`,
    );
  }

  await persist(input, view);
  await acts.writeProcessArtifact({
    projectCwd: input.projectCwd,
    processInstanceId: input.processInstanceId,
    name: 'UserGoal',
    value: { type: 'UserGoal', text: input.goal, repo: input.repo },
  });

  const artifactDir = `.t3/instances/${input.processInstanceId}`;
  const completed = new Set<string>();

  for (;;) {
    if (cancelled) {
      view = { ...view, state: 'cancelled' };
      await persist(input, view);
      return { processInstanceId: input.processInstanceId, processId: input.processId, state: 'cancelled' };
    }
    await condition(() => !paused || cancelled);
    if (cancelled) {
      view = { ...view, state: 'cancelled' };
      await persist(input, view);
      return { processInstanceId: input.processInstanceId, processId: input.processId, state: 'cancelled' };
    }
    const step = nextReadyStep(def.steps, completed);
    if (!step) {
      const leftover = def.steps.filter((s) => !completed.has(s.id));
      if (leftover.length > 0) {
        const failure: StepFailure = {
          kind: 'StepFailure',
          processInstanceId: input.processInstanceId,
          stepId: leftover[0]!.id,
          assignmentId: input.processInstanceId,
          failureClass: 'process_map_gap',
          attempted: 0,
          allowedNext: ['block', 'cancel_graph'],
          evidence: `No ready step; unmet dependsOn: ${leftover.map((s) => s.id).join(', ')}`,
        };
        view = { ...view, state: 'blocked', stepId: leftover[0]!.id, failureClass: failure.failureClass };
        await persist(input, view);
        return terminal(input, 'blocked', failure);
      }
      break;
    }
    view = { ...view, state: 'running', stepId: step.id };
    await persist(input, view);

    if (step.engine === 'native') {
      if (step.process === 'ClassifyEngineeringGoal') {
        const classified = await acts.classifyEngineeringGoal({
          goal: input.goal,
          projectCwd: input.projectCwd,
        });
        await acts.writeProcessArtifact({
          projectCwd: input.projectCwd,
          processInstanceId: input.processInstanceId,
          name: classified.kind,
          value: classified,
        });
      }
      completed.add(step.id);
      continue;
    }

    const outcome = await runWorkerStep({
      input,
      def,
      catalog,
      step,
      artifactDir,
      isCancelled: () => cancelled,
    });
    if (outcome.kind === 'success') {
      for (const name of step.out) {
        await acts.writeProcessArtifact({
          projectCwd: input.projectCwd,
          processInstanceId: input.processInstanceId,
          name,
          value: outcome.artifacts[name],
        });
      }
      completed.add(step.id);
      continue;
    }

    const failure = outcome.failure;
    view = {
      ...view,
      state: 'blocked',
      stepId: step.id,
      failureClass: failure.failureClass,
      allowedNext: failure.allowedNext,
      assignmentId: failure.assignmentId,
    };
    await persist(input, view);
    await acts.writeProcessArtifact({
      projectCwd: input.projectCwd,
      processInstanceId: input.processInstanceId,
      name: 'StepFailure',
      value: failure,
    });

    const recovered = await applyOnFail({
      input,
      def,
      catalog,
      step,
      artifactDir,
      failure,
      engineCaps,
      isCancelled: () => cancelled,
      waitRecovery: async (allowedNext) => {
        // Clear before publishing allowedNext so a supervisor signal cannot be
        // wiped after the client observes that escalate is waiting.
        recovery = undefined;
        view = { ...view, allowedNext, state: 'blocked' };
        await persist(input, view);
        await condition(() => recovery !== undefined || cancelled);
        return recovery;
      },
    });
    if (recovered.kind === 'success') {
      for (const name of step.out) {
        await acts.writeProcessArtifact({
          projectCwd: input.projectCwd,
          processInstanceId: input.processInstanceId,
          name,
          value: recovered.artifacts[name],
        });
      }
      completed.add(step.id);
      continue;
    }
    view = {
      ...view,
      state: recovered.state,
      failureClass: recovered.failure?.failureClass ?? failure.failureClass,
      allowedNext: recovered.failure?.allowedNext ?? failure.allowedNext,
    };
    await persist(input, view);
    return {
      processInstanceId: input.processInstanceId,
      processId: input.processId,
      state: recovered.state,
      failure: recovered.failure ?? failure,
    };
  }

  view = { ...view, state: 'completed', stepId: undefined };
  await persist(input, view);
  await acts.writeProcessArtifact({
    projectCwd: input.projectCwd,
    processInstanceId: input.processInstanceId,
    name: 'CompletionReport',
    value: {
      type: 'CompletionReport',
      processInstanceId: input.processInstanceId,
      status: 'completed',
    },
  });
  return { processInstanceId: input.processInstanceId, processId: input.processId, state: 'completed' };
}

async function persist(input: ProcessInstanceInput, view: ProcessInstanceStatusView): Promise<void> {
  await acts.writeProcessStatus({
    projectCwd: input.projectCwd,
    status: {
      processInstanceId: view.processInstanceId,
      processId: view.processId,
      state: view.state === 'paused' ? 'running' : view.state,
      stepId: view.stepId,
      failureClass: view.failureClass,
      allowedNext: view.allowedNext,
      assignmentId: view.assignmentId,
    },
  });
}

function terminal(
  input: ProcessInstanceInput,
  state: ProcessInstanceResult['state'],
  failure?: StepFailure,
): ProcessInstanceResult {
  return {
    processInstanceId: input.processInstanceId,
    processId: input.processId,
    state,
    failure,
  };
}

async function runWorkerStep(input: {
  input: ProcessInstanceInput;
  def: ProcessDefinition;
  catalog: ProcessDefinition[];
  step: ProcessStep;
  artifactDir: string;
  isCancelled: () => boolean;
  workerThreadId?: string;
  exclude?: Array<{ instanceId?: string; modelId?: string }>;
  attempt?: number;
  current?: { instanceId?: string; modelId?: string };
}): Promise<
  | { kind: 'success'; artifacts: Record<string, unknown>; workerThreadId?: string; result: AssignmentWorkflowResult }
  | { kind: 'fail'; failure: StepFailure; workerThreadId?: string; result?: AssignmentWorkflowResult }
> {
  const assignmentId = `asgn_${input.input.processInstanceId}_${input.step.id}_${input.attempt ?? 0}`;
  const goal = stepGoal({
    catalog: input.catalog,
    step: input.step,
    goal: input.input.goal,
    artifactDir: input.artifactDir,
  });
  const selected = await acts.selectWorkerModelForAttempt({
    role: input.step.role,
    projectCwd: input.input.projectCwd,
    exclude: input.exclude,
    allowReviewFallback: (input.attempt ?? 0) > 0 && input.step.role === 'review',
    mode: input.workerThreadId ? 'regate' : input.exclude?.length ? 'retry_role' : 'select',
    current:
      input.workerThreadId && input.current?.instanceId && input.current.modelId
        ? { instanceId: input.current.instanceId, modelId: input.current.modelId }
        : undefined,
  });
  if (!selected.ok) {
    const failure: StepFailure = {
      kind: 'StepFailure',
      processInstanceId: input.input.processInstanceId,
      stepId: input.step.id,
      assignmentId,
      instanceId: input.current?.instanceId,
      modelId: input.current?.modelId,
      failureClass: selected.failureClass,
      attempted: input.attempt ?? 0,
      allowedNext: input.step.onFail,
      evidence: selected.detail,
    };
    await acts.sendSupervisorFollowUp({
      assignmentId,
      supervisorThreadId: input.input.supervisorThreadId ?? '',
      specSha: input.input.specSha,
      failure,
      processInstanceId: input.input.processInstanceId,
      stepId: input.step.id,
    });
    return { kind: 'fail', failure };
  }

  await acts.writeProcessArtifact({
    projectCwd: input.input.projectCwd,
    processInstanceId: input.input.processInstanceId,
    name: 'ModelSelection',
    value: selected.selection,
  });

  try {
    const result = await executeChild(assignmentWorkflow, {
      workflowId: `assignment-${assignmentId}`,
      args: [
        {
          repo: input.input.repo,
          specSha: input.input.specSha,
          baseCommit: input.input.baseCommit,
          environmentId: input.input.environmentId,
          supervisorThreadId: input.input.supervisorThreadId,
          instanceId: selected.selection.instanceId,
          modelId: selected.selection.modelId,
          goal,
          assignmentId,
          role: input.step.role,
          workerThreadId: input.workerThreadId,
          processInstanceId: input.input.processInstanceId,
          stepId: input.step.id,
          attempt: input.attempt ?? 0,
          awaitReview: input.step.role === 'implement',
          timeoutMs: input.step.timeoutMs,
          projectCwd: input.input.projectCwd,
          baseBranch: input.input.baseBranch,
          exclude: input.exclude,
          onFail: input.step.onFail,
        },
      ],
    });
    if (input.isCancelled()) {
      return {
        kind: 'fail',
        failure: {
          kind: 'StepFailure',
          processInstanceId: input.input.processInstanceId,
          stepId: input.step.id,
          assignmentId,
          workerThreadId: result.workerThreadId,
          failureClass: 'cancelled',
          attempted: input.attempt ?? 0,
          allowedNext: ['cancel_graph'],
        },
        workerThreadId: result.workerThreadId,
        result,
      };
    }
    if (result.state === 'accepted' || result.state === 'delivered') {
      const artifacts: Record<string, unknown> = {};
      for (const name of input.step.out) {
        if (name === 'ImplementationArtifact') {
          artifacts[name] = {
            type: 'ImplementationArtifact',
            assignmentId,
            deliverySha: result.deliverySha,
            specSha: input.input.specSha,
            workerThreadId: result.workerThreadId,
          };
        } else if (name === 'VerificationEvidence') {
          artifacts[name] = {
            type: 'VerificationEvidence',
            verdict: 'pass',
            deliverySha: result.deliverySha,
          };
        } else {
          artifacts[name] = {
            type: name,
            assignmentId,
            deliverySha: result.deliverySha,
          };
        }
      }
      return { kind: 'success', artifacts, workerThreadId: result.workerThreadId, result };
    }
    const failure: StepFailure = result.failure ?? {
      kind: 'StepFailure',
      processInstanceId: input.input.processInstanceId,
      stepId: input.step.id,
      assignmentId,
      workerThreadId: result.workerThreadId,
      instanceId: selected.selection.instanceId,
      modelId: selected.selection.modelId,
      failureClass: (result.blockedReason as FailureClass) ?? 'child_failed',
      attempted: input.attempt ?? 0,
      allowedNext: input.step.onFail,
    };
    if (!failure.instanceId) failure.instanceId = selected.selection.instanceId;
    if (!failure.modelId) failure.modelId = selected.selection.modelId;
    return { kind: 'fail', failure, workerThreadId: result.workerThreadId, result };
  } catch (err) {
    return {
      kind: 'fail',
      failure: {
        kind: 'StepFailure',
        processInstanceId: input.input.processInstanceId,
        stepId: input.step.id,
        assignmentId,
        failureClass: 'child_failed',
        attempted: input.attempt ?? 0,
        allowedNext: input.step.onFail,
        evidence: String(err),
      },
    };
  }
}

async function applyOnFail(input: {
  input: ProcessInstanceInput;
  def: ProcessDefinition;
  catalog: ProcessDefinition[];
  step: ProcessStep;
  artifactDir: string;
  failure: StepFailure;
  engineCaps?: EngineCapsByRole;
  isCancelled: () => boolean;
  waitRecovery: (
    allowedNext: OnFailAction[],
  ) => Promise<{ action: OnFailAction } | undefined>;
}): Promise<
  | { kind: 'success'; artifacts: Record<string, unknown> }
  | { kind: 'stop'; state: ProcessInstanceResult['state']; failure?: StepFailure }
> {
  const caps = retryCaps(input.step.role, input.step, input.engineCaps);
  let retrySameUsed = 0;
  let retryRoleUsed = 0;
  let last = input.failure;
  let workerThreadId = input.failure.workerThreadId;
  const exclude: Array<{ instanceId?: string; modelId?: string }> = [];

  for (;;) {
    if (input.isCancelled()) {
      return { kind: 'stop', state: 'cancelled', failure: { ...last, failureClass: 'cancelled' } };
    }
    const decision = decideOnFail({
      onFail: input.step.onFail,
      retrySameUsed,
      retryRoleUsed,
      retrySameMax: caps.retrySameMax,
      retryRoleMax: caps.retryRoleMax,
    });
    await acts.writeProcessArtifact({
      projectCwd: input.input.projectCwd,
      processInstanceId: input.input.processInstanceId,
      name: 'RecoveryDecision',
      value: decision,
    });

    if (decision.action === 'retry_same') {
      retrySameUsed += 1;
      const again = await runWorkerStep({
        ...input,
        workerThreadId,
        current: { instanceId: last.instanceId, modelId: last.modelId },
        attempt: retrySameUsed,
      });
      if (again.kind === 'success') return again;
      last = again.failure;
      workerThreadId = again.workerThreadId ?? workerThreadId;
      continue;
    }
    if (decision.action === 'retry_role') {
      retryRoleUsed += 1;
      if (last.instanceId || last.modelId) {
        exclude.push({ instanceId: last.instanceId, modelId: last.modelId });
      }
      const again = await runWorkerStep({
        ...input,
        workerThreadId: undefined,
        exclude,
        attempt: retrySameUsed + retryRoleUsed,
      });
      if (again.kind === 'success') return again;
      last = again.failure;
      continue;
    }
    if (decision.action === 'escalate') {
      let picked: { action: OnFailAction } | undefined;
      for (;;) {
        picked = await input.waitRecovery(decision.allowedNext);
        if (!picked || input.isCancelled()) {
          return { kind: 'stop', state: 'cancelled', failure: { ...last, failureClass: 'cancelled' } };
        }
        if (decision.allowedNext.includes(picked.action) || picked.action === 'cancel_graph') {
          break;
        }
      }
      if (!picked) {
        return { kind: 'stop', state: 'cancelled', failure: { ...last, failureClass: 'cancelled' } };
      }
      if (picked.action === 'block') {
        return { kind: 'stop', state: 'blocked', failure: last };
      }
      if (picked.action === 'cancel_graph') {
        return { kind: 'stop', state: 'cancelled', failure: { ...last, failureClass: 'cancelled' } };
      }
      if (picked.action === 'retry_same') {
        retrySameUsed = Math.max(0, retrySameUsed - 1);
        continue;
      }
      if (picked.action === 'retry_role') {
        retryRoleUsed = Math.max(0, retryRoleUsed - 1);
        continue;
      }
    }
    if (decision.action === 'cancel_graph') {
      return { kind: 'stop', state: 'cancelled', failure: { ...last, failureClass: 'cancelled' } };
    }
    return { kind: 'stop', state: 'blocked', failure: last };
  }
}
