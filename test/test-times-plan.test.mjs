// The shared planner (test-times/plan.mjs): the deal, the counts, the history it takes from a
// folder, and its command line.
//
// The stored deal, test/fixtures/test-times/expected-deal.json, was worked out by hand from
// history.json and files.tsv beside it, not written by the planner: heaviest first onto the
// least-loaded part, a file with no history at the median weight, a serial file weighed whole.
// Placing the files in path order instead gives another deal, so a planner that lost its sort
// fails here, though least-loaded placement alone keeps its parts close in size.
//
// Every child starts from an environment this file builds from a short list, so nothing of a
// GitHub runner reaches it. Every temporary folder is removed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MATRIX_LIMIT, NONE_DISCOVERED, NOT_EXACTLY_ONCE, PlanError, checkDeal, count, deal, loadHistory, readFilesList, weigh,
} from '../test-times/plan.mjs';
import { parseRecord, ranNoTest, readDeal } from '../test-times/record.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAN = path.join(ROOT, 'test-times', 'plan.mjs');
const FIX = path.join(ROOT, 'test', 'fixtures', 'test-times');
const MISMATCH = 'the deal does not match';

const HISTORY_BYTES = fs.readFileSync(path.join(FIX, 'history.json'));
const HISTORY = JSON.parse(HISTORY_BYTES.toString('utf8'));
const FILES = readFilesList(fs.readFileSync(path.join(FIX, 'files.tsv'), 'utf8'));
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIX, 'expected-deal.json'), 'utf8'));

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'test-times-plan-'));
  made.push(d);
  return d;
}

