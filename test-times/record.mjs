// The test-time record, version 1: its writer, its reader and the unzipping of a run file.
//
// Every other reader of records imports these, so the format is held in one place. Pure
// functions over bytes and text, using only what Node 22 has. The format is written out in
// README.md beside this file; work/release-stays-fast/spec-record.md in dev-cycle is its spec.
//
// A record never holds a host, address, port, connection string or argument: the kinds are
// four fixed words, and the run's facts are the GitHub and runner fields setup.mjs wrote.
//
// It also holds the readers' contract (spec-record.md, "Readers' contract"): pairing a record
// with its job, attempts, "ran no test" and job groups, so read.mjs, the scheduler's weekly
// reading and the main product's share check read GitHub's job listing one way.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import zlib from 'node:zlib';

export const VERSION = 1;
export const NEVER_STARTED = 'the test runner never started';
export const SECOND_RUNNER = 'a second test runner started in this job; a job keeps one runner\'s record';
// The name of the test line that says a file failed as a file: it threw on import, its
// process crashed or exited non-zero, or it failed to collect or to load. Its time is the
// file's own, where the runner gives one.
export const FILE_ITSELF = '(the file itself)';
export const KINDS = ['process', 'local-service', 'network', 'browser'];
// The touch preload keeps its state here, so a reporter in the same process can mark it the runner.
export const TOUCH_MARK = Symbol.for('dazzer.test-times.touch');

// Fields that vary by machine and moment, compared by type only (spec: fixture records).
export const VARYING = ['ms', 'waits_ms', 'reference_ms', 'started_at', 'ended_at'];
export const RUN_FACTS = ['repo', 'sha', 'ref', 'event', 'run_id', 'run_attempt', 'job_key',
  'runner_name', 'runner'];

// git's blob hash of a file's bytes, with no git command.
export function gitBlob(bytes) {
  const h = crypto.createHash('sha1');
  h.update(`blob ${bytes.length}\0`);
  h.update(bytes);
  return h.digest('hex');
}

// The fixed reference timing: SHA-256 over 64 MiB of zero bytes in 1 MiB pieces.
export function referenceMs() {
  const piece = Buffer.alloc(1 << 20);
  const h = crypto.createHash('sha256');
  const t0 = performance.now();
  for (let i = 0; i < 64; i++) h.update(piece);
  h.digest();
  return round1(performance.now() - t0);
}

export function round1(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// The run's GitHub and runner facts, written by setup.mjs while the job's whole environment
// was present. Adapters never read them from their own environment.
export function readRunFacts(file) {
  const f = readJson(`${file}.run.json`);
  return f && typeof f === 'object' ? f : null;
}

export function runLine({ facts, runnerKind = null, referenceMs: ref = null, kindScope = null,
  startedAt = null, endedAt = null }) {
  const f = facts ?? {};
  const r = f.runner ?? {};
  return {
    v: VERSION, type: 'run',
    repo: f.repo ?? null, sha: f.sha ?? null, ref: f.ref ?? null,
    event: f.event || 'local',
    run_id: f.run_id ?? null, run_attempt: f.run_attempt ?? null,
    job_key: f.job_key ?? null, runner_name: f.runner_name ?? null,
    runner: { os: r.os ?? null, arch: r.arch ?? null, cores: r.cores ?? null, label: r.label ?? null },
    runner_kind: runnerKind, reference_ms: ref, kind_scope: kindScope,
    started_at: startedAt, ended_at: endedAt,
  };
}

// A part's deal line, written by the part to `<record file>.deal` before its runner started.
export function readDeal(file) {
  let text;
  try { text = fs.readFileSync(`${file}.deal`, 'utf8'); } catch { return null; }
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const d = JSON.parse(l);
      return d && d.type === 'deal' ? d : null;
    } catch { return null; }
  }
  return null;
}

