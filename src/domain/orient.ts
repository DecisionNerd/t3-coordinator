import * as fs from 'node:fs';
import * as path from 'node:path';
import { coordinatorHome } from './bindings';
import { readGoals } from './goals';
import { tryResolveProjectContext } from './repoContext';
import {
  listMilestones,
  listOpenIssues,
  listOpenIssuesInMilestone,
  type GhIssue,
} from '../github/gh';

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
  };
}

/**
 * Empty / "next" brief for the supervisor: goals + backlog snapshot + decide-what-next instructions.
 * Repo comes from the current checkout — no sticky default github repo.
 */
export function orientNext() {
  const home = coordinatorHome();
  const goals = readGoals(home);
  const profilePath = path.join(home, 'operating-profile.json');
  const operatingProfile = fs.existsSync(profilePath)
    ? (JSON.parse(fs.readFileSync(profilePath, 'utf8')) as Record<string, unknown>)
    : null;

  const supervisorInstructions = [
    'Thin supervisor: almost no tool use beyond reading requirements / next / sitrep, then assign and review.',
    'Implementation and investigations belong in worker sub-agents (complete / push_issue / assign_work) — do not dig the repo or implement in this chat.',
    'The operator invoked t3-coordinator with no specific command.',
    '1) Review goals (if any) against the live backlog below.',
    '2) Decide the single best next action in this repo (shape backlog, push one issue, complete a milestone/epic, or ask the operator).',
    '3) Prefer one critical-path item — do not spawn parallel workers.',
    '4) Execute with a concrete phrase/tool: "192", "complete M2", "complete epic 50", plan/critique/refine, or create/close with apply:true when mutating.',
    '5) If goals are empty and the backlog is unclear, propose 1–3 goals or issues before pushing work.',
  ];

  const resolved = tryResolveProjectContext();
  if (!resolved.ok) {
    return {
      ok: false as const,
      kind: 'next' as const,
      mode: 'orient' as const,
      error: 'need_repo' as const,
      ask: resolved.ask,
      detail: resolved.detail,
      goals: goals ?? { version: 1 as const, goals: [], notes: 'No goals.json / goals.md yet.' },
      goalsPath: {
        json: path.join(home, 'goals.json'),
        md: path.join(home, 'goals.md'),
      },
      backlog: null,
      operatingProfile: operatingProfile
        ? { present: true, testbed: (operatingProfile as { testbed?: unknown }).testbed ?? null }
        : { present: false },
      supervisorInstructions: [
        ...supervisorInstructions,
        '6) You are not in a git repo — ask the operator which T3 project checkout to use (or open it), then retry.',
      ],
      suggestedPhrases: [],
    };
  }

  const ctx = resolved.context;
  let milestones: Array<{
    number: number;
    title: string;
    open_issues: number;
    closed_issues: number;
    suggestedNext: ReturnType<typeof summarizeIssue> | null;
  }> = [];
  let openIssues: GhIssue[] = [];
  let ghError: string | null = null;

  try {
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
    openIssues = listOpenIssues(ctx.githubRepo, 40);
  } catch (err) {
    ghError = String(err);
  }

  const epics = openIssues.filter(looksLikeEpic).map(summarizeIssue);
  const unmilestoned = openIssues
    .filter((i) => !i.milestone && !looksLikeEpic(i))
    .slice(0, 15)
    .map(summarizeIssue);

  const suggestedPhrases: string[] = [];
  for (const m of milestones) {
    if (m.suggestedNext) {
      suggestedPhrases.push(`complete ${m.title.match(/^M\d+/i)?.[0] ?? m.title}`);
      suggestedPhrases.push(String(m.suggestedNext.number));
    }
  }
  for (const e of epics.slice(0, 3)) {
    suggestedPhrases.push(`complete epic ${e.number}`);
    suggestedPhrases.push(`status epic ${e.number}`);
  }
  if (unmilestoned[0]) suggestedPhrases.push(String(unmilestoned[0].number));
  if (suggestedPhrases.length === 0) {
    suggestedPhrases.push('create issue …', 'create milestone …', 'create epic …');
  }

  const assignReady = Boolean(ctx.t3ProjectId && ctx.instanceId && ctx.modelId);

  return {
    ok: true as const,
    kind: 'next' as const,
    mode: 'orient' as const,
    repo: {
      githubRepo: ctx.githubRepo,
      projectCwd: ctx.projectCwd,
      source: ctx.source,
    },
    goals: goals ?? {
      version: 1 as const,
      goals: [] as { id?: string; text: string; priority?: number }[],
      notes: 'No goals set. Optional: ~/.t3-coordinator/goals.md or goals.json',
    },
    goalsPath: {
      json: path.join(home, 'goals.json'),
      md: path.join(home, 'goals.md'),
    },
    assignPrefs: {
      ready: assignReady,
      t3ProjectId: ctx.t3ProjectId ?? null,
      instanceId: ctx.instanceId ?? null,
      modelId: ctx.modelId ?? null,
      hint: assignReady
        ? null
        : 'Push/complete needs defaults-set --t3-project --instance --model (no --github; repo is this checkout).',
    },
    backlog: {
      githubRepo: ctx.githubRepo,
      milestonesWithOpenWork: milestones,
      openEpics: epics,
      openIssuesWithoutMilestone: unmilestoned,
      openIssueSampleCount: openIssues.length,
      ghError,
    },
    operatingProfile: operatingProfile
      ? { present: true, testbed: (operatingProfile as { testbed?: unknown }).testbed ?? null }
      : { present: false },
    supervisorInstructions,
    suggestedPhrases: [...new Set(suggestedPhrases)].slice(0, 12),
  };
}
