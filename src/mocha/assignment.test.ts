import assert from 'assert';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { after, before, describe, it } from 'mocha';
import { Worker } from '@temporalio/worker';
import { nanoid } from 'nanoid';
import {
  assignmentWorkflow,
  pauseSignal,
  resumeSignal,
  reviewSignal,
  type AssignmentWorkflowInput,
} from '../workflows';

const baseInput: AssignmentWorkflowInput = {
  repo: 'scratch',
  specSha: 'spec1',
  baseCommit: 'base1',
  environmentId: 'env-test',
  instanceId: 'opencode',
  modelId: 'glm',
  goal: 'ship a noop',
  assignmentId: 'asgn_test_1',
  projectCwd: '/tmp/scratch',
  baseBranch: 'main',
  worktreePath: '/tmp/scratch-wt',
  deliveryGraceMs: 10_000,
};

describe('AssignmentWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  before(async function () {
    this.timeout(120_000);
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await testEnv?.teardown();
  });

  it('blocks with no_delivery after grace when HEAD never moves', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: baseInput.assignmentId!,
          supervisorThreadId: 'thr_sup',
        }),
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => ({
          observation: {
            headSha: 'base1',
            baseCommit: 'base1',
            commitMessage: '',
            dirty: false,
            observedAt: 't',
          },
          verdict: { status: 'pending' as const },
        }),
        sendSupervisorFollowUp: async () => {
          throw new Error('should not send follow-up');
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(assignmentWorkflow, {
        args: [baseInput],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );
    assert.equal(result.state, 'blocked');
    assert.equal(result.blockedReason, 'no_delivery');
  });

  it('defers mailbox while busy, then accepts review', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    let followUps = 0;
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_busy',
          supervisorThreadId: 'thr_sup',
        }),
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => ({
          observation: {
            headSha: 'deadbeef',
            baseCommit: 'base1',
            commitMessage: 'Coordinated-By: asgn_busy',
            dirty: false,
            observedAt: 't',
          },
          verdict: {
            status: 'delivered' as const,
            deliverySha: 'deadbeef',
            dirty: false,
          },
        }),
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          if (followUps === 1) {
            return { mailboxId: 'mbx_1', sent: false, deferredBusy: true };
          }
          return { mailboxId: 'mbx_1', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(assignmentWorkflow, {
          args: [{ ...baseInput, assignmentId: 'asgn_busy', deliveryGraceMs: 5_000 }],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        await handle.signal(reviewSignal, {
          verdict: 'ACCEPT',
          deliverySha: 'deadbeef',
        });
        return handle.result();
      })(),
    );

    assert.equal(result.state, 'accepted');
    assert.equal(result.deliverySha, 'deadbeef');
    assert.equal(result.mailboxId, 'mbx_1');
    assert.ok(followUps >= 2);
  });

  it('pause blocks mailbox until resume', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    let followUps = 0;
    let releaseObserve!: () => void;
    const observeGate = new Promise<void>((resolve) => {
      releaseObserve = resolve;
    });
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_pause',
          supervisorThreadId: 'thr_sup',
        }),
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => {
          await observeGate;
          return {
            observation: {
              headSha: 'cafebabe',
              baseCommit: 'base1',
              commitMessage: 'Coordinated-By: asgn_pause',
              dirty: false,
              observedAt: 't',
            },
            verdict: {
              status: 'delivered' as const,
              deliverySha: 'cafebabe',
              dirty: false,
            },
          };
        },
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          return { mailboxId: 'mbx_p', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(assignmentWorkflow, {
          args: [{ ...baseInput, assignmentId: 'asgn_pause', deliveryGraceMs: 5_000 }],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        await handle.signal(pauseSignal);
        releaseObserve();
        // Workflow is waiting on pause condition; mailbox must not fire yet.
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(followUps, 0);
        await handle.signal(resumeSignal);
        await handle.signal(reviewSignal, {
          verdict: 'ACCEPT',
          deliverySha: 'cafebabe',
        });
        return handle.result();
      })(),
    );

    assert.equal(result.state, 'accepted');
    assert.equal(followUps, 1);
  });
});