// The touch preload's lines this runner owns: its own process's and its direct children's.
// A process that marked itself the runner (a line {"pid","ppid","runner":true}) keeps none of
// its lines, whichever came first, so the runner's own starts and connections never count.
export function readTouch(touchFile, pid = process.pid) {
  let text;
  try { text = fs.readFileSync(touchFile, 'utf8'); } catch { return []; }
  const lines = [];
  const runners = new Set();
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    let t;
    try { t = JSON.parse(l); } catch { continue; }
    if (!t || typeof t !== 'object') continue;
    if (t.runner === true) runners.add(t.pid);
    else lines.push(t);
  }
  return lines.filter((t) => !runners.has(t.pid) && (t.pid === pid || t.ppid === pid));
}

// A reporter in the runner's main process marks the preload there, if it is loaded, as the
// runner's own, so the runner's own process starts and connections never count as a test's.
export function markRunner() {
  const s = globalThis[TOUCH_MARK];
  if (!s) return;
  s.runner = true;
  try { s.markRunner?.(); } catch { /* a lost mark leaves the runner's own lines in */ }
}

const roots = new Map();
// The repository-relative path of a test file: relative to the nearest folder holding `.git`.
export function repoPath(abs) {
  const dir = path.dirname(abs);
  let root = roots.get(dir);
  if (root === undefined) {
    root = null;
    for (let d = dir; ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, '.git'))) { root = d; break; }
      if (path.dirname(d) === d) break;
    }
    roots.set(dir, root);
  }
  return path.relative(root ?? process.cwd(), abs).split(path.sep).join('/');
}

function orderKinds(set) {
  return KINDS.filter((k) => set.has(k));
}

