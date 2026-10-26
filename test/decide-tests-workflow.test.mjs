// The decide-tests workflow runs the check the repository ruleset requires.
// The records repository's github/repo-rulesets.json requires the status check
// context "decide-tests" (integration 15368, GitHub Actions) for this repository;
// a test here cannot read that other repository, so the name is pinned below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REQUIRED_CHECK = 'decide-tests'; // github/repo-rulesets.json, required_status_checks
const file = fileURLToPath(new URL('../.github/workflows/decide-tests.yml', import.meta.url));
const MISSING = 'no workflow runs the decide-tests check';

function read() {
  assert.ok(fs.existsSync(file), `${MISSING}: .github/workflows/decide-tests.yml is absent`);
  return fs.readFileSync(file, 'utf8');
}

// The jobs block: each job's id and its name: line (a check run takes the name, else the id).
function jobs(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(start >= 0, `${MISSING}: the workflow has no jobs block`);
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break;
    let m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { out.push({ id: m[1], name: null, body: '' }); continue; }
    if (!out.length) continue;
    out.at(-1).body += l + '\n';
    m = l.match(/^    name:\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
    if (m) out.at(-1).name = m[1];
  }
  return out;
}

test('a job of the workflow reports the check the ruleset requires', () => {
  const names = jobs(read()).map((j) => j.name ?? j.id);
  assert.ok(names.includes(REQUIRED_CHECK),
    `${MISSING}: the jobs report ${JSON.stringify(names)}`);
});

test('it runs on pull requests and the merge queue', () => {
  const t = read();
  assert.match(t, /^on:\n(?:  .*\n)*  pull_request:/m, `${MISSING} on pull requests`);
  assert.match(t, /^on:\n(?:  .*\n)*  merge_group:/m, `${MISSING} in the merge queue`);
});

test('it holds a read-only token, keeps no credentials and names no secret', () => {
  const t = read();
  assert.match(t, /^permissions:\n  contents: read\n(?!  )/m, 'the workflow token is wider than contents: read');
  assert.match(t, /persist-credentials: false/, 'the checkout keeps its credentials');
  assert.doesNotMatch(t, /secrets\./, 'the workflow reads a secret');
});

test('every action is pinned by commit and the tests run over test/', () => {
  const t = read();
  const uses = [...t.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.some((u) => u.startsWith('actions/setup-node@')), 'the workflow sets up no Node');
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `the action ${u} is not pinned by commit`);
  const job = jobs(t).find((j) => (j.name ?? j.id) === REQUIRED_CHECK);
  assert.ok(job, MISSING);
  assert.match(job.body, /run:\s*node --test test\/?\s*$/m, `${MISSING}: the job does not run node --test over test/`);
});