const KEEP_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'USERPROFILE'];
function cleanEnv(extra = {}) {
  const env = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

function plan(args, extra = {}) {
  return spawnSync(process.execPath, [PLAN, ...args], { cwd: ROOT, env: cleanEnv(extra), encoding: 'utf8', timeout: 30000 });
}

const shape = (d) => ({
  parts: d.parts.map((p) => ({ part: p.part, files: p.files.map((f) => [f.path, f.group]), total_ms: p.total_ms, predicted_ms: p.predicted_ms })),
  hash: d.hash,
});
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('the stored history and file list give exactly the stored deal and its hash', () => {
  // the stored hash is the SHA-256 of the stored parts' [path, group] lists as JSON, in part order
  assert.equal(sha256(JSON.stringify(EXPECTED.parts.map((p) => p.files))), EXPECTED.hash,
    `${MISMATCH}: the stored hash is not the hash of the stored parts`);
  const got = shape(deal({ files: FILES, history: HISTORY, parts: EXPECTED.parts.length, lane: EXPECTED.lane }));
  const want = { parts: EXPECTED.parts, hash: EXPECTED.hash };
  assert.deepEqual(got, want, `${MISMATCH}:\nwant ${JSON.stringify(want)}\ngot  ${JSON.stringify(got)}`);
});

test('the same inputs, in any order, always give the same deal', () => {
  const orders = [FILES, [...FILES].reverse(), [...FILES.slice(5), ...FILES.slice(0, 5)]];
  for (const files of orders) {
    for (let i = 0; i < 2; i++) {
      const d = deal({ files, history: HISTORY, parts: 3, lane: 'unit-tests' });
      assert.equal(d.hash, EXPECTED.hash, `${MISMATCH}: the files in the order ${JSON.stringify(files.map((f) => f.path))} dealt ${JSON.stringify(shape(d).parts)}`);
    }
  }
});

test('a file with no history weighs the median, serial when its group is, and a serial file weighs its whole time', () => {
  const w = new Map(weigh({ files: FILES, history: HISTORY }).files.map((f) => [`${f.path} ${f.group}`, f]));
  // the ten known weights: 200 500 1000 1500 1500 2400 2500 3000 4000 9000, median 1950
  assert.deepEqual([w.get('test/echo.test.mjs null').weight, w.get('test/echo.test.mjs null').serial], [1950, false],
    'test/echo.test.mjs has no history; the known files of its group are not all serial');
  assert.deepEqual([w.get('int/locks-b.int.ts serial-locks').weight, w.get('int/locks-b.int.ts serial-locks').serial], [1950, true],
    'int/locks-b.int.ts has no history, and the known files of its group run one at a time');
  assert.equal(w.get('test/bravo.test.mjs null').weight, 3000, '12000 ms over 4 workers');
  assert.equal(w.get('e2e/basket.spec.ts firefox').weight, 2500, 'a path recorded under several groups is weighed by its own group');
  // e2e/basket.spec.ts is recorded under chromium, firefox and webkit, never under tablet-safari
  const miss = weigh({ files: [...FILES, { path: 'e2e/basket.spec.ts', group: 'tablet-safari' }], history: HISTORY })
    .files.find((f) => f.group === 'tablet-safari');
  assert.deepEqual([miss.known, miss.weight], [false, 1950],
    'a path recorded only under other groups has no history in its own, and weighs the median, never another group\'s entry');
  const history = { files: { 'a.test.mjs': [{ group: null, ms: 8000, workers: 4, serial: true, n: 1 }],
    'b.test.mjs': [{ group: null, ms: 8000, workers: 4, serial: false, n: 1 }] } };
  const two = weigh({ files: ['a.test.mjs', 'b.test.mjs'], history }).files.map((f) => f.weight);
  assert.deepEqual(two, [8000, 2000], 'a file that runs one at a time is weighed whole, never divided by its workers');
});

test('with no history at all every file weighs the same, the time is unknown, and the count is one', () => {
  const none = { v: 1, attempt: 1, source: 'none', why: 'could not read: GET /x answered 502', runs: [], files: {}, jobs: {} };
  const d = deal({ files: FILES, history: none, parts: 3 });
  assert.equal(d.timed, false);
  assert.deepEqual(d.parts.map((p) => p.files.length), [4, 4, 4], 'twelve files of equal weight deal four to a part');
  assert.deepEqual(d.parts.map((p) => p.predicted_ms), [null, null, null]);
  checkDeal(FILES, d.parts.map((p) => p.files));
  assert.equal(count({ history: none, lane: 'unit-tests' }).count, 1);
  assert.equal(count({ history: none, group: 'chromium', under: 1000 }).count, 1);
});

test('a deal that does not hold every file exactly once is refused, naming the file', () => {
  const good = deal({ files: FILES, history: HISTORY, parts: 3 }).parts.map((p) => p.files);
  const refuse = (lists, file) => assert.throws(() => checkDeal(FILES, lists),
    (err) => err instanceof PlanError && err.message === `${NOT_EXACTLY_ONCE}: ${file}`, `refused naming ${file}`);
  refuse([good[0], good[1], good[2].slice(1)], 'e2e/basket.spec.ts (chromium)');
  refuse([good[0], [...good[1], good[0][0]], good[2]], 'test/charlie.test.mjs');
  refuse([good[0], good[1], [...good[2], { path: 'test/zulu.test.mjs', group: null }]], 'test/zulu.test.mjs');
  assert.throws(() => deal({ files: [...FILES, FILES[0]], history: HISTORY, parts: 3 }),
    (err) => err instanceof PlanError && err.message === 'a file was discovered twice: test/alpha.test.mjs');
  assert.throws(() => deal({ files: [], history: HISTORY, parts: 3 }),
    (err) => err instanceof PlanError && err.message === NONE_DISCOVERED, 'no discovered file is never a lane');
});

// deal() runs no check of its own (plan.mjs, deal): its placement holds each file once by
// construction, so it is proved here, at every count from one part to more parts than files.
test('every count deals every discovered file exactly once', () => {
  for (let parts = 1; parts <= FILES.length + 2; parts++) {
    const d = deal({ files: FILES, history: HISTORY, parts, lane: 'unit-tests' });
    assert.doesNotThrow(() => checkDeal(FILES, d.parts.map((p) => p.files)), `at ${parts} parts`);
  }
});

// Worked by hand: the lane's fourteen recorded files total 34.7 s; its set-up is 30 s.
test('a lane\'s count is the smallest whose slowest part no longer sets the wait', () => {
  const two = count({ history: HISTORY, lane: 'unit-tests', ignore: ['Merge Check'] });
  assert.deepEqual([two.count, two.slowest_ms, two.against, two.against_ms], [2, 47400, 'build-docs', 50000],
    'one part is 64.7 s against build-docs\'s 50 s; two parts are 47.4 s');
  const three = count({ history: HISTORY, lane: 'unit-tests', ignore: ['Merge Check', 'build-docs'] });
  assert.deepEqual([three.count, three.slowest_ms, three.against, three.against_ms], [3, 41700, 'lint', 45000],
    'held to lint\'s 45 s, two parts at 47.4 s still set the wait, three at 41.7 s do not');
  const one = count({ history: HISTORY, lane: 'unit-tests' });
  assert.deepEqual([one.count, one.against], [1, 'Merge Check'], 'a group not ignored is a figure the lane is held to');
  const alone = count({ history: { ...HISTORY, jobs: { 'unit-tests': HISTORY.jobs['unit-tests'] } }, lane: 'unit-tests' });
  assert.deepEqual([alone.count, alone.why], [1, 'no other job group to hold unit-tests to'], 'a lane alone stays one part');
});

// 300 serial files of 1 s, held to docs-site's 50 s, with the lane's set-up given.
const SERIAL_300 = {};
for (let i = 0; i < 300; i++) SERIAL_300[`test/many-${String(i).padStart(3, '0')}.test.mjs`] = [{ group: null, ms: 1000, workers: 1, serial: true, n: 3 }];
const held = (setup) => count({ history: { ...HISTORY, files: SERIAL_300,
  jobs: { 'unit-tests': { ms: 400000, setup_ms: setup, n: 3 }, 'docs-site': { ms: 50000, setup_ms: 5000, n: 3 } } }, lane: 'unit-tests' });

// D15: where no count holds the slowest part under the figure, the count is the smallest whose
// slowest part's own tests, the part less the lane's recorded set-up, are under it. Six parts of
// fifty 1 s files hold the tests to 50 s, so 1 ms of set-up either side of the figure, or ten
// seconds over it, gives the same count. Further below the figure it can still jump (next test).
test('where the set-up keeps a lane over, the count holds its slowest part\'s own tests under, and 1 ms of set-up either side of the figure never swings it', () => {
  const at = held(50000);
  const below = held(49999);
  assert.equal(below.count, at.count, `a set-up of 49 999 ms gives ${below.count} parts and one of 50 000 ms ${at.count}: 1 ms of set-up swings the count`);
  for (const [c, setup] of [[at, 50000], [below, 49999], [held(60000), 60000]]) {
    assert.deepEqual([c.count, c.tests_ms, c.slowest_ms, c.setup_over, c.alone, c.capped], [6, 50000, 50000 + setup, true, null, false],
      `with ${setup} ms of set-up, six parts of fifty 1 s files hold the tests to docs-site's 50 s, and the set-up keeps the lane over`);
  }
});

// D15 moves the jump rather than removing it (README.md, "Where no count gets under its
// figure"): it sits where the figure stops being reachable at any count up to 256, at a set-up
// of the figure less the lowest slowest part's own tests, here 50 s less two 1 s files.
test('where the figure stops being reachable, 1 ms of set-up still takes the count from 150 parts to 6, as the notes say', () => {
  const reach = held(48000);
  const past = held(48001);
  assert.deepEqual([reach.count, reach.slowest_ms, reach.tests_ms, reach.setup_over], [150, 50000, 2000, false],
    'with 48 000 ms of set-up, 150 parts of two 1 s files are 50 s, no longer than docs-site\'s 50 s');
  assert.deepEqual([past.count, past.slowest_ms, past.tests_ms, past.setup_over], [6, 98001, 50000, true],
    'with 48 001 ms no count up to 256 gets under 50 s, so the tests rule gives six parts at 98 001 ms');
  assert.deepEqual([held(47000).count, held(47001).count], [100, 150], 'before that edge the first rule steps on its own, 100 parts to 150');
});

test('a lane whose set-up is well under its figure still takes the first rule', () => {
  // With 5 s of set-up, six parts are 55 s, over 50 s, though their own tests, 50 s, are not;
  // seven parts of at most 43 files are 48 s. So the count is seven, and the set-up does not keep it over.
  const c = held(5000);
  assert.deepEqual([c.count, c.slowest_ms, c.tests_ms, c.setup_over], [7, 48000, 43000, false],
    'a lane whose slowest part, set-up included, gets under the figure at some count takes that count');
});

test('a lane no count holds under stops where its heaviest file stands alone, and never passes the matrix limit', () => {
  const files = SERIAL_300;
  const base = { ...HISTORY, files };
  const many = {};
  for (let i = 0; i < 600; i++) many[`test/many-${String(i).padStart(3, '0')}.test.mjs`] = [{ group: null, ms: 1000, workers: 1, serial: true, n: 3 }];
  const capped = count({ history: { ...base, files: many, jobs: { 'unit-tests': { ms: 600000, setup_ms: 0, n: 3 }, 'docs-site': { ms: 1000, setup_ms: 0, n: 3 } } }, lane: 'unit-tests' });
  assert.ok(capped.count <= MATRIX_LIMIT, `a count of ${capped.count} is above GitHub's ${MATRIX_LIMIT}-job matrix limit`);
  assert.deepEqual([capped.count, capped.capped, capped.slowest_ms], [200, true, 3000],
    'six hundred 1 s files under 1 s needs 600 parts; up to 256 the lowest slowest part, 3 s, comes first at 200');
  const heavy = count({ history: { ...base, files: { ...files, 'test/huge.test.mjs': [{ group: null, ms: 80000, workers: 1, serial: true, n: 3 }] },
    jobs: { 'unit-tests': { ms: 400000, setup_ms: 1000, n: 3 }, 'docs-site': { ms: 50000, setup_ms: 5000, n: 3 } } }, lane: 'unit-tests' });
  assert.deepEqual([heavy.count, heavy.setup_over, heavy.alone], [5, false, 'test/huge.test.mjs'],
    'one 80 s file is over 50 s even without the set-up; at five parts it stands alone, the other four holding 75 s each');
});

test('one group\'s share count is the smallest under the figure given, and a file alone heavier says so', () => {
  const fits = count({ history: HISTORY, group: 'chromium', under: 4000 });
  assert.deepEqual([fits.count, fits.slowest_ms, fits.alone], [2, 3500, null], 'chromium\'s 3.5 s, 2 s and 1.5 s go 3.5 / 3.5');
  const over = count({ history: HISTORY, group: 'chromium', under: 3000 });
  assert.deepEqual([over.count, over.slowest_ms, over.alone], [2, 3500, 'e2e/checkout.spec.ts (chromium)'],
    'no count puts e2e/checkout.spec.ts under 3 s, so the count stops where it alone sets the wait');
});

test('handed a folder, it takes the history file of the newest attempt not above the part\'s own, at any depth', () => {
  const dir = tmp();
  const write = (rel, attempt) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify({ ...HISTORY, attempt }) + '\n');
  };
  write('history.json', 2);
  write('test-times-history-1/history.json', 1);
  write('deeper/test-times-history-3/history.json', 3);
  fs.writeFileSync(path.join(dir, 'other.json'), '{"not":"a history"}\n');
  assert.equal(loadHistory(dir, '2').history.attempt, 2);
  assert.equal(loadHistory(dir, '1').history.attempt, 1);
  assert.equal(loadHistory(dir, '7').history.attempt, 3);
  // GitHub sets GITHUB_RUN_ATTEMPT in every step, this suite's own included: an attempt not
  // given caps nothing, whatever the environment says.
  const was = process.env.GITHUB_RUN_ATTEMPT;
  process.env.GITHUB_RUN_ATTEMPT = '1';
  try {
    for (const none of [undefined, null, '']) {
      assert.equal(loadHistory(dir, none).history.attempt, 3, `with no attempt given (${JSON.stringify(none)}) the newest is taken`);
    }
    assert.equal(loadHistory(dir).history.attempt, 3, 'with no attempt given the newest is taken');
  } finally {
    if (was === undefined) delete process.env.GITHUB_RUN_ATTEMPT; else process.env.GITHUB_RUN_ATTEMPT = was;
  }
  assert.throws(() => loadHistory(path.join(dir, 'deeper'), '2'),
    (err) => err instanceof PlanError && err.message.startsWith('no history file of an attempt not above 2 in '));
});