function writeLines(file, lines) {
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// The writer every adapter uses. start() writes the run line before the first test, so a
// record that exists and has no end means the runner stopped partway; finish() writes the
// whole record, the run line's end included.
export class Recorder {
  constructor({ file, runnerKind }) {
    this.file = file;
    this.runnerKind = runnerKind;
    this.tests = [];
    this.fileTimes = new Map();
  }

  // A job keeps one runner's record. A runner that starts where another already started (its
  // run line is kept beside the record, in `<record file>.started`, because Node's runner
  // empties its destination when it opens it) records nothing of its own and ends the job's
  // record incomplete, saying so.
  start({ kindScope }) {
    this.facts = readRunFacts(this.file);
    this.kindScope = kindScope;
    const marker = `${this.file}.started`;
    if (fs.existsSync(marker)) {
      this.second = true;
      endSecond(this.file, marker);
      return;
    }
    this.referenceMs = referenceMs();
    this.startedAt = new Date().toISOString();
    const head = this.runLine(null);
    fs.writeFileSync(marker, JSON.stringify(head) + '\n');
    writeLines(this.file, [head]);
  }

  runLine(endedAt) {
    return runLine({ facts: this.facts, runnerKind: this.runnerKind, referenceMs: this.referenceMs,
      kindScope: this.kindScope, startedAt: this.startedAt, endedAt });
  }

  static key(file, group) {
    return `${group ?? ''}\0${file}`;
  }

  // One test result. `file` is the absolute path the runner gives.
  test({ file, group = null, name, ms, status, retry = 0 }) {
    this.tests.push({ key: Recorder.key(file, group), file, group, name, ms: round1(ms), status, retry });
  }

  // A file that failed as a file: one failing test line for the file itself.
  fileFailed({ file, group = null, ms = null }) {
    this.test({ file, group, name: FILE_ITSELF, ms, status: 'fail', retry: 0 });
  }

  // One test file's own time, workers and serial flag, as the runner reports them.
  fileTime({ file, group = null, ms, workers = null, serial = null }) {
    this.fileTimes.set(Recorder.key(file, group),
      { file, group, ms: round1(ms), workers, serial });
  }

  // Kinds and waits per file, from the touch lines this runner owns (record.mjs readTouch).
  // A process writes a line the moment it first sees each kind, with waits_ms null, and one
  // more at its exit holding all its kinds and its waits. So a process killed by a signal still
  // says what it touched, and its waits are unknown: waits_ms is null when no line said any.
  touchFor(touchLines) {
    if (this.kindScope === 'runner') return { scope: 'runner', of: () => ({ kinds: ['browser'], waits_ms: null }) };
    if (!touchLines.length) return { scope: 'job', of: () => ({ kinds: [], waits_ms: null }) };
    const add = (e, t) => {
      for (const k of t.kinds ?? []) e.kinds.add(k);
      if (typeof t.waits_ms === 'number') { e.waits += t.waits_ms; e.known = true; }
    };
    const out = (e) => ({ kinds: orderKinds(e.kinds), waits_ms: e.known ? round1(e.waits) : null });
    if (this.kindScope === 'file') {
      const byFile = new Map();
      for (const t of touchLines) {
        if (!t.file) continue;
        const e = byFile.get(t.file) ?? { kinds: new Set(), waits: 0, known: false };
        add(e, t);
        byFile.set(t.file, e);
      }
      return {
        scope: 'file',
        of: (abs) => {
          const e = byFile.get(abs);
          return e ? out(e) : { kinds: [], waits_ms: null };
        },
      };
    }
    const all = { kinds: new Set(), waits: 0, known: false };
    for (const t of touchLines) add(all, t);
    const job = out(all);
    return { scope: 'job', of: () => job };
  }

  finish({ complete, why = null, touchLines = [] }) {
    if (this.second) return null;
    // A second runner that started while this one ran has already ended the job's record.
    if (endsSecond(this.file)) { complete = false; why = SECOND_RUNNER; }
    const touch = this.touchFor(touchLines);
    this.kindScope = touch.scope;
    const files = new Map(this.fileTimes);
    for (const t of this.tests) {
      if (!files.has(t.key)) {
        files.set(t.key, { file: t.file, group: t.group, ms: null, workers: null, serial: null });
      }
    }
    const rel = new Map([...files].map(([k, f]) => [k, repoPath(f.file)]));
    const keys = [...files.keys()].sort((a, b) => {
      const pa = rel.get(a); const pb = rel.get(b);
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const lines = [this.runLine(new Date().toISOString())];
    const deal = readDeal(this.file);
    if (deal) lines.push(deal);
    const seen = new Map();
    let tests = 0;
    for (const k of keys) {
      const f = files.get(k);
      const file = rel.get(k);
      for (const t of this.tests) {
        if (t.key !== k) continue;
        const nk = `${file}\0${t.name}`;
        const n = seen.get(nk) ?? 0;
        seen.set(nk, n + 1);
        lines.push({ type: 'test', file, name: t.name, n, ms: t.ms, status: t.status, retry: t.retry });
        tests++;
      }
      let blob = null;
      try { blob = gitBlob(fs.readFileSync(f.file)); } catch { /* a file gone before the end has no hash */ }
      const { kinds, waits_ms } = touch.of(f.file);
      lines.push({ type: 'file', file, group: f.group, blob, ms: f.ms, workers: f.workers,
        serial: f.serial, kinds, waits_ms });
    }
    lines.push({ type: 'end', tests, files: keys.length, complete: !!complete, why: complete ? null : why });
    writeLines(this.file, lines);
    return lines;
  }
}

function linesOf(text) {
  const out = [];
  for (const l of String(text ?? '').split('\n')) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o && typeof o === 'object') out.push(o); } catch { /* a torn line is dropped */ }
  }
  return out;
}

function endsSecond(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const end = linesOf(text).findLast((l) => l.type === 'end');
  return end?.why === SECOND_RUNNER;
}

// End the job's record incomplete because a second runner started: keep every line the first
// runner wrote, or its run line alone when its runner emptied the file, and end it saying so.
function endSecond(file, marker) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* emptied or gone */ }
  let lines = linesOf(text).filter((l) => l.type !== 'end');
  if (lines[0]?.type !== 'run') {
    const head = linesOf(fs.readFileSync(marker, 'utf8'))[0];
    lines = head ? [head, ...lines.filter((l) => l.type !== 'run')] : lines;
  }
  const tests = lines.filter((l) => l.type === 'test').length;
  const files = lines.filter((l) => l.type === 'file').length;
  writeLines(file, [...lines, { type: 'end', tests, files, complete: false, why: SECOND_RUNNER }]);
}

