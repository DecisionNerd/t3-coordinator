import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'mocha';
import {
  commitMessageHasTrailer,
  evaluateDelivery,
  isThreadBusy,
  resolveSupervisorThread,
  workerPromptContract,
} from '../domain/contracts';
import { bindSupervisor, getSupervisorBinding, readBindings } from '../domain/bindings';
import { deriveAssignmentId } from '../domain/gitDelivery';
import { FakeT3Adapter } from '../t3/adapter';

describe('delivery trailer', () => {
  it('matches exact Coordinated-By line', () => {
    const id = 'asgn_abc';
    assert.equal(commitMessageHasTrailer(`feat: x\n\nCoordinated-By: ${id}\n`, id), true);
    assert.equal(commitMessageHasTrailer(`Coordinated-By: ${id} extra`, id), false);
    assert.equal(commitMessageHasTrailer(`Coordinated-By: other`, id), false);
  });

  it('evaluateDelivery requires HEAD move + trailer', () => {
    const assignmentId = 'asgn_1';
    const base = 'aaa';
    assert.deepEqual(
      evaluateDelivery({
        assignmentId,
        baseCommit: base,
        observation: {
          headSha: base,
          baseCommit: base,
          commitMessage: `Coordinated-By: ${assignmentId}`,
          dirty: false,
          observedAt: 't',
        },
      }),
      { status: 'pending' },
    );
    assert.equal(
      evaluateDelivery({
        assignmentId,
        baseCommit: base,
        observation: {
          headSha: 'bbb',
          baseCommit: base,
          commitMessage: 'no trailer',
          dirty: false,
          observedAt: 't',
        },
      }).status,
      'unbound',
    );
    assert.deepEqual(
      evaluateDelivery({
        assignmentId,
        baseCommit: base,
        observation: {
          headSha: 'bbb',
          baseCommit: base,
          commitMessage: `done\n\nCoordinated-By: ${assignmentId}`,
          dirty: true,
          observedAt: 't',
        },
      }),
      { status: 'delivered', deliverySha: 'bbb', dirty: true },
    );
  });

  it('worker prompt embeds trailer contract', () => {
    const text = workerPromptContract('asgn_x', 'Do the thing', 'spec1');
    assert.match(text, /Coordinated-By: asgn_x/);
    assert.match(text, /Do the thing/);
  });
});

describe('supervisor binding resolve', () => {
  it('rejects unbound and mismatched overrides', () => {
    assert.deepEqual(resolveSupervisorThread({ binding: undefined }), {
      ok: false,
      error: 'supervisor_unbound',
    });
    const binding = {
      environmentId: 'env',
      supervisorThreadId: 'thr_sup',
      boundAt: 't',
    };
    assert.deepEqual(
      resolveSupervisorThread({ binding, requestedThreadId: 'thr_other' }),
      { ok: false, error: 'supervisor_thread_mismatch' },
    );
    assert.deepEqual(resolveSupervisorThread({ binding }), {
      ok: true,
      supervisorThreadId: 'thr_sup',
    });
    assert.deepEqual(resolveSupervisorThread({ binding, requestedThreadId: 'thr_sup' }), {
      ok: true,
      supervisorThreadId: 'thr_sup',
    });
  });

  it('persists bindings under a home path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3c-bind-'));
    const filePath = path.join(dir, 'bindings.json');
    const binding = bindSupervisor({
      environmentId: 'env-a',
      supervisorThreadId: 'thr_1',
      filePath,
    });
    assert.equal(binding.supervisorThreadId, 'thr_1');
    assert.equal(getSupervisorBinding('env-a', filePath)?.supervisorThreadId, 'thr_1');
    assert.equal(readBindings(filePath).version, 1);
  });
});

describe('busy matrix', () => {
  it('marks running / queued / raised-hand as busy', () => {
    assert.equal(
      isThreadBusy({
        latestTurnState: 'running',
        sessionStatus: 'stopped',
        hasQueuedTurnStart: false,
        hasRaisedHand: false,
      }),
      true,
    );
    assert.equal(
      isThreadBusy({
        latestTurnState: null,
        sessionStatus: 'running',
        hasQueuedTurnStart: false,
        hasRaisedHand: false,
      }),
      true,
    );
    assert.equal(
      isThreadBusy({
        latestTurnState: null,
        sessionStatus: 'stopped',
        hasQueuedTurnStart: true,
        hasRaisedHand: false,
      }),
      true,
    );
    assert.equal(
      isThreadBusy({
        latestTurnState: null,
        sessionStatus: 'stopped',
        hasQueuedTurnStart: false,
        hasRaisedHand: true,
      }),
      true,
    );
    assert.equal(
      isThreadBusy({
        latestTurnState: 'completed',
        sessionStatus: 'stopped',
        hasQueuedTurnStart: false,
        hasRaisedHand: false,
      }),
      false,
    );
  });
});

describe('command receipt idempotency', () => {
  it('reuses sequence for the same commandId', async () => {
    const adapter = new FakeT3Adapter();
    const input = {
      commandId: 'cmd_1',
      threadId: 'thr_1',
      messageText: 'hi',
      instanceId: 'i',
      modelId: 'm',
    };
    const first = await adapter.dispatchTurn(input);
    const second = await adapter.dispatchTurn(input);
    assert.equal(first.adopted, false);
    assert.equal(second.adopted, true);
    assert.equal(first.sequence, second.sequence);
    assert.equal(adapter.dispatches.length, 1);
  });
});

describe('assignment id derivation', () => {
  it('is stable for the same inputs', () => {
    const input = {
      repo: 'r',
      specSha: 's',
      baseCommit: 'b',
      environmentId: 'e',
      instanceId: 'i',
      modelId: 'm',
      goal: 'g',
    };
    assert.equal(deriveAssignmentId(input), deriveAssignmentId(input));
    assert.notEqual(
      deriveAssignmentId(input),
      deriveAssignmentId({ ...input, specSha: 'other' }),
    );
  });
});
