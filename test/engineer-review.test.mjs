// Engineer review over recorded GitHub answers (test/fixtures/engineer-review-events.json).
// No network: every answer the decision reads is in the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decide, summary, evidenceLine, firstLineIsReviewed, headPushedAt,
  prNumberFromMergeGroup, rerunTarget,
} from '../engineer-review/decide.mjs';

const fixture = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./fixtures/engineer-review-events.json', import.meta.url)), 'utf8'));
// Said only when a check goes red on a change that would merge unreviewed.
const UNREVIEWED = 'a change merged with no engineer review on its last commit';
const scenario = (name) => {
  const s = fixture.scenarios[name];
  assert.ok(s, `the fixture has no scenario named "${name}"`);
  return s;
};

function check(name) {
  const s = scenario(name);
  const d = decide(s);
  assert.equal(d.result, s.expect.result, s.expect.result === 'pending'
    ? `${UNREVIEWED}: "${name}" passed on ${JSON.stringify(d.evidence)}`
    : `"${name}" settled ${d.result}, expected pass: ${d.reason}`);
  if (s.expect.result === 'pass') {
    assert.equal(d.evidence.who, s.expect.by);
    assert.equal(d.evidence.at, s.expect.at);
    assert.equal(d.evidence.how, s.expect.how);
    assert.equal(d.evidence.commit, fixture.headSha);
  } else {
    assert.equal(d.evidence, null);
  }
  return d;
}

test('a reviewed comment after the last push passes', () => {
  check('reviewed comment after the last push');
});

test('a reviewed comment before a later push does not pass', () => {
  const d = check('reviewed comment before a later push');
  assert.equal(d.pushedAt, '2026-10-20T10:30:00Z');
  const seen = d.considered.find((c) => c.who === 'mira-okafor');
  assert.ok(seen && seen.counted === false && /before/.test(seen.why),
    `${UNREVIEWED}: the early comment counted, got ${JSON.stringify(seen)}`);
});

test("a bot's comment does not pass", () => {
  const d = check("a bot's reviewed comment");
  assert.match(d.considered[0].why, /bot/);
});

test('upper-case Reviewed passes', () => {
  check('upper-case Reviewed after the last push');
});

test('an approving review on an older commit does not pass', () => {
  check('approving review on an older commit');
});

test('an approving review on the head commit passes', () => {
  check('approving review on the head commit');
});

test('a reviewed comment by a person who may not merge does not pass', () => {
  check('reviewed comment by a person who may not merge');
});

test('the first line must be the word alone', () => {
  check('reviewed comment with words after it on the first line');
  assert.equal(firstLineIsReviewed('  REVIEWED  \nmore'), true);
  assert.equal(firstLineIsReviewed('reviewed.'), false);
  assert.equal(firstLineIsReviewed('not reviewed'), false);
  assert.equal(firstLineIsReviewed('\nreviewed'), false);
  assert.equal(firstLineIsReviewed(null), false);
});

test('with no record of the push a comment cannot count', () => {
  check('reviewed comment with no record of the push');
});

test('the head push time is the latest push of the head commit to the branch', () => {
  const s = scenario('reviewed comment after the last push');
  assert.equal(headPushedAt({ headSha: s.pr.headSha, headRef: s.pr.headRef, activity: s.activity }), '2026-10-20T10:30:00Z');
  const again = [{ ...s.activity[0], timestamp: '2026-10-20T12:00:00Z', activity_type: 'force_push' }, ...s.activity];
  assert.equal(headPushedAt({ headSha: s.pr.headSha, headRef: s.pr.headRef, activity: again }), '2026-10-20T12:00:00Z');
  const otherBranch = s.activity.map((e) => ({ ...e, ref: 'refs/heads/somewhere-else' }));
  assert.equal(headPushedAt({ headSha: s.pr.headSha, headRef: s.pr.headRef, activity: otherBranch }), null);
});

test('the summary carries who, when and the commit', () => {
  const d = decide(scenario('reviewed comment after the last push'));
  const text = summary(d);
  assert.match(text, /Passed/);
  assert.ok(text.includes('mira-okafor'));
  assert.ok(text.includes('2026-10-20T11:05:00Z'));
  assert.ok(text.includes(fixture.headSha));
  const line = JSON.parse(evidenceLine(d));
  assert.deepEqual(line, {
    result: 'pass', pr: 42, headSha: fixture.headSha, pushedAt: '2026-10-20T10:30:00Z',
    by: 'mira-okafor', at: '2026-10-20T11:05:00Z', how: 'comment',
  });
  const pending = summary(decide(scenario('reviewed comment before a later push')));
  assert.match(pending, /Pending/, `${UNREVIEWED}: the summary of an unreviewed head reads ${pending.split('\n')[2]}`);
  assert.ok(pending.includes('Not counted'));
});

test('a merge group names its pull request', () => {
  assert.equal(prNumberFromMergeGroup(fixture.mergeGroupHeadRef), 42);
  assert.equal(prNumberFromMergeGroup('refs/heads/main'), null);
});

test('a review arriving by comment re-runs the failed pull_request run on the head', () => {
  const t = rerunTarget(fixture.workflowRuns.workflow_runs,
    { headSha: fixture.headSha, workflowFile: '.github/workflows/engineer-review.yml' });
  assert.equal(t && t.id, fixture.workflowRuns.expectRerun);
  assert.equal(rerunTarget([], { headSha: fixture.headSha, workflowFile: '.github/workflows/engineer-review.yml' }), null);
});
