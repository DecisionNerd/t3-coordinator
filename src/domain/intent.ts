export type AdminVerb =
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
  | 'list'
  | 'push'
  | 'complete';

export type ParsedIntent =
  | { kind: 'next' }
  | { kind: 'sitrep'; windowDays?: number }
  | { kind: 'push_issue'; issueNumber: number }
  | { kind: 'complete_milestone'; milestone: string }
  | { kind: 'complete_epic'; epicNumber: number }
  | {
      kind: 'issue_admin';
      command: Exclude<AdminVerb, 'list' | 'complete'>;
      issueNumber?: number;
      rest?: string;
      asEpic?: boolean;
    }
  | {
      kind: 'milestone_admin';
      command: Exclude<AdminVerb, 'reopen' | 'push'>;
      milestone?: string;
      rest?: string;
    }
  | {
      kind: 'epic_admin';
      command: 'status' | 'plan' | 'critique' | 'review' | 'explain' | 'close' | 'create';
      epicNumber?: number;
      rest?: string;
    }
  | { kind: 'unknown'; raw: string }
  | { kind: 'classify'; goal: string }
  | { kind: 'start_process'; processId: string }
  | {
      kind: 'process_recover';
      action: 'retry_same' | 'retry_role' | 'block' | 'cancel_graph';
      processInstanceId?: string;
    };

const ADMIN =
  'status|plan|critique|review|refine|update|narrow|widen|explain|close|reopen|create|list|push|complete';

/**
 * Map @t3-coordinator phrases to DX intents.
 *
 * Orient:  "" / "next" / "what next"
 * Sitrep:  "sitrep" / "standup" / "status" / "check-in"
 * Execute: "192", "complete M2", "complete epic 50"
 * Shape:   "critique 192", "plan milestone M2", "status epic 50", "create epic"
 */
