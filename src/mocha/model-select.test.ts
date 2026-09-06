import assert from 'assert';
import { describe, it } from 'mocha';
import { loadRolePolicies } from '../domain/models/rolePolicies';
import { selectWorkerModel, providerRunnable } from '../domain/models/select';
import type { AaModelRow, ModelSelectInput, T3Provider } from '../domain/models/types';

function provider(partial: Partial<T3Provider> & { instanceId: string; models: T3Provider['models'] }): T3Provider {
  return {
    enabled: true,
    installed: true,
    status: 'ready',
    availability: 'available',
    auth: { status: 'authenticated' },
    ...partial,
  };
}

const cheap: AaModelRow = {
  id: 'aa-cheap',
  evaluations: { artificial_analysis_coding_index: 50, artificial_analysis_intelligence_index: 40 },
  pricing: { price_1m_blended_3_to_1: 1 },
};
const fancy: AaModelRow = {
  id: 'aa-fancy',
  evaluations: { artificial_analysis_coding_index: 80, artificial_analysis_intelligence_index: 90 },
  pricing: { price_1m_blended_3_to_1: 10 },
};
const dominated: AaModelRow = {
  id: 'aa-dom',
  evaluations: { artificial_analysis_coding_index: 40, artificial_analysis_intelligence_index: 30 },
  pricing: { price_1m_blended_3_to_1: 8 },
};
const frontier: AaModelRow = {
  id: 'aa-front',
  evaluations: { artificial_analysis_coding_index: 70, artificial_analysis_intelligence_index: 95 },
  pricing: { price_1m_blended_3_to_1: 20 },
};

function baseInput(over: Partial<ModelSelectInput> = {}): ModelSelectInput {
  return {
    role: 'implement',
    providers: [
      provider({
        instanceId: 'cursor',
        models: [{ slug: 'composer' }, { slug: 'gpt-5.4' }, { slug: 'slop' }],
        usageLimits: { windows: [{ id: 'month', usedPercent: 10 }] },
      }),
    ],
    aaModels: [cheap, fancy, dominated, frontier],
    mapping: [
      { t3Model: 'composer', aaId: 'aa-cheap', class: 'worker' },
      { t3Model: 'gpt-5.4', aaId: 'aa-fancy', class: 'frontier' },
      { t3Model: 'slop', aaId: 'aa-dom', class: 'worker' },
      { t3Model: 'fable', aaId: 'aa-front', class: 'frontier' },
    ],
    rankingAvailable: true,
    rankingSource: 'aa',
    minCodingIndex: 10,
    minIntelligenceIndex: 10,
    minReviewIntelligenceIndex: 50,
    ...over,
  };
}

describe('selectWorkerModel', () => {
  it('picks max Q/C on the Pareto frontier, not max coding index', () => {
    const result = selectWorkerModel(baseInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.modelId, 'composer');
    assert.ok((result.selection.Q_over_C ?? 0) > 8);
  });

  it('never selects a dominated model', () => {
    const result = selectWorkerModel(baseInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(result.selection.modelId, 'slop');
    const peers = result.selection.frontierPeers ?? [];
    assert.equal(peers.some((p) => p.endsWith('slop')), false);
  });

  it('skips a higher-Q model over the worker usage cap', () => {
    const result = selectWorkerModel(
      baseInput({
        providers: [
          provider({
            instanceId: 'cursor',
            models: [{ slug: 'composer' }, { slug: 'gpt-5.4' }],
            usageLimits: { windows: [{ id: 'month', usedPercent: 10 }] },
          }),
          provider({
            instanceId: 'codex',
            models: [{ slug: 'gpt-5.4' }],
            usageLimits: { windows: [{ id: 'month', usedPercent: 95 }] },
          }),
        ],
        mapping: [
          { t3Model: 'composer', aaId: 'aa-cheap', class: 'worker' },
          { t3Model: 'gpt-5.4', instanceHint: 'codex', aaId: 'aa-fancy', class: 'frontier' },
        ],
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.instanceId, 'cursor');
    assert.equal(result.selection.modelId, 'composer');
  });

  it('review picks a frontier-tagged model even if a worker has better Q/C', () => {
    const result = selectWorkerModel(
      baseInput({
        role: 'review',
        providers: [
          provider({
            instanceId: 'cursor',
            models: [{ slug: 'composer' }, { slug: 'gpt-5.4' }],
            usageLimits: { windows: [{ id: 'month', usedPercent: 10 }] },
          }),
        ],
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.modelId, 'gpt-5.4');
    assert.equal(result.selection.reviewFallback, false);
  });

  it('fails closed when ranking is unavailable', () => {
    const result = selectWorkerModel(
      baseInput({ rankingAvailable: false, aaModels: [] }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failureClass, 'ranking_unavailable');
  });

  it('sticky composer with disabled T3 is not runnable', () => {
    const p = provider({
      instanceId: 'cursor',
      status: 'disabled',
      models: [{ slug: 'composer' }],
    });
    const gate = providerRunnable(p, 'composer', 90);
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.equal(gate.failureClass, 'provider_unavailable');
  });

  it('model missing on the instance fails model_missing', () => {
    const p = provider({ instanceId: 'cursor', models: [{ slug: 'other' }] });
    const gate = providerRunnable(p, 'composer', 90);
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    assert.equal(gate.failureClass, 'model_missing');
  });

  it('usedPercent 100 is usage_exhausted; unsupported skips quota', () => {
    const exhausted = provider({
      instanceId: 'cursor',
      models: [{ slug: 'composer' }],
      usageLimits: { windows: [{ id: 'month', usedPercent: 100 }] },
    });
    const unsupported = provider({
      instanceId: 'cursor',
      models: [{ slug: 'composer' }],
      usageLimits: { windows: [], unavailable: { reason: 'unsupported' } },
    });
    assert.equal(providerRunnable(exhausted, 'composer', 100).ok, false);
    assert.equal(providerRunnable(unsupported, 'composer', 100).ok, true);
  });

  it('requireRanking false allows an unranked T3 model', () => {
    const result = selectWorkerModel(
      baseInput({ rankingAvailable: false, aaModels: [], requireRanking: false }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.selection.rankingSource, 'unranked');
  });

  it('loads shipped role-policy floors', () => {
    const policy = loadRolePolicies();
    assert.equal(policy.requireRanking, true);
    assert.equal(policy.minCodingIndex, 15);
    assert.equal(policy.usageMaxPercent.implement, 90);
    assert.equal(policy.usageMaxPercent.review, 100);
  });
});
