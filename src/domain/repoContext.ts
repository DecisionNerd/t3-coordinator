import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readDefaults, type ProjectDefaults } from './defaults';

export type ProjectContext = {
  projectCwd: string;
  githubRepo: string;
  source: 'gh' | 'git-remote' | 'env';
  baseBranch: string;
  environmentId: string;
  t3ProjectId?: string;
  instanceId?: string;
  modelId?: string;
  defaults: ProjectDefaults | null;
};

export class NeedRepoError extends Error {
  readonly code = 'need_repo' as const;
  readonly ask: string;

  constructor(ask: string, detail?: string) {
    super(detail ?? ask);
    this.name = 'NeedRepoError';
    this.ask = ask;
  }
}

function git(args: string[], cwd: string): string | null {
  const res = spawnSync('git', args, { encoding: 'utf8', cwd, env: process.env });
  if (res.status !== 0) return null;
  return (res.stdout || '').trim() || null;
}

/** Parse owner/name from common GitHub remote URL shapes. */
export function parseGitHubOwnerRepo(remoteUrl: string): string | null {
  const u = remoteUrl.trim().replace(/\.git$/i, '');
  // git@github.com:owner/repo
  let m = u.match(/^git@([^:]+):(.+)$/i);
  if (m) {
    const host = m[1]!.toLowerCase();
    const repoPath = m[2]!;
    if (host === 'github.com' || host.endsWith('.github.com')) {
      const parts = repoPath.split('/').filter(Boolean);
      if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }
  // https://github.com/owner/repo or ssh://git@github.com/owner/repo
  m = u.match(/^(?:https?:\/\/|ssh:\/\/(?:git@)?)([^/]+)\/(.+)$/i);
  if (m) {
    const host = m[1]!.toLowerCase().replace(/^www\./, '');
    const repoPath = m[2]!;
    if (host === 'github.com' || host.endsWith('.github.com')) {
      const parts = repoPath.split('/').filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
  }
  return null;
}

function findGitRoot(startCwd: string): string | null {
  const abs = path.resolve(startCwd);
  if (!fs.existsSync(abs)) return null;
  return git(['rev-parse', '--show-toplevel'], abs);
}

function detectGithubRepo(gitRoot: string): { githubRepo: string; source: 'gh' | 'git-remote' } | null {
  const gh = spawnSync(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
    { encoding: 'utf8', cwd: gitRoot, env: process.env },
  );
  if (gh.status === 0) {
    const name = (gh.stdout || '').trim();
    if (name.includes('/')) return { githubRepo: name, source: 'gh' };
  }
  const remote =
    git(['remote', 'get-url', 'origin'], gitRoot) ??
    git(['config', '--get', 'remote.origin.url'], gitRoot);
  if (!remote) return null;
  const parsed = parseGitHubOwnerRepo(remote);
  if (!parsed) return null;
  return { githubRepo: parsed, source: 'git-remote' };
}

function candidateCwds(defaults: ProjectDefaults | null, explicit?: string): string[] {
  const out: string[] = [];
  if (explicit) out.push(explicit);
  const envCwd = process.env.COORD_PROJECT_CWD?.trim();
  if (envCwd) out.push(envCwd);
  out.push(process.cwd());
  // Optional cwd hint only (not a sticky github repo)
  if (defaults?.projectCwd) out.push(defaults.projectCwd);
  return [...new Set(out.map((c) => path.resolve(c)))];
}

const ASK_NOT_IN_REPO =
  'Not inside a git repository. Open (or cd into) the T3 project checkout you want to work on, then try again. If the MCP process cwd is wrong, set COORD_PROJECT_CWD to that checkout.';

function withPrefs(
  gitRoot: string,
  githubRepo: string,
  source: ProjectContext['source'],
  defaults: ProjectDefaults | null,
): ProjectContext {
  return {
    projectCwd: gitRoot,
    githubRepo,
    source,
    baseBranch: defaults?.baseBranch ?? process.env.COORD_BASE_BRANCH ?? 'main',
    environmentId: defaults?.environmentId ?? process.env.COORD_ENV_ID ?? 'env-local',
    t3ProjectId: defaults?.t3ProjectId ?? process.env.COORD_REPO,
    instanceId: defaults?.instanceId ?? process.env.COORD_INSTANCE_ID,
    modelId: defaults?.modelId ?? process.env.COORD_MODEL_ID,
    defaults,
  };
}

/**
 * Resolve GitHub owner/repo + project cwd from the current checkout (how T3 usually works).
 * No sticky default github repo. Throws NeedRepoError when not in a repo — caller should ask the operator.
 */
export function resolveProjectContext(opts?: {
  cwd?: string;
  defaults?: ProjectDefaults | null;
}): ProjectContext {
  const defaults = opts?.defaults !== undefined ? opts.defaults : readDefaults();
  const cwds = candidateCwds(defaults, opts?.cwd);
  const envRepo = process.env.COORD_GITHUB_REPO?.trim();

  let lastDetail = 'No candidate directories.';
  for (const cwd of cwds) {
    const gitRoot = findGitRoot(cwd);
    if (!gitRoot) {
      lastDetail = `${cwd} is not inside a git work tree.`;
      continue;
    }
    if (envRepo && envRepo.includes('/')) {
      return withPrefs(gitRoot, envRepo, 'env', defaults);
    }
    const detected = detectGithubRepo(gitRoot);
    if (!detected) {
      lastDetail = `Git root ${gitRoot} has no resolvable GitHub remote (origin).`;
      continue;
    }
    return withPrefs(gitRoot, detected.githubRepo, detected.source, defaults);
  }

  throw new NeedRepoError(ASK_NOT_IN_REPO, lastDetail);
}

export function tryResolveProjectContext(opts?: {
  cwd?: string;
  defaults?: ProjectDefaults | null;
}):
  | { ok: true; context: ProjectContext }
  | { ok: false; error: 'need_repo'; ask: string; detail: string } {
  try {
    return { ok: true, context: resolveProjectContext(opts) };
  } catch (err) {
    if (err instanceof NeedRepoError) {
      return { ok: false, error: 'need_repo', ask: err.ask, detail: err.message };
    }
    throw err;
  }
}

/** For assign/push: need worker identity fields beyond the git repo. */
export function requireAssignContext(opts?: {
  cwd?: string;
  defaults?: ProjectDefaults | null;
}): ProjectContext & { t3ProjectId: string; instanceId: string; modelId: string } {
  const ctx = resolveProjectContext(opts);
  const missing: string[] = [];
  if (!ctx.t3ProjectId) missing.push('t3ProjectId (defaults-set --t3-project or COORD_REPO)');
  if (!ctx.instanceId) missing.push('instanceId (defaults-set --instance or COORD_INSTANCE_ID)');
  if (!ctx.modelId) missing.push('modelId (defaults-set --model or COORD_MODEL_ID)');
  if (missing.length) {
    throw new NeedRepoError(
      `In repo ${ctx.githubRepo}, but missing assign settings: ${missing.join('; ')}. Set worker prefs with defaults-set (no --github — repo comes from the current checkout).`,
      missing.join(', '),
    );
  }
  return ctx as ProjectContext & { t3ProjectId: string; instanceId: string; modelId: string };
}

export function needRepoResult(err: unknown): {
  ok: false;
  error: 'need_repo';
  ask: string;
  detail: string;
} | null {
  if (err instanceof NeedRepoError) {
    return { ok: false, error: 'need_repo', ask: err.ask, detail: err.message };
  }
  return null;
}
