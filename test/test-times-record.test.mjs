// The test-time record (test-times/): its three adapters, its touch preload, setup.mjs,
// finish.mjs and record.mjs's reader and unzipping.
//
// - The Node adapter runs under the real `node --test` on three fixture files (one passing,
//   one failing, one opening a loopback socket) and must write test/fixtures/test-times/
//   expected.jsonl, kinds and end line included.
// - The vitest and Playwright adapters are fed the stored event objects each runner's reporter
//   interface documents, and must write the records stored beside those events.
// Records are compared field by field (record.mjs compareRecords): the fields that vary by
// machine and moment by type only, every other field exactly.
//
// Every child starts from an environment this file builds from a short list, never from its
// own, so the suite answers the same on a GitHub runner, whose ImageOS, GITHUB_* and RUNNER_*
// would otherwise leak into setup.mjs, as on a laptop. Every temporary folder is removed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as record from '../test-times/record.mjs';
import {
  NEVER_STARTED, Recorder, compareRecords, gitBlob, parseRecord, readRunFile, unzip,
} from '../test-times/record.mjs';
import { connectKind, isLoopback, outOf } from '../test-times/touch.mjs';
import { nodeOptions, recordRun } from '../test-times/node-test-reporter.mjs';
import VitestTestTimes from '../test-times/vitest-reporter.mjs';
import PlaywrightTestTimes from '../test-times/playwright-reporter.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'test-times');
const FIX = path.join(ROOT, 'test', 'fixtures', 'test-times');
const MISMATCH = 'record does not match';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'test-times-'));
  made.push(d);
  return d;
}

