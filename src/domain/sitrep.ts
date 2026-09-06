import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from './bindings';
import { readGoals } from './goals';
import { listBlockedProcessInstances } from './process/status';
import { tryResolveProjectContext } from './repoContext';
import {
  listClosedIssues,
  listMergedPullRequests,
  listMilestones,
  listOpenIssues,
  listOpenIssuesInMilestone,
  listOpenPullRequests,
  type GhIssue,
  type GhPullRequest,
} from '../github/gh';

const DEFAULT_WINDOW_DAYS = 7;

function looksLikeEpic(issue: GhIssue): boolean {
  if (/^\[?\s*epic\s*\]?/i.test(issue.title)) return true;
  const body = issue.body ?? '';
  return /^- \[[ x]\] #\d+/im.test(body) || /\b(Epic|Parent)\s*#\d+/i.test(body);
}

function summarizeIssue(i: GhIssue) {
  return {
    number: i.number,
    title: i.title,
    url: i.url,
    milestone: i.milestone?.title ?? null,
    closedAt: i.closedAt ?? null,
    labels: (i.labels ?? []).map((l) => l.name),
  };
}

function summarizePr(p: GhPullRequest) {
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    mergedAt: p.mergedAt ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}

function withinDays(iso: string | null | undefined, days: number, now = Date.now()): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return now - t <= days * 24 * 60 * 60 * 1000;
}

