import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'mocha';
import {
  aaCacheStale,
  refreshAaCatalogIfStale,
  writeAaCache,
} from '../domain/models/aaCache';
import { loadRolePolicies } from '../domain/models/rolePolicies';
import { decideOnFail, retryCaps } from '../domain/process/onFail';

describe('AA cache hourly fetch-if-stale', () => {
  it('does not HTTP when the cache is fresh', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3c-aa-'));
    const cachePath = path.join(dir, 'aa-llms.json');
    writeAaCache({ fetchedAt: new Date().toISOString(), data: [{ id: 'x' }] }, cachePath);
    let calls = 0;
    const result = await refreshAaCatalogIfStale({
      cachePath,
      apiKey: 'secret',
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}', { status: 200 });
      },
    });
    assert.equal(result.fetched, false);
    assert.equal(result.rankingSource, 'aa');
    assert.equal(calls, 0);
  });

  it('fetches exactly once when stale', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3c-aa-'));
    const cachePath = path.join(dir, 'aa-llms.json');
    writeAaCache(
      { fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: [{ id: 'old' }] },
      cachePath,
    );
    let calls = 0;
    const result = await refreshAaCatalogIfStale({
      cachePath,
      apiKey: 'secret',
      now: Date.now(),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [{ id: 'new' }] }), { status: 200 });
      },
    });
    assert.equal(result.fetched, true);
    assert.equal(calls, 1);
    assert.equal(result.cache?.data[0]?.id, 'new');
  });

  it('cold cache without a key is ranking unavailable material', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3c-aa-'));
    const cachePath = path.join(dir, 'missing.json');
    const prev = process.env.AA_API_KEY;
    const prev2 = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    delete process.env.AA_API_KEY;
    delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    try {
      const result = await refreshAaCatalogIfStale({ cachePath, fetchImpl: async () => new Response('no') });
      assert.equal(result.cache, null);
      assert.equal(result.fetched, false);
      assert.equal(result.rankingSource, 'unranked');
    } finally {
      if (prev !== undefined) process.env.AA_API_KEY = prev;
      if (prev2 !== undefined) process.env.ARTIFICIAL_ANALYSIS_API_KEY = prev2;
    }
  });

  it('marks cache stale at 1h', () => {
    const fresh = { fetchedAt: new Date().toISOString(), data: [] };
    const stale = { fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), data: [] };
    assert.equal(aaCacheStale(fresh, Date.now(), 60 * 60 * 1000), false);
    assert.equal(aaCacheStale(stale, Date.now(), 60 * 60 * 1000), true);
  });
});

describe('onFail policy', () => {
  it('retry_same before retry_role; check steps do not retry implement', () => {
    const first = decideOnFail({
      onFail: ['retry_same', 'retry_role', 'escalate'],
      retrySameUsed: 0,
      retryRoleUsed: 0,
      retrySameMax: 1,
      retryRoleMax: 1,
    });
    assert.equal(first.action, 'retry_same');
    const second = decideOnFail({
      onFail: ['retry_same', 'retry_role', 'escalate'],
      retrySameUsed: 1,
      retryRoleUsed: 0,
      retrySameMax: 1,
      retryRoleMax: 1,
    });
    assert.equal(second.action, 'retry_role');
    assert.equal(retryCaps('check').retrySameMax, 0);
    const check = decideOnFail({
      onFail: ['escalate'],
      retrySameUsed: 0,
      retryRoleUsed: 0,
      ...retryCaps('check'),
    });
    assert.equal(check.action, 'escalate');
    assert.deepEqual(check.allowedNext, ['block', 'cancel_graph']);
  });

  it('does not invent silent block when only retries are spent', () => {
    const decision = decideOnFail({
      onFail: ['retry_same'],
      retrySameUsed: 1,
      retryRoleUsed: 0,
      retrySameMax: 1,
      retryRoleMax: 0,
    });
    assert.equal(decision.action, 'escalate');
    assert.deepEqual(decision.allowedNext, ['block', 'cancel_graph']);
  });

  it('loads engineCaps from role-policies.json into retryCaps', () => {
    const policies = loadRolePolicies();
    const implement = retryCaps('implement', undefined, policies.engineCaps);
    assert.equal(implement.retrySameMax, 1);
    assert.equal(implement.retryRoleMax, 1);
    const review = retryCaps('review', undefined, policies.engineCaps);
    assert.equal(review.retrySameMax, 0);
  });
});
