import { spawnSync } from 'node:child_process';
import {
  getIssue,
  listMilestones,
  listOpenIssuesInMilestone,
  resolveMilestone,
  type GhIssue,
  type GhMilestone,
} from '../github/gh';
import { resolveProjectContext } from './repoContext';
import { commitIssueSpec } from './specFromIssue';

export type IssueCommand =
  | 'status'
  | 'plan'
  | 'critique'
  | 'review'
  | 'refine'
  | 'update'
  | 'narrow'
  | 'widen'
  | 'explain'
  | 'close'
  | 'reopen'
  | 'create'
  | 'push';

export type MilestoneCommand =
  | 'status'
  | 'plan'
  | 'critique'
  | 'review'
  | 'refine'
  | 'update'
  | 'narrow'
  | 'widen'
  | 'explain'
  | 'close'
  | 'list'
  | 'create'
  | 'complete';

const ISSUE_RUBRIC = [
  'Clear problem statement?',
  'Bounded scope / non-goals?',
  'Falsifiable acceptance criteria (BDD Given/When/Then)?',
  'Enough context to implement without oral clarification?',
  'Risks / dependencies called out?',
  'Ready to commit a specSha and assign_work?',
];

const MILESTONE_RUBRIC = [
  'Clear close criteria?',
  'Issue membership matches the slice?',
  'Critical path identifiable?',
  'Any issue too vague to execute?',
  'Scope too wide / too narrow?',
  'Ready to push the next critical-path issue?',
];

