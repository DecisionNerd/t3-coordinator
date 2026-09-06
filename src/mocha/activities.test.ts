import { MockActivityEnvironment } from '@temporalio/testing';
import { describe, it } from 'mocha';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'assert';
import * as activities from '../activities';
import { FakeT3Adapter, setT3Adapter } from '../t3/adapter';

describe('greet activity', async () => {
  it('successfully greets the user', async () => {
    const env = new MockActivityEnvironment();
    const name = 'Temporal';
    const result = await env.run(activities.greet, name);
    assert.equal(result, 'Hello, Temporal!');
  });
});

describe('resolveAssignWork mailbox sources', () => {
  it('uses caller thread, then binding, then operator inbox', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3c-resolve-'));
    const prevHome = process.env.T3_COORDINATOR_HOME;
    process.env.T3_COORDINATOR_HOME = dir;
    delete process.env.T3_THREAD_ID;
    delete process.env.T3_SUPERVISOR_THREAD_ID;
    delete process.env.COORD_SUPERVISOR_THREAD_ID;

    const adapter = new FakeT3Adapter();
    setT3Adapter(adapter);

    const base = {
      repo: 'proj',
      specSha: 'spec',
      baseCommit: 'base',
      environmentId: 'env-x',
      instanceId: 'inst',
      modelId: 'model',
      goal: 'do it',
    };

    try {
      const inbox = await activities.resolveAssignWork(base);
      assert.equal(inbox.ok, true);
      if (!inbox.ok) return;
      assert.equal(inbox.mailboxSource, 'operator_inbox');
      assert.equal(adapter.dispatches.length, 1);

      const again = await activities.resolveAssignWork(base);
      assert.equal(again.ok, true);
      if (!again.ok) return;
      assert.equal(again.mailboxSource, 'binding');
      assert.equal(again.supervisorThreadId, inbox.supervisorThreadId);
      assert.equal(adapter.dispatches.length, 1);

      const caller = await activities.resolveAssignWork({
        ...base,
        supervisorThreadId: 'thr_caller',
      });
      assert.equal(caller.ok, true);
      if (!caller.ok) return;
      assert.equal(caller.mailboxSource, 'caller');
      assert.equal(caller.supervisorThreadId, 'thr_caller');
    } finally {
      if (prevHome === undefined) delete process.env.T3_COORDINATOR_HOME;
      else process.env.T3_COORDINATOR_HOME = prevHome;
      setT3Adapter(new FakeT3Adapter());
    }
  });
});
