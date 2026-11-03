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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  NEVER_STARTED, compareRecords, gitBlob, parseRecord, readRunFile, unzip,
} from '../test-times/record.mjs';
import { connectKind, isLoopback } from '../test-times/touch.mjs';
import VitestTestTimes from '../test-times/vitest-reporter.mjs';
import PlaywrightTestTimes from '../test-times/playwright-reporter.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'test-times');
const FIX = path.join(ROOT, 'test', 'fixtures', 'test-times');
const MISMATCH = 'record does not match';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'test-times-'));
}

// A child's environment with no recorder variable and no parent test runner in it.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('TEST_TIMES_') || k.startsWith('GITHUB_') || k.startsWith('RUNNER_')) delete env[k];
  delete env.NODE_TEST_CONTEXT;
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
    if (name === 'onTestModuleEnd') return [{ ...mod(a.module, a.project), diagnostic: () => a.diagnostic }];
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
