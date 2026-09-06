import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GhIssue } from '../github/gh';

function git(cwd: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

export function revParseHead(projectCwd: string): string {
  return git(projectCwd, ['rev-parse', 'HEAD']);
}

/**
 * Commit a thin spec from the GitHub issue so assign_work has a real specSha.
 * Idempotent-ish: overwrites `.coordinator/specs/issue-<n>.md` and commits when dirty.
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

  git(projectCwd, ['add', '--', rel]);
  const dirty = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: projectCwd });
  if (dirty.status === 0) {
    // nothing staged — reuse HEAD as spec
    return { specSha: baseCommit, baseCommit, specPath: rel };
  }
  git(projectCwd, [
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
