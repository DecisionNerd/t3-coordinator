import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from '../bindings';
import { shippedTemplatesRoot } from '../process/catalog';
import type { StepRole } from '../process/types';

export interface RolePolicies {
  requireRanking: boolean;
  minCodingIndex: number;
  minIntelligenceIndex: number;
  minReviewIntelligenceIndex: number;
  usageMaxPercent: Record<StepRole, number>;
  aaCacheTtlMs: number;
  engineCaps: Record<StepRole, { maxRetrySame: number; maxRetryRole: number }>;
  reviseMaxAttempts: number;
}

const DEFAULTS: RolePolicies = {
  requireRanking: true,
  minCodingIndex: 15,
  minIntelligenceIndex: 15,
  minReviewIntelligenceIndex: 50,
  usageMaxPercent: {
    implement: 90,
    investigate: 90,
    review: 100,
    check: 100,
  },
  aaCacheTtlMs: 3_600_000,
  engineCaps: {
    implement: { maxRetrySame: 1, maxRetryRole: 1 },
    investigate: { maxRetrySame: 1, maxRetryRole: 1 },
    review: { maxRetrySame: 0, maxRetryRole: 1 },
    check: { maxRetrySame: 0, maxRetryRole: 0 },
  },
  reviseMaxAttempts: 2,
};

function mergePolicies(base: RolePolicies, raw: unknown): RolePolicies {
  if (!raw || typeof raw !== 'object') return base;
  const rec = raw as Record<string, unknown>;
  const usage = rec.usageMaxPercent && typeof rec.usageMaxPercent === 'object'
    ? (rec.usageMaxPercent as Record<string, number>)
    : {};
  return {
    requireRanking: typeof rec.requireRanking === 'boolean' ? rec.requireRanking : base.requireRanking,
    minCodingIndex: typeof rec.minCodingIndex === 'number' ? rec.minCodingIndex : base.minCodingIndex,
    minIntelligenceIndex:
      typeof rec.minIntelligenceIndex === 'number' ? rec.minIntelligenceIndex : base.minIntelligenceIndex,
    minReviewIntelligenceIndex:
      typeof rec.minReviewIntelligenceIndex === 'number'
        ? rec.minReviewIntelligenceIndex
        : base.minReviewIntelligenceIndex,
    usageMaxPercent: {
      implement: usage.implement ?? base.usageMaxPercent.implement,
      investigate: usage.investigate ?? base.usageMaxPercent.investigate,
      review: usage.review ?? base.usageMaxPercent.review,
      check: usage.check ?? base.usageMaxPercent.check,
    },
    aaCacheTtlMs: typeof rec.aaCacheTtlMs === 'number' ? rec.aaCacheTtlMs : base.aaCacheTtlMs,
    engineCaps: mergeEngineCaps(base.engineCaps, rec.engineCaps),
    reviseMaxAttempts:
      typeof rec.reviseMaxAttempts === 'number' ? rec.reviseMaxAttempts : base.reviseMaxAttempts,
  };
}

function mergeEngineCaps(
  base: RolePolicies['engineCaps'],
  raw: unknown,
): RolePolicies['engineCaps'] {
  if (!raw || typeof raw !== 'object') return base;
  const rec = raw as Record<string, { maxRetrySame?: number; maxRetryRole?: number }>;
  const mergeRole = (role: StepRole) => ({
    maxRetrySame:
      typeof rec[role]?.maxRetrySame === 'number' ? rec[role]!.maxRetrySame! : base[role].maxRetrySame,
    maxRetryRole:
      typeof rec[role]?.maxRetryRole === 'number' ? rec[role]!.maxRetryRole! : base[role].maxRetryRole,
  });
  return {
    implement: mergeRole('implement'),
    investigate: mergeRole('investigate'),
    review: mergeRole('review'),
    check: mergeRole('check'),
  };
}

/** Overlay: shipped → ~/.t3-coordinator/models → repo .t3/models (later wins). */
export function loadRolePolicies(projectCwd?: string): RolePolicies {
  const files = [
    path.join(shippedTemplatesRoot(), 'models', 'role-policies.json'),
    path.join(coordinatorHome(), 'models', 'role-policies.json'),
  ];
  if (projectCwd) files.push(path.join(projectCwd, '.t3', 'models', 'role-policies.json'));
  let policy = DEFAULTS;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    policy = mergePolicies(policy, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return policy;
}
