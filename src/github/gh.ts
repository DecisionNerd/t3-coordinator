import { spawnSync } from 'node:child_process';

export class GhError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GhError';
  }
}

function ghJson<T>(args: string[], cwd?: string): T {
  const res = spawnSync('gh', args, {
    encoding: 'utf8',
    cwd,
    env: process.env,
  });
  if (res.status !== 0) {
    throw new GhError(`gh ${args.join(' ')} failed`, res.stderr || res.stdout || '');
  }
  return JSON.parse(res.stdout) as T;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  milestone?: { title: string; number: number } | null;
}

export interface GhMilestone {
  number: number;
  title: string;
  description: string;
  state: string;
  open_issues: number;
  closed_issues: number;
  url?: string;
}

export function getIssue(githubRepo: string, issueNumber: number): GhIssue {
  return ghJson<GhIssue>([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    githubRepo,
    '--json',
    'number,title,body,url,state,milestone',
  ]);
}

export function listMilestones(githubRepo: string, state: 'open' | 'all' = 'all'): GhMilestone[] {
  return ghJson<GhMilestone[]>([
    'api',
    `repos/${githubRepo}/milestones?state=${state}&per_page=100`,
  ]);
}

export function listOpenIssuesInMilestone(githubRepo: string, milestoneNumber: number): GhIssue[] {
  return ghJson<GhIssue[]>([
    'issue',
    'list',
    '--repo',
    githubRepo,
    '--milestone',
    String(milestoneNumber),
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,body,url,state,milestone',
  ]);
}

/** Open issues in the repo (newest first via gh default). */
export function listOpenIssues(githubRepo: string, limit = 40): GhIssue[] {
  return ghJson<GhIssue[]>([
    'issue',
    'list',
    '--repo',
    githubRepo,
    '--state',
    'open',
    '--limit',
    String(limit),
    '--json',
    'number,title,body,url,state,milestone',
  ]);
}

/** Resolve "M2", "2", or a title substring to a milestone. */
export function resolveMilestone(githubRepo: string, query: string): GhMilestone {
  const milestones = listMilestones(githubRepo, 'all');
  const q = query.trim();
  const asNum = Number(q.replace(/^M/i, ''));

  const byNumber =
    Number.isFinite(asNum) && String(asNum) === q.replace(/^M/i, '')
      ? milestones.find((m) => m.number === asNum)
      : undefined;
  if (byNumber) return byNumber;

  const mPrefix = q.match(/^M(\d+)\b/i);
  if (mPrefix) {
    const n = Number(mPrefix[1]);
    const hit =
      milestones.find((m) => new RegExp(`^M${n}\\b`, 'i').test(m.title)) ??
      milestones.find((m) => m.number === n);
    if (hit) return hit;
  }

  const lower = q.toLowerCase();
  const byTitle = milestones.find(
    (m) => m.title.toLowerCase() === lower || m.title.toLowerCase().includes(lower),
  );
  if (byTitle) return byTitle;

  throw new Error(
    `No milestone matching ${JSON.stringify(query)} in ${githubRepo}. Known: ${milestones
      .map((m) => `${m.number}:${m.title}`)
      .join(', ')}`,
  );
}
