import assert from 'assert';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { after, before, describe, it } from 'mocha';
import { Worker } from '@temporalio/worker';
import { nanoid } from 'nanoid';
import {
  assignmentWorkflow,
  cancelSignal,
  pauseSignal,
  resumeSignal,
  reviewSignal,
  statusQuery,
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

const okSelect = {
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
};

function deliveredObserve(assignmentId: string, sha = 'deadbeef') {
  return async () => ({
    observation: {
      headSha: sha,
      baseCommit: 'base1',
      commitMessage: `Coordinated-By: ${assignmentId}`,
      dirty: false,
      observedAt: 't',
    },
    verdict: { status: 'delivered' as const, deliverySha: sha, dirty: false },
  });
}

describe('AssignmentWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  before(async function () {
    this.timeout(120_000);
    testEnv = await TestWorkflowEnvironment.createLocal();
  });

  after(async () => {
    await testEnv?.teardown();
  });

  it('blocks with no_delivery after grace when HEAD never moves and mails the supervisor', async function () {
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
          assignmentId: baseInput.assignmentId!,
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
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
          followUps += 1;
          return { mailboxId: 'mbx_nd', sent: true, deferredBusy: false };
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
    assert.equal(result.failure?.failureClass, 'no_delivery');
    assert.ok(followUps >= 1);
  });

  it('turn error is worker_turn_failed with mailbox and no grace path', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    let observes = 0;
    let followUps = 0;
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_err',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'error' }),
        observeDelivery: async () => {
          observes += 1;
          throw new Error('grace must not run');
        },
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          return { mailboxId: 'mbx_err', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(assignmentWorkflow, {
        args: [{ ...baseInput, assignmentId: 'asgn_err' }],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );
    assert.equal(result.blockedReason, 'worker_turn_failed');
    assert.equal(result.failure?.failureClass, 'worker_turn_failed');
    assert.equal(observes, 0);
    assert.equal(followUps, 1);
  });

  it('wait timeout is turn_timeout with mailbox', async function () {
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
          assignmentId: 'asgn_to',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: null, state: 'timeout' }),
        observeDelivery: async () => {
          throw new Error('grace must not run');
        },
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          return { mailboxId: 'mbx_to', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(assignmentWorkflow, {
        args: [{ ...baseInput, assignmentId: 'asgn_to', timeoutMs: 1_000 }],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );
    assert.equal(result.blockedReason, 'turn_timeout');
    assert.equal(followUps, 1);
  });

  it('dispatch throw is dispatch_failed with mailbox and no second worker', async function () {
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
          assignmentId: 'asgn_df',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async () => {
          throw new Error('boom');
        },
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => {
          throw new Error('should not observe');
        },
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          return { mailboxId: 'mbx_df', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(assignmentWorkflow, {
        args: [{ ...baseInput, assignmentId: 'asgn_df' }],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );
    assert.equal(result.state, 'blocked');
    assert.equal(result.blockedReason, 'dispatch_failed');
    assert.equal(followUps, 1);
  });

  it('cancel during wait interrupts before turn end', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    let interrupted = 0;
    let waiting!: () => void;
    let releaseWait!: () => void;
    const gate = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_c',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_c',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => {
          waiting();
          await new Promise<void>((resolve) => {
            releaseWait = resolve;
          });
          return { turnId: 't1', state: 'interrupted' };
        },
        observeDelivery: async () => {
          throw new Error('should not observe');
        },
        sendSupervisorFollowUp: async () => ({
          mailboxId: 'mbx_c',
          sent: true,
          deferredBusy: false,
        }),
        interruptWorker: async () => {
          interrupted += 1;
          releaseWait();
        },
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(assignmentWorkflow, {
          args: [{ ...baseInput, assignmentId: 'asgn_c' }],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        await gate;
        await handle.signal(cancelSignal);
        return handle.result();
      })(),
    );
    assert.equal(result.state, 'cancelled');
    assert.ok(interrupted >= 1);
  });

  it('REVISE re-dispatches the same worker thread', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    const threads: string[] = [];
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_rev',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => {
          threads.push(input.workerThreadId ?? 'thr_rev');
          return {
            commandId: `cmd_${threads.length}`,
            workerThreadId: input.workerThreadId ?? 'thr_rev',
            sequence: threads.length,
            adopted: false,
            worktreePath: '/tmp/scratch-wt',
          };
        },
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: deliveredObserve('asgn_rev'),
        sendSupervisorFollowUp: async () => ({
          mailboxId: 'mbx_rev',
          sent: true,
          deferredBusy: false,
        }),
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(assignmentWorkflow, {
          args: [{ ...baseInput, assignmentId: 'asgn_rev', maxRevise: 2, deliveryGraceMs: 5_000 }],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        for (let i = 0; i < 50; i++) {
          const view = await handle.query(statusQuery);
          if (view.state === 'in_review') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await handle.signal(reviewSignal, { verdict: 'REVISE', deliverySha: 'deadbeef' });
        for (let i = 0; i < 50; i++) {
          const view = await handle.query(statusQuery);
          if (view.state === 'in_review' && view.attempt >= 1) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await handle.signal(reviewSignal, { verdict: 'ACCEPT', deliverySha: 'deadbeef' });
        return handle.result();
      })(),
    );
    assert.equal(result.state, 'accepted');
    assert.equal(threads.length, 2);
    assert.equal(threads[0], threads[1]);
  });

  it('REVISE over cap blocks with StepFailure mailbox', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    const threads: string[] = [];
    const mailboxes: Array<{ failureClass?: string; evidence?: string }> = [];
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_revcap',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => {
          threads.push(input.workerThreadId ?? 'thr_revcap');
          return {
            commandId: `cmd_${threads.length}`,
            workerThreadId: input.workerThreadId ?? 'thr_revcap',
            sequence: threads.length,
            adopted: false,
            worktreePath: '/tmp/scratch-wt',
          };
        },
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: deliveredObserve('asgn_revcap'),
        sendSupervisorFollowUp: async (input: {
          failure?: { failureClass?: string; evidence?: string };
        }) => {
          if (input.failure) {
            mailboxes.push({
              failureClass: input.failure.failureClass,
              evidence: input.failure.evidence,
            });
          }
          return { mailboxId: 'mbx_revcap', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(assignmentWorkflow, {
          args: [
            { ...baseInput, assignmentId: 'asgn_revcap', maxRevise: 2, deliveryGraceMs: 5_000 },
          ],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        for (let i = 0; i < 50; i++) {
          const view = await handle.query(statusQuery);
          if (view.state === 'in_review') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await handle.signal(reviewSignal, { verdict: 'REVISE', deliverySha: 'deadbeef' });
        for (let i = 0; i < 50; i++) {
          const view = await handle.query(statusQuery);
          if (view.state === 'in_review' && view.attempt >= 1) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await handle.signal(reviewSignal, { verdict: 'REVISE', deliverySha: 'deadbeef' });
        return handle.result();
      })(),
    );
    assert.equal(result.state, 'blocked');
    assert.equal(result.failure?.failureClass, 'worker_turn_failed');
    assert.equal(result.failure?.evidence, 'revise_cap');
    assert.equal(threads.length, 2);
    assert.equal(threads[0], threads[1]);
    assert.ok(mailboxes.some((m) => m.evidence === 'revise_cap'));
  });

  it('disabled T3 provider is provider_unavailable with zero dispatch', async function () {
    this.timeout(60_000);
    const { client, nativeConnection } = testEnv;
    const taskQueue = `aq-${nanoid()}`;
    let dispatches = 0;
    const worker = await Worker.create({
      connection: nativeConnection,
      taskQueue,
      workflowsPath: require.resolve('../workflows'),
      activities: {
        resolveAssignWork: async () => ({
          ok: true as const,
          assignmentId: 'asgn_pu',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => ({
          ok: false as const,
          failureClass: 'provider_unavailable' as const,
          detail: 'disabled',
          providers: [],
          rankingSource: 'unranked' as const,
        }),
        dispatchWorker: async () => {
          dispatches += 1;
          throw new Error('must not dispatch');
        },
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: async () => {
          throw new Error('no');
        },
        sendSupervisorFollowUp: async () => ({
          mailboxId: 'mbx_pu',
          sent: true,
          deferredBusy: false,
        }),
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(assignmentWorkflow, {
        args: [{ ...baseInput, assignmentId: 'asgn_pu' }],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );
    assert.equal(result.blockedReason, 'provider_unavailable');
    assert.equal(dispatches, 0);
  });

  it('HEAD moved without trailer is delivery_unbound with mailbox', async function () {
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
          assignmentId: 'asgn_unbound',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
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
            headSha: 'moved',
            baseCommit: 'base1',
            commitMessage: 'no trailer',
            dirty: false,
            observedAt: 't',
          },
          verdict: { status: 'unbound' as const, headSha: 'moved', dirty: false },
        }),
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          return { mailboxId: 'mbx_unbound', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      client.workflow.execute(assignmentWorkflow, {
        args: [{ ...baseInput, assignmentId: 'asgn_unbound', deliveryGraceMs: 5_000 }],
        workflowId: `wf-${nanoid()}`,
        taskQueue,
      }),
    );
    assert.equal(result.failure?.failureClass, 'delivery_unbound');
    assert.equal(followUps, 1);
  });

  it('review SHA mismatch is stale_review with mailbox', async function () {
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
          assignmentId: 'asgn_stale',
          supervisorThreadId: 'thr_sup',
        }),
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: deliveredObserve('asgn_stale'),
        sendSupervisorFollowUp: async () => {
          followUps += 1;
          return { mailboxId: 'mbx_stale', sent: true, deferredBusy: false };
        },
        interruptWorker: async () => undefined,
      },
    });

    const result = await worker.runUntil(
      (async () => {
        const handle = await client.workflow.start(assignmentWorkflow, {
          args: [{ ...baseInput, assignmentId: 'asgn_stale', deliveryGraceMs: 5_000 }],
          workflowId: `wf-${nanoid()}`,
          taskQueue,
        });
        for (let i = 0; i < 50; i++) {
          const view = await handle.query(statusQuery);
          if (view.state === 'in_review') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await handle.signal(reviewSignal, { verdict: 'ACCEPT', deliverySha: 'wrong' });
        return handle.result();
      })(),
    );
    assert.equal(result.failure?.failureClass, 'stale_review');
    assert.ok(followUps >= 2);
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
        selectWorkerModelForAttempt: async () => okSelect,
        dispatchWorker: async (input: { workerThreadId?: string }) => ({
          commandId: 'cmd_1',
          workerThreadId: input.workerThreadId ?? 'thr_worker',
          sequence: 1,
          adopted: false,
          worktreePath: '/tmp/scratch-wt',
        }),
        waitWorkerTurnEnd: async () => ({ turnId: 't1', state: 'completed' }),
        observeDelivery: deliveredObserve('asgn_busy'),
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
        selectWorkerModelForAttempt: async () => okSelect,
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