function isBlockedIssue(i: GhIssue): boolean {
  const labels = (i.labels ?? []).map((l) => l.name.toLowerCase());
  if (labels.some((n) => /block|blocked|blocker|wontfix|on-hold|onhold|waiting/.test(n))) {
    return true;
  }
  if (/\b(blocked|blocker|blocking)\b/i.test(i.title)) return true;
  const body = i.body ?? '';
  if (/^#+\s*blockers?\b/im.test(body)) return true;
  if (/\bblocked\s+by\b/i.test(body)) return true;
  return false;
}

function readOperatorBlockers(home: string): string[] {
  const md = path.join(home, 'blockers.md');
  if (!fs.existsSync(md)) return [];
  return fs
    .readFileSync(md, 'utf8')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Standup / sitrep: recently accomplished, blockers, what's coming up.
 * Repo from current checkout — ask if not in a git repo.
 */
export function sitrep(windowDays = DEFAULT_WINDOW_DAYS) {
  const home = coordinatorHome();
  const goals = readGoals(home);
  const operatorBlockers = readOperatorBlockers(home);
  const days = Math.max(1, Math.min(90, windowDays));

  const supervisorInstructions = [
    'Standup / sitrep check-in — summarize for the operator (do not auto-assign).',
    '1) Cover accomplished (recent closes/merges), blockers, and coming up.',
    '2) Call out anything stalled or waiting on humans — including blocked/failed process instances.',
    '3) On StepFailed, pick only allowedNext (retry / block / cancel). Do not invent a plan.',
    '4) Propose the single next action if clear; otherwise ask the operator.',
    '5) To execute after the sitrep, use next / a concrete phrase (192, complete M2, …).',
  ];

  const resolved = tryResolveProjectContext();
  if (!resolved.ok) {
    return {
      ok: false as const,
      kind: 'sitrep' as const,
      mode: 'standup' as const,
      windowDays: days,
      error: 'need_repo' as const,
      ask: resolved.ask,
      detail: resolved.detail,
      goals: goals ?? { version: 1 as const, goals: [], notes: 'No goals set.' },
      accomplished: { issuesClosed: [], prsMerged: [], notes: [] as string[] },
      blockers: {
        operatorNotes: operatorBlockers,
        issues: [] as ReturnType<typeof summarizeIssue>[],
        processInstances: [] as ReturnType<typeof listBlockedProcessInstances>,
        setup: [resolved.ask],
      },
      comingUp: { milestones: [], epics: [], suggestedNext: [] as string[] },
      openPullRequests: [],
      supervisorInstructions: [
        ...supervisorInstructions,
        '6) Not in a git repo — ask which T3 project to use, then retry sitrep.',
      ],
      narrativeHints: {
        accomplished: 'No repo context.',
        blockers: resolved.ask,
        comingUp: 'Open a T3 project checkout first.',
      },
    };
  }

  const ctx = resolved.context;
  let closed: GhIssue[] = [];
  let open: GhIssue[] = [];
  let merged: GhPullRequest[] = [];
  let openPrs: GhPullRequest[] = [];
  let milestones: Array<{
    number: number;
    title: string;
    open_issues: number;
    closed_issues: number;
    suggestedNext: ReturnType<typeof summarizeIssue> | null;
  }> = [];
  let ghError: string | null = null;

  try {
    closed = listClosedIssues(ctx.githubRepo, 30).filter((i) => withinDays(i.closedAt, days));
    open = listOpenIssues(ctx.githubRepo, 50);
    merged = listMergedPullRequests(ctx.githubRepo, 20).filter((p) => withinDays(p.mergedAt, days));
    openPrs = listOpenPullRequests(ctx.githubRepo, 20);
    const openMs = listMilestones(ctx.githubRepo, 'open').filter((m) => m.open_issues > 0);
    milestones = openMs.map((m) => {
      const issues = listOpenIssuesInMilestone(ctx.githubRepo, m.number);
      const next = [...issues].sort((a, b) => a.number - b.number)[0] ?? null;
      return {
        number: m.number,
        title: m.title,
        open_issues: m.open_issues,
        closed_issues: m.closed_issues,
        suggestedNext: next ? summarizeIssue(next) : null,
      };
    });
  } catch (err) {
    ghError = String(err);
  }

  const blockedIssues = open.filter(isBlockedIssue).map(summarizeIssue);
  const blockedProcessInstances = listBlockedProcessInstances(ctx.projectCwd).slice(0, 10);
  const epics = open.filter(looksLikeEpic).map(summarizeIssue);
  const setupBlockers: string[] = [];
  if (ghError) setupBlockers.push(`GitHub error: ${ghError}`);

  const suggestedNext: string[] = [];
  for (const proc of blockedProcessInstances) {
    const action = proc.allowedNext?.[0];
    if (action === 'retry_same' || action === 'retry_role') {
      suggestedNext.push(`retry ${proc.processInstanceId}`);
    } else if (action === 'block') {
      suggestedNext.push(`block ${proc.processInstanceId}`);
    } else if (proc.state === 'blocked' || proc.state === 'cancelled') {
      suggestedNext.push(`inspect process ${proc.processInstanceId} (${proc.failureClass ?? proc.state})`);
    }
  }
  for (const m of milestones) {
    if (m.suggestedNext) {
      suggestedNext.push(
        `complete ${m.title.match(/^M\d+/i)?.[0] ?? m.title} → #${m.suggestedNext.number}`,
      );
    }
  }
  for (const e of epics.slice(0, 3)) {
    suggestedNext.push(`complete epic ${e.number}`);
  }
  const unblockedOpen = open
    .filter((i) => !isBlockedIssue(i) && !looksLikeEpic(i))
    .slice(0, 5)
    .map((i) => `#${i.number} ${i.title}`);
  for (const line of unblockedOpen.slice(0, 3)) {
    if (!suggestedNext.some((s) => s.includes(line.split(' ')[0]!))) {
      suggestedNext.push(line);
    }
  }

  const accomplishedIssues = closed.slice(0, 15).map(summarizeIssue);
  const accomplishedPrs = merged.slice(0, 15).map(summarizePr);

  return {
    ok: true as const,
    kind: 'sitrep' as const,
    mode: 'standup' as const,
    windowDays: days,
    githubRepo: ctx.githubRepo,
    projectCwd: ctx.projectCwd,
    repoSource: ctx.source,
    goals: goals ?? {
      version: 1 as const,
      goals: [] as { id?: string; text: string; priority?: number }[],
      notes: 'No goals set. Optional: ~/.t3-coordinator/goals.md',
    },
    accomplished: {
      issuesClosed: accomplishedIssues,
      prsMerged: accomplishedPrs,
      notes:
        accomplishedIssues.length === 0 && accomplishedPrs.length === 0
          ? [`No issues closed or PRs merged in the last ${days} days (in the sampled lists).`]
          : [],
    },
    blockers: {
      operatorNotes: operatorBlockers,
      issues: blockedIssues,
      processInstances: blockedProcessInstances,
      openPrsWaiting: openPrs.slice(0, 10).map(summarizePr),
      setup: setupBlockers,
      blockersPath: path.join(home, 'blockers.md'),
    },
    processInstances: {
      blockedOrFailed: blockedProcessInstances,
    },
    comingUp: {
      milestones,
      epics,
      suggestedNext: [...new Set(suggestedNext)].slice(0, 12),
    },
    openPullRequests: openPrs.slice(0, 10).map(summarizePr),
    supervisorInstructions,
    narrativeHints: {
      accomplished:
        accomplishedIssues.length || accomplishedPrs.length
          ? `Closed ${accomplishedIssues.length} issue(s), merged ${accomplishedPrs.length} PR(s) in ~${days}d.`
          : `Quiet last ${days}d on closes/merges.`,
      blockers:
        blockedIssues.length ||
        operatorBlockers.length ||
        openPrs.length ||
        blockedProcessInstances.length
          ? `${blockedIssues.length} blocked issue(s), ${blockedProcessInstances.length} blocked/failed process instance(s), ${operatorBlockers.length} operator note(s), ${openPrs.length} open PR(s).`
          : 'No labeled blockers detected.',
      comingUp:
        milestones.length || epics.length
          ? `${milestones.length} active milestone(s), ${epics.length} open epic(s).`
          : 'No active milestones/epics with open work in sample.',
    },
    ghError,
  };
}
