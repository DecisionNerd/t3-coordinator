import type { ProcessDefinition, ProcessMapGap, ProcessSelection, ProcessSelectionScore } from './types';

function includesPhrase(haystack: string, needle: string): boolean {
  return haystack.includes(needle.trim().toLowerCase());
}

export function scoreProcess(goal: string, def: ProcessDefinition): ProcessSelectionScore | null {
  if (def.classify === false || !def.classification) return null;
  const text = goal.toLowerCase();
  const { signals, excludes } = def.classification;
  const matchedSignals = signals.filter((s) => includesPhrase(text, s));
  const matchedExcludes = excludes.filter((s) => includesPhrase(text, s));
  const denom = Math.max(signals.length, 1);
  const score =
    matchedExcludes.length > 0 ? 0 : Number((matchedSignals.length / denom).toFixed(4));
  return {
    processId: def.id,
    score: Number(score.toFixed(4)),
    matchedSignals,
    matchedExcludes,
  };
}

export function classifyGoal(goal: string, catalog: ProcessDefinition[]): ProcessSelection | ProcessMapGap {
  const candidates = catalog
    .map((def) => scoreProcess(goal, def))
    .filter((s): s is ProcessSelectionScore => s !== null)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const threshold = best
    ? catalog.find((p) => p.id === best.processId)?.classification?.threshold ?? 0.75
    : 0.75;
  const unmapped = [
    ...new Set(candidates.flatMap((c) => c.matchedExcludes)),
  ];
  if (!best || best.score < threshold) {
    return {
      kind: 'ProcessMapGap',
      goal,
      bestProcessId: best?.processId ?? null,
      bestScore: best?.score ?? 0,
      threshold,
      unmappedCharacteristics: unmapped,
      message: [
        'I understand the engineering goal, but our process catalog does not currently contain a high-confidence workflow.',
        best
          ? `The closest workflow is ${best.processId} (score ${best.score}, threshold ${threshold}).`
          : 'No process produced a score.',
        unmapped.length ? `Unmapped characteristics: ${unmapped.join(', ')}.` : '',
        'This is a process-map gap.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }
  return {
    kind: 'ProcessSelection',
    goal,
    threshold,
    candidates: candidates.slice(0, 5),
    selected: best.processId,
    unmappedCharacteristics: unmapped,
  };
}
