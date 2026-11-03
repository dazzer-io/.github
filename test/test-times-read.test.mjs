// test-times/read.mjs, fed stored GitHub answers and run files
// (test/fixtures/test-times/github-answers.json, every name in it made up): each mode's lines
// and exit codes, `could not read` included.
//
// A stand-in for GitHub's API on a loopback port serves the stored answers by path, refusing a
// request that lacks the query a route names, and builds each run file's zip as GitHub's upload
// writes it. read.mjs runs as its own process against it, through GITHUB_API_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const READ = path.join(ROOT, 'test-times', 'read.mjs');
const ANSWERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'test-times', 'github-answers.json'), 'utf8'));
const BASE = ['--workflow', 'checks.yml', '--event', 'push', '--branch', 'main'];

function zipOf(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.text);
    const method = e.method === 'store' ? 0 : 8;
    const body = method ? zlib.deflateRawSync(data) : data;
    const flags = method ? 0x08 : 0;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(name.length, 26);
    if (!flags) { local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); }
    const desc = Buffer.alloc(flags ? 16 : 0);
    if (flags) { desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(body.length, 8); desc.writeUInt32LE(data.length, 12); }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, name, body, desc); central.push(cd, name);
    offset += local.length + name.length + body.length + desc.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

let server; let base;
before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    const route = ANSWERS.routes[url.pathname];
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    if (!route) return send(404, { message: 'Not Found' });
    if (url.pathname.startsWith('/storage/')) {
      if (req.headers.authorization) return send(400, { message: 'storage refuses a token' });
      if (route.cut) {
        res.writeHead(200, { 'content-type': 'application/zip', 'content-length': '4096' });
        res.write(Buffer.alloc(64));
        setTimeout(() => res.destroy(), 50);
        return undefined;
      }
      if (route.bytes_base64) return send(200, Buffer.from(route.bytes_base64, 'base64'), 'application/zip');
      return send(200, zipOf(route.zip), 'application/zip');
    }
    if (req.headers.authorization !== 'Bearer stand-in-token') return send(401, { message: 'Bad credentials' });
    for (const [k, v] of Object.entries(route.query ?? {})) {
      if (url.searchParams.get(k) !== v) return send(422, { message: `the stand-in wants ${k}=${v}` });
    }
    if (route.status === 302) {
      res.writeHead(302, { location: `${base}${route.location}` });
      return res.end();
    }
    if (route.status && route.status !== 200) return send(route.status, route.body ?? {});
    const page = Number(url.searchParams.get('page') ?? 1);
    if (page > 1) {
      const body = { ...route.body };
      for (const [k, v] of Object.entries(body)) if (Array.isArray(v)) body[k] = [];
      return send(200, body);
    }
    return send(200, route.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
const made = [];
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
  return new Promise((resolve) => server.close(resolve));
});
function outFile() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'test-times-read-'));
  made.push(d);
  return path.join(d, 'history.json');
}