test('its command line prints the deal, its hash and its history, and writes the part\'s files and its deal line', () => {
  const dir = tmp();
  const folder = path.join(dir, 'histories');
  fs.mkdirSync(path.join(folder, 'test-times-history-1'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'test-times-history-1', 'history.json'), HISTORY_BYTES);
  fs.writeFileSync(path.join(folder, 'history.json'), JSON.stringify({ ...HISTORY, attempt: 2, files: {} }) + '\n');
  const out = path.join(dir, 'part-2.txt');
  const record = path.join(dir, 'test-times.jsonl');
  const r = plan(['--history', folder, '--files', path.join(FIX, 'files.tsv'), '--parts', '3', '--part', '2',
    '--out', out, '--deal', `${record}.deal`, '--lane', 'unit-tests'], { GITHUB_RUN_ATTEMPT: '1' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const hist = sha256(HISTORY_BYTES);
  assert.deepEqual(lines, [
    `history: 12 files from 3 runs, attempt 1, ${hist.slice(0, 16)} ${path.join(folder, 'test-times-history-1', 'history.json')}`,
    'part 1/3: 3 files, 0.7 min predicted with 0.5 min set-up, 3 with history',
    'part 2/3: 4 files, 0.7 min predicted with 0.5 min set-up, 3 with history',
    'part 3/3: 5 files, 0.7 min predicted with 0.5 min set-up, 4 with history',
    `deal ${EXPECTED.hash.slice(0, 16)}`,
  ], `${MISMATCH}: the printed deal\n${r.stdout}`);
  // each file in the line form of --files: its path, and a tab and its group when it has one
  const share = EXPECTED.parts[1].files.map(([p, g]) => (g === null ? p : `${p}\t${g}`));
  assert.ok(share.includes('int/locks-a.int.ts\tserial-locks'), 'part 2 holds a file with a group');
  assert.equal(fs.readFileSync(out, 'utf8'), share.map((p) => `${p}\n`).join(''), `${MISMATCH}: part 2's files`);
  const discovered = sha256(JSON.stringify(FILES.map((f) => [f.path, f.group]).sort((a, b) =>
    (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] === b[1] ? 0 : a[1] === null ? -1 : b[1] === null ? 1 : a[1] < b[1] ? -1 : 1))));
  assert.deepEqual(readDeal(record), { type: 'deal', parts: 3, part: 2, files: share, discovered,
    discovered_count: 12, history: hist }, `${MISMATCH}: the deal line`);
});

test('its counts print the figure they were held to and write count and parts to GITHUB_OUTPUT', () => {
  const dir = tmp();
  const output = path.join(dir, 'github-output');
  const hist = path.join(FIX, 'history.json');
  const lane = plan(['--history', hist, '--count', '--lane', 'unit-tests', '--ignore', 'Merge Check'], { GITHUB_OUTPUT: output });
  assert.equal(lane.status, 0, lane.stdout);
  assert.ok(lane.stdout.includes('count 2: slowest part 0.8 min with 0.5 min set-up against build-docs 0.8 min\n'), lane.stdout);
  const group = plan(['--history', hist, '--count', '--group', 'chromium', '--under', '3000'], { GITHUB_OUTPUT: output });
  assert.equal(group.status, 0, group.stdout);
  assert.ok(group.stdout.includes('count 2: slowest share 0.1 min against the 0.1 min given\n'), group.stdout);
  assert.ok(group.stdout.includes('no count holds it under: e2e/checkout.spec.ts (chromium) alone sets the wait\n'), group.stdout);
  assert.equal(fs.readFileSync(output, 'utf8'), 'count=2\nparts=[1,2]\ncount=2\nparts=[1,2]\n');
  const slow = path.join(dir, 'history.json');
  fs.writeFileSync(slow, JSON.stringify({ ...HISTORY, jobs: { ...HISTORY.jobs, 'unit-tests': { ms: 420000, setup_ms: 60000, n: 3 } } }));
  const over = plan(['--history', slow, '--count', '--lane', 'unit-tests', '--ignore', 'Merge Check']);
  assert.equal(over.status, 0, over.stdout);
  assert.ok(over.stdout.includes('count 1: slowest part 1.6 min with 1.0 min set-up against build-docs 0.8 min\n'), over.stdout);
  assert.ok(over.stdout.includes('no count holds it under: the lane\'s set-up, 1.0 min, keeps it over build-docs 0.8 min, and every part pays it: the count holds the slowest part\'s own tests, 0.6 min, under it\n'), over.stdout);
});

test('a part dealt nothing says it runs no test, its record carries its deal line of no file, and no discovered file is refused', () => {
  const dir = tmp();
  const files = path.join(dir, 'files.tsv');
  fs.writeFileSync(files, 'test/alpha.test.mjs\ntest/bravo.test.mjs\n');
  const output = path.join(dir, 'github-output');
  const record = (part) => path.join(dir, `part-${part}`, 'test-times.jsonl');
  const run = (part) => {
    fs.mkdirSync(path.dirname(record(part)), { recursive: true });
    return plan(['--history', path.join(FIX, 'history.json'), '--files', files, '--parts', '3', '--part', String(part),
      '--out', path.join(dir, `part-${part}.txt`), '--deal', `${record(part)}.deal`], { GITHUB_OUTPUT: output });
  };
  const first = run(1);
  assert.equal(first.status, 0, first.stdout);
  const third = run(3);
  assert.equal(third.status, 0, third.stdout);
  assert.ok(third.stdout.includes('part 3/3: run no test\n'), third.stdout);
  assert.equal(fs.readFileSync(output, 'utf8'), 'run=true\nfile_count=1\nrun=false\nfile_count=0\n',
    'GITHUB_OUTPUT says whether the part runs any test, so a runner is never handed an empty list, and its count of files as file_count, never read as the list');
  assert.equal(fs.readFileSync(path.join(dir, 'part-3.txt'), 'utf8'), '');
  // The part skips its runner, so finish.mjs writes its record: the never-started one, carrying
  // the deal line plan.mjs wrote beside it, so a reader sees the part was planned and ran no test.
  const finish = spawnSync(process.execPath, [path.join(ROOT, 'test-times', 'finish.mjs')], {
    env: cleanEnv({ TEST_TIMES_FILE: record(3), TEST_TIMES_ID: 'unit-3-gh-3-1700000000000' }), encoding: 'utf8', timeout: 30000 });
  assert.equal(finish.status, 0, finish.stderr);
  const kept = parseRecord(fs.readFileSync(record(3), 'utf8'));
  assert.deepEqual(kept.deal, readDeal(record(3)), 'the record a part dealt nothing leaves carries its deal line');
  assert.deepEqual([kept.deal?.part, kept.deal?.files], [3, []], 'its deal line is part 3\'s and holds no file');
  assert.equal(ranNoTest({ record: kept, conclusion: 'success' }), true, 'a reader counts it as planned and run, having run no test');
  const empty = path.join(dir, 'empty.tsv');
  fs.writeFileSync(empty, '\n');
  const none = plan(['--history', path.join(FIX, 'history.json'), '--files', empty, '--parts', '2']);
  assert.equal(none.status, 1, none.stdout);
  assert.ok(none.stdout.endsWith(`${NONE_DISCOVERED}\n`), none.stdout);
});

test('a history no discovered file matches says so loudly', () => {
  const dir = tmp();
  const files = path.join(dir, 'files.tsv');
  fs.writeFileSync(files, '/home/runner/work/sample-shop/test/alpha.test.mjs\n/home/runner/work/sample-shop/test/bravo.test.mjs\n');
  const r = plan(['--history', path.join(FIX, 'history.json'), '--files', files, '--parts', '2']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes('::warning title=test-times plan::none of the 2 discovered files matched any of the history\'s 12 files, so every file weighs the same: --files paths are repository-relative with forward slashes, as the record writes them\n'), r.stdout);
});

test('a file heavier than a whole part gets a part to itself, and the deal says it alone sets the wait', () => {
  const dir = tmp();
  const hist = path.join(dir, 'history.json');
  const ms = (n) => [{ group: null, ms: n, workers: 1, serial: true, n: 1 }];
  fs.writeFileSync(hist, JSON.stringify({ ...HISTORY, files: { 'test/heavy.test.mjs': ms(90000), 'test/a.test.mjs': ms(1000), 'test/b.test.mjs': ms(2000) } }));
  const files = path.join(dir, 'files.tsv');
  fs.writeFileSync(files, 'test/a.test.mjs\ntest/b.test.mjs\ntest/heavy.test.mjs\ntest/new.test.mjs\n');
  const r = plan(['--history', hist, '--files', files, '--parts', '2']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(r.stdout.includes('part 1/2: 1 file, 1.5 min predicted, set-up unknown, 1 with history; test/heavy.test.mjs alone sets the wait\n'), r.stdout);
  assert.ok(r.stdout.includes('part 2/2: 3 files, 0.1 min predicted, set-up unknown, 2 with history\n'), r.stdout);
});

test('a file discovered twice and arguments it does not take are refused', () => {
  const dir = tmp();
  const files = path.join(dir, 'files.tsv');
  fs.writeFileSync(files, 'test/a.test.mjs\ntest/a.test.mjs\t\n');
  const twice = plan(['--history', path.join(FIX, 'history.json'), '--files', files, '--parts', '2']);
  assert.equal(twice.status, 1, twice.stdout);
  assert.ok(twice.stdout.includes('a file was discovered twice: test/a.test.mjs\n'), twice.stdout);
  const bad = plan(['--history', path.join(FIX, 'history.json'), '--files', files, '--parts', '0']);
  assert.equal(bad.status, 2, bad.stdout);
  assert.equal(bad.stdout, 'plan.mjs: --parts is a whole number above 0, not 0\n');
});
