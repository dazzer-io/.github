// The decide-tests workflow runs the check the repository ruleset requires.
// The records repository's github/repo-rulesets.json requires the status check
// context "decide-tests" (integration 15368, GitHub Actions) for this repository;
// a test here cannot read that other repository, so the name is pinned below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REQUIRED_CHECK = 'decide-tests'; // github/repo-rulesets.json, required_status_checks
const file = fileURLToPath(new URL('../.github/workflows/decide-tests.yml', import.meta.url));
const MISSING = 'no workflow runs the decide-tests check';

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
  assert.deepEqual(parse(t).permissions, { contents: 'read' }, 'the workflow token is wider than contents: read');
  const checkouts = jobs(parse(t)).flatMap((j) => j.steps ?? []).filter((s) => s.uses?.startsWith('actions/checkout@'));
  assert.ok(checkouts.length && checkouts.every((s) => s.with?.['persist-credentials'] === false), 'the checkout keeps its credentials');
  assert.doesNotMatch(t, /secrets\./, 'the workflow reads a secret');
});

test('every action is pinned by commit and the tests run as test/*.test.mjs', () => {
  for (const u of jobs(parse(read())).flatMap((j) => [j.uses, ...(j.steps ?? []).map((s) => s.uses)]).filter(Boolean)) assert.match(u, /@[0-9a-f]{40}$/, `the action ${u} is not pinned by commit`);
  const job = jobs(parse(read())).find((j) => j.check === REQUIRED_CHECK);
  assert.ok(job, MISSING);
  assert.ok(job.steps?.some((s) => s.uses?.startsWith('actions/setup-node@')), 'the workflow sets up no Node');
  // Node 22 reads a bare folder (node --test test/) as one file and fails; the glob is
  // expanded by the shell, so every test file runs on any Node version.
  assert.ok(job.steps?.some((s) => s.run?.trim() === 'node --test test/*.test.mjs'),
    'the decide-tests check cannot run the tests: the job does not run node --test test/*.test.mjs');
});