// Only what a process needs to start, never this process's own environment.
const KEEP_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'USERPROFILE'];
function read(args, env = {}) {
  const e = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) e[k] = process.env[k];
  return new Promise((resolve) => {
    execFile(process.execPath, [READ, ...args], {
      env: { ...e, GITHUB_API_URL: base, GITHUB_TOKEN: 'stand-in-token', ...env }, encoding: 'utf8', timeout: 30000,
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

const show = (r) => `exit ${r.code}\n${r.stdout}${r.stderr}`;

test('--require-complete passes when every group left a complete record and the newest run left one', async () => {
  const r = await read(['--repo', 'acme-labs/widget', ...BASE, '--require-complete']);
  assert.equal(r.code, 0, show(r));
  assert.deepEqual(r.stdout.trim().split('\n'), [
    // db's newest record is attempt 1's: attempt 2's re-run left none and never hides it
    'db: complete, 2 tests in 1 files',
    'e2e: ran no test',
    'unit: complete, 4 tests in 3 files',
    'complete test-time records from every job group in 3 runs',
  ], show(r));
});

test('--require-complete fails by name for groups that never left a complete record', async () => {
  const r = await read(['--repo', 'acme-labs/gadget', ...BASE, '--require-complete']);
  assert.equal(r.code, 1, show(r));
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'browser: incomplete: no end line: the runner stopped partway',
    'docs: incomplete: no run file was kept',
    'legacy: incomplete: unreadable: format version 2 is not one this reader knows',
    'unit: complete, 1 tests in 1 files',
    'no complete test-time record: browser, docs, legacy',
  ], show(r));
});

test('--require-complete reads only as many runs as --runs says', async () => {
  const r = await read(['--repo', 'acme-labs/widget', ...BASE, '--require-complete', '--runs', '1']);
  assert.equal(r.code, 0, show(r));
  assert.match(r.stdout, /in 1 runs$/m);
});

test('--history writes the file a planner deals from, with medians over the successful runs', async () => {
  const out = outFile();
  const r = await read(['--repo', 'acme-labs/widget', ...BASE, '--history', '--out', out], { GITHUB_RUN_ATTEMPT: '3' });
  assert.equal(r.code, 0, show(r));
  assert.match(r.stdout, /^history: 4 files and 4 job groups from 2 runs/m);
  const h = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(typeof h.read_at, 'string');
  delete h.read_at;
  assert.deepEqual(h, {
    v: 1, repo: 'acme-labs/widget', workflow: 'checks.yml', event: 'push', branch: 'main', attempt: 3,
    source: 'history', why: null,
    runs: [{ id: 3003, attempt: 2, sha: 'e300000000000000000000000000000000000000' },
      { id: 3002, attempt: 1, sha: 'e200000000000000000000000000000000000000' }],
    files: {
      'test/alpha.test.mjs': [{ group: null, ms: 33000, workers: 2, serial: false, n: 2 }],
      'test/beta.test.mjs': [{ group: null, ms: 53000, workers: 2, serial: false, n: 2 }],
      'test/db/store.test.mjs': [{ group: null, ms: 200000, workers: 2, serial: false, n: 2 }],
      'test/gamma.test.mjs': [{ group: null, ms: 42000, workers: 2, serial: false, n: 2 }],
    },
    jobs: {
      // db's time in run 3003 is its newest attempt's (5 min); its set-up is from the
      // attempt that left a complete record
      db: { ms: 330000, setup_ms: 75000, n: 2 },
      e2e: { ms: 30000, setup_ms: null, n: 2 },
      lint: { ms: 60000, setup_ms: null, n: 2 },
      unit: { ms: 240000, setup_ms: 75000, n: 2 },
    },
  }, show(r));
});

test('--history --job-prefix feeds files only from the jobs it names, and still holds every group', async () => {
  const out = outFile();
  const r = await read(['--repo', 'acme-labs/widget', ...BASE, '--history', '--out', out, '--job-prefix', 'unit']);
  assert.equal(r.code, 0, show(r));
  const h = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(h.files), ['test/alpha.test.mjs', 'test/beta.test.mjs', 'test/gamma.test.mjs']);
  assert.deepEqual(Object.keys(h.jobs), ['db', 'e2e', 'lint', 'unit']);
  assert.equal(h.attempt, 1, 'outside a workflow the attempt is the first');
});

test('a refused read exits 2 with could not read, and never passes', async () => {
  for (const mode of [['--require-complete'], ['--slowest', 'unit'], ['--not-slowest', 'unit']]) {
    const r = await read(['--repo', 'acme-labs/sprocket', ...BASE, ...mode]);
    assert.equal(r.code, 2, show(r));
    assert.equal(r.stdout, 'could not read: GET /repos/acme-labs/sprocket/actions/runs/5001/jobs answered 403\n', show(r));
  }
  const out = outFile();
  const h = await read(['--repo', 'acme-labs/sprocket', ...BASE, '--history', '--out', out]);
  assert.equal(h.code, 2, show(h));
  assert.equal(fs.existsSync(out), false, 'without --allow-none a refused read writes no history file');
});

test('--history --allow-none still writes its file, saying none and why, and warns by name', async () => {
  const out = outFile();
  const r = await read(['--repo', 'acme-labs/sprocket', ...BASE, '--history', '--allow-none', '--out', out], { GITHUB_RUN_ATTEMPT: '2' });
  assert.equal(r.code, 0, show(r));
  const why = 'could not read: GET /repos/acme-labs/sprocket/actions/runs/5001/jobs answered 403';
  assert.match(r.stdout, new RegExp(`^::warning title=test-times history::${why.replace(/[/.]/g, '\\$&')}$`, 'm'));
  const h = JSON.parse(fs.readFileSync(out, 'utf8'));
  delete h.read_at;
  assert.deepEqual(h, { v: 1, repo: 'acme-labs/sprocket', workflow: 'checks.yml', event: 'push', branch: 'main', attempt: 2,
    source: 'none', why, runs: [], files: {}, jobs: {} });
});

test('a run file that cannot be opened is a read that could not be made', async () => {
  const r = await read(['--repo', 'acme-labs/cog', ...BASE, '--require-complete']);
  assert.equal(r.code, 2, show(r));
  assert.match(r.stdout, /^could not read: run file test-times-unit-1-gh-cu-\d+ of run 6001: not a zip this reader opens: no end of central directory$/m, show(r));
});

test('no token at all is a read that could not be made', async () => {
  const r = await read(['--repo', 'acme-labs/widget', ...BASE, '--require-complete'], { GITHUB_TOKEN: '', PATH: '/nonexistent' });
  assert.equal(r.code, 2, show(r));
  assert.match(r.stdout, /^could not read: no token/, show(r));
});

test('--slowest passes for the group that sets the wait and names the one that does otherwise', async () => {
  const yes = await read(['--repo', 'acme-labs/widget', ...BASE, '--slowest', 'db']);
  assert.equal(yes.code, 0, show(yes));
  assert.deepEqual(yes.stdout.trim().split('\n'), [
    'db: 5.5 min over 2 runs', 'unit: 4.0 min over 2 runs', 'lint: 1.0 min over 2 runs', 'e2e: 0.5 min over 2 runs',
    'db sets the wait: 5.5 min',
  ]);
  const no = await read(['--repo', 'acme-labs/widget', ...BASE, '--slowest', 'unit']);
  assert.equal(no.code, 1, show(no));
  assert.match(no.stdout, /^db sets the wait: 5\.5 min against unit 4\.0 min$/m);
  const ignored = await read(['--repo', 'acme-labs/widget', ...BASE, '--slowest', 'unit', '--ignore', 'db']);
  assert.equal(ignored.code, 0, show(ignored));
  const absent = await read(['--repo', 'acme-labs/widget', ...BASE, '--slowest', 'browser']);
  assert.equal(absent.code, 1, show(absent));
  assert.match(absent.stdout, /^browser has no job in the 2 runs read$/m);
});

test('--not-slowest passes while another group is longer and names the group when it is the longest', async () => {
  const yes = await read(['--repo', 'acme-labs/widget', ...BASE, '--not-slowest', 'unit']);
  assert.equal(yes.code, 0, show(yes));
  assert.match(yes.stdout, /^db sets the wait: 5\.5 min against unit 4\.0 min$/m);
  const no = await read(['--repo', 'acme-labs/widget', ...BASE, '--not-slowest', 'db']);
  assert.equal(no.code, 1, show(no));
  assert.match(no.stdout, /^db sets the wait: 5\.5 min against unit 4\.0 min$/m);
  const ignored = await read(['--repo', 'acme-labs/widget', ...BASE, '--not-slowest', 'unit', '--ignore', 'db']);
  assert.equal(ignored.code, 1, show(ignored));
  assert.match(ignored.stdout, /^unit sets the wait: 4\.0 min against lint 1\.0 min$/m);
});

test('the arguments it does not take are refused before any read', async () => {
  for (const [args, words] of [
    [['--repo', 'acme-labs/widget', ...BASE], /name one mode/],
    [['--repo', 'acme-labs/widget', ...BASE, '--history'], /--history needs --out/],
    [['--repo', 'acme-labs/widget', ...BASE, '--require-complete', '--runs', '0'], /--runs is a whole number/],
    [['--repo', 'widget', ...BASE, '--require-complete'], /--repo is owner\/name/],
  ]) {
    const r = await read(args);
    assert.equal(r.code, 2, show(r));
    assert.match(r.stdout, words, show(r));
  }
});

// acme-labs/gizmo: one run whose matrix legs share the name "unit". gh-zu-1 left a complete
// record and ran 4 minutes; gh-zu-2 started first, ran 6 minutes and left a record with no end.
test('matrix legs that share a name are separate jobs: an incomplete leg fails --require-complete', async () => {
  const r = await read(['--repo', 'acme-labs/gizmo', ...BASE, '--require-complete']);
  assert.equal(r.code, 1, show(r));
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'unit: incomplete: unit on gh-zu-2: no end line: the runner stopped partway',
    'no complete test-time record: unit',
  ], show(r));
});

