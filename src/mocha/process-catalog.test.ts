import assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'mocha';
import { parseIntent } from '../domain/intent';
import { refreshAaCatalogIfStale, writeAaCache } from '../domain/models/aaCache';
import { providerRunnable, selectWorkerModel } from '../domain/models/select';
import type { AaModelRow, T3ModelMapEntry, T3Provider } from '../domain/models/types';
import { loadProcessCatalog, parseProcessDefinition } from '../domain/process/catalog';
import { classifyGoal } from '../domain/process/classify';
import { decideOnFail } from '../domain/process/onFail';

function readyProvider(id: string, models: string[], usedPercent?: number): T3Provider {
  return {
    instanceId: id,
    enabled: true,
    installed: true,
    status: 'ready',
    availability: 'available',
    auth: { status: 'authenticated' },
    models: models.map((slug) => ({ slug })),
    usageLimits:
      usedPercent == null
        ? undefined
        : { windows: [{ id: 'w1', usedPercent }] },
  };
}

const mapping: T3ModelMapEntry[] = [
  { t3Model: 'cheap', aaId: 'aa-cheap', class: 'worker' },
  { t3Model: 'mid', aaId: 'aa-mid', class: 'worker' },
  { t3Model: 'fancy', aaId: 'aa-fancy', class: 'worker' },
  { t3Model: 'fable', aaId: 'aa-fable', class: 'frontier' },
];

const aa: AaModelRow[] = [
  {
    id: 'aa-cheap',
    evaluations: { artificial_analysis_coding_index: 40, artificial_analysis_intelligence_index: 40 },
    pricing: { price_1m_blended_3_to_1: 0.5 },
  },
  {
    id: 'aa-mid',
    evaluations: { artificial_analysis_coding_index: 70, artificial_analysis_intelligence_index: 60 },
    pricing: { price_1m_blended_3_to_1: 1 },
  },
  {
    id: 'aa-fancy',
    evaluations: { artificial_analysis_coding_index: 90, artificial_analysis_intelligence_index: 90 },
    pricing: { price_1m_blended_3_to_1: 10 },
  },
  {
    id: 'aa-fable',
    evaluations: { artificial_analysis_coding_index: 80, artificial_analysis_intelligence_index: 95 },
    pricing: { price_1m_blended_3_to_1: 20 },
  },
];

describe('process catalog', () => {
  it('refuses to parse a step without onFail', () => {
    assert.throws(() =>
      parseProcessDefinition(
        {
          id: 'Broken',
          consumes: ['UserGoal'],
          produces: ['X'],
          steps: [{ id: 's', process: 'Broken', role: 'implement', in: ['UserGoal'], out: ['X'] }],
        },
        'mem',
      ),
    );
  });

  it('loads shipped catalog including CrossLanguageLogicMigration', () => {
    const catalog = loadProcessCatalog();
    const ids = catalog.map((p) => p.id);
    assert.ok(ids.includes('CrossLanguageLogicMigration'));
    assert.ok(ids.includes('ImplementSlice'));
  });

  it('classifies python/rust parity as CrossLanguageLogicMigration', () => {
    const catalog = loadProcessCatalog();
    const result = classifyGoal(
      'All logic needs to move from Python into Rust, and Python is just a thin host wrapper of the Rust logic, and has practical parity with Node/WASM.',
      catalog,
    );
    assert.equal(result.kind, 'ProcessSelection');
    if (result.kind === 'ProcessSelection') {
      assert.equal(result.selected, 'CrossLanguageLogicMigration');
    }
  });

  it('dual-write/cutover language is a ProcessMapGap', () => {
    const catalog = loadProcessCatalog();
    const result = classifyGoal(
      'Migrate python to rust with a dual-write cutover and strangler rollback',
      catalog,
    );
    assert.equal(result.kind, 'ProcessMapGap');
  });
});

describe('parseIntent dual DX', () => {
  it('keeps 192 as ImplementSlice shortcut', () => {
    assert.deepEqual(parseIntent('192'), { kind: 'push_issue', issueNumber: 192 });
  });

  it('maps complete M* and complete epic to shortcuts (skip classify)', () => {
    assert.deepEqual(parseIntent('complete M5'), { kind: 'complete_milestone', milestone: 'M5' });
    assert.deepEqual(parseIntent('complete epic 50'), { kind: 'complete_epic', epicNumber: 50 });
  });

  it('maps freeform goals to classify only (no start)', () => {
    const intent = parseIntent('move all logic from python into rust');
    assert.equal(intent.kind, 'classify');
    if (intent.kind === 'classify') {
      assert.match(intent.goal, /python/i);
    }
  });

  it('maps start and recover phrases', () => {
    assert.deepEqual(parseIntent('start CrossLanguageLogicMigration'), {
      kind: 'start_process',
      processId: 'CrossLanguageLogicMigration',
    });
    assert.equal(parseIntent('retry').kind, 'process_recover');
    assert.equal(parseIntent('move all logic from python into rust').kind, 'classify');
  });
});

describe('onFail engine', () => {
  it('retry_same then retry_role then escalate, never invents silent block', () => {
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
    const third = decideOnFail({
      onFail: ['retry_same', 'retry_role', 'escalate'],
      retrySameUsed: 1,
      retryRoleUsed: 1,
      retrySameMax: 1,
      retryRoleMax: 1,
    });
    assert.equal(third.action, 'escalate');
    assert.deepEqual(third.allowedNext, ['retry_same', 'retry_role']);
  });
});

