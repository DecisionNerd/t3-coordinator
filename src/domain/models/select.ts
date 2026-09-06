import {
  AA_ATTRIBUTION,
  DEFAULT_USAGE_MAX_PERCENT,
  WORKER_USAGE_MAX_PERCENT,
  type ModelSelection,
} from '../process/types';
import type {
  AaModelRow,
  ModelSelectInput,
  ModelSelectResult,
  T3ModelMapEntry,
  T3Provider,
} from './types';

function modelOnProvider(provider: T3Provider, modelId: string): boolean {
  const want = modelId.toLowerCase();
  return provider.models.some(
    (m) =>
      m.slug.toLowerCase() === want ||
      (m.aliases ?? []).some((a) => a.toLowerCase() === want),
  );
}

function tightestUsedPercent(provider: T3Provider): number | null {
  const windows = provider.usageLimits?.windows ?? [];
  if (windows.length === 0) return null;
  return Math.max(...windows.map((w) => w.usedPercent));
}

export function providerRunnable(
  provider: T3Provider,
  modelId: string | undefined,
  usageMaxPercent: number,
): { ok: true } | { ok: false; failureClass: Exclude<ModelSelectResult, { ok: true }>['failureClass'] } {
  if (!provider.enabled || !provider.installed) {
    return { ok: false, failureClass: 'provider_unavailable' };
  }
  if (provider.availability === 'unavailable') {
    return { ok: false, failureClass: 'provider_unavailable' };
  }
  if (provider.status === 'error' || provider.status === 'disabled') {
    return { ok: false, failureClass: 'provider_unavailable' };
  }
  if (provider.auth.status !== 'authenticated') {
    return { ok: false, failureClass: 'provider_unavailable' };
  }
  if (modelId && !modelOnProvider(provider, modelId)) {
    return { ok: false, failureClass: 'model_missing' };
  }
  const unavailable = provider.usageLimits?.unavailable;
  if (unavailable?.reason === 'probeFailed') {
    return { ok: false, failureClass: 'usage_unknown' };
  }
  if (unavailable?.reason === 'unsupported' || !provider.usageLimits || provider.usageLimits.windows.length === 0) {
    return { ok: true };
  }
  const used = tightestUsedPercent(provider);
  if (used != null && used >= usageMaxPercent) {
    return { ok: false, failureClass: 'usage_exhausted' };
  }
  return { ok: true };
}

interface Candidate {
  instanceId: string;
  modelId: string;
  aa?: AaModelRow;
  map?: T3ModelMapEntry;
  Q: number;
  C: number;
  Q_over_C: number;
  usedPercent: number | null;
  class: 'worker' | 'frontier';
}

function paretoFrontier(cands: Candidate[]): Candidate[] {
  return cands.filter((a) => !cands.some((b) => b !== a && b.Q >= a.Q && b.C <= a.C && (b.Q > a.Q || b.C < a.C)));
}

function quality(role: ModelSelectInput['role'], row?: AaModelRow): number {
  const ev = row?.evaluations;
  if (role === 'implement' || role === 'check') return ev?.artificial_analysis_coding_index ?? 0;
  return ev?.artificial_analysis_intelligence_index ?? 0;
}