test('a group\'s time in a run is its longest job\'s, whatever its legs are named', async () => {
  const r = await read(['--repo', 'acme-labs/gizmo', ...BASE, '--slowest', 'unit']);
  assert.equal(r.code, 0, show(r));
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'unit: 6.0 min over 1 runs', 'lint: 5.0 min over 1 runs', 'unit sets the wait: 6.0 min',
  ], show(r));
});

test('--history holds one entry per group a path was recorded under, null first, and no single pick', async () => {
  const out = outFile();
  const r = await read(['--repo', 'acme-labs/gizmo', ...BASE, '--history', '--out', out]);
  assert.equal(r.code, 0, show(r));
  const h = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(h.files, {
    'test/ui.spec.mjs': [
      { group: null, ms: 20000, workers: 2, serial: false, n: 1 },
      { group: 'chromium', ms: 30000, workers: 2, serial: false, n: 1 },
      { group: 'webkit', ms: 50000, workers: 1, serial: true, n: 1 },
    ],
  }, show(r));
  assert.deepEqual(h.jobs, {
    lint: { ms: 300000, setup_ms: null, n: 1 },
    // the longest leg's 6 minutes; set-up only from the leg that left a complete record
    unit: { ms: 360000, setup_ms: 80000, n: 1 },
  }, show(r));
});

