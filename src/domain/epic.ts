import { spawnSync } from 'node:child_process';
import { getIssue, type GhIssue } from '../github/gh';
import { requireDefaults } from './defaults';

export interface EpicChild {
  number: number;
  title: string;
  state: string;
  url: string;
  done: boolean;
  source: 'sub_issue' | 'task_list' | 'search';
}

function ghJsonLoose<T>(args: string[]): T | null {
  const res = spawnSync('gh', args, { encoding: 'utf8', env: process.env });
  if (res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    return null;
  }
}

function repo(): string {
  return requireDefaults().githubRepo;
}

/** Parse `- [ ] #12` / `- [x] #12` task-list children from epic body. */
export function parseTaskListChildren(body: string): { number: number; done: boolean }[] {
  const out: { number: number; done: boolean }[] = [];
  const re = /^\s*[-*]\s*\[([ xX])\]\s*#(\d+)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ number: Number(m[2]), done: m[1] !== ' ' });
  }
  // Also plain "- #12" bullets
  const plain = /^\s*[-*]\s+#(\d+)\b/gm;
  while ((m = plain.exec(body))) {
    const n = Number(m[1]);
    if (!out.some((c) => c.number === n)) out.push({ number: n, done: false });
  }
  return out;
}

function trySubIssues(githubRepo: string, parent: number): EpicChild[] {
  const data = ghJsonLoose<Array<{ number: number; title: string; state: string; html_url?: string }>>([
    'api',
    `repos/${githubRepo}/issues/${parent}/sub_issues`,
    '-H',
    'Accept: application/vnd.github+json',
  ]);
  if (!data || !Array.isArray(data)) return [];
  return data.map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    url: i.html_url ?? `https://github.com/${githubRepo}/issues/${i.number}`,
    done: String(i.state).toUpperCase() === 'CLOSED',
    source: 'sub_issue' as const,
  }));
}

function trySearchChildren(githubRepo: string, parent: number): EpicChild[] {
  const q = `repo:${githubRepo} is:issue (\"Epic #${parent}\" OR \"Parent #${parent}\" OR \"part of #${parent}\" OR \"tracked by #${parent}\")`;
  const data = ghJsonLoose<Array<{ number: number; title: string; state: string; url: string }>>([
    'issue',
    'list',
    '--repo',
    githubRepo,
    '--search',
    q,
    '--limit',
    '50',
    '--json',
    'number,title,state,url',
  ]);
  if (!data) return [];
  return data
    .filter((i) => i.number !== parent)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      url: i.url,
      done: String(i.state).toUpperCase() === 'CLOSED',
      source: 'search' as const,
    }));
}

/**
 * Resolve children of a parent/epic issue (milestone optional).
 * Prefers GitHub sub-issues API, then task-list in body, then search.
 */
export function listEpicChildren(parentNumber: number): {
  parent: GhIssue;
  children: EpicChild[];
  openChildren: EpicChild[];
} {
  const githubRepo = repo();
  const parent = getIssue(githubRepo, parentNumber);
  const bySub = trySubIssues(githubRepo, parentNumber);
  const fromList = parseTaskListChildren(parent.body ?? '');
  const byList: EpicChild[] = [];
  for (const ref of fromList) {
    try {
      const child = getIssue(githubRepo, ref.number);
      byList.push({
        number: child.number,
        title: child.title,
        state: child.state,
        url: child.url,
        done: String(child.state).toUpperCase() === 'CLOSED' || ref.done,
        source: 'task_list',
      });
    } catch {
      byList.push({
        number: ref.number,
        title: `(missing #${ref.number})`,
        state: 'UNKNOWN',
        url: `https://github.com/${githubRepo}/issues/${ref.number}`,
        done: ref.done,
        source: 'task_list',
      });
    }
  }
  const bySearch = trySearchChildren(githubRepo, parentNumber);

  const merged = new Map<number, EpicChild>();
  for (const c of [...bySub, ...byList, ...bySearch]) {
    const prev = merged.get(c.number);
    if (!prev || (prev.source !== 'sub_issue' && c.source === 'sub_issue')) {
      merged.set(c.number, c);
    } else if (prev && c.done && !prev.done) {
      merged.set(c.number, { ...prev, done: true });
    }
  }
  const children = [...merged.values()].sort((a, b) => a.number - b.number);
  const openChildren = children.filter((c) => !c.done && String(c.state).toUpperCase() !== 'CLOSED');
  return { parent, children, openChildren };
}

export function epicStatus(parentNumber: number) {
  const { parent, children, openChildren } = listEpicChildren(parentNumber);
  return {
    ok: true as const,
    entity: 'epic' as const,
    command: 'status' as const,
    parent: {
      number: parent.number,
      title: parent.title,
      state: parent.state,
      url: parent.url,
      milestone: parent.milestone ?? null,
    },
    children,
    openChildren,
    next: [
      openChildren.length
        ? `complete epic ${parentNumber} (or run "complete epic ${parentNumber}") to push #${openChildren.sort((a, b) => a.number - b.number)[0]!.number}`
        : `All children done — close epic ${parentNumber} when ready (issue close ${parentNumber} apply:true)`,
      'Shape children with issue plan/critique/refine; add children via task-list (- [ ] #N) or GitHub sub-issues',
    ],
  };
}

export const EPIC_BODY_TEMPLATE = [
  '## Epic',
  '',
  '_Parent tracker — not necessarily on a milestone. Children can be listed below or linked as GitHub sub-issues._',
  '',
  '## Outcome',
  '',
  '- …',
  '',
  '## Children',
  '',
  '- [ ] #…',
  '',
  '## Non-goals',
  '',
  '- …',
  '',
].join('\n');
