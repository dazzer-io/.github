// The decide-tests workflow runs the check the repository ruleset requires.
// The repository ruleset requires the status check context "decide-tests"
// (integration 15368, GitHub Actions) for this repository; a test here cannot
// read the ruleset, so the name is pinned below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { oneWay } from '../leak-check/hashes.mjs';

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

// The required check lints the workflows itself: scripts/actionlint.mjs runs over every workflow
// (no file named) before the tests.
test('the decide-tests check lints every workflow with actionlint before the tests', () => {
  const NO_LINT = 'decide-tests does not lint the workflows with scripts/actionlint.mjs';
  const job = jobs(parse(read())).find((j) => j.check === REQUIRED_CHECK);
  assert.ok(job, MISSING);
  const steps = job.steps ?? [];
  const lint = steps.findIndex((s) => s.run?.trim() === 'node scripts/actionlint.mjs');
  const tests = steps.findIndex((s) => s.run?.trim() === 'node --test test/*.test.mjs');
  const node = steps.findIndex((s) => s.uses?.startsWith('actions/setup-node@'));
  assert.ok(lint !== -1, `${NO_LINT}: no step runs node scripts/actionlint.mjs; the steps run ${JSON.stringify(steps.map((s) => s.uses ?? s.run))}`);
  assert.ok(tests !== -1 && lint < tests, `${NO_LINT} before the tests: it is step ${lint + 1}, the tests step ${tests + 1}`);
  assert.ok(node !== -1 && node < lint, `${NO_LINT} after Node is set up: Node is step ${node + 1}, the lint step ${lint + 1}`);
  assert.ok(steps[lint].if === undefined && steps[lint]['continue-on-error'] === undefined, `${NO_LINT} as a refusal: the step carries ${JSON.stringify({ if: steps[lint].if, 'continue-on-error': steps[lint]['continue-on-error'] })}`);
});

// The workflow and its lint script are public: their comments explain the check to a reader, and
// name none of the organisation's internal machinery. The internal names are held as one-way hashes
// (leak-check/hashes.mjs), so this list does not publish what it keeps out: eight internal phrases
// and workflow file names, and three setting prefixes. Anyone can confirm a word they already guess;
// none is written here.
const NOT_REFUSED = 'a new leak finding was not refused';
const PHRASES = new Set(["4aed456d4575dcd247082bb134c355e25a728321d63b5cea49e252fd9e545f57", "59774f2a630071a23cbaec6dbcc297d0f54e163dbe447a51298e5fddf3cc351a", "69b783ee9a87359fefc18c998e722659dd314126e1bf4864a9180c1118b5daf9", "780805137340a896d6cf94833cae5f64a13b20974a76407b6f6dda1a58403e6c", "80a8243eb4aa60736f612b2272664196ad29e5651f2c1f9d88d05e3207e5bfe4", "a0df506bafc745e05c325270fa56439e15e7de963e80616ca96dfcc681690903", "be5ad3553785b5a5603e1ff3ffc1d368fd1048e99bf408a7c0f2e7a564c7d828", "f33f7e98c933487118e1137c384ad6e18fb91896a64909044b7895437c6466c7"]);
const PREFIXES = new Set(["a0e03d63fe942314951e1730f7abf5695fb14205029befc8b9278b814b093829", "bb582462fda42a722e06244d5d0e25042a2fb11ce74d8e5c3c5c13d2242aebde", "e780b3c53088c0da4ccb49b416a5cc246f62363e56a7ebe6e3eedd82e0dd0f7a"]);

// Words as a phrase is held: lower-case, split at anything that is not a letter or digit (so a
// hyphen, underscore or dot separates words), each with a trailing plural s removed.
const wordsOf = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
// The one-way hash of a phrase as PHRASES holds it.
const internalHash = (phrase) => oneWay(wordsOf(phrase).join(' '));