// acme-labs/bolt: its one run file's download breaks off partway through the body.
test('a run file whose download breaks off is a read that could not be made', async () => {
  const r = await read(['--repo', 'acme-labs/bolt', ...BASE, '--require-complete']);
  assert.equal(r.code, 2, show(r));
  assert.match(r.stdout, /^could not read: the run file behind \/repos\/acme-labs\/bolt\/actions\/artifacts\/9201\/zip broke off: \S+$/m, show(r));
  assert.equal(r.stdout.trim().split('\n').length, 1, show(r));
});

test('--history --allow-none never exits 2: any read error writes none with why, and warns', async () => {
  for (const [repo, words] of [
    ['acme-labs/bolt', /^could not read: the run file behind \/repos\/acme-labs\/bolt\/actions\/artifacts\/9201\/zip broke off: \S+$/],
    ['acme-labs/nut', /^could not read: run file test-times-unit-1-gh-nu-1791021600000 expired$/],
  ]) {
    const out = outFile();
    const r = await read(['--repo', repo, ...BASE, '--history', '--allow-none', '--out', out]);
    assert.equal(r.code, 0, show(r));
    const h = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(h.source, 'none', show(r));
    assert.match(h.why, words, show(r));
    assert.match(r.stdout, new RegExp(`^::warning title=test-times history::${h.why.replace(/[/.\\]/g, '\\$&')}$`, 'm'), show(r));
  }
});

