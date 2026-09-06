import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import { nanoid } from 'nanoid';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { nextReadyStep, stepDependenciesMet } from '../domain/process/dag';
import { decideOnFail, retryCaps } from '../domain/process/onFail';
import type { ProcessDefinition, ProcessStep } from '../domain/process/types';
import { processInstanceWorkflow, processRecoverSignal, processStatusQuery } from '../workflows';

function step(over: Partial<ProcessStep> & { id: string }): ProcessStep {
  return {
    process: 'X',
    role: 'implement',
    in: [],
    out: [],
    timeoutMs: 1,
    onFail: ['retry_same', 'retry_role', 'escalate'],
    ...over,
  };
}

describe('process instance DAG', () => {
  it('starts a step only after dependsOn have completed', () => {
    const implement = step({ id: 'implement-slices', dependsOn: ['design-graph'] });
    const done = new Set<string>(['discover']);
    assert.equal(stepDependenciesMet(implement, done), false);
    done.add('design-graph');
    assert.equal(stepDependenciesMet(implement, done), true);
  });

  it('steps without dependsOn are always ready', () => {
    assert.equal(stepDependenciesMet(step({ id: 'discover' }), new Set()), true);
  });

  it('picks a later-listed predecessor before a dependent listed first', () => {
    const steps = [
      step({ id: 'dependent', dependsOn: ['root'] }),
      step({ id: 'root' }),
    ];
    const completed = new Set<string>();
    const first = nextReadyStep(steps, completed);
    assert.equal(first?.id, 'root');
    completed.add('root');
    assert.equal(nextReadyStep(steps, completed)?.id, 'dependent');
  });
});

describe('check-step recovery', () => {
  it('does not retry implement for constraint failures', () => {
    const caps = retryCaps('check');
    const decision = decideOnFail({
      onFail: ['escalate'],
      retrySameUsed: 0,
      retryRoleUsed: 0,
      ...caps,
    });
    assert.equal(decision.action, 'escalate');
    assert.ok(!decision.allowedNext.includes('retry_same'));
  });
});

const twoStep: ProcessDefinition = {
  id: 'TwoStep',
  consumes: ['UserGoal'],
  produces: ['CompletionReport'],
  steps: [
    {
      id: 'first',
      process: 'ImplementSlice',
      role: 'implement',
      in: ['UserGoal'],
      out: ['ImplementationArtifact'],
      timeoutMs: 60_000,
      onFail: ['block'],
    },
    {
      id: 'second',
      process: 'ValidateParity',
      role: 'check',
      dependsOn: ['first'],
      in: ['ImplementationArtifact'],
      out: ['VerificationEvidence'],
      timeoutMs: 60_000,
      onFail: ['escalate'],
    },
  ],
};

