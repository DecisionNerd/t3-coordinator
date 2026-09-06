'use strict';

const assert = require('assert');
const { describe, it } = require('mocha');
const { parseIntent } = require('../../lib/domain/intent.js');
const { parseTaskListChildren } = require('../../lib/domain/epic.js');

describe('parseIntent', () => {
  it('maps empty and next to orientation', () => {
    assert.deepStrictEqual(parseIntent(''), { kind: 'next' });
    assert.deepStrictEqual(parseIntent('   '), { kind: 'next' });
    assert.deepStrictEqual(parseIntent('next'), { kind: 'next' });
    assert.deepStrictEqual(parseIntent('what next'), { kind: 'next' });
  });

  it('maps sitrep and standup to sitrep', () => {
    assert.deepStrictEqual(parseIntent('sitrep'), { kind: 'sitrep', windowDays: undefined });
    assert.deepStrictEqual(parseIntent('standup'), { kind: 'sitrep', windowDays: undefined });
    assert.deepStrictEqual(parseIntent('status'), { kind: 'sitrep', windowDays: undefined });
    assert.deepStrictEqual(parseIntent('check-in'), { kind: 'sitrep', windowDays: undefined });
    assert.deepStrictEqual(parseIntent('sitrep 14d'), { kind: 'sitrep', windowDays: 14 });
  });

  it('maps bare issue numbers to Path C', () => {
    assert.deepStrictEqual(parseIntent('192'), { kind: 'push_issue', issueNumber: 192 });
    assert.deepStrictEqual(parseIntent('#192'), { kind: 'push_issue', issueNumber: 192 });
    assert.deepStrictEqual(parseIntent('push 192'), { kind: 'push_issue', issueNumber: 192 });
  });

  it('maps complete phrases to Path B', () => {
    assert.deepStrictEqual(parseIntent('complete M2'), {
      kind: 'complete_milestone',
      milestone: 'M2',
    });
  });

  it('maps epic complete and status', () => {
    assert.deepStrictEqual(parseIntent('complete epic 50'), {
      kind: 'complete_epic',
      epicNumber: 50,
    });
    assert.deepStrictEqual(parseIntent('epic 50'), {
      kind: 'epic_admin',
      command: 'status',
      epicNumber: 50,
    });
    assert.deepStrictEqual(parseIntent('status epic 50'), {
      kind: 'epic_admin',
      command: 'status',
      epicNumber: 50,
      rest: undefined,
    });
  });

  it('maps create and close across issue / milestone / epic', () => {
    assert.deepStrictEqual(parseIntent('create epic Payment redesign'), {
      kind: 'epic_admin',
      command: 'create',
      rest: 'Payment redesign',
    });
    assert.strictEqual(parseIntent('create issue Fix login').kind, 'issue_admin');
    assert.strictEqual(parseIntent('create milestone M3 Slice').kind, 'milestone_admin');
    assert.deepStrictEqual(parseIntent('close 192'), {
      kind: 'issue_admin',
      command: 'close',
      issueNumber: 192,
      rest: undefined,
    });
    assert.strictEqual(parseIntent('close M2').kind, 'milestone_admin');
    assert.deepStrictEqual(parseIntent('close epic 50'), {
      kind: 'epic_admin',
      command: 'close',
      epicNumber: 50,
      rest: undefined,
    });
  });

  it('maps issue and milestone admin verbs', () => {
    assert.strictEqual(parseIntent('critique 192').kind, 'issue_admin');
    assert.strictEqual(parseIntent('plan milestone M2').kind, 'milestone_admin');
  });
});

describe('parseGitHubOwnerRepo', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseGitHubOwnerRepo } = require('../../lib/domain/repoContext.js');

  it('parses ssh and https remotes', () => {
    assert.strictEqual(
      parseGitHubOwnerRepo('git@github.com:DecisionNerd/t3-coordinator.git'),
      'DecisionNerd/t3-coordinator',
    );
    assert.strictEqual(
      parseGitHubOwnerRepo('https://github.com/DecisionNerd/t3-coordinator.git'),
      'DecisionNerd/t3-coordinator',
    );
  });
});

describe('parseTaskListChildren', () => {
  it('reads checkbox children', () => {
    const kids = parseTaskListChildren('- [ ] #12\n- [x] #13\n* #14\n');
    assert.deepStrictEqual(
      kids.map((k) => ({ n: k.number, d: k.done })),
      [
        { n: 12, d: false },
        { n: 13, d: true },
        { n: 14, d: false },
      ],
    );
  });
});
