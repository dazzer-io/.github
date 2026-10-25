// Engineer review over recorded GitHub answers (test/fixtures/engineer-review-events.json).
// No network: every answer the decision reads is in the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decide, summary, evidenceLine, firstLineIsReviewed, headPushedAt,
  prNumberFromMergeGroup, run, targetOf, statusFor, renderCaller, CALLER_USES, CONTEXT,
} from '../engineer-review/decide.mjs';

const fixture = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./fixtures/engineer-review-events.json', import.meta.url)), 'utf8'));
// Said only when a check goes red on a review the status missed.
const MISSED = 'a review comment did not set the Engineer review status';
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

// A client that answers only from the recorded answers and records every write.
function recordedClient(answers) {
  const reads = [];
  const posts = [];
  const answer = (path) => {
    const key = path.split('?')[0];
    reads.push(key);
    if (!(key in answers)) throw new Error(`no recorded answer for ${key}`);
    return structuredClone(answers[key]);
  };
  return {
    reads, posts,
    async get(path) { return answer(path); },
    async all(path) { return answer(path); },
    async post(path, body) { posts.push({ path, body }); return { id: posts.length }; },
    warn() {},
  };
}

async function runEvent(name) {
  const e = fixture.events[name];
  assert.ok(e, `the fixture has no event named "${name}"`);
  const client = recordedClient(e.answers);
  const out = await run({
    eventName: e.eventName, event: e.event, repo: fixture.repository, client,
    runUrl: `https://github.com/${fixture.repository}/actions/runs/123`,
  });
  return { e, out, client };
}

test('a reviewed comment event on a pull request sets the status to success', async () => {
  const { e, out, client } = await runEvent('a reviewed comment on the pull request');
  assert.equal(client.posts.length, 1, `${MISSED}: ${client.posts.length} statuses were set${out.skip ? ` (skipped: ${out.skip})` : ''}`);
  const [{ path, body }] = client.posts;
  assert.equal(path, `/repos/${fixture.repository}/statuses/${e.expect.sha}`, `${MISSED}: it was set on ${path}`);
  assert.equal(body.context, CONTEXT);
  assert.equal(body.context, 'Engineer review');
  assert.equal(body.state, e.expect.state, `${MISSED}: it reads ${body.state} (${body.description})`);
  for (const word of e.expect.says) assert.ok(body.description.includes(word), `the status should say ${word}: ${body.description}`);
  assert.ok(body.description.length <= 140);
  assert.equal(body.target_url, `https://github.com/${fixture.repository}/actions/runs/123`);
});

test('a push after the review sets the new head pending again', async () => {
  const { e, client } = await runEvent('a push after the review');
  assert.equal(client.posts.length, 1, `${UNREVIEWED}: no status was set on the new head`);
  const [{ path, body }] = client.posts;
  assert.equal(path, `/repos/${fixture.repository}/statuses/${e.expect.sha}`);
  assert.equal(body.state, 'pending', `${UNREVIEWED}: the new head reads ${body.state} (${body.description})`);
  for (const word of e.expect.says) assert.ok(body.description.includes(word), `the status should say ${word}: ${body.description}`);
});

test('an approving review event on the head commit sets success', async () => {
  const { e, client } = await runEvent('an approving review on the head commit');
  assert.equal(client.posts.length, 1);
  assert.equal(client.posts[0].path, `/repos/${fixture.repository}/statuses/${e.expect.sha}`);
  assert.equal(client.posts[0].body.state, 'success');
  for (const word of e.expect.says) assert.ok(client.posts[0].body.description.includes(word));
});

test('a comment on an issue, not a pull request, sets nothing', async () => {
  const { out, client } = await runEvent('a comment on an issue, not a pull request');
  assert.equal(client.posts.length, 0);
  assert.equal(client.reads.length, 0);
  assert.equal(out.status, null);
  assert.match(out.skip, /issue/);
});

