import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  assignmentIdempotencyKey,
  evaluateDelivery,
  type AssignWorkInput,
  type DeliveryObservation,
  type DeliveryVerdict,
} from './contracts';

const execFileAsync = promisify(execFile);

export function deriveAssignmentId(input: AssignWorkInput): string {
  if (input.assignmentId) return input.assignmentId;
  const digest = createHash('sha256').update(assignmentIdempotencyKey(input)).digest('hex');
  return `asgn_${digest.slice(0, 24)}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}

export async function observeWorktreeDelivery(input: {
  worktreePath: string;
  baseCommit: string;
  assignmentId: string;
}): Promise<{ observation: DeliveryObservation; verdict: DeliveryVerdict }> {
  const headSha = await git(input.worktreePath, ['rev-parse', 'HEAD']);
  const commitMessage = await git(input.worktreePath, ['log', '-1', '--format=%B']);
  const porcelain = await git(input.worktreePath, ['status', '--porcelain']);
  const observation: DeliveryObservation = {
    headSha,
    baseCommit: input.baseCommit,
    commitMessage,
    dirty: porcelain.length > 0,
    observedAt: new Date().toISOString(),
  };
  return {
    observation,
    verdict: evaluateDelivery({
      assignmentId: input.assignmentId,
      baseCommit: input.baseCommit,
      observation,
    }),
  };
}
