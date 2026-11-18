// The decide-tests workflow runs the check the repository ruleset requires.
// The repository ruleset requires the status check context "decide-tests"
// (integration 15368, GitHub Actions) for this repository; a test here cannot
// read the ruleset, so the name is pinned below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REQUIRED_CHECK = 'decide-tests'; // the repository ruleset's required_status_checks
const file = fileURLToPath(new URL('../.github/workflows/decide-tests.yml', import.meta.url));
const MISSING = 'no workflow runs the decide-tests check';
const NO_LEAK = 'decide-tests does not run the leak check';
// An action of this repository, called by its folder, runs the code of the change itself.
const LOCAL = /^\.\/[A-Za-z0-9_./-]+$/;

function read() {
  assert.ok(fs.existsSync(file), `${MISSING}: .github/workflows/decide-tests.yml is absent`);
  return fs.readFileSync(file, 'utf8');
}

// Each job with the name its check run takes: its name:, else its id.
const jobs = (wf) => Object.entries(wf.jobs ?? {}).map(([id, job]) => ({ ...job, check: job.name ?? id }));

test('a job of the workflow reports the check the ruleset requires', () => {
  const names = jobs(parse(read())).map((j) => j.check);
  assert.ok(names.includes(REQUIRED_CHECK),
    `${MISSING}: the jobs report ${JSON.stringify(names)}`);
});

test('it runs on pull requests and the merge queue', () => {
  const on = Object.keys(parse(read()).on ?? {});
  assert.ok(on.includes('pull_request'), `${MISSING} on pull requests`);
  assert.ok(on.includes('merge_group'), `${MISSING} in the merge queue`);
});

test('it holds a read-only token, keeps no credentials and names no secret', () => {
  const t = read();
  assert.deepEqual(parse(t).permissions, {}, 'the workflow\'s top grants a token');
  for (const j of jobs(parse(t))) assert.deepEqual(j.permissions, { contents: 'read' }, `the job ${j.check} grants other than contents: read`);
  const checkouts = jobs(parse(t)).flatMap((j) => j.steps ?? []).filter((s) => s.uses?.startsWith('actions/checkout@'));
  assert.ok(checkouts.length && checkouts.every((s) => s.with?.['persist-credentials'] === false), 'the checkout keeps its credentials');
  assert.doesNotMatch(t, /secrets\./, 'the workflow reads a secret');
});

test('every action is pinned by commit and the tests run as test/*.test.mjs', () => {
  for (const u of jobs(parse(read())).flatMap((j) => [j.uses, ...(j.steps ?? []).map((s) => s.uses)]).filter(Boolean)) if (!LOCAL.test(u)) assert.match(u, /@[0-9a-f]{40}$/, `the action ${u} is not pinned by commit`);
  const job = jobs(parse(read())).find((j) => j.check === REQUIRED_CHECK);
  assert.ok(job, MISSING);
  assert.ok(job.steps?.some((s) => s.uses?.startsWith('actions/setup-node@')), 'the workflow sets up no Node');
  // Node 22 reads a bare folder (node --test test/) as one file and fails; the glob is
  // expanded by the shell, so every test file runs on any Node version.
  assert.ok(job.steps?.some((s) => s.run?.trim() === 'node --test test/*.test.mjs'),
    'the decide-tests check cannot run the tests: the job does not run node --test test/*.test.mjs');
});

// The required check refuses a leak: the leak check runs inside the decide-tests job, after a
// checkout that brings every branch and tag and before the tests, reading the list beside the
// action (no hashes input), so a change adding a private name never reaches a green check.
test('the decide-tests check runs the leak check over every ref before the tests', () => {
  const job = jobs(parse(read())).find((j) => j.check === REQUIRED_CHECK);
  assert.ok(job, MISSING);
  const steps = job.steps ?? [];
  const leak = steps.findIndex((s) => s.uses === './leak-check');
  const tests = steps.findIndex((s) => s.run?.trim() === 'node --test test/*.test.mjs');
  const checkout = steps.findIndex((s) => s.uses?.startsWith('actions/checkout@'));
  assert.ok(leak !== -1, `${NO_LEAK}: no step uses ./leak-check; the steps use ${JSON.stringify(steps.map((s) => s.uses ?? s.run))}`);
  assert.ok(tests === -1 || leak < tests, `${NO_LEAK} before the tests: it is step ${leak + 1}, the tests step ${tests + 1}`);
  assert.ok(checkout !== -1 && checkout < leak, `${NO_LEAK} over a checkout: the checkout is step ${checkout + 1}, the leak check step ${leak + 1}`);
  assert.equal(String(steps[checkout].with?.['fetch-depth']), '0', `${NO_LEAK} over every ref: the checkout fetches ${JSON.stringify(steps[checkout].with?.['fetch-depth'] ?? 1)} commit(s) deep, not every ref (fetch-depth: 0)`);
  assert.ok(!steps[leak].with?.hashes, `${NO_LEAK} against its own list: the step reads ${steps[leak].with?.hashes} instead of leak-check/hashes.json`);
  assert.ok(steps[leak].if === undefined && steps[leak]['continue-on-error'] === undefined, `${NO_LEAK} as a refusal: the step carries ${JSON.stringify({ if: steps[leak].if, 'continue-on-error': steps[leak]['continue-on-error'] })}`);
});