describe('SelectWorkerModel', () => {
  it('implement picks max Q/C on the Pareto frontier, not max Q', () => {
    const result = selectWorkerModel({
      role: 'implement',
      providers: [
        readyProvider('a', ['cheap']),
        readyProvider('b', ['mid']),
        readyProvider('c', ['fancy']),
      ],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // mid: 70/1 = 70; cheap: 40/0.5 = 80; fancy: 90/10 = 9. cheap dominates? Q=40 C=0.5 vs mid Q=70 C=1.
    // cheap is weaker (40<70) but cheaper. mid is stronger and costlier. Neither dominates.
    // fancy Q=90 C=10: mid has Q=70 C=1 — fancy is stronger but much costlier. mid does not dominate fancy (weaker).
    // cheap does not dominate mid. Pick max Q/C: cheap 80, mid 70, fancy 9 → cheap.
    assert.equal(result.selection.modelId, 'cheap');
    assert.ok((result.selection.Q_over_C ?? 0) >= 70);
  });

  it('never selects a dominated model (weaker and costlier)', () => {
    const dominated: AaModelRow[] = [
      {
        id: 'aa-cheap',
        evaluations: { artificial_analysis_coding_index: 40 },
        pricing: { price_1m_blended_3_to_1: 2 },
      },
      {
        id: 'aa-mid',
        evaluations: { artificial_analysis_coding_index: 70 },
        pricing: { price_1m_blended_3_to_1: 1 },
      },
    ];
    const result = selectWorkerModel({
      role: 'implement',
      providers: [readyProvider('a', ['cheap']), readyProvider('b', ['mid'])],
      aaModels: dominated,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.modelId, 'mid');
  });

  it('skips exhausted worker usage and takes the next frontier point', () => {
    const result = selectWorkerModel({
      role: 'implement',
      providers: [
        readyProvider('a', ['cheap'], 95),
        readyProvider('b', ['mid'], 10),
      ],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
      workerUsageMaxPercent: 90,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.modelId, 'mid');
  });

  it('review picks frontier even if a cheaper worker has better Q/C', () => {
    const result = selectWorkerModel({
      role: 'review',
      providers: [readyProvider('w', ['cheap']), readyProvider('f', ['fable'])],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.modelId, 'fable');
    assert.equal(result.selection.reviewFallback, false);
  });

  it('status=disabled is provider_unavailable', () => {
    const disabled = readyProvider('x', ['glm']);
    disabled.status = 'disabled';
    const result = selectWorkerModel({
      role: 'implement',
      providers: [disabled],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failureClass, 'provider_unavailable');
  });

  it('model slug missing on instance is model_missing when that is the only listed model miss', () => {
    const p = readyProvider('x', ['other']);
    const gate = providerRunnable(p, 'glm', 90);
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.equal(gate.failureClass, 'model_missing');
  });

  it('usedPercent=100 is usage_exhausted', () => {
    const result = selectWorkerModel({
      role: 'implement',
      providers: [readyProvider('x', ['mid'], 100)],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
      workerUsageMaxPercent: 90,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failureClass, 'usage_exhausted');
  });

  it('probeFailed after refresh path is usage_unknown via providerRunnable skip of exhausted', () => {
    const p = readyProvider('x', ['mid']);
    p.usageLimits = { windows: [], unavailable: { reason: 'probeFailed' } };
    const result = selectWorkerModel({
      role: 'implement',
      providers: [p],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failureClass, 'usage_unknown');
  });

  it('usageLimits unsupported skips quota gate', () => {
    const p = readyProvider('x', ['mid']);
    p.usageLimits = { windows: [], unavailable: { reason: 'unsupported' } };
    const result = selectWorkerModel({
      role: 'implement',
      providers: [p],
      aaModels: aa,
      mapping,
      rankingAvailable: true,
      rankingSource: 'aa',
    });
    assert.equal(result.ok, true);
  });

  it('cold cache without ranking is ranking_unavailable', () => {
    const result = selectWorkerModel({
      role: 'implement',
      providers: [readyProvider('x', ['mid'])],
      aaModels: [],
      mapping,
      rankingAvailable: false,
      rankingSource: 'unranked',
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failureClass, 'ranking_unavailable');
  });
});

describe('AA cache hourly', () => {
  it('fresh cache does not HTTP; stale cache fetches once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-cache-'));
    const cachePath = path.join(dir, 'aa-llms.json');
    writeAaCache(
      { fetchedAt: new Date().toISOString(), data: [{ id: 'x' }] },
      cachePath,
    );
    let hits = 0;
    const fetchImpl = (async () => {
      hits += 1;
      return new Response(JSON.stringify({ data: [{ id: 'y' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const fresh = await refreshAaCatalogIfStale({ fetchImpl, cachePath, apiKey: 'k' });
    assert.equal(fresh.fetched, false);
    assert.equal(hits, 0);

    writeAaCache(
      { fetchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), data: [{ id: 'x' }] },
      cachePath,
    );
    const stale = await refreshAaCatalogIfStale({ fetchImpl, cachePath, apiKey: 'k' });
    assert.equal(stale.fetched, true);
    assert.equal(hits, 1);
  });
});