test('every event names its pull request, and other events set nothing', () => {
  assert.deepEqual(targetOf('issue_comment', fixture.events['a reviewed comment on the pull request'].event),
    { number: 42, headSha: null, statusSha: null });
  assert.equal(targetOf('push', {}).skip.length > 0, true);
  const mg = targetOf('merge_group', { merge_group: { head_ref: fixture.mergeGroupHeadRef, head_sha: 'ab'.repeat(20) } });
  assert.deepEqual(mg, { number: 42, headSha: null, statusSha: 'ab'.repeat(20) });
});

test('a long reason is cut to the 140 characters a status keeps', () => {
  const d = { result: 'pending', headSha: fixture.headSha, reason: 'x'.repeat(300), evidence: null };
  const s = statusFor(d, {});
  assert.equal(s.state, 'pending');
  assert.equal(s.description.length, 140);
  assert.equal(s.sha, fixture.headSha);
});

const callerPath = fileURLToPath(new URL('../engineer-review/caller.yml', import.meta.url));
const workflowPath = fileURLToPath(new URL('../.github/workflows/engineer-review.yml', import.meta.url));

test('the caller file pins its reusable workflow to a commit and names nothing of the install', () => {
  const caller = fs.readFileSync(callerPath, 'utf8');
  const uses = caller.split('\n').filter((l) => /^\s*uses:/.test(l)).map((l) => l.replace(/^\s*uses:\s*/, '').trim());
  assert.deepEqual(uses, [CALLER_USES], 'the caller has exactly one uses: line, the placeholder one');
  // Nothing of the install: no owner/repo path other than the placeholders, no web address.
  const named = [...caller.matchAll(/[A-Za-z0-9_.<>-]+\/[A-Za-z0-9_.<>-]+\/\.github\/workflows\//g)].map((m) => m[0]);
  assert.deepEqual([...new Set(named)], ['<owner>/<repo>/.github/workflows/']);
  assert.doesNotMatch(caller, /https?:\/\//);
  assert.doesNotMatch(caller, /secrets\./);
  for (const trigger of ['pull_request:', 'issue_comment:', 'pull_request_review:']) assert.ok(caller.includes(trigger), trigger);
  assert.match(caller, /types: \[opened, synchronize, reopened\]/);
  assert.match(caller, /issue_comment:\n\s+types: \[created\]/);
  assert.match(caller, /pull_request_review:\n\s+types: \[submitted\]/);
  assert.match(caller, /permissions:\n\s+statuses: write\n\s+pull-requests: read\n\n/);
  assert.match(caller, /if: github\.event_name != 'issue_comment' \|\| github\.event\.issue\.pull_request/);

  const commit = '5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d';
  const copy = renderCaller(caller, { owner: 'harbor-lane', repo: '.github', commit });
  assert.match(copy, new RegExp(`uses: harbor-lane/\\.github/\\.github/workflows/engineer-review\\.yml@${commit}\\n`));
  assert.ok(!copy.includes('<owner>') && !copy.includes('<commit>'));
  for (const ref of ['main', 'v1', commit.slice(0, 7), 'refs/heads/main', '']) {
    assert.throws(() => renderCaller(caller, { owner: 'harbor-lane', repo: '.github', commit: ref }), /commit/);
  }
  assert.throws(() => renderCaller(caller, { owner: 'harbor-lane/x', repo: '.github', commit }), /owner/);
});

test('the reusable workflow answers to calls and to this repository\'s own events, and never fails on a missing review', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');
  for (const trigger of ['workflow_call:', 'pull_request:', 'issue_comment:', 'pull_request_review:']) assert.ok(wf.includes(`  ${trigger}`), trigger);
  assert.match(wf, /permissions:\n\s+statuses: write\n\s+pull-requests: read\n\n/);
  assert.doesNotMatch(wf, /actions: write/);
  for (const line of wf.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l))) {
    assert.match(line, /@[0-9a-f]{40}\b/, `every uses: line is pinned to a commit: ${line.trim()}`);
  }
  assert.match(wf, /job\.workflow_sha/);
});