// A child's environment: only what a process needs to start, never this process's own, so no
// recorder variable, no parent test runner and nothing of a GitHub runner reaches it.
const KEEP_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'USERPROFILE'];
function cleanEnv(extra = {}) {
  const env = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

function assertMatches(expectedText, file) {
  const written = fs.readFileSync(file, 'utf8');
  const diffs = compareRecords(expectedText, written);
  assert.deepEqual(diffs, [], `${MISMATCH}:\n  ${diffs.join('\n  ')}\nwritten:\n${written}`);
  return written;
}

const lines = (arr) => arr.map((l) => JSON.stringify(l)).join('\n') + '\n';

test('the Node adapter, under the real node --test, writes the expected record', () => {
  const t = tmp();
  const file = path.join(t, 'test-times.jsonl');
  const deal = { type: 'deal', parts: 2, part: 1, files: ['test/fixtures/test-times/fail.test.mjs'],
    discovered: 'a'.repeat(64), discovered_count: 3, history: 'b'.repeat(64) };
  fs.writeFileSync(`${file}.deal`, JSON.stringify(deal) + '\n');
  const files = ['fail', 'pass', 'socket'].map((n) => `test/fixtures/test-times/${n}.test.mjs`);
  const r = spawnSync(process.execPath, [
    `--import=${DIR}/touch.mjs?out=${file}.touch`,
    '--test', '--test-concurrency=2',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${DIR}/node-test-reporter.mjs`, `--test-reporter-destination=${file}`,
    ...files,
  ], { cwd: ROOT, env: cleanEnv(), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, `the fixture suite holds one failing file, so node --test exits 1:\n${r.stdout}\n${r.stderr}`);
  const written = assertMatches(fs.readFileSync(path.join(FIX, 'expected.jsonl'), 'utf8'), file);
  const run = JSON.parse(written.split('\n')[0]);
  assert.equal(run.event, 'local', 'a run with no run file of facts says its event is local');
  assert.ok(!/127\.0\.0\.1|localhost/.test(written), `a record never holds an address:\n${written}`);
  const parsed = parseRecord(written);
  assert.equal(parsed.complete, true, parsed.why);
  // the spec reporter beside it still prints what it prints today
  assert.match(r.stdout, /fails on purpose/);
  // pass.test.mjs waits OWN_WAIT_MS before its first test, outside any test: its waits_ms holds
  // it, and its own time holds it on top of its tests' times, which only the file's own
  // test:complete reports
  const own = Number(/OWN_WAIT_MS = (\d+)/.exec(fs.readFileSync(path.join(FIX, 'pass.test.mjs'), 'utf8'))[1]);
  const pass = parsed.files.find((f) => f.file === 'test/fixtures/test-times/pass.test.mjs');
  const sum = parsed.tests.filter((t) => t.file === pass.file).reduce((n, t) => n + (t.ms ?? 0), 0);
  assert.ok(pass.waits_ms >= own + 5,
    `pass.test.mjs asked for at least ${own + 5} ms of waits, but its waits_ms says ${pass.waits_ms}`);
  assert.ok(pass.ms >= sum + own - 10,
    `pass.test.mjs's own time, ${pass.ms} ms, is not its tests' ${sum} ms plus its ${own} ms outside them: it did not come from the file's own test:complete`);
});

// Three files that fail as files, written where a `.git` folder makes them repository files:
// one throws on import, one ends its process in a test, one exits non-zero after its tests.
test('a test file that fails as a file is recorded as failing, and the end line counts it', () => {
  const t = tmp();
  fs.mkdirSync(path.join(t, '.git'));
  const src = {
    'imports.test.mjs': "import { test } from 'node:test';\ntest('never counts', () => {});\nthrow new Error('this fixture fails on import');\n",
    'crashes.test.mjs': "import { test } from 'node:test';\ntest('first', () => {});\ntest('ends the process', () => { process.exit(3); });\n",
    'exits.test.mjs': "import { test } from 'node:test';\ntest('passes', () => {});\nprocess.on('exit', () => { process.exitCode = 4; });\n",
    'clean.test.mjs': "import { test } from 'node:test';\ntest('passes', () => {});\n",
  };
  for (const [n, text] of Object.entries(src)) fs.writeFileSync(path.join(t, n), text);
  const file = path.join(t, 'test-times.jsonl');
  const r = spawnSync(process.execPath, [
    `--import=${DIR}/touch.mjs?out=${file}.touch`, '--test', '--test-concurrency=2',
    `--test-reporter=${DIR}/node-test-reporter.mjs`, `--test-reporter-destination=${file}`,
    ...Object.keys(src),
  ], { cwd: t, env: cleanEnv(), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  const rec = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.complete, true, rec.why);
  for (const n of ['imports.test.mjs', 'crashes.test.mjs', 'exits.test.mjs']) {
    const own = rec.tests.filter((x) => x.file === n && x.name === record.FILE_ITSELF);
    assert.equal(own.length, 1, `${MISMATCH}: ${n} failed as a file, but the record holds no failing line for it:\n${JSON.stringify(rec.tests)}`);
    assert.equal(own[0].status, 'fail');
    assert.equal(typeof own[0].ms, 'number');
    assert.ok(rec.files.some((f) => f.file === n), `${n} keeps its file line`);
  }
  assert.equal(rec.tests.filter((x) => x.file === 'clean.test.mjs' && x.name === record.FILE_ITSELF).length, 0,
    'a file that only passed has no line for itself');
  assert.equal(rec.end.tests, rec.tests.length);
  assert.ok(rec.tests.filter((x) => x.status === 'fail').length >= 3, 'the end line counts the files that failed as files');
});

test('without a file destination the Node adapter records nothing and the run is unchanged', () => {
  const r = spawnSync(process.execPath, [
    '--test', `--test-reporter=${DIR}/node-test-reporter.mjs`, '--test-reporter-destination=stdout',
    'test/fixtures/test-times/socket.test.mjs',
  ], { cwd: ROOT, env: cleanEnv(), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /records nothing/);
});

// vitest's documented objects, built from the stored fields.
function vitestObjects(fx) {
  const projects = Object.fromEntries(Object.entries(fx.projects).map(([k, p]) => [k, { name: p.name, config: p.config }]));
  const mod = (m, project) => ({ type: 'module', moduleId: path.join(ROOT, m), project: projects[project] });
  return (name, a = {}) => {
    if (name === 'onTestCaseResult') {
      let parent = mod(a.module, a.project);
      for (const s of a.suites) parent = { type: 'suite', name: s, parent };
      return [{
        type: 'test', name: a.name, parent, module: mod(a.module, a.project), project: projects[a.project],
        options: { mode: a.mode }, result: () => ({ state: a.state, errors: [] }), diagnostic: () => a.diagnostic ?? undefined,
      }];
    }
    if (name === 'onTestModuleEnd') {
      return [{ ...mod(a.module, a.project), diagnostic: () => a.diagnostic, state: () => a.state ?? 'passed', errors: () => a.errors ?? [] }];
    }
    if (name === 'onTestRunEnd') return [[], [], a.reason];
    return [{ config: {} }];
  };
}

function pidOf(name) {
  if (name === 'self') return process.pid;
  if (name === 'parent') return process.ppid;
  return 4000000 + [...name].reduce((n, c) => n + c.charCodeAt(0), 0);
}

function feedVitest(fx, file, mutate = (e) => e) {
  fs.writeFileSync(`${file}.run.json`, JSON.stringify(fx.runFacts) + '\n');
  fs.writeFileSync(`${file}.deal`, JSON.stringify(fx.deal) + '\n');
  fs.writeFileSync(`${file}.touch`, fx.touch.map((t) => JSON.stringify({ ...t, pid: pidOf(t.pid), ppid: pidOf(t.ppid) })).join('\n') + '\n');
  const reporter = new VitestTestTimes({ ...fx.options, file });
  const build = vitestObjects(fx);
  for (const [name, a] of mutate(fx.events)) reporter[name](...build(name, a));
}

test('the vitest adapter, fed a stored run, writes the record stored beside it', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(FIX, 'vitest-events.json'), 'utf8'));
  const file = path.join(tmp(), 'test-times.jsonl');
  feedVitest(fx, file);
  const written = assertMatches(lines(fx.expected), file);
  const run = JSON.parse(written.split('\n')[0]);
  for (const k of ['repo', 'sha', 'ref', 'event', 'run_id', 'run_attempt', 'job_key', 'runner_name', 'runner']) {
    assert.deepEqual(run[k], fx.runFacts[k], `the run line's ${k} comes from the run file of facts setup.mjs wrote`);
  }
});

test('a vitest run that was interrupted ends incomplete, and readers never take its times', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(FIX, 'vitest-events.json'), 'utf8'));
  const file = path.join(tmp(), 'test-times.jsonl');
  feedVitest(fx, file, (evs) => evs.map(([n, a]) => (n === 'onTestRunEnd' ? [n, { reason: 'interrupted' }] : [n, a])));
  const r = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(r.complete, false);
  assert.equal(r.why, 'the run was interrupted');
});