// acme-labs/nut: its one run file was kept past its retention, so GitHub lists it as expired.
test('an expired run file is a run file that cannot be opened', async () => {
  const r = await read(['--repo', 'acme-labs/nut', ...BASE, '--require-complete']);
  assert.equal(r.code, 2, show(r));
  assert.equal(r.stdout, 'could not read: run file test-times-unit-1-gh-nu-1791021600000 expired\n', show(r));
});

// The readers' contract, held in record.mjs so the scheduler's weekly reading and the main
// product's share check import it rather than rebuild it.
test('pairing, attempts, ran no test and job groups are exported from record.mjs', async () => {
  const record = await import('../test-times/record.mjs');
  for (const name of ['jobOf', 'pairRecords', 'jobsOfRun', 'ranNoTest', 'jobGroups', 'groupTimes']) {
    assert.equal(typeof record[name], 'function', `record.mjs exports ${name}`);
  }
  assert.equal(record.KEEP_STEP, 'Keep the test times');
  const steps = [{ name: record.KEEP_STEP, conclusion: 'success' }];
  const listing = [
    { id: 1, name: 'unit', run_attempt: 1, conclusion: 'success', started_at: '2026-10-01T08:00:00Z', completed_at: '2026-10-01T08:04:00Z', runner_name: 'a', steps },
    { id: 2, name: 'unit', run_attempt: 1, conclusion: 'success', started_at: '2026-10-01T08:00:00Z', completed_at: '2026-10-01T08:05:00Z', runner_name: 'b', steps },
    { id: 3, name: 'unit', run_attempt: 2, conclusion: 'success', started_at: '2026-10-01T09:00:00Z', completed_at: '2026-10-01T09:01:00Z', runner_name: 'c', steps },
  ];
  const run = (runner, start, end, endLine) => ({ v: 1, type: 'run', job_key: 'unit', runner_name: runner, run_attempt: runner === 'c' ? 2 : 1, started_at: start, ended_at: end, endLine });
  const recordOf = (r) => record.parseRecord([JSON.stringify(r), JSON.stringify(r.endLine)].join('\n'));
  const records = [
    recordOf(run('a', '2026-10-01T08:01:00Z', '2026-10-01T08:03:00Z', { type: 'end', tests: 0, files: 0, complete: true, why: null })),
    recordOf(run('b', '2026-10-01T08:01:00Z', '2026-10-01T08:04:00Z', { type: 'end', tests: 0, files: 0, complete: true, why: null })),
    recordOf(run('c', '2026-10-01T09:00:10Z', '2026-10-01T09:00:20Z', { type: 'end', tests: 0, files: 0, complete: false, why: record.NEVER_STARTED })),
  ];
  const jobs = record.pairRecords(listing.map(record.jobOf), records);
  assert.deepEqual(jobs.map((j) => j.record?.run.runner_name), ['a', 'b', 'c']);
  assert.equal(record.ranNoTest(jobs[2]), true, 'a job that succeeded and never started its runner ran no test');
  const [unit] = record.jobsOfRun(jobs);
  assert.equal(unit.state.state, 'complete', 'attempt 2 ran no test, so attempt 1\'s two complete legs count');
  assert.deepEqual(unit.state.legs.map((l) => l.job.runner), ['a', 'b']);
  const perRun = record.jobGroups([{ run: { id: 1 }, jobs: [unit] }]);
  assert.equal(perRun[0].jobs[0].group, 'unit');
  assert.deepEqual([...record.groupTimes(perRun)], [['unit', [60000]]], 'the newest attempt that ran sets the time');
});
