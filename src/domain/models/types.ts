export interface AaEvaluations {
  artificial_analysis_intelligence_index?: number;
  artificial_analysis_coding_index?: number;
  artificial_analysis_math_index?: number;
}

export interface AaPricing {
  price_1m_blended_3_to_1?: number;
}

export interface AaModelRow {
  id: string;
  name?: string;
  slug?: string;
  evaluations?: AaEvaluations;
  pricing?: AaPricing;
  median_output_tokens_per_second?: number;
}

export interface AaCacheFile {
  fetchedAt: string;
  data: AaModelRow[];
}

export interface T3ProviderModel {
  slug: string;
  aliases?: string[];
}

export interface T3UsageWindow {
  id: string;
  usedPercent: number;
  resetsAt?: string;
}

export interface T3Provider {
  instanceId: string;
  driver?: string;
  enabled: boolean;
  installed: boolean;
  status: 'ready' | 'warning' | 'error' | 'disabled';
  availability?: 'available' | 'unavailable';
  auth: { status: 'authenticated' | 'unauthenticated' | 'unknown' };
  models: T3ProviderModel[];
  usageLimits?: {
    windows: T3UsageWindow[];
    unavailable?: { reason: 'unsupported' | 'probeFailed'; message?: string };
  };
  checkedAt?: string;
}

export interface T3ModelMapEntry {
  t3Model: string;
  instanceHint?: string;
  aaId: string;
  class: 'worker' | 'frontier';
}

export interface ModelSelectInput {
  role: 'investigate' | 'implement' | 'review' | 'check';
  providers: T3Provider[];
  aaModels: AaModelRow[];
  mapping: T3ModelMapEntry[];
  exclude?: Array<{ instanceId?: string; modelId?: string }>;
  usageMaxPercent?: number;
  workerUsageMaxPercent?: number;
  minCodingIndex?: number;
  minIntelligenceIndex?: number;
  minReviewIntelligenceIndex?: number;
  rankingAvailable: boolean;
  rankingSource: 'aa' | 'aa_stale' | 'unranked';
  allowReviewFallback?: boolean;
  /** Default true. Cold AA cache is ranking_unavailable only when ranking is required. */
  requireRanking?: boolean;
}

export type ModelSelectResult =
  | { ok: true; selection: import('../process/types').ModelSelection }
  | {
      ok: false;
      failureClass:
        | 'provider_unavailable'
        | 'model_missing'
        | 'usage_exhausted'
        | 'usage_unknown'
        | 'ranking_unavailable';
      detail: string;
    };