export function selectWorkerModel(input: ModelSelectInput): ModelSelectResult {
  const workerCap = input.workerUsageMaxPercent ?? WORKER_USAGE_MAX_PERCENT;
  const reviewCap = input.usageMaxPercent ?? DEFAULT_USAGE_MAX_PERCENT;
  const usageCap = input.role === 'review' ? reviewCap : workerCap;

  if (input.requireRanking !== false && !input.rankingAvailable && input.aaModels.length === 0) {
    return { ok: false, failureClass: 'ranking_unavailable', detail: 'No Artificial Analysis cache and ranking is required' };
  }

  const excluded = input.exclude ?? [];
  const isExcluded = (instanceId: string, modelId: string) =>
    excluded.some(
      (e) =>
        (e.instanceId && e.instanceId === instanceId && !e.modelId) ||
        (e.instanceId === instanceId && e.modelId === modelId) ||
        (e.modelId === modelId && !e.instanceId),
    );

  const candidates: Candidate[] = [];
  let firstGateFail: Exclude<ModelSelectResult, { ok: true }> | undefined;
  for (const provider of input.providers) {
    for (const model of provider.models) {
      if (isExcluded(provider.instanceId, model.slug)) continue;
      const gate = providerRunnable(provider, model.slug, usageCap);
      if (!gate.ok) {
        if (!firstGateFail) {
          firstGateFail = { ok: false, failureClass: gate.failureClass, detail: gate.failureClass };
        }
        continue;
      }
      const map = input.mapping.find(
        (m) =>
          m.t3Model.toLowerCase() === model.slug.toLowerCase() &&
          (!m.instanceHint || m.instanceHint === provider.instanceId || m.instanceHint === provider.driver),
      );
      const aa = map ? input.aaModels.find((row) => row.id === map.aaId) : undefined;
      const Q = aa ? quality(input.role, aa) : Number.NaN;
      const C = aa?.pricing?.price_1m_blended_3_to_1;
      candidates.push({
        instanceId: provider.instanceId,
        modelId: model.slug,
        aa,
        map,
        Q: Number.isFinite(Q) ? Q : 0,
        C: typeof C === 'number' && C > 0 ? C : Number.NaN,
        Q_over_C: Number.isFinite(Q) && typeof C === 'number' && C > 0 ? Q / C : 0,
        usedPercent: tightestUsedPercent(provider),
        class: map?.class ?? 'worker',
      });
    }
  }

  if (candidates.length === 0) {
    return (
      firstGateFail ?? {
        ok: false,
        failureClass: 'provider_unavailable',
        detail: 'No T3-runnable instance/model passed the live gate',
      }
    );
  }

  const minCoding = input.minCodingIndex ?? 0;
  const minIntel = input.minIntelligenceIndex ?? 0;
  const minReview = input.minReviewIntelligenceIndex ?? 40;

  const toSelection = (c: Candidate, extra: Partial<ModelSelection> = {}): ModelSelection => ({
    kind: 'ModelSelection',
    instanceId: c.instanceId,
    modelId: c.modelId,
    aaId: c.aa?.id,
    role: input.role,
    Q: c.aa && Number.isFinite(c.Q) ? c.Q : undefined,
    C: c.aa && Number.isFinite(c.C) ? c.C : undefined,
    Q_over_C: c.aa && Number.isFinite(c.Q_over_C) ? c.Q_over_C : undefined,
    rankingSource: c.aa ? input.rankingSource : 'unranked',
    frontierPeers: extra.frontierPeers,
    remainingWindowPercents: extra.remainingWindowPercents,
    attribution: AA_ATTRIBUTION,
    ...extra,
  });

  if (input.role === 'review') {
    const frontier = candidates.filter((c) => c.class === 'frontier' || c.Q >= minReview);
    const pool = frontier.length > 0 ? frontier : input.allowReviewFallback === true ? candidates : [];
    if (pool.length === 0) {
      return { ok: false, failureClass: 'provider_unavailable', detail: 'No frontier reviewer runnable' };
    }
    pool.sort((a, b) => b.Q - a.Q || a.C - b.C);
    const pick = pool[0]!;
    return {
      ok: true,
      selection: toSelection(pick, {
        reviewFallback: frontier.length === 0,
        remainingWindowPercents: pick.usedPercent == null ? [] : [pick.usedPercent],
      }),
    };
  }

  const floored = candidates.filter((c) => {
    if (!c.aa) return true;
    if (input.role === 'implement' || input.role === 'check') return c.Q >= minCoding;
    return c.Q >= minIntel;
  });
  const ranked = floored.filter((c) => c.aa && Number.isFinite(c.Q) && Number.isFinite(c.C));
  const unranked = floored.filter((c) => !c.aa);
  const frontier = ranked.length > 0 ? paretoFrontier(ranked) : [];
  frontier.sort((a, b) => b.Q_over_C - a.Q_over_C || b.Q - a.Q);
  const underCap = frontier.filter((c) => c.usedPercent == null || c.usedPercent < workerCap);
  const pick = underCap[0] ?? unranked[0];
  if (!pick) {
    return { ok: false, failureClass: 'model_missing', detail: 'All runnable models were below quality floors' };
  }
  return {
    ok: true,
    selection: toSelection(pick, {
      frontierPeers: frontier.map((c) => `${c.instanceId}:${c.modelId}`),
      remainingWindowPercents: pick.usedPercent == null ? [] : [pick.usedPercent],
    }),
  };
}