// Playwright's documented objects, built from the stored fields.
function playwrightObjects(fx) {
  const projects = fx.projects;
  return (name, a = {}) => {
    if (name === 'onTestEnd') {
      const project = () => projects[a.project];
      let parent = { type: 'file', title: a.file, project, parent: { type: 'project', title: a.project, project } };
      for (const d of a.describes) parent = { type: 'describe', title: d, project, parent };
      return [{ title: a.title, parent, location: { file: path.join(ROOT, a.file), line: 1, column: 1 }, annotations: a.annotations },
        a.result];
    }
    if (name === 'onEnd') return [{ status: a.status }];
    if (name === 'onError') return [{ message: a.message, location: a.location && { ...a.location, file: path.join(ROOT, a.location.file) } }];
    return [{ workers: fx.config.workers, projects: Object.values(projects) }, {}];
  };
}

test('the Playwright adapter, fed a stored run, writes the record stored beside it', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(FIX, 'playwright-events.json'), 'utf8'));
  const file = path.join(tmp(), 'test-times.jsonl');
  const reporter = new PlaywrightTestTimes({ ...fx.options, file });
  const build = playwrightObjects(fx);
  for (const [name, a] of fx.events) reporter[name](...build(name, a));
  assertMatches(lines(fx.expected), file);
});

test('the adapters write the run line before the first test, so a runner that stops leaves a record with no end', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const reporter = new PlaywrightTestTimes({ file });
  reporter.onBegin({ workers: 1 }, {});
  const r = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(r.run.type, 'run');
  assert.equal(r.end, null);
  assert.equal(r.complete, false);
  assert.match(r.why, /no end line/);
});