function gh(args: string[]): string {
  const res = spawnSync('gh', args, { encoding: 'utf8', env: process.env });
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function repo(): string {
  return resolveProjectContext().githubRepo;
}

/** Shared shape/refine/narrow/widen: preview or apply body/title. */
function issueShape(
  command: 'refine' | 'narrow' | 'widen' | 'update',
  issueNumber: number,
  patch: { title?: string; body?: string },
  apply: boolean,
) {
  const issue = getIssue(repo(), issueNumber);
  if (!apply) {
    return {
      ok: true as const,
      entity: 'issue' as const,
      command,
      mode: 'preview' as const,
      issue,
      proposed: patch,
      hint:
        command === 'narrow'
          ? 'Move extras into Non-Goals; keep AC tight.'
          : command === 'widen'
            ? 'Expand deliberately; keep AC bounded.'
            : command === 'refine'
              ? 'Sharpen wording without changing agreed scope.'
              : 'Update title/body as proposed.',
      next: ['Re-call with apply:true (and title/body) to mutate GitHub.'],
    };
  }
  if (!patch.title && !patch.body) {
    throw new Error(`${command} with apply:true requires title and/or body`);
  }
  const args = ['issue', 'edit', String(issueNumber), '--repo', repo()];
  if (patch.title) args.push('--title', patch.title);
  if (patch.body) args.push('--body', patch.body);
  gh(args);
  return {
    ok: true as const,
    entity: 'issue' as const,
    command,
    mode: 'applied' as const,
    issue: getIssue(repo(), issueNumber),
  };
}

export function runIssueCommand(input: {
  command: IssueCommand;
  issueNumber?: number;
  title?: string;
  body?: string;
  comment?: string;
  planText?: string;
  commitSpec?: boolean;
  apply?: boolean;
}) {
  const apply = Boolean(input.apply);
  const cmd = input.command === 'review' ? 'critique' : input.command;

  if (cmd === 'create') {
    if (!input.title || !input.body) throw new Error('create requires title and body');
    if (!apply) {
      return {
        ok: true as const,
        entity: 'issue' as const,
        command: 'create' as const,
        mode: 'preview' as const,
        proposed: { title: input.title, body: input.body },
        next: ['Re-call with apply:true to create.'],
      };
    }
    const url = gh([
      'issue',
      'create',
      '--repo',
      repo(),
      '--title',
      input.title,
      '--body',
      input.body,
    ]);
    return {
      ok: true as const,
      entity: 'issue' as const,
      command: 'create' as const,
      mode: 'applied' as const,
      url,
    };
  }

  if (input.issueNumber == null) throw new Error(`${cmd} requires issueNumber`);
  const n = input.issueNumber;

  if (cmd === 'status') {
    const issue = getIssue(repo(), n);
    return {
      ok: true as const,
      entity: 'issue' as const,
      command: 'status' as const,
      issue,
      next: [
        'critique / plan / refine / narrow / widen to shape',
        `push (or run "${n}") to dispatch a worker`,
      ],
    };
  }
  if (cmd === 'explain') {
    const issue = getIssue(repo(), n);
    return {
      ok: true as const,
      entity: 'issue' as const,
      command: 'explain' as const,
      issue,
      explainHint:
        'Summarize for the operator: goal, why it matters, acceptance, blockers. No GitHub mutation.',
    };
  }
  if (cmd === 'critique') {
    const issue = getIssue(repo(), n);
    if (apply && input.comment) {
      gh(['issue', 'comment', String(n), '--repo', repo(), '--body', input.comment]);
      return {
        ok: true as const,
        entity: 'issue' as const,
        command: 'critique' as const,
        mode: 'commented' as const,
        issue,
      };
    }
    return {
      ok: true as const,
      entity: 'issue' as const,
      command: 'critique' as const,
      issue,
      rubric: ISSUE_RUBRIC,
      next: [
        'Answer the rubric as supervisor.',
        'Shape with refine|narrow|widen + body + apply:true.',
        'Optional: critique again with comment + apply:true to post on the issue.',
        `Execute with push / run("${n}").`,
      ],
    };
  }
  if (cmd === 'plan') {
    const issue = getIssue(repo(), n);
    if (!input.planText) {
      return {
        ok: true as const,
        entity: 'issue' as const,
        command: 'plan' as const,
        mode: 'draft' as const,
        issue,
        planTemplate: [
          '## Plan',
          '- Files / areas',
          '- Risks',
          '- BDD scenarios',
          '- Stop conditions',
          '- Evidence / tests',
        ].join('\n'),
        next: [
          'Draft planText, then re-call plan with planText (and commitSpec:true to persist specSha).',
        ],
      };
    }
    if (input.commitSpec) {
      const ctx = resolveProjectContext();
      const synthetic: GhIssue = {
        ...issue,
        body: `${issue.body ?? ''}\n\n## Execution plan\n\n${input.planText}`,
      };
      const committed = commitIssueSpec(ctx.projectCwd, synthetic);
      return {
        ok: true as const,
        entity: 'issue' as const,
        command: 'plan' as const,
        mode: 'committed' as const,
        issue,
        planText: input.planText,
        ...committed,
        next: [`push_issue ${n} / run("${n}")`],
      };
    }
    return {
      ok: true as const,
      entity: 'issue' as const,
      command: 'plan' as const,
      mode: 'ready' as const,
      issue,
      planText: input.planText,
      next: ['Re-call with commitSpec:true to persist, or push_issue to auto-spec from issue body.'],
    };
  }
  if (cmd === 'refine' || cmd === 'narrow' || cmd === 'widen' || cmd === 'update') {
    return issueShape(cmd, n, { title: input.title, body: input.body }, apply);
  }
  if (cmd === 'close') {
    const issue = getIssue(repo(), n);
    if (!apply) {
      return {
        ok: true as const,
        entity: 'issue' as const,
        command: 'close' as const,
        mode: 'preview' as const,
        issue,
        comment: input.comment ?? null,
        next: ['Re-call with apply:true to close.'],
      };
    }
    const args = ['issue', 'close', String(n), '--repo', repo()];
    if (input.comment) args.push('--comment', input.comment);
    gh(args);
    return { ok: true as const, entity: 'issue' as const, command: 'close' as const, mode: 'applied' as const };
  }
  if (cmd === 'reopen') {
    const issue = getIssue(repo(), n);
    if (!apply) {
      return {
        ok: true as const,
        entity: 'issue' as const,
        command: 'reopen' as const,
        mode: 'preview' as const,
        issue,
        next: ['Re-call with apply:true to reopen.'],
      };
    }
    gh(['issue', 'reopen', String(n), '--repo', repo()]);
    return { ok: true as const, entity: 'issue' as const, command: 'reopen' as const, mode: 'applied' as const };
  }
  if (cmd === 'push') {
    throw new Error('push is handled by pushIssue — use runDxIntent / push_issue tool');
  }
  throw new Error(`Unsupported issue command: ${input.command}`);
}

export function runMilestoneCommand(input: {
  command: MilestoneCommand;
  milestone?: string;
  title?: string;
  description?: string;
  dueOn?: string;
  apply?: boolean;
}) {
  const apply = Boolean(input.apply);
  const cmd = input.command === 'review' ? 'critique' : input.command;

  if (cmd === 'list') {
    const milestones = listMilestones(repo(), 'open');
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'list' as const,
      milestones: milestones.map((m) => ({
        number: m.number,
        title: m.title,
        state: m.state,
        open_issues: m.open_issues,
        closed_issues: m.closed_issues,
      })),
    };
  }
  if (cmd === 'create') {
    if (!input.title) throw new Error('create requires title');
    if (!apply) {
      return {
        ok: true as const,
        entity: 'milestone' as const,
        command: 'create' as const,
        mode: 'preview' as const,
        proposed: {
          title: input.title,
          description: input.description,
          dueOn: input.dueOn,
        },
        next: ['Re-call with apply:true to create.'],
      };
    }
    const args = ['api', '-X', 'POST', `repos/${repo()}/milestones`, '-f', `title=${input.title}`];
    if (input.description) args.push('-f', `description=${input.description}`);
    if (input.dueOn) args.push('-f', `due_on=${input.dueOn}`);
    const created = JSON.parse(gh(args)) as GhMilestone;
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'create' as const,
      mode: 'applied' as const,
      milestone: created,
    };
  }

  if (!input.milestone) throw new Error(`${cmd} requires milestone query`);
  const q = input.milestone;

  if (cmd === 'complete') {
    throw new Error('complete is handled by completeMilestone — use runDxIntent / complete_milestone');
  }
  if (cmd === 'status') {
    const milestone = resolveMilestone(repo(), q);
    const open = listOpenIssuesInMilestone(repo(), milestone.number);
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'status' as const,
      milestone,
      openIssues: open.map((i) => ({ number: i.number, title: i.title, url: i.url })),
      next: [
        'critique / plan / refine / narrow / widen to shape',
        `complete_milestone "${q}" to dispatch next critical-path issue`,
      ],
    };
  }
  if (cmd === 'explain') {
    const milestone = resolveMilestone(repo(), q);
    const open = listOpenIssuesInMilestone(repo(), milestone.number);
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'explain' as const,
      milestone,
      openCount: open.length,
      explainHint: 'Explain purpose, close criteria, progress, leftovers — no mutation.',
    };
  }
  if (cmd === 'critique') {
    const milestone = resolveMilestone(repo(), q);
    const open = listOpenIssuesInMilestone(repo(), milestone.number);
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'critique' as const,
      milestone,
      openIssues: open.map((i) => ({ number: i.number, title: i.title })),
      rubric: MILESTONE_RUBRIC,
      next: [
        'Answer the rubric.',
        'Shape with refine|update|narrow|widen + apply:true.',
        `Execute with complete_milestone "${q}".`,
      ],
    };
  }
  if (cmd === 'plan') {
    const milestone = resolveMilestone(repo(), q);
    const open = listOpenIssuesInMilestone(repo(), milestone.number);
    const critical = [...open].sort((a, b) => a.number - b.number)[0] ?? null;
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'plan' as const,
      milestone,
      openIssues: open.map((i) => ({ number: i.number, title: i.title, url: i.url })),
      suggestedCriticalPath: critical
        ? { number: critical.number, title: critical.title, url: critical.url }
        : null,
      next: [
        'Confirm membership; refine/narrow/widen as needed.',
        critical
          ? `Plan issue #${critical.number}, then complete_milestone / push_issue.`
          : 'No open issues — close when release criteria are met.',
      ],
    };
  }
  if (cmd === 'refine' || cmd === 'update' || cmd === 'narrow' || cmd === 'widen') {
    const milestone = resolveMilestone(repo(), q);
    const proposed = {
      title: input.title,
      description: input.description,
      dueOn: input.dueOn,
    };
    if (!apply) {
      return {
        ok: true as const,
        entity: 'milestone' as const,
        command: cmd,
        mode: 'preview' as const,
        milestone,
        proposed,
        hint:
          cmd === 'narrow'
            ? 'Reduce scope; move issues out of this milestone on GitHub as needed.'
            : cmd === 'widen'
              ? 'Expand deliberately; pull related issues in with rationale.'
              : 'Sharpen title/description/close criteria.',
        next: [
          'Re-call with apply:true and title/description to mutate the milestone record.',
          'Issue membership moves still use gh issue edit --milestone (supervisor or follow-up).',
        ],
      };
    }
    if (!input.title && !input.description && !input.dueOn) {
      throw new Error(`${cmd} with apply:true requires title, description, and/or dueOn`);
    }
    const args = ['api', '-X', 'PATCH', `repos/${repo()}/milestones/${milestone.number}`];
    if (input.title) args.push('-f', `title=${input.title}`);
    if (input.description) args.push('-f', `description=${input.description}`);
    if (input.dueOn) args.push('-f', `due_on=${input.dueOn}`);
    const updated = JSON.parse(gh(args)) as GhMilestone;
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: cmd,
      mode: 'applied' as const,
      milestone: updated,
    };
  }
  if (cmd === 'close') {
    const milestone = resolveMilestone(repo(), q);
    if (!apply) {
      return {
        ok: true as const,
        entity: 'milestone' as const,
        command: 'close' as const,
        mode: 'preview' as const,
        milestone,
        next: ['Re-call with apply:true to close.'],
      };
    }
    const updated = JSON.parse(
      gh([
        'api',
        '-X',
        'PATCH',
        `repos/${repo()}/milestones/${milestone.number}`,
        '-f',
        'state=closed',
      ]),
    ) as GhMilestone;
    return {
      ok: true as const,
      entity: 'milestone' as const,
      command: 'close' as const,
      mode: 'applied' as const,
      milestone: updated,
    };
  }
  throw new Error(`Unsupported milestone command: ${input.command}`);
}