// Every internal name in text, as its one-way hash: each run of one to three words (PHRASES), and
// each word's part up to and including each underscore (PREFIXES).
const internalIn = (text, phrases = PHRASES, prefixes = PREFIXES) => {
  const found = new Set();
  const words = wordsOf(text);
  words.forEach((_, i) => {
    for (let n = 1; n <= 3 && i + n <= words.length; n += 1) { const h = oneWay(words.slice(i, i + n).join(' ')); if (phrases.has(h)) found.add(h); }
  });
  for (const w of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    for (let at = w.indexOf('_'); at !== -1; at = w.indexOf('_', at + 1)) { const h = oneWay(w.slice(0, at + 1)); if (prefixes.has(h)) found.add(h); }
  }
  return [...found];
};
// The comment text alone, its lines joined, so a phrase broken across two lines is still read.
const commentsOf = (text, mark) => text.split('\n').filter((l) => mark.test(l)).map((l) => l.replace(mark, '')).join(' ');

test('the workflow\'s comments describe no internal machinery', () => {
  const comments = commentsOf(read(), /^\s*#\s?/);
  assert.ok(comments.trim().length > 0, 'the workflow carries no comment to read');
  const found = internalIn(comments);
  assert.deepEqual(found, [], `${NOT_REFUSED}: the workflow's comments name internal machinery (one-way hashes ${found.join(', ')})`);
});

test('the lint script\'s comments describe no internal machinery', () => {
  const script = fileURLToPath(new URL('../scripts/actionlint.mjs', import.meta.url));
  assert.ok(fs.existsSync(script), 'scripts/actionlint.mjs is absent');
  const comments = commentsOf(fs.readFileSync(script, 'utf8'), /^\s*\/\/\s?/);
  assert.ok(comments.trim().length > 0, 'scripts/actionlint.mjs carries no comment to read');
  const found = internalIn(comments);
  assert.deepEqual(found, [], `${NOT_REFUSED}: scripts/actionlint.mjs's comments name internal machinery (one-way hashes ${found.join(', ')})`);
});

test('no file the repository tracks names internal machinery in plain text', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  assert.equal(listed.status, 0, `git could not list the tracked files: ${listed.stderr}`);
  const files = listed.stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 0, 'git lists no tracked file to read');
  const named = files.filter((f) => fs.existsSync(path.join(root, f)) && internalIn(fs.readFileSync(path.join(root, f), 'utf8')).length);
  assert.deepEqual(named, [], `${NOT_REFUSED}: tracked files name internal machinery in plain text: ${named.join(', ')}`);
});

test('the internal-names check finds a planted phrase split across lines, and a setting prefix', () => {
  // Invented words, hashed the same way: the check's own reading, seen finding what it must.
  const phrases = new Set([internalHash('quiet lantern')]);
  const prefixes = new Set([oneWay('zed_')]);
  assert.equal(internalIn('a quiet\n# lantern here', phrases, prefixes).length, 1, 'a phrase broken across two lines was not found');
  assert.equal(internalIn('reads ZED_RUNNER_2', phrases, prefixes).length, 1, 'a setting prefix was not found');
  assert.equal(internalIn('reads no ZED_ setting', phrases, prefixes).length, 1, 'a bare setting prefix was not found');
  assert.equal(internalIn('a quiet lamp and zedx', phrases, prefixes).length, 0, 'an ordinary phrase was found');
});

test('the internal-names check finds a plural, hyphenated or underscored form of a hashed phrase', () => {
  // Invented phrases, hashed as the check holds its own: lower-case, words joined by one space.
  const planted = new Set([internalHash('quiet lantern'), internalHash('brass kettle')]);
  for (const text of ['two quiet lanterns', 'a quiet-lantern', 'QUIET_LANTERN', 'the quiet-lanterns', 'Brass Kettles']) {
    assert.equal(internalIn(text, planted, new Set()).length, 1, `${NOT_REFUSED}: the planted phrase was not found in "${text}"`);
  }
  assert.equal(internalIn('a quietly lit lantern', planted, new Set()).length, 0, 'an ordinary phrase was found');
});