export function parseIntent(raw: string): ParsedIntent {
  const text = raw.trim();

  // Sitrep / standup check-in (before bare "status" colliding with orient)
  const sitrepMatch = text.match(
    /^(?:sit[\s-]?rep|standup|stand-up|check[\s-]?in|status(?:\s+report)?)(?:\s+(\d+)\s*d(?:ays?)?)?$/i,
  );
  if (sitrepMatch) {
    const days = sitrepMatch[1] ? Number(sitrepMatch[1]) : undefined;
    return { kind: 'sitrep', windowDays: days };
  }

  // Empty @mention or explicit next → supervisor orientation brief
  if (!text || /^(next|what\s+next|orient|go|continue|\?+)$/i.test(text)) {
    return { kind: 'next' };
  }

  // Bare issue → Path C execute
  const issueOnly = text.match(/^#?(\d+)$/);
  if (issueOnly) {
    return { kind: 'push_issue', issueNumber: Number(issueOnly[1]) };
  }

  // complete epic 50
  const completeEpic = text.match(/^complete\s+epic\s+#?(\d+)\s*$/i);
  if (completeEpic) {
    return { kind: 'complete_epic', epicNumber: Number(completeEpic[1]) };
  }

  // complete M2 / complete milestone 2
  const complete = text.match(/^complete\s+(?:milestone\s+)?(.+)$/i);
  if (complete) {
    const target = complete[1]!.trim();
    const epicNum = target.match(/^epic\s+#?(\d+)$/i);
    if (epicNum) return { kind: 'complete_epic', epicNumber: Number(epicNum[1]) };
    return { kind: 'complete_milestone', milestone: target };
  }

  // push 192
  const push = text.match(/^(?:push|do|fix)\s+#?(\d+)\s*$/i);
  if (push) {
    return { kind: 'push_issue', issueNumber: Number(push[1]) };
  }

  // create epic …
  if (/^create\s+epic\b/i.test(text)) {
    return { kind: 'epic_admin', command: 'create', rest: text.replace(/^create\s+epic\s*/i, '').trim() };
  }

  // epic <cmd> <n> | <cmd> epic <n>
  const epicCmd = text.match(
    new RegExp(`^(?:epic\\s+)?(${ADMIN})\\s+epic\\s+#?(\\d+)(?:\\s+([\\s\\S]+))?$`, 'i'),
  );
  if (epicCmd) {
    const command = epicCmd[1]!.toLowerCase();
    if (['status', 'plan', 'critique', 'review', 'explain', 'close'].includes(command)) {
      return {
        kind: 'epic_admin',
        command: command as 'status' | 'plan' | 'critique' | 'review' | 'explain' | 'close',
        epicNumber: Number(epicCmd[2]),
        rest: epicCmd[3]?.trim(),
      };
    }
    if (command === 'complete') {
      return { kind: 'complete_epic', epicNumber: Number(epicCmd[2]) };
    }
  }

  // epic 50 → status
  const epicOnly = text.match(/^epic\s+#?(\d+)\s*$/i);
  if (epicOnly) {
    return { kind: 'epic_admin', command: 'status', epicNumber: Number(epicOnly[1]) };
  }

  // issue <cmd> <n> | <cmd> #<n>
  const issueCmd = text.match(
    new RegExp(`^(?:issue\\s+)?(${ADMIN})\\s+(?:issue\\s+)?#?(\\d+)(?:\\s+([\\s\\S]+))?$`, 'i'),
  );
  if (issueCmd && !['list', 'complete'].includes(issueCmd[1]!.toLowerCase())) {
    return {
      kind: 'issue_admin',
      command: issueCmd[1]!.toLowerCase() as Exclude<AdminVerb, 'list' | 'complete'>,
      issueNumber: Number(issueCmd[2]),
      rest: issueCmd[3]?.trim(),
    };
  }

  // milestone list
  if (/^(?:milestone\s+)?list(?:\s+milestones)?$/i.test(text) || /^list\s+milestones$/i.test(text)) {
    return { kind: 'milestone_admin', command: 'list' };
  }

  // create issue … / create milestone …
  const createEntity = text.match(/^create\s+(issue|milestone)\b([\s\S]*)$/i);
  if (createEntity) {
    const entity = createEntity[1]!.toLowerCase();
    if (entity === 'issue') {
      return { kind: 'issue_admin', command: 'create', rest: createEntity[2]?.trim() };
    }
    return { kind: 'milestone_admin', command: 'create', rest: createEntity[2]?.trim(), milestone: createEntity[2]?.trim() };
  }

  // milestone <cmd> <target> | <cmd> milestone <target>
  const msCmd = text.match(new RegExp(`^(?:milestone\\s+)?(${ADMIN})\\s+(?:milestone\\s+)?(.+)$`, 'i'));
  if (msCmd && !['reopen', 'push'].includes(msCmd[1]!.toLowerCase())) {
    return {
      kind: 'milestone_admin',
      command: msCmd[1]!.toLowerCase() as Exclude<AdminVerb, 'reopen' | 'push'>,
      milestone: msCmd[2]!.trim(),
    };
  }

  // milestone M2 → status
  const msOnly = text.match(/^milestone\s+(.+)$/i);
  if (msOnly) {
    return { kind: 'milestone_admin', command: 'status', milestone: msOnly[1].trim() };
  }

  const startProc = text.match(/^start\s+([A-Za-z][A-Za-z0-9_-]*)\s*$/);
  if (startProc) {
    return { kind: 'start_process', processId: startProc[1]! };
  }

  const recover = text.match(
    /^(retry(?:[\s_]+same)?|retry[\s_]+role|block|cancel)(?:\s+([A-Za-z0-9_-]+))?\s*$/i,
  );
  if (recover) {
    const verb = recover[1]!.toLowerCase().replace(/\s+/g, '_');
    const action =
      verb === 'retry_role'
        ? ('retry_role' as const)
        : verb === 'block'
          ? ('block' as const)
          : verb === 'cancel'
            ? ('cancel_graph' as const)
            : ('retry_same' as const);
    return { kind: 'process_recover', action, processInstanceId: recover[2] };
  }

  return { kind: 'classify', goal: text };
}