// The record finish.mjs writes when no runner wrote one.
export function neverStartedRecord({ facts, why = NEVER_STARTED, now = new Date() }) {
  const started = facts?.setup_at ? new Date(facts.setup_at).toISOString() : now.toISOString();
  return [
    runLine({ facts, startedAt: started, endedAt: now.toISOString() }),
    { type: 'end', tests: 0, files: 0, complete: false, why },
  ];
}

// Read a record's text. Only version 1 is read; any other is unreadable. A record is complete
// only with an end line saying so whose counts match the lines it holds.
export function parseRecord(text) {
  const out = { head: null, run: null, deal: null, tests: [], files: [], end: null,
    complete: false, why: null, neverStarted: false, unreadable: null };
  const lines = String(text ?? '').split('\n').filter((l) => l.trim());
  const refuse = (why) => { out.unreadable = why; out.why = `unreadable: ${why}`; return out; };
  if (!lines.length) return refuse('the record is empty');
  let first;
  try { first = JSON.parse(lines[0]); } catch { return refuse('its first line is not JSON'); }
  if (!first || typeof first !== 'object') return refuse('its first line is not a run line');
  out.head = first;
  if (first.type !== 'run') return refuse('its first line is not a run line');
  if (first.v !== VERSION) return refuse(`format version ${first.v} is not one this reader knows`);
  out.run = first;
  for (const l of lines.slice(1)) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'test') out.tests.push(o);
    else if (o.type === 'file') out.files.push(o);
    else if (o.type === 'deal') out.deal = o;
    else if (o.type === 'end') out.end = o;
  }
  const e = out.end;
  if (!e) out.why = 'no end line: the runner stopped partway';
  else if (e.complete !== true) {
    out.why = e.why || 'its end line says it is not complete';
    out.neverStarted = e.why === NEVER_STARTED;
  } else if (e.tests !== out.tests.length || e.files !== out.files.length) {
    out.why = `its end line counts ${e.tests} tests in ${e.files} files, but it holds ${out.tests.length} in ${out.files.length}`;
  } else out.complete = true;
  return out;
}

// The entries of a zip: its central directory, stored and deflated entries only.
export function unzip(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const fail = (why) => { throw new Error(`not a zip this reader opens: ${why}`); };
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('no end of central directory');
  const count = b.readUInt16LE(eocd + 10);
  const cdOffset = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) fail('zip64 is not read');
  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) fail('a broken central directory');
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const compSize = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) fail(`${name} is encrypted`);
    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50) fail(`${name} has no local header`);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + compSize);
    if (raw.length !== compSize) fail(`${name} is cut short`);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw); } catch (err) { fail(`${name} does not inflate: ${err.message}`); }
    } else fail(`${name} uses compression method ${method}`);
    if (data.length !== size) fail(`${name} is ${data.length} bytes, not ${size}`);
    out.push({ name, data });
  }
  return out;
}

// A downloaded run file holding a record: its first `.jsonl` entry, parsed.
export function readRunFile(bytes) {
  const entry = unzip(bytes).find((e) => e.name.endsWith('.jsonl'));
  if (!entry) throw new Error('not a zip this reader opens: it holds no .jsonl record');
  return parseRecord(entry.data.toString('utf8'));
}

