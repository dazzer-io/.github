// Engineer review over recorded GitHub answers (test/fixtures/engineer-review-events.json).
// No network: every answer the decision reads is in the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decide, summary, evidenceLine, firstLineIsReviewed, headPushedAt,
  prNumberFromMergeGroup, run, targetOf, statusFor, renderCaller, CALLER_USES, CONTEXT,
  callerFor, confirmOnMain, readOnlyReason, wasEdited,
} from '../engineer-review/decide.mjs';

const fixture = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('./fixtures/engineer-review-events.json', import.meta.url)), 'utf8'));
// Said only when a check goes red on a review counted that never should be.
const SHOULD_NOT = 'a review that should not count set the Engineer review status';
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
    ? `${SHOULD_NOT}: "${name}" passed on ${JSON.stringify(d.evidence)}`
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
    eventName: e.eventName, event: e.event, repo: fixture.repository, client, actor: e.actor,
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

test('the reusable workflow answers to calls and to this repository\'s own events, pinned and with its least rights', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');
  for (const trigger of ['workflow_call:', 'pull_request:', 'issue_comment:', 'pull_request_review:']) assert.ok(wf.includes(`  ${trigger}`), trigger);
  assert.match(wf, /permissions:\n\s+statuses: write\n\s+pull-requests: read\n\n/);
  assert.doesNotMatch(wf, /actions: write/);
  const uses = wf.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.ok(uses.length >= 1);
  for (const line of uses) {
    assert.match(line, /@[0-9a-f]{40}\b/, `every uses: line is pinned to a commit: ${line.trim()}`);
  }
});

test('the job is named apart from the status it sets', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');
  const names = [...wf.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(names, ['Settle engineer review']);
  assert.notEqual(names[0], CONTEXT);
  assert.equal(CONTEXT, 'Engineer review');
});