describe('ProcessInstanceWorkflow child fail', () => {
  let testEnv: TestWorkflowEnvironment;

  before(async function () {
    this.timeout(120_000);
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await testEnv?.teardown();
  });

  it('records StepFailure and does not start dependents', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `pq-${nanoid()}`;
    const dispatches: string[] = [];
    const artifacts: string[] = [];
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        loadCatalog: async () => [twoStep],
        loadEngineCaps: async () => ({
          implement: { maxRetrySame: 1, maxRetryRole: 1 },
          investigate: { maxRetrySame: 1, maxRetryRole: 1 },
          review: { maxRetrySame: 0, maxRetryRole: 1 },
          check: { maxRetrySame: 0, maxRetryRole: 0 },
        }),
        writeProcessStatus: async () => 'ok',
        writeProcessArtifact: async (input: { name: string }) => {
          artifacts.push(input.name);
          return 'ok';
        },
        selectWorkerModelForAttempt: async () => ({
          ok: true as const,
          selection: {
            kind: 'ModelSelection' as const,
            instanceId: 'opencode',
            modelId: 'glm',
            role: 'implement' as const,
            rankingSource: 'unranked' as const,
          },
          providers: [],
          rankingSource: 'unranked' as const,
        }),
        resolveAssignWork: async (input: { assignmentId?: string }) => ({
          ok: true as const,
          assignmentId: input.assignmentId ?? 'asgn_child',
          supervisorThreadId: 'thr_sup',
        }),
        dispatchWorker: async (input: { assignmentId: string }) => {
          dispatches.push(input.assignmentId);
          throw new Error('boom');
        },
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => {
          throw new Error('no');
        },
        sendSupervisorFollowUp: async () => ({
          mailboxId: 'mbx_child',
          sent: true,
          deferredBusy: false,
        }),
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(processInstanceWorkflow, {
        args: [
          {
            processInstanceId: 'proc_child',
            processId: 'TwoStep',
            goal: 'do the thing',
            repo: 'scratch',
            specSha: 'spec1',
            baseCommit: 'base1',
            environmentId: 'env-test',
            projectCwd: '/tmp/scratch',
            baseBranch: 'main',
            supervisorThreadId: 'thr_sup',
            instanceId: 'opencode',
            modelId: 'glm',
          },
        ],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );

    assert.equal(result.state, 'blocked');
    assert.equal(result.failure?.failureClass, 'dispatch_failed');
    assert.ok(dispatches.length >= 1);
    assert.equal(new Set(dispatches).size, 1);
    assert.ok(dispatches[0]?.includes('first'));
    assert.ok(!dispatches.some((id) => id.includes('second')));
    assert.ok(artifacts.includes('StepFailure'));
    assert.ok(artifacts.includes('RecoveryDecision'));
    assert.ok(!artifacts.includes('CompletionReport'));
  });

  it('escalate waits for supervisor signal and rejects invalid allowedNext', async function () {
    this.timeout(90_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `pq-${nanoid()}`;
    const escalateDef: ProcessDefinition = {
      id: 'EscalateOnce',
      consumes: ['UserGoal'],
      produces: ['ImplementationArtifact'],
      steps: [
        {
          id: 'only',
          process: 'ImplementSlice',
          role: 'implement',
          in: ['UserGoal'],
          out: ['ImplementationArtifact'],
          timeoutMs: 60_000,
          onFail: ['escalate', 'block'],
        },
      ],
    };
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        loadCatalog: async () => [escalateDef],
        loadEngineCaps: async () => ({
          implement: { maxRetrySame: 1, maxRetryRole: 1 },
          investigate: { maxRetrySame: 1, maxRetryRole: 1 },
          review: { maxRetrySame: 0, maxRetryRole: 1 },
          check: { maxRetrySame: 0, maxRetryRole: 0 },
        }),
        writeProcessStatus: async () => 'ok',
        writeProcessArtifact: async () => 'ok',
        selectWorkerModelForAttempt: async () => ({
          ok: true as const,
          selection: {
            kind: 'ModelSelection' as const,
            instanceId: 'opencode',
            modelId: 'glm',
            role: 'implement' as const,
            rankingSource: 'unranked' as const,
          },
          providers: [],
          rankingSource: 'unranked' as const,
        }),
        resolveAssignWork: async (input: { assignmentId?: string }) => ({
          ok: true as const,
          assignmentId: input.assignmentId ?? 'asgn_esc',
          supervisorThreadId: 'thr_sup',
        }),
        dispatchWorker: async () => {
          throw new Error('dispatch boom');
        },
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => {
          throw new Error('no');
        },
        sendSupervisorFollowUp: async () => ({
          mailboxId: 'mbx_esc',
          sent: true,
          deferredBusy: false,
        }),
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(processInstanceWorkflow, {
          args: [
            {
              processInstanceId: 'proc_esc',
              processId: 'EscalateOnce',
              goal: 'do the thing',
              repo: 'scratch',
              specSha: 'spec1',
              baseCommit: 'base1',
              environmentId: 'env-test',
              projectCwd: '/tmp/scratch',
              baseBranch: 'main',
              supervisorThreadId: 'thr_sup',
              instanceId: 'opencode',
              modelId: 'glm',
            },
          ],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        for (let i = 0; i < 200; i++) {
          const view = await handle.query(processStatusQuery);
          // Escalate wait rewrites allowedNext to remaining actions (no 'escalate').
          if (
            view.allowedNext?.includes('block') &&
            !view.allowedNext.includes('escalate')
          ) {
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        // Invalid action is ignored until an allowedNext (or cancel_graph) arrives.
        await handle.signal(processRecoverSignal, { action: 'retry_role' });
        await new Promise((r) => setTimeout(r, 500));
        const desc = await handle.describe();
        assert.equal(desc.status.name, 'RUNNING');
        await handle.signal(processRecoverSignal, { action: 'block' });
        return handle.result();
      })(),
    );

    assert.equal(result.state, 'blocked');
    assert.equal(result.failure?.failureClass, 'dispatch_failed');
  });
});