test('setup.mjs names the folder, the record file and the run file to the job, and writes the run facts', () => {
  const t = tmp();
  const r = spawnSync(process.execPath, [path.join(DIR, 'setup.mjs')], {
    env: cleanEnv({ RUNNER_TEMP: t, GITHUB_JOB: 'unit', GITHUB_RUN_ATTEMPT: '2', RUNNER_NAME: 'GitHub Actions 12',
      GITHUB_REPOSITORY: 'acme-labs/widget', GITHUB_SHA: 'c'.repeat(40), GITHUB_REF: 'refs/heads/main',
      GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ID: '991', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim().split('\n');
  assert.equal(out.length, 3, r.stdout);
  assert.equal(out[0], `TEST_TIMES_DIR=${DIR}`);
  assert.equal(out[1], `TEST_TIMES_FILE=${path.join(t, 'test-times.jsonl')}`);
  assert.match(out[2], /^TEST_TIMES_ID=unit-2-GitHub-Actions-12-\d{13}$/);
  const facts = JSON.parse(fs.readFileSync(path.join(t, 'test-times.jsonl.run.json'), 'utf8'));
  assert.deepEqual({ ...facts, runner: { ...facts.runner, cores: 0 }, setup_at: null }, {
    repo: 'acme-labs/widget', sha: 'c'.repeat(40), ref: 'refs/heads/main', event: 'push', run_id: 991, run_attempt: 2,
    job_key: 'unit', runner_name: 'GitHub Actions 12', runner: { os: 'Linux', arch: 'X64', cores: 0, label: null },
    setup_at: null,
  });
  assert.ok(facts.runner.cores >= 1);
});

test('setup.mjs refuses outside a GitHub job', () => {
  const r = spawnSync(process.execPath, [path.join(DIR, 'setup.mjs')], { env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /RUNNER_TEMP is not set/);
});

test('finish.mjs writes "the test runner never started" when no record was written, and names the run file', () => {
  const t = tmp();
  const file = path.join(t, 'test-times.jsonl');
  fs.writeFileSync(`${file}.run.json`, JSON.stringify({ repo: 'acme-labs/widget', job_key: 'unit', runner_name: 'gh-1',
    run_attempt: 1, setup_at: '2026-10-01T08:00:00.000Z' }));
  const r = spawnSync(process.execPath, [path.join(DIR, 'finish.mjs')], {
    env: cleanEnv({ TEST_TIMES_FILE: file, TEST_TIMES_ID: 'unit-1-gh-1-1700000000000' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'name=test-times-unit-1-gh-1-1700000000000\n');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.trim().split('\n').length, 2);
  const rec = parseRecord(text);
  assert.deepEqual(rec.end, { type: 'end', tests: 0, files: 0, complete: false, why: NEVER_STARTED });
  assert.equal(rec.neverStarted, true);
  assert.equal(rec.run.runner_name, 'gh-1');
  assert.equal(rec.run.started_at, '2026-10-01T08:00:00.000Z');
});

// parseRecord takes a deal line from anywhere after the run line, so only its place pins it;
// compareRecords reads lines in order, and the adapters write it second (record.mjs, finish).
test('finish.mjs writes a dealt part\'s deal line second, after its run line and before its end, as the adapters do', () => {
  const t = tmp();
  const file = path.join(t, 'test-times.jsonl');
  fs.writeFileSync(`${file}.run.json`, JSON.stringify({ repo: 'acme-labs/widget', job_key: 'unit', runner_name: 'gh-2',
    run_attempt: 1, setup_at: '2026-10-01T08:00:00.000Z' }));
  const deal = { type: 'deal', parts: 3, part: 2, files: [], discovered: 'a'.repeat(64), discovered_count: 2, history: 'b'.repeat(64) };
  fs.writeFileSync(`${file}.deal`, JSON.stringify(deal) + '\n');
  const r = spawnSync(process.execPath, [path.join(DIR, 'finish.mjs')], {
    env: cleanEnv({ TEST_TIMES_FILE: file, TEST_TIMES_ID: 'unit-2-gh-2-1700000000000' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(file, 'utf8');
  const kept = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(kept[1]?.type, 'deal', `the deal line is not second, after the run line:\n${text}`);
  assert.deepEqual(kept.map((l) => l.type), ['run', 'deal', 'end'], `a dealt part's never-started record is its run line, its deal line and its end:\n${text}`);
  assert.deepEqual(kept[1], deal, 'the deal line is the one the part left beside the record');
  assert.equal(parseRecord(text).neverStarted, true);
});

test('finish.mjs leaves a record that stopped partway as it is', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const partial = JSON.stringify({ v: 1, type: 'run', runner_name: 'gh-1' }) + '\n';
  fs.writeFileSync(file, partial);
  const r = spawnSync(process.execPath, [path.join(DIR, 'finish.mjs')], {
    env: cleanEnv({ TEST_TIMES_FILE: file, TEST_TIMES_ID: 'x' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), partial);
  assert.match(r.stderr, /incomplete: no end line/);
});

test('finish.mjs names a plan job\'s history file by its run attempt', () => {
  const file = path.join(tmp(), 'history.json');
  fs.writeFileSync(file, '{}\n');
  const r = spawnSync(process.execPath, [path.join(DIR, 'finish.mjs'), '--kind', 'history', '--file', file], {
    env: cleanEnv({ GITHUB_RUN_ATTEMPT: '3' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'name=test-times-history-3\n');
});

test('a record is read only in a version this reader knows, and only complete with a matching end', () => {
  const run = { v: 1, type: 'run' };
  const t = { type: 'test', file: 'a', name: 'x', n: 0, ms: 1, status: 'pass', retry: 0 };
  const f = { type: 'file', file: 'a' };
  assert.equal(parseRecord(lines([run, t, f, { type: 'end', tests: 1, files: 1, complete: true, why: null }])).complete, true);
  assert.equal(parseRecord(lines([run, t, f, { type: 'end', tests: 2, files: 1, complete: true, why: null }])).complete, false);
  const torn = parseRecord(lines([run, t]) + '{"type":"fi');
  assert.equal(torn.complete, false);
  assert.match(torn.why, /no end line/);
  const v2 = parseRecord(lines([{ ...run, v: 2 }, { type: 'end', tests: 0, files: 0, complete: true }]));
  assert.equal(v2.complete, false);
  assert.equal(v2.why, 'unreadable: format version 2 is not one this reader knows');
  assert.equal(parseRecord('').why, 'unreadable: the record is empty');
});

test('the comparison of records holds every field but the ones that vary by machine and moment', () => {
  const a = lines([{ type: 'file', file: 'a', ms: 1, kinds: [] }]);
  assert.deepEqual(compareRecords(a, lines([{ type: 'file', file: 'a', ms: 99, kinds: [] }])), []);
  assert.equal(compareRecords(a, lines([{ type: 'file', file: 'a', kinds: [] }])).length, 1);
  assert.equal(compareRecords(a, lines([{ type: 'file', file: 'a', ms: 1, kinds: ['process'] }])).length, 1);
  assert.equal(compareRecords(a, lines([{ type: 'file', file: 'a', ms: null, kinds: [] }])).length, 1);
});

// A zip as GitHub's upload writes it: deflated, sizes in a data descriptor after the data.
function zipOf(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const { name, data, method } of entries) {
    const nameB = Buffer.from(name);
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const flags = method === 8 ? 0x08 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(nameB.length, 26);
    if (!flags) { local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); }
    const desc = flags ? Buffer.alloc(16) : Buffer.alloc(0);
    if (flags) { desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(body.length, 8); desc.writeUInt32LE(data.length, 12); }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, nameB, body, desc);
    central.push(cd, nameB);
    offset += local.length + nameB.length + body.length + desc.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

test('a downloaded run file is unzipped with no dependency, stored and deflated entries alike', () => {
  const rec = lines([{ v: 1, type: 'run' }, { type: 'end', tests: 0, files: 0, complete: true, why: null }]);
  const z = zipOf([{ name: 'notes/', data: Buffer.alloc(0), method: 0 }, { name: 'a.txt', data: Buffer.from('hello\n'), method: 0 },
    { name: 'test-times.jsonl', data: Buffer.from(rec), method: 8 }]);
  const entries = unzip(z);
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'test-times.jsonl']);
  assert.equal(entries[0].data.toString(), 'hello\n');
  assert.equal(readRunFile(z).complete, true);
  assert.throws(() => unzip(Buffer.from('not a zip')), /not a zip this reader opens/);
  assert.throws(() => readRunFile(zipOf([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }])), /holds no \.jsonl record/);
});

test('a test file\'s blob is git\'s hash of its bytes, computed with no git command', () => {
  assert.equal(gitBlob(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('the touch preload turns a connection into a kind and keeps no address', () => {
  assert.equal(connectKind([[{ port: 5432, host: '127.0.0.1' }]]), 'local-service');
  assert.equal(connectKind([{ port: 6379 }]), 'local-service');
  assert.equal(connectKind([{ path: '/tmp/db.sock' }]), 'local-service');
  assert.equal(connectKind(['/tmp/db.sock']), 'local-service');
  assert.equal(connectKind([443, '203.0.113.9']), 'network');
  assert.equal(connectKind([{ port: 443, host: '2001:db8::1' }]), 'network');
  assert.equal(connectKind([{ port: 443, host: 'api.example.com' }]), null, 'a name waits for its lookup');
  for (const h of ['localhost', 'db.localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopback(h), true, h);
  }
  for (const h of ['10.0.0.1', '8.8.8.8', 'example.com', '::ffff:10.0.0.1']) assert.equal(isLoopback(h), false, h);
});

test('imported with no output in its address, the touch preload installs nothing', () => {
  assert.equal(globalThis[Symbol.for('dazzer.test-times.touch')], undefined);
});

test('a Playwright spec that fails to load before the run begins is still recorded as failing', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const reporter = new PlaywrightTestTimes({ file });
  reporter.onError({ message: 'SyntaxError', location: { file: path.join(FIX, 'socket.test.mjs'), line: 1, column: 1 } });
  reporter.onEnd({ status: 'failed' });
  const rec = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.complete, true, rec.why);
  assert.deepEqual(rec.tests.map((x) => [x.file, x.name, x.status]),
    [['test/fixtures/test-times/socket.test.mjs', record.FILE_ITSELF, 'fail']]);
});

test('a second test runner in a job that holds a record ends that record incomplete, saying so', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const first = new Recorder({ file, runnerKind: 'node-test' });
  first.start({ kindScope: 'job' });
  first.test({ file: path.join(FIX, 'pass.test.mjs'), name: 'one', ms: 1, status: 'pass' });
  first.finish({ complete: true });
  const second = new Recorder({ file, runnerKind: 'vitest' });
  second.start({ kindScope: 'job' });
  let rec = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.complete, false, 'the job\'s record is no longer complete');
  assert.equal(rec.why, record.SECOND_RUNNER);
  assert.equal(rec.tests.length, 1, 'the first runner\'s lines are kept, never truncated');
  second.test({ file: path.join(FIX, 'socket.test.mjs'), name: 'two', ms: 1, status: 'pass' });
  second.finish({ complete: true });
  rec = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.why, 'a second test runner started in this job; a job keeps one runner\'s record');
  // a runner that empties its destination on opening, as Node's does, leaves the run line said
  fs.writeFileSync(file, '');
  const third = new Recorder({ file, runnerKind: 'node-test' });
  third.start({ kindScope: 'job' });
  rec = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.run?.type, 'run');
  assert.equal(rec.why, record.SECOND_RUNNER);
});

test('a file line made from its tests alone keeps their group', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const rec = new Recorder({ file, runnerKind: 'vitest' });
  rec.start({ kindScope: 'job' });
  rec.test({ file: path.join(FIX, 'pass.test.mjs'), group: 'unit', name: 'one', ms: 1, status: 'pass' });
  rec.finish({ complete: true });
  const r = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(r.files.map((f) => [f.file, f.group]), [['test/fixtures/test-times/pass.test.mjs', 'unit']]);
});

test('a raw % in the touch path never crashes the reporter or the preload', () => {
  const o = nodeOptions(['--import=/x/touch.mjs?out=/tmp/a%zz.touch', '--test-reporter=spec']);
  assert.equal(o.touch, '/tmp/a%zz.touch');
  assert.equal(outOf('file:///x/touch.mjs?out=/tmp/50%25%off.touch'), '/tmp/50%%off.touch');
  assert.equal(nodeOptions(['--import=/x/touch.mjs?out=/tmp/a%20b.touch']).touch, '/tmp/a b.touch');
});

// A stand-in for a test runner's own code: a module under node_modules that arms a timer, as
// vitest's per-test and per-hook timeouts do through its safe timers.
test('waits_ms counts only the delays a test\'s own code asks for, never a runner\'s from node_modules', () => {
  const t = tmp();
  fs.mkdirSync(path.join(t, 'node_modules', 'stand-in-runner'), { recursive: true });
  fs.writeFileSync(path.join(t, 'node_modules', 'stand-in-runner', 'index.mjs'),
    'export function arm() { const h = setTimeout(() => {}, 5000); clearTimeout(h); const i = setInterval(() => {}, 10000); clearInterval(i); }\n');
  fs.writeFileSync(path.join(t, 'main.mjs'),
    "import { arm } from './node_modules/stand-in-runner/index.mjs';\narm();\nawait new Promise((resolve) => setTimeout(resolve, 7));\n");
  const out = path.join(t, 'touch.jsonl');
  const r = spawnSync(process.execPath, [`--import=${DIR}/touch.mjs?out=${out}`, path.join(t, 'main.mjs')],
    { cwd: t, env: cleanEnv(), encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const ls = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const waits = ls.filter((l) => typeof l.waits_ms === 'number').map((l) => l.waits_ms);
  assert.deepEqual(waits, [7], `only main.mjs's own 7 ms counts:\n${ls.map((l) => JSON.stringify(l)).join('\n')}`);
});

test('the touch preload never changes how a process dies, and says a kind the moment it is seen', async () => {
  const t = tmp();
  fs.writeFileSync(path.join(t, 'stuck.mjs'),
    "import { spawnSync } from 'node:child_process';\nspawnSync(process.execPath, ['-e', '']);\nprocess.stdout.write('ready\\n');\nfor (;;) {}\n");
  const out = path.join(t, 'touch.jsonl');
  const child = spawn(process.execPath, [`--import=${DIR}/touch.mjs?out=${out}`, path.join(t, 'stuck.mjs')],
    { cwd: t, env: cleanEnv(), stdio: ['ignore', 'pipe', 'inherit'] });
  const ended = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve) => child.stdout.on('data', (b) => { if (String(b).includes('ready')) resolve(); }));
  child.kill('SIGTERM');
  const killed = setTimeout(() => child.kill('SIGKILL'), 5000);
  const end = await ended;
  clearTimeout(killed);
  assert.equal(end.signal, 'SIGTERM', `a process stuck in its own code dies on SIGTERM, as it would with no preload; it ended ${JSON.stringify(end)}`);
  const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const ls = text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(ls.some((l) => l.pid === child.pid && (l.kinds ?? []).includes('process')),
    `the child process it started was written down when it started, before any exit:\n${text}`);
});

test('the runner\'s own process is never counted as a test file\'s, whenever it marks itself', () => {
  const t = tmp();
  const out = path.join(t, 'touch.jsonl');
  fs.writeFileSync(out, [
    { pid: 10, ppid: 1, file: '/runner/bin.js', kinds: ['process'], waits_ms: null },
    { pid: 10, ppid: 1, runner: true },
    { pid: 11, ppid: 10, file: '/repo/a.test.mjs', kinds: ['network'], waits_ms: null },
    { pid: 11, ppid: 10, file: '/repo/a.test.mjs', kinds: ['network'], waits_ms: 4 },
    { pid: 12, ppid: 11, file: '/repo/helper.mjs', kinds: ['process'], waits_ms: 9 },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.deepEqual(record.readTouch(out, 10).map((l) => l.pid), [11, 11]);
});

// Job scope: a vitest pool's workers each run several files. Worker 11 exits having asked
// 100 ms; worker 12 said a kind and was killed before its exit line, so its waits, and the
// job's, are unknown.
test('in job scope the job\'s waits_ms is null unless every process that wrote a line wrote its exit line', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const rec = new Recorder({ file, runnerKind: 'vitest' });
  rec.start({ kindScope: 'job' });
  rec.test({ file: path.join(FIX, 'pass.test.mjs'), group: 'unit', name: 'one', ms: 1, status: 'pass' });
  rec.test({ file: path.join(FIX, 'socket.test.mjs'), group: 'unit', name: 'two', ms: 1, status: 'pass' });
  const exited = [
    { pid: 11, ppid: process.pid, file: '/repo/worker.js', kinds: ['process'], waits_ms: null },
    { pid: 11, ppid: process.pid, file: '/repo/worker.js', kinds: ['process'], waits_ms: 100 },
  ];
  const killed = { pid: 12, ppid: process.pid, file: '/repo/worker.js', kinds: ['local-service'], waits_ms: null };
  rec.finish({ complete: true, touchLines: [...exited, killed] });
  const r = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(r.files.map((f) => [f.kinds, f.waits_ms]),
    [[['process', 'local-service'], null], [['process', 'local-service'], null]],
    'worker 12 left no exit line, so no file line can say the job\'s waits');
  const whole = path.join(tmp(), 'test-times.jsonl');
  const both = new Recorder({ file: whole, runnerKind: 'vitest' });
  both.start({ kindScope: 'job' });
  both.test({ file: path.join(FIX, 'pass.test.mjs'), group: 'unit', name: 'one', ms: 1, status: 'pass' });
  both.finish({ complete: true, touchLines: [...exited, killed, { ...killed, waits_ms: 30 }] });
  assert.deepEqual(parseRecord(fs.readFileSync(whole, 'utf8')).files.map((f) => f.waits_ms), [130],
    'with both exit lines the job\'s waits are their sum');
});

// File scope (Node's runner, one child per file): a.test.mjs's own process 31 said a kind and
// was killed before its exit line, while a helper it started, 33, exited having asked 5 ms; so
// its waits are unknown. b.test.mjs's process 32 exited having asked 12 ms.
test('in file scope a file\'s waits_ms is null when one of its processes left no exit line', () => {
  const file = path.join(tmp(), 'test-times.jsonl');
  const rec = new Recorder({ file, runnerKind: 'node-test', execArgv: [] });
  rec.start({ kindScope: 'file' });
  const a = path.join(FIX, 'pass.test.mjs');
  const b = path.join(FIX, 'socket.test.mjs');
  rec.test({ file: a, name: 'one', ms: 1, status: 'pass' });
  rec.test({ file: b, name: 'two', ms: 1, status: 'pass' });
  rec.finish({ complete: true, touchLines: [
    { pid: 31, ppid: process.pid, file: a, kinds: ['process'], waits_ms: null },
    { pid: 33, ppid: process.pid, file: a, kinds: [], waits_ms: 5 },
    { pid: 32, ppid: process.pid, file: b, kinds: ['local-service'], waits_ms: null },
    { pid: 32, ppid: process.pid, file: b, kinds: ['local-service'], waits_ms: 12 },
  ] });
  const r = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(r.run.kind_scope, 'file');
  assert.deepEqual(r.files.map((f) => [f.file, f.kinds, f.waits_ms]), [
    ['test/fixtures/test-times/pass.test.mjs', ['process'], null],
    ['test/fixtures/test-times/socket.test.mjs', ['local-service'], 12],
  ], `${MISMATCH}: pass.test.mjs's process 31 left no exit line, so its waits are unknown, whatever its helper's exit line says`);
});

// Under --test-isolation=none (Node 22 names it --experimental-test-isolation) the tests run in
// the runner's own process, whose touch lines are dropped once it marks itself. A helper the
// test starts exits with 0 ms of waits, while the test itself waits 25 ms in the runner's
// process: a known job total would leave that out. Node 25 marks the runner before its exit and
// recorded 0 here; Node 22.14 never marks it, and the runner's own exit line comes after the
// record, so there the waits were already unknown. The Recorder test after this one holds the
// rule on any version.
test('under node --test with no isolation the job\'s waits are unknown, never a total that leaves out the runner\'s own process', () => {
  const t = tmp();
  fs.mkdirSync(path.join(t, '.git'));
  const file = path.join(t, 'test-times.jsonl');
  const touch = `--import=${DIR}/touch.mjs?out=${file}.touch`;
  fs.writeFileSync(path.join(t, 'waits.test.mjs'), [
    "import { test } from 'node:test';",
    "import { spawnSync } from 'node:child_process';",
    "test('waits in the runner process', async () => {",
    `  const r = spawnSync(process.execPath, [${JSON.stringify(touch)}, '-e', '']);`,
    "  if (r.status !== 0) throw new Error('the helper did not run');",
    '  await new Promise((resolve) => setTimeout(resolve, 25));',
    '});',
    '',
  ].join('\n'));
  const r = spawnSync(process.execPath, [
    touch, '--test', '--experimental-test-isolation=none',
    `--test-reporter=${DIR}/node-test-reporter.mjs`, `--test-reporter-destination=${file}`,
    'waits.test.mjs',
  ], { cwd: t, env: cleanEnv(), encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const helper = fs.readFileSync(`${file}.touch`, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((l) => l.waits_ms === 0);
  assert.equal(helper.length, 1, 'the helper wrote its exit line with 0 ms of waits');
  const rec = parseRecord(fs.readFileSync(file, 'utf8'));
  assert.equal(rec.complete, true, rec.why);
  assert.equal(rec.run.kind_scope, 'job');
  assert.deepEqual(rec.files.map((f) => [f.file, f.waits_ms]), [['waits.test.mjs', null]],
    `${MISMATCH}: with no isolation the tests ran in the runner's own process, so the job's waits are unknown:\n${JSON.stringify(rec.files)}`);
});

test('a Recorder for node --test with no isolation records the job\'s waits as unknown, whatever its helpers\' exit lines say', () => {
  const helper = [{ pid: 41, ppid: process.pid, file: null, kinds: [], waits_ms: 0 }];
  const waitsOf = (opts) => {
    const file = path.join(tmp(), 'test-times.jsonl');
    const rec = new Recorder({ file, runnerKind: 'node-test', ...opts });
    rec.start({ kindScope: 'job' });
    rec.test({ file: path.join(FIX, 'pass.test.mjs'), name: 'one', ms: 1, status: 'pass' });
    rec.finish({ complete: true, touchLines: helper });
    return parseRecord(fs.readFileSync(file, 'utf8')).files.map((f) => f.waits_ms);
  };
  const none = [
    { execArgv: ['--test', '--test-isolation=none'] },
    { execArgv: ['--test', '--experimental-test-isolation=none'] },
    { execArgv: ['--test', '--test-isolation', 'none'] },
    { execArgv: ['--test', '--experimental-test-isolation', 'none'] },
    { isolation: 'none', execArgv: ['--test'] },
  ];
  for (const opts of none) {
    assert.deepEqual(waitsOf(opts), [null],
      `${MISMATCH}: under ${JSON.stringify(opts)} the tests ran in the runner's own process, so the job's waits are unknown`);
  }
  assert.deepEqual(waitsOf({ execArgv: ['--test', '--test-isolation=process'] }), [0],
    'with process isolation the job\'s waits stay known');
  assert.deepEqual(waitsOf({ isolation: 'process', execArgv: ['--test', '--test-isolation', 'none'] }), [0],
    'the isolation its adapter read is the one that counts');
});

// The Node adapter reads its command line once (nodeOptions) and hands the Recorder the
// isolation it read. Driven here with a command line of its own, never this process's, it must
// record the waits its own isolation says. One of its two isolations differs from this
// process's own flags, however this suite is run, so a Recorder that read them would be caught.
test('the Node adapter hands the Recorder the isolation it read, and the record\'s waits follow it', async () => {
  const pass = path.join(FIX, 'pass.test.mjs');
  const waitsUnder = async (isolation) => {
    const dir = tmp();
    const file = path.join(dir, 'test-times.jsonl');
    fs.writeFileSync(`${file}.touch`, `${JSON.stringify({ pid: 41, ppid: process.pid, file: null, kinds: [], waits_ms: 0 })}\n`);
    const execArgv = ['--test', ...isolation, '--test-concurrency=2',
      `--test-reporter=${path.join(DIR, 'node-test-reporter.mjs')}`, `--test-reporter-destination=${file}`];
    async function* events() {
      yield { type: 'test:start', data: { file: pass, name: 'one', nesting: 0 } };
      yield { type: 'test:pass', data: { file: pass, name: 'one', nesting: 0, details: { duration_ms: 1 } } };
    }
    for await (const _ of recordRun(events(), { execArgv, cwd: dir })) { /* it yields nothing */ }
    const rec = parseRecord(fs.readFileSync(file, 'utf8'));
    assert.equal(rec.complete, true, rec.why);
    return rec.files.map((f) => f.waits_ms);
  };
  for (const isolation of [['--test-isolation', 'none'], ['--experimental-test-isolation=none']]) {
    assert.deepEqual(await waitsUnder(isolation), [null],
      `${MISMATCH}: the reporter read ${isolation.join(' ')}, so the tests ran in the runner's own process and the job's waits are unknown, whatever this process's own flags say`);
  }
  assert.deepEqual(await waitsUnder(['--test-isolation=process']), [0],
    `${MISMATCH}: the reporter read process isolation, so the job's waits stay known, whatever this process's own flags say`);
});