function typeOf(v) {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

// Compare a written record with a stored expected one, field by field: the same lines in the
// same order and of the same types, every field equal, except the fields that vary by machine
// and moment, which are compared by type only. Answers the differences, none when they match.
export function compareRecords(expectedText, actualText) {
  const parse = (t) => String(t).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const exp = parse(expectedText);
  const act = parse(actualText);
  const diffs = [];
  const n = Math.max(exp.length, act.length);
  for (let i = 0; i < n; i++) {
    const e = exp[i]; const a = act[i];
    const where = `line ${i + 1}${e?.file ? ` (${e.type} ${e.file}${e.name ? ` "${e.name}"` : ''})` : e ? ` (${e.type})` : ''}`;
    if (!e) { diffs.push(`${where}: an extra ${a.type} line`); continue; }
    if (!a) { diffs.push(`${where}: missing`); continue; }
    if (e.type !== a.type) { diffs.push(`${where}: a ${a.type} line in place of ${e.type}`); continue; }
    const byType = new Set(VARYING);
    if (e.type === 'run') for (const k of RUN_FACTS) byType.add(k);
    for (const k of new Set([...Object.keys(e), ...Object.keys(a)])) {
      if (!(k in a)) { diffs.push(`${where}: ${k} is missing`); continue; }
      if (!(k in e)) { diffs.push(`${where}: ${k} is not expected`); continue; }
      if (byType.has(k)) {
        if (typeOf(e[k]) !== typeOf(a[k])) diffs.push(`${where}: ${k} is a ${typeOf(a[k])}, not a ${typeOf(e[k])}`);
      } else if (!isDeepStrictEqual(e[k], a[k])) {
        diffs.push(`${where}: ${k} is ${JSON.stringify(a[k])}, not ${JSON.stringify(e[k])}`);
      }
    }
  }
  return diffs;
}

// ---- The readers' contract (spec-record.md, "Readers' contract") ----
//
// Pure functions over GitHub's job listing and parsed records, so every reader pairs, counts
// attempts and groups jobs the same way:
//   jobOf(listed)               one job of GitHub's job listing, in the shape these read;
//   pairRecords(jobs, records)  each record on the job it belongs to;
//   ranNoTest(job)              whether a job ran no test and so owes no record;
//   jobsOfRun(jobs)             per job name in one run: its legs, the attempt that counts, its time;
//   jobGroups(perRun)           each job's group across the runs read;
//   groupTimes(perRun)          each group's time in each run.

export const KEEP_STEP = 'Keep the test times';
// GitHub's job times are whole seconds; a record's are milliseconds.
export const SLACK_MS = 1000;

const timeOf = (s) => (s ? Date.parse(s) : NaN);

export function jobOf(j) {
  return {
    id: j.id, name: j.name, attempt: j.run_attempt ?? 1, conclusion: j.conclusion ?? null,
    start: timeOf(j.started_at), end: timeOf(j.completed_at), runner: j.runner_name ?? null,
    keep: (j.steps ?? []).some((s) => s.name === KEEP_STEP && s.conclusion && s.conclusion !== 'skipped'),
    record: null,
  };
}

// A record belongs to the job whose runner name matches its runner_name, of its attempt, and
// whose start and end hold its started_at and ended_at. Several jobs of one run may share a
// name and a job id, as every leg of a matrix does; each is a job of its own, told apart by
// its runner and its times. Answers new jobs; the ones given are not changed.
export function pairRecords(jobs, records) {
  const out = jobs.map((j) => ({ ...j, record: null }));
  for (const record of records) {
    const head = record?.run ?? record?.head ?? {};
    const rs = timeOf(head.started_at); const re = timeOf(head.ended_at);
    const fits = out.filter((j) => !j.record && head.runner_name && j.runner === head.runner_name
      && (head.run_attempt == null || j.attempt === head.run_attempt)
      && (Number.isNaN(rs) || (j.start - SLACK_MS <= rs && (Number.isNaN(j.end) || rs <= j.end + SLACK_MS)))
      && (Number.isNaN(re) || Number.isNaN(j.end) || re <= j.end + SLACK_MS));
    fits.sort((a, b) => Math.abs(a.start - rs) - Math.abs(b.start - rs));
    if (fits[0]) fits[0].record = record;
  }
  return out;
}

// A job that succeeded and whose record says the runner never started ran no test, as when
// the main product's unit tests are answered from turbo's cache. The same words in a job that
// failed or was cancelled mean it stopped before its tests.
export function ranNoTest(job) {
  return !!job?.record?.neverStarted && job.conclusion === 'success';
}

// The state of one job's record: complete, none (it ran no test) or incomplete with why.
// Null for a job in which no `Keep the test times` step ran, which owes no record.
function legState(job) {
  if (!job.keep) return null;
  const r = job.record;
  if (!r) return { state: 'incomplete', why: 'no run file was kept', job, record: null };
  if (r.complete) return { state: 'complete', job, record: r };
  if (ranNoTest(job)) return { state: 'none', job, record: r };
  return { state: 'incomplete', why: r.why, job, record: r };
}

const ran = (j) => j.conclusion !== 'skipped' && !Number.isNaN(j.start) && !Number.isNaN(j.end);

// Per job name in one run (attempts). The jobs of one attempt that share a name are its legs,
// each a job of its own. An attempt is complete when no leg that owes a record left an
// incomplete one and at least one left a complete one. The newest complete attempt counts; a
// later attempt that left none, or ran no test, never hides it. Failing that, the newest
// attempt that owed a record says the state. The name's time is its longest leg's in the
// newest attempt that ran.
//   { name, key, ms, state: null | { state, why, legs: [{ state, why, job, record }] } }
export function jobsOfRun(jobs) {
  const byName = new Map();
  for (const j of jobs) {
    if (!byName.has(j.name)) byName.set(j.name, new Map());
    const atts = byName.get(j.name);
    if (!atts.has(j.attempt)) atts.set(j.attempt, []);
    atts.get(j.attempt).push(j);
  }
  const out = [];
  for (const [name, atts] of byName) {
    const attempts = [...atts.entries()].sort((a, b) => b[0] - a[0]).map(([, legs]) => legs);
    const timed = attempts.find((legs) => legs.some(ran));
    const ms = timed ? Math.max(...timed.filter(ran).map((j) => j.end - j.start)) : null;
    const all = attempts.flat();
    const key = all.find((j) => j.record?.run?.job_key)?.record.run.job_key ?? null;
    const states = attempts.map((legs) => legs.map(legState).filter(Boolean)).filter((s) => s.length);
    const sum = (legs) => {
      const bad = legs.filter((l) => l.state === 'incomplete');
      if (bad.length) return 'incomplete';
      return legs.some((l) => l.state === 'complete') ? 'complete' : 'none';
    };
    const counted = states.find((legs) => sum(legs) === 'complete') ?? states[0];
    let state = null;
    if (counted) {
      const s = sum(counted);
      const label = (l) => (counted.length > 1 ? `${name} on ${l.job.runner ?? 'an unnamed runner'}: ${l.why}` : l.why);
      state = { state: s, why: s === 'incomplete' ? counted.filter((l) => l.state === 'incomplete').map(label).join('; ') : null, legs: counted };
    }
    out.push({ name, key, ms: Number.isFinite(ms) && ms >= 0 ? ms : null, state });
  }
  return out;
}

// Job groups. A job that kept a record is grouped by its job id (job_key), so every machine
// of one matrix is one group however its machines are named. A job that kept none is grouped
// by the job id its name carried in any run read, so one missing upload never splits a
// matrix; failing that, by its name. perRun is [{ run, jobs: jobsOfRun(...) }], newest first;
// answers it with each job's `group` set.
export function jobGroups(perRun) {
  const nameToKey = new Map();
  for (const { jobs } of perRun) for (const j of jobs) if (j.key) nameToKey.set(j.name, j.key);
  return perRun.map(({ jobs, ...rest }) => ({
    ...rest, jobs: jobs.map((j) => ({ ...j, group: j.key ?? nameToKey.get(j.name) ?? j.name })),
  }));
}

// Each group's time in each run read: its longest job's, from that job's start to its end.
// Answers Map group -> [ms, one per run in which it ran], newest run first.
export function groupTimes(perRun) {
  const times = new Map();
  for (const { jobs } of perRun) {
    const longest = new Map();
    for (const j of jobs) {
      if (j.ms === null || j.ms === undefined) continue;
      longest.set(j.group, Math.max(longest.get(j.group) ?? 0, j.ms));
    }
    for (const [g, ms] of longest) {
      if (!times.has(g)) times.set(g, []);
      times.get(g).push(ms);
    }
  }
  return times;
}
