import { Context } from '@temporalio/activity';
import { nanoid } from 'nanoid';
import { bindSupervisor, getSupervisorBinding } from './domain/bindings';
import {
  resolveSupervisorThread,
  workerPromptContract,
  type AssignWorkInput,
  isThreadBusy,
} from './domain/contracts';
import { deriveAssignmentId, observeWorktreeDelivery } from './domain/gitDelivery';
import { refreshAaCatalogIfStale } from './domain/models/aaCache';
import { needsProviderRefresh } from './domain/models/inventory';
import { loadT3ToAaMapping } from './domain/models/mapping';
import { loadRolePolicies } from './domain/models/rolePolicies';
import { selectWorkerModel, providerRunnable } from './domain/models/select';
import type { ModelSelectInput, ModelSelectResult, T3Provider } from './domain/models/types';
import {
  ensureOperatorInbox,
  OPERATOR_INBOX_FAIL_ASK,
  type MailboxSource,
} from './domain/operatorInbox';
import { classifyGoal } from './domain/process/classify';
import { writeArtifact } from './domain/process/artifacts';
import { getProcess, loadProcessCatalog } from './domain/process/catalog';
import { formatStepFailed } from './domain/process/onFail';
import { writeInstanceStatus, type ProcessInstanceStatus } from './domain/process/status';
import type { FailureClass, ModelSelection, OnFailAction, ProcessDefinition, StepFailure } from './domain/process/types';
import { getT3Adapter } from './t3/adapter';

export async function greet(name: string): Promise<string> {
  return `Hello, ${name}!`;
}

