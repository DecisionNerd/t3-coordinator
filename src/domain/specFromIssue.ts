import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GhIssue } from '../github/gh';
import { readDefaults } from './defaults';

type GhUser = {
  login?: string;
  id?: number;
  name?: string | null;
  email?: string | null;
};

function ghAuthedUser(): GhUser | null {
  const res = spawnSync('gh', ['api', 'user'], { encoding: 'utf8', env: process.env });
  if (res.status !== 0) return null;
  try {
    return JSON.parse(res.stdout) as GhUser;
  } catch {
    return null;
  }
}

/** Identity for coordinator-made commits only — never writes git config. Prefers `gh` login. */
export function coordinatorGitIdentity(): { name: string; email: string; source: string } {
  const defaults = readDefaults();
  const envName = process.env.COORD_GIT_AUTHOR_NAME?.trim();
  const envEmail = process.env.COORD_GIT_AUTHOR_EMAIL?.trim();
  if (envName && envEmail) {
    return { name: envName, email: envEmail, source: 'env' };
  }

  const ghUser = ghAuthedUser();
  if (ghUser?.login) {
    const name =
      envName ||
      defaults?.gitUserName?.trim() ||
      ghUser.name?.trim() ||
      ghUser.login;
    const email =
      envEmail ||
      defaults?.gitUserEmail?.trim() ||
      ghUser.email?.trim() ||
      (typeof ghUser.id === 'number'
        ? `${ghUser.id}+${ghUser.login}@users.noreply.github.com`
        : `${ghUser.login}@users.noreply.github.com`);
    return { name, email, source: 'gh' };
  }

  const name = envName || defaults?.gitUserName?.trim() || 't3-coordinator';
  const email =
    envEmail || defaults?.gitUserEmail?.trim() || 't3-coordinator@users.noreply.github.com';
  return { name, email, source: defaults?.gitUserName || defaults?.gitUserEmail ? 'defaults' : 'fallback' };
}

function git(cwd: string, args: string[], opts?: { withIdentity?: boolean }): string {
  const env = { ...process.env };
  if (opts?.withIdentity !== false) {
    const id = coordinatorGitIdentity();
    env.GIT_AUTHOR_NAME = id.name;
    env.GIT_AUTHOR_EMAIL = id.email;
    env.GIT_COMMITTER_NAME = id.name;
    env.GIT_COMMITTER_EMAIL = id.email;
  }
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

export function revParseHead(projectCwd: string): string {
  return git(projectCwd, ['rev-parse', 'HEAD'], { withIdentity: false });
}

/**
 * Commit a thin spec from the GitHub issue so assign_work has a real specSha.
 * Idempotent-ish: overwrites `.coordinator/specs/issue-<n>.md` and commits when dirty.
 * Uses per-process author env (or -c overrides) — does not set user.name/email in git config.
 */
export function commitIssueSpec(projectCwd: string, issue: GhIssue): {
  specSha: string;
  baseCommit: string;
  specPath: string;
} {
  const baseCommit = revParseHead(projectCwd);
  const rel = path.join('.coordinator', 'specs', `issue-${issue.number}.md`);
  const abs = path.join(projectCwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const body = [
    `# Spec: issue #${issue.number} — ${issue.title}`,
    '',
    `Source: ${issue.url}`,
    '',
    '## Acceptance',
    '',
    issue.body?.trim() || '_No issue body — confirm acceptance criteria before delivery._',
    '',
    '## Coordinator notes',
    '',
    '- Deliver with a commit containing `Coordinated-By: <assignmentId>`.',
    '- Do not claim done without that trailer.',
    '',
  ].join('\n');
  fs.writeFileSync(abs, body, 'utf8');

  git(projectCwd, ['add', '--', rel], { withIdentity: false });
  const dirty = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: projectCwd,
    encoding: 'utf8',
  });
  if (dirty.status === 0) {
    return { specSha: baseCommit, baseCommit, specPath: rel };
  }

  const id = coordinatorGitIdentity();
  git(projectCwd, [
    '-c',
    `user.name=${id.name}`,
    '-c',
    `user.email=${id.email}`,
    'commit',
    '-m',
    `coord(spec): issue #${issue.number} ${issue.title}\n\nSpec-For: #${issue.number}`,
  ]);
  const specSha = revParseHead(projectCwd);
  return { specSha, baseCommit, specPath: rel };
}

export function buildIssueGoal(issue: GhIssue, githubRepo: string): string {
  return [
    `Implement GitHub issue #${issue.number}: ${issue.title}`,
    `Repo: ${githubRepo}`,
    `URL: ${issue.url}`,
    'Follow the committed spec under .coordinator/specs/.',
    'When finished, commit with Coordinated-By trailer for this assignment.',
  ].join('\n');
}