test('the script is fetched with checkout at the workflow\'s own repository and commit, failing closed on an empty context', () => {
  const wf = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(wf, /curl|raw\.githubusercontent/);
  assert.match(wf, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(wf, /SOURCE_REPO: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(wf, /SOURCE_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(wf, /repository: \$\{\{ steps\.source\.outputs\.repo \}\}/);
  assert.match(wf, /ref: \$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.match(wf, /token: \$\{\{ github\.token \}\}/);
  assert.match(wf, /if \[ -z "\$SOURCE_REPO" \]; then\n\s+echo "::error[^"]*job\.workflow_repository is empty[^"]*"\n\s+exit 1/);
  assert.match(wf, /if \[ -z "\$SOURCE_SHA" \]; then\n\s+echo "::error[^"]*job\.workflow_sha is empty[^"]*"\n\s+exit 1/);
  assert.match(wf, /run: node \.engineer-review\/engineer-review\/decide\.mjs/);
});

// Said only when a check goes red on a run that fetches or runs a pull request's own code.
const UNTRUSTED = "the Engineer review run fetches or runs code a pull request's author chose";

// The workflow with its whole-line comments dropped.
function workflowCode(wf) {
  return wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}
// The job's steps, each from its "- " line to the next.
function workflowSteps(code) {
  const at = code.indexOf('\n    steps:\n');
  assert.ok(at >= 0, 'the job has no steps');
  return code.slice(at + '\n    steps:\n'.length).split(/\n(?= {6}- )/).filter((s) => s.trim());
}
// A step's own keys, in order.
function stepKeys(step) {
  return [...step.matchAll(/^(?: {6}- | {8})([A-Za-z][\w-]*):/gm)].map((m) => m[1]);
}
// The trimmed, non-blank lines nested under a step's key, or null when it has none.
function stepBlock(step, header) {
  const lines = step.split('\n');
  const at = lines.findIndex((l) => header.test(l));
  if (at < 0) return null;
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && !/^ {10}/.test(l)) break;
    if (l.trim()) out.push(l.trim());
  }
  return out;
}

const SOURCE_OUTPUTS = ['echo "repo=$SOURCE_REPO" >> "$GITHUB_OUTPUT"', 'echo "sha=$SOURCE_SHA" >> "$GITHUB_OUTPUT"'];
const SOURCE_CHECKS = ['if [ -z "$SOURCE_REPO" ]; then', 'if [ -z "$SOURCE_SHA" ]; then', 'exit 1', 'fi'];

test("a comment run fetches only the workflow's own commit and runs only the script fetched from it", () => {
  // issue_comment holds a write token for every pull request, a fork's too. Its run is safe
  // only while the one checkout is job.workflow_sha (on that trigger GitHub reads this file
  // from the default branch, and a caller from its own) and nothing else fetches or runs code.
  const code = workflowCode(fs.readFileSync(workflowPath, 'utf8'));
  for (const fetches of [/\bhead[._]?(?:sha|ref)/i, /\bmerge_commit_sha\b/, /refs\/pull\//,
    /\bgit\s+(?:fetch|pull|checkout|clone|switch)\b/, /\bgh\s/, /\bcurl\b/, /\bwget\b/, /\bGITHUB_(?:ENV|PATH)\b/]) {
    assert.doesNotMatch(code, fetches, `${UNTRUSTED}: the workflow names a pull request's head, a fetching tool or a later step's environment (${fetches})`);
  }
  assert.equal((code.match(/^\s*env:\s*$/gm) || []).length, 2, `${UNTRUSTED}: env is set beyond the two steps that need it`);
  assert.deepEqual(code.split('\n').filter((l) => l.includes('GITHUB_OUTPUT')).map((l) => l.trim()), SOURCE_OUTPUTS,
    `${UNTRUSTED}: a step output is written from something other than the workflow's own repository and commit`);

  const steps = workflowSteps(code);
  const source = steps.find((s) => /^ {8}id: source$/m.test(s));
  assert.ok(source, `${UNTRUSTED}: no step names the workflow's own commit`);
  assert.deepEqual(stepKeys(source), ['name', 'id', 'env', 'run'], `${UNTRUSTED}: the naming step carries more than its name, id, env and script`);
  assert.deepEqual(stepBlock(source, /^ {8}env:\s*$/), ['SOURCE_REPO: ${{ job.workflow_repository }}', 'SOURCE_SHA: ${{ job.workflow_sha }}'],
    `${UNTRUSTED}: the naming step's env holds more than the workflow's own repository and commit`);
  for (const line of stepBlock(source, /^ {8}run: \|\s*$/) || ['(no script)']) {
    assert.ok(SOURCE_CHECKS.includes(line) || SOURCE_OUTPUTS.includes(line) || /^echo "::error title=Engineer review::[^"$`\\]*"$/.test(line),
      `${UNTRUSTED}: the naming step runs ${line}`);
  }

  const actions = steps.filter((s) => /^\s*-?\s*uses:/m.test(s));
  assert.equal(actions.length, 1, `${UNTRUSTED}: ${actions.length} steps run an action, where the one allowed is the script's checkout`);
  const [checkout] = actions;
  assert.match(checkout, /uses: actions\/checkout@[0-9a-f]{40}/, `${UNTRUSTED}: the one action is not the pinned checkout`);
  assert.match(checkout, /repository: \$\{\{ steps\.source\.outputs\.repo \}\}/, `${UNTRUSTED}: the checkout's repository is not the workflow's own`);
  assert.match(checkout, /ref: \$\{\{ steps\.source\.outputs\.sha \}\}/, `${UNTRUSTED}: the checkout's commit is not the workflow's own`);
  assert.match(checkout, /persist-credentials: false/, `${UNTRUSTED}: the checkout leaves the token in the fetched copy`);

  const runs = steps.filter((s) => /^\s*-?\s*run:/m.test(s));
  assert.equal(runs.length, 2, `${UNTRUSTED}: ${runs.length} steps run commands, where two are allowed`);
  const [first, decision] = runs;
  assert.equal(first, source, `${UNTRUSTED}: the first command is not the step naming the workflow's own commit`);
  assert.deepEqual(stepKeys(decision), ['name', 'env', 'run'], `${UNTRUSTED}: the decision step carries more than its name, env and command`);
  assert.deepEqual(stepBlock(decision, /^ {8}env:\s*$/), ['GITHUB_TOKEN: ${{ github.token }}'], `${UNTRUSTED}: the decision step's env holds more than its token`);
  assert.match(decision, /^ {8}run: node \.engineer-review\/engineer-review\/decide\.mjs\s*$/m, `${UNTRUSTED}: the last command is not the fetched decision script`);
  assert.ok(steps.indexOf(checkout) < steps.indexOf(decision), `${UNTRUSTED}: the script runs before it is fetched`);
});

test('a reviewed comment posted through an App does not count', async () => {
  const d = check('reviewed comment posted through an App');
  assert.match(d.considered[0].why, /harbor-relay/);
  // And through a whole comment event, the status stays pending.
  const e = fixture.events['a reviewed comment on the pull request'];
  const answers = structuredClone(e.answers);
  answers[`/repos/${fixture.repository}/issues/42/comments`] = scenario('reviewed comment posted through an App').comments;
  const client = recordedClient(answers);
  await run({ eventName: e.eventName, event: e.event, repo: fixture.repository, client, actor: e.actor });
  assert.equal(client.posts.length, 1);
  assert.equal(client.posts[0].body.state, 'pending', `${SHOULD_NOT}: an App-posted comment set ${client.posts[0].body.state} (${client.posts[0].body.description})`);
});

test('an edited comment is judged by its edit time and never counts', () => {
  for (const name of [
    'reviewed comment edited after the last push',
    'comment posted before the last push, edited to reviewed after it',
    'reviewed comment edited before the last push',
  ]) {
    const d = check(name);
    const why = d.considered[0].why;
    assert.ok(why.includes(scenario(name).expect.why), `"${name}" should name its edit time: ${why}`);
  }
  assert.equal(wasEdited({ created_at: '2026-10-20T11:05:00Z', updated_at: '2026-10-20T11:05:00Z' }), false);
  assert.equal(wasEdited({ created_at: '2026-10-20T11:05:00Z', updated_at: '2026-10-20T11:05:01Z' }), true);
});

test('a token that cannot write statuses skips the write and ends green', async () => {
  for (const name of ['a push to a pull request from a fork', 'a review on a pull request from a fork', 'a pull request Dependabot opened']) {
    const { e, out, client } = await runEvent(name);
    assert.equal(out.readOnly, true, `"${name}" should be read as a read-only token`);
    assert.equal(out.status, null);
    assert.equal(client.posts.length, 0, `"${name}" tried to write a status with a read-only token`);
    assert.equal(client.reads.length, 0);
    assert.ok(out.skip.includes(e.expect.says), out.skip);
  }
  // The same events from the repository itself, or a comment on a fork's pull request, can write.
  const push = fixture.events['a push after the review'];
  assert.equal(readOnlyReason(push.eventName, push.event, 'mira-okafor'), null);
  const fork = fixture.events['a push to a pull request from a fork'];
  assert.equal(readOnlyReason('issue_comment', fork.event, 'mira-okafor'), null);
});

test('a caller pin is refused unless its commit is on the shared workflow repository main', async () => {
  const pins = fixture.callerPins;
  const client = recordedClient(new Proxy(pins.answers, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : null),
  }));
  const caller = fs.readFileSync(callerPath, 'utf8');
  for (const commit of pins.accepted) {
    const copy = await callerFor(client, caller, { owner: pins.owner, repo: pins.repo, commit });
    assert.ok(copy.includes(`@${commit}\n`));
  }
  for (const [commit, why] of Object.entries(pins.refused)) {
    await assert.rejects(callerFor(client, caller, { owner: pins.owner, repo: pins.repo, commit }),
      (err) => err.message.includes(commit) && err.message.includes(why === 'no comparison' ? 'no comparison' : `"${why}"`),
      `an imposter or unmerged commit ${commit} was accepted as a pin`);
  }
  assert.equal(await confirmOnMain(client, { owner: pins.owner, repo: pins.repo, commit: pins.accepted[1] }), 'identical');
  assert.ok(client.reads.every((r) => r.startsWith(`/repos/${pins.owner}/${pins.repo}/compare/main...`)));
});