function activityAbortSignal(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

function heartbeat(details?: unknown): void {
  try {
    Context.current().heartbeat(details);
  } catch {
    /* not in activity context */
  }
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
  commandId?: string;
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
  const commandId = input.commandId ?? `cmd_${input.assignmentId}_${input.workerThreadId}_dispatch`;
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
    messageId: `msg_${commandId}`,
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

export async function waitWorkerTurnEnd(input: {
  threadId: string;
  timeoutMs?: number;
}): Promise<{ turnId: string | null; state: string }> {
  const adapter = getT3Adapter();
  const pollMs = 2_000;
  const timeoutMs = input.timeoutMs;
  const started = Date.now();
  for (;;) {
    heartbeat({ threadId: input.threadId, elapsedMs: Date.now() - started });
    const remaining =
      timeoutMs != null ? Math.max(0, timeoutMs - (Date.now() - started)) : undefined;
    const slice = remaining != null ? Math.min(pollMs, remaining + 50) : pollMs;
    const result = await adapter.waitForTurnEnd({
      threadId: input.threadId,
      pollMs: slice,
      timeoutMs: slice,
      signal: activityAbortSignal(),
    });
    if (result.state === 'timeout') {
      if (timeoutMs != null && Date.now() - started >= timeoutMs) {
        return { turnId: result.turnId, state: 'timeout' };
      }
      continue;
    }
    return result;
  }
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
  deliverySha?: string;
  specSha?: string;
  mailboxId?: string;
  failure?: StepFailure;
  processInstanceId?: string;
  stepId?: string;
}): Promise<{ mailboxId: string; sent: boolean; deferredBusy: boolean }> {
  const adapter = getT3Adapter();
  const mailboxId =
    input.mailboxId ??
    (input.failure
      ? `mbx_${input.assignmentId}_${input.failure.failureClass}_${input.failure.attempted}`
      : `mbx_${input.assignmentId}_${(input.deliverySha ?? 'none').slice(0, 8)}`);
  const busy = isThreadBusy(await adapter.getThreadBusy(input.supervisorThreadId));
  if (busy) {
    return { mailboxId, sent: false, deferredBusy: true };
  }
  const commandId = `cmd_${mailboxId}`;
  const messageText = input.failure
    ? formatStepFailed({
        ...input.failure,
        processInstanceId: input.processInstanceId ?? input.failure.processInstanceId,
        stepId: input.stepId ?? input.failure.stepId,
      })
    : [
        `Delivery ready for assignment ${input.assignmentId}.`,
        input.specSha ? `specSha: ${input.specSha}` : '',
        `deliverySha: ${input.deliverySha}`,
        'Call submit_review with ACCEPT, REVISE, or BLOCKED.',
      ]
        .filter(Boolean)
        .join('\n');
  await adapter.dispatchTurn({
    commandId,
    threadId: input.supervisorThreadId,
    messageText,
  });
  return { mailboxId, sent: true, deferredBusy: false };
}

export async function interruptWorker(input: {
  assignmentId: string;
  workerThreadId: string;
}): Promise<void> {
  await getT3Adapter().interruptTurn({
    commandId: `cmd_${input.assignmentId}_${input.workerThreadId}_interrupt`,
    threadId: input.workerThreadId,
  });
}

export async function loadProcessDefinition(input: {
  processId: string;
  projectCwd?: string;
}): Promise<ProcessDefinition> {
  return getProcess(input.processId, input.projectCwd);
}

export async function loadCatalog(projectCwd?: string): Promise<ProcessDefinition[]> {
  return loadProcessCatalog(projectCwd);
}

export async function loadEngineCaps(projectCwd?: string): Promise<
  import('./domain/models/rolePolicies').RolePolicies['engineCaps']
> {
  return loadRolePolicies(projectCwd).engineCaps;
}

export async function writeProcessArtifact(input: {
  projectCwd: string;
  processInstanceId: string;
  name: string;
  value: unknown;
}): Promise<string> {
  return writeArtifact(input.projectCwd, input.processInstanceId, input.name, input.value);
}

export async function writeProcessStatus(input: {
  projectCwd: string;
  status: ProcessInstanceStatus;
}): Promise<string> {
  return writeInstanceStatus(input.projectCwd, input.status);
}

export async function selectWorkerModelForAttempt(input: {
  role: ModelSelectInput['role'];
  projectCwd?: string;
  exclude?: Array<{ instanceId?: string; modelId?: string }>;
  allowReviewFallback?: boolean;
  mode?: 'select' | 'regate' | 'retry_role';
  current?: { instanceId: string; modelId: string };
}): Promise<
  ModelSelectResult & {
    providers: T3Provider[];
    rankingSource: ModelSelectInput['rankingSource'];
  }
> {
  const aa = await refreshAaCatalogIfStale({});
  const adapter = getT3Adapter();
  let providers = (await adapter.getServerConfig()).providers;
  if (needsProviderRefresh(providers)) {
    providers = (await adapter.refreshProviders()).providers;
    if (needsProviderRefresh(providers)) {
      const stillProbe = providers.some((p) => p.usageLimits?.unavailable?.reason === 'probeFailed');
      if (stillProbe) {
        return {
          ok: false,
          failureClass: 'usage_unknown',
          detail: 'usageLimits.unavailable.reason=probeFailed after refresh',
          providers,
          rankingSource: aa.rankingSource,
        };
      }
    }
  }
  const mapping = loadT3ToAaMapping(input.projectCwd);
  const policy = loadRolePolicies(input.projectCwd);
  const rankingAvailable = Boolean(aa.cache);
  const rankingSource = aa.rankingSource;
  const usageCap =
    input.role === 'review' || input.role === 'check'
      ? (policy.usageMaxPercent[input.role] ?? 100)
      : (policy.usageMaxPercent[input.role] ?? 90);

  if (input.mode === 'regate' && input.current?.instanceId && input.current.modelId) {
    const provider = providers.find((p) => p.instanceId === input.current!.instanceId);
    if (!provider) {
      return {
        ok: false,
        failureClass: 'provider_unavailable',
        detail: 'instance not in providers[]',
        providers,
        rankingSource,
      };
    }
    const gate = providerRunnable(provider, input.current.modelId, usageCap);
    if (!gate.ok) {
      return { ok: false, failureClass: gate.failureClass, detail: gate.failureClass, providers, rankingSource };
    }
    return {
      ok: true,
      selection: {
        kind: 'ModelSelection',
        instanceId: input.current.instanceId,
        modelId: input.current.modelId,
        role: input.role,
        rankingSource,
        attribution: 'https://artificialanalysis.ai/',
      },
      providers,
      rankingSource,
    };
  }

  const result = selectWorkerModel({
    role: input.role,
    providers,
    aaModels: aa.cache?.data ?? [],
    mapping,
    exclude: input.exclude,
    rankingAvailable,
    rankingSource,
    allowReviewFallback: input.allowReviewFallback ?? input.mode === 'retry_role',
    requireRanking: policy.requireRanking,
    minCodingIndex: policy.minCodingIndex,
    minIntelligenceIndex: policy.minIntelligenceIndex,
    minReviewIntelligenceIndex: policy.minReviewIntelligenceIndex,
    workerUsageMaxPercent: policy.usageMaxPercent.implement,
    usageMaxPercent: usageCap,
  });
  return { ...result, providers, rankingSource };
}

export async function recordNativeStep(input: {
  projectCwd: string;
  processInstanceId: string;
  name: string;
  value: unknown;
}): Promise<void> {
  writeArtifact(input.projectCwd, input.processInstanceId, input.name, input.value);
}

export async function classifyEngineeringGoal(input: {
  goal: string;
  projectCwd?: string;
}): Promise<import('./domain/process/types').ProcessSelection | import('./domain/process/types').ProcessMapGap> {
  return classifyGoal(input.goal, loadProcessCatalog(input.projectCwd));
}

export function newProcessInstanceId(): string {
  return `proc_${nanoid(12)}`;
}

export type { FailureClass, ModelSelection, OnFailAction, StepFailure };
