#!/usr/bin/env node
// The reader of test-time records on GitHub, with no dependency.
//
//   node read.mjs --repo <owner/name> --workflow <file> --event <push|pull_request> [--branch <name>] <one mode>
//
//   --require-complete [--runs <n>]
//   --history --out <file> [--runs <n>] [--job-prefix <name>] [--allow-none]
//   --slowest <group> [--runs <n>] [--ignore <group>]...
//   --not-slowest <group> [--runs <n>] [--ignore <group>]...
//
// Exit codes: 0 holds, 1 does not hold (in the mode's words), 2 `could not read: <what
// refused>` when GitHub refuses a call or a run file cannot be opened. A read that could not
// be made never passes; `--history --allow-none` alone still writes its file, saying `none`
// and why, prints a GitHub warning line with the same words, and exits 0.
//
// Token: GITHUB_TOKEN or GH_TOKEN, else `gh auth token`. It only reads. The API is
// GITHUB_API_URL, else https://api.github.com.
//
// Which runs: README.md beside this file. Attempts, pairing a record with its job, "ran no
// test" and job groups are record.mjs's, exported there so every reader reads them one way.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { KEEP_STEP, groupTimes, jobGroups, jobOf, jobsOfRun, median, pairRecords, readRunFile } from './record.mjs';

export { KEEP_STEP };
const WINDOW = 10; // the newest ten successful runs
const AT_ONCE = 6;

class Refused extends Error {}

function parseArgs(argv) {
  const o = { ignore: [] };
  const modes = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Refused(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--repo': o.repo = next(); break;
      case '--workflow': o.workflow = next(); break;
      case '--event': o.event = next(); break;
      case '--branch': o.branch = next(); break;
      case '--runs': {
        const v = next();
        if (!/^[1-9]\d*$/.test(v)) throw new Refused(`--runs is a whole number above 0, not ${v}`);
        o.runs = Number(v); break;
      }
      case '--out': o.out = next(); break;
      case '--job-prefix': o.jobPrefix = next(); break;
      case '--allow-none': o.allowNone = true; break;
      case '--ignore': o.ignore.push(next()); break;
      case '--require-complete': modes.push('require-complete'); break;
      case '--history': modes.push('history'); break;
      case '--slowest': modes.push('slowest'); o.group = next(); break;
      case '--not-slowest': modes.push('not-slowest'); o.group = next(); break;
      default: throw new Refused(`an argument this reader does not know: ${a}`);
    }
  }
  if (modes.length !== 1) throw new Refused('name one mode: --require-complete, --history, --slowest or --not-slowest');
  o.mode = modes[0];
  for (const k of ['repo', 'workflow', 'event']) if (!o[k]) throw new Refused(`--${k} is missing`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(o.repo)) throw new Refused(`--repo is owner/name, not ${o.repo}`);
  if (o.mode === 'history' && !o.out) throw new Refused('--history needs --out <file>');
  return o;
}

function token() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) return t;
  try {
    const g = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (g) return g;
  } catch { /* answered below */ }
  throw new Refused('no token: GITHUB_TOKEN and GH_TOKEN are unset and `gh auth token` answered none');
}

// Each GitHub request is tried up to TRIES times while the connection fails, no answer comes
// within the try's time limit, the body breaks off, or GitHub answers 5xx or 429. Between tries it
// waits WAITS (a 429's Retry-After instead, between 0 and RETRY_AFTER_CAP); then it is refused
// with the last failure and the number of tries. Any other answer is final at once.
//   TEST_TIMES_TRY_TIMEOUT_MS    digits: each try's time limit, body included (default 30000)
//   TEST_TIMES_RETRY_WAIT_MS     digits: every wait slept instead of the chosen one (tests set 0)
//   TEST_TIMES_RETRY_WAIT_LOG    a file: each chosen wait is added as `<request> wait <ms>`
const TRIES = 3;
const WAITS = [1000, 3000];
const RETRY_AFTER_CAP = 10000;
const TRY_TIMEOUT = 30000;

const digits = (name) => {
  const v = process.env[name];
  return v !== undefined && /^\d+$/.test(v) ? Number(v) : null;
};

// The wait before try n + 1, after a failure whose answer (if any) carried `retryAfter`.
function waitBefore(n, retryAfter) {
  const after = retryAfter?.trim();
  if (after) {
    const ms = /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now();
    if (Number.isFinite(ms)) return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP);
  }
  return WAITS[Math.min(n - 1, WAITS.length - 1)];
}

// A failure worth another try; `retryAfter` from a 429's answer.
class Again extends Error {
  constructor(message, retryAfter = null) { super(message); this.retryAfter = retryAfter; }
}

// An answer worth another try becomes Again, its body let go.
async function againIf(what, res) {
  if (res.status < 500 && res.status !== 429) return;
  const after = res.status === 429 ? res.headers.get('retry-after') : null;
  try { await res.body?.cancel(); } catch { /* the answer is dropped either way */ }
  throw new Again(`${what} answered ${res.status}`, after);
}

// `once(signal)` makes one whole try, reading its body too, under the try's time limit. It
// throws Refused for an answer that is final, Again for one worth another try; anything else it
// throws (a failed connection, a body that broke off, the time limit) is worth another try.
async function tried(what, once) {
  const limit = digits('TEST_TIMES_TRY_TIMEOUT_MS') ?? TRY_TIMEOUT;
  for (let n = 1; ; n++) {
    const signal = AbortSignal.timeout(limit);
    let last;
    try { return await once(signal); } catch (err) {
      if (err instanceof Refused) throw err;
      last = err instanceof Again ? err : new Again(signal.aborted
        ? `${what}: no answer within ${limit} ms` : `${what}: ${err.cause?.code ?? err.message}`);
    }
    if (n >= TRIES) throw new Refused(`${last.message} after ${n} tries`);
    const chosen = waitBefore(n, last.retryAfter);
    const log = process.env.TEST_TIMES_RETRY_WAIT_LOG;
    if (log) fs.appendFileSync(log, `${what} wait ${chosen}\n`);
    await new Promise((resolve) => setTimeout(resolve, digits('TEST_TIMES_RETRY_WAIT_MS') ?? chosen));
  }
}

// A body read in full, or the words of why it broke off: worth another try. One cut short by
// the try's time limit is left to `tried` to name.
async function body(what, res, read, signal) {
  try { return await read(res); } catch (err) {
    if (signal.aborted) throw err;
    throw new Again(`${what} broke off: ${err.cause?.code ?? err.message}`);
  }
}

function client() {
  const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const auth = token();
  const headers = { authorization: `Bearer ${auth}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28', 'user-agent': 'dazzer-io-test-times' };
  const urlOf = (pathname, params = {}) => {
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    return url;
  };
  return {
    json(pathname, params) {
      const what = `GET ${pathname}`;
      return tried(what, async (signal) => {
        const res = await fetch(urlOf(pathname, params), { headers, signal });
        await againIf(what, res);
        if (!res.ok) throw new Refused(`${what} answered ${res.status}`);
        const text = await body(what, res, (r) => r.text(), signal);
        try { return JSON.parse(text); } catch { throw new Refused(`${what} answered no JSON`); }
      });
    },
    // A run file's bytes. GitHub answers with a redirect to its storage, which is followed
    // without the token and tried again on its own, its body included.
    async bytes(pathname) {
      const what = `GET ${pathname}`;
      const file = `the run file behind ${pathname}`;
      const got = await tried(what, async (signal) => {
        const res = await fetch(urlOf(pathname), { headers, redirect: 'manual', signal });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) throw new Refused(`${what} answered ${res.status} with nowhere to go`);
          return { loc };
        }
        await againIf(what, res);
        if (!res.ok) throw new Refused(`${what} answered ${res.status}`);
        return { bytes: Buffer.from(await body(file, res, (r) => r.arrayBuffer(), signal)) };
      });
      if (got.bytes) return got.bytes;
      return tried(file, async (signal) => {
        const res = await fetch(got.loc, { signal });
        await againIf(file, res);
        if (!res.ok) throw new Refused(`${what} answered ${res.status}`);
        return Buffer.from(await body(file, res, (r) => r.arrayBuffer(), signal));
      });
    },
  };
}

async function paged(gh, pathname, params, key, enough = () => false) {
  const out = [];
  for (let page = 1; ; page++) {
    const body = await gh.json(pathname, { ...params, per_page: 100, page });
    const items = body?.[key];
    if (!Array.isArray(items)) throw new Refused(`GET ${pathname} answered no ${key}`);
    out.push(...items);
    if (items.length < 100 || enough(out) || (Number.isInteger(body.total_count) && out.length >= body.total_count)) return out;
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const time = (s) => (s ? Date.parse(s) : NaN);

// The newest `want` completed runs of the workflow on the event that pass `keep`.
async function listRuns(gh, o, want, keep) {
  const runs = await paged(gh, `/repos/${o.repo}/actions/workflows/${encodeURIComponent(o.workflow)}/runs`,
    { status: 'completed', event: o.event, branch: o.branch, exclude_pull_requests: 'true' },
    'workflow_runs', (got) => got.filter(keep).length >= want);
  return runs.filter((r) => r.status === 'completed' && keep(r))
    .sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id)
    .slice(0, want);
}

// One run: its jobs of every attempt, each with the record paired to it (record.mjs). A run
// file GitHub lists as expired is a run file that cannot be opened.
async function readRun(gh, o, run) {
  const jobs = await paged(gh, `/repos/${o.repo}/actions/runs/${run.id}/jobs`, { filter: 'all' }, 'jobs');
  const artifacts = await paged(gh, `/repos/${o.repo}/actions/runs/${run.id}/artifacts`, {}, 'artifacts');
  const kept = artifacts.filter((a) => /^test-times-/.test(a.name) && !/^test-times-history-/.test(a.name));
  const expired = kept.find((a) => a.expired);
  if (expired) throw new Refused(`run file ${expired.name} expired`);
  const records = await pool(kept, AT_ONCE, async (a) => {
    const bytes = await gh.bytes(`/repos/${o.repo}/actions/artifacts/${a.id}/zip`);
    try { return readRunFile(bytes); } catch (err) {
      throw new Refused(`run file ${a.name} of run ${run.id}: ${err.message}`);
    }
  });
  return { id: run.id, attempt: run.run_attempt ?? 1, sha: run.head_sha ?? null, jobs: pairRecords(jobs.map(jobOf), records) };
}

const minutes = (ms) => (ms / 60000).toFixed(1);

async function readWindow(o, want, keep) {
  const gh = client();
  const runs = await listRuns(gh, o, want, keep);
  const read = [];
  for (const r of runs) read.push(await readRun(gh, o, r));
  return jobGroups(read.map((run) => ({ run, jobs: jobsOfRun(run.jobs) })));
}

const completeLegs = (j) => (j.state?.legs ?? []).filter((l) => l.state === 'complete');

function groupState(jobs) {
  const owed = jobs.filter((j) => j.state);
  if (!owed.length) return null;
  const bad = owed.filter((j) => j.state.state === 'incomplete');
  if (bad.length) {
    const why = bad.map((j) => (owed.length > 1 ? `${j.name}: ${j.state.why}` : j.state.why)).join('; ');
    return { state: 'incomplete', why };
  }
  const done = owed.flatMap(completeLegs);
  if (!done.length) return { state: 'none' };
  return {
    state: 'complete',
    tests: done.reduce((n, l) => n + l.record.tests.length, 0),
    files: done.reduce((n, l) => n + l.record.files.length, 0),
  };
}

async function requireComplete(o) {
  const want = o.runs ?? WINDOW;
  const perRun = await readWindow(o, want, (r) => r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  const groups = new Map(); // group -> states, newest run first
  for (const { jobs } of perRun) {
    const byGroup = new Map();
    for (const j of jobs) {
      if (!byGroup.has(j.group)) byGroup.set(j.group, []);
      byGroup.get(j.group).push(j);
    }
    for (const [g, js] of byGroup) {
      const s = groupState(js);
      if (!s) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    }
  }
  const lines = [];
  const missing = [];
  for (const g of [...groups.keys()].sort()) {
    const states = groups.get(g);
    const s = states[0];
    lines.push(`${g}: ${s.state === 'complete' ? `complete, ${s.tests} tests in ${s.files} files`
      : s.state === 'none' ? 'ran no test' : `incomplete: ${s.why}`}`);
    const ok = states.some((x) => x.state === 'complete') || states.every((x) => x.state === 'none');
    if (!ok) missing.push(g);
  }
  const newest = perRun[0];
  const newestHas = newest && newest.jobs.some((j) => completeLegs(j).length);
  if (!perRun.length) missing.push('no completed run was found');
  else if (!newestHas) missing.push(`the newest run (${newest.run.id}) left none`);
  for (const l of lines) console.log(l);
  if (missing.length) {
    console.log(`no complete test-time record: ${missing.join(', ')}`);
    return 1;
  }
  console.log(`complete test-time records from every job group in ${perRun.length} runs`);
  return 0;
}

// The history file: per test file, one entry for each
// group it was recorded under, ordered by group with null first, each the median over the
// complete records of that file in that group; per job group, its median time and set-up.
function historyFrom(o, perRun) {
  const files = new Map(); // path -> group -> { samples, newest }
  const setup = new Map();
  for (const { jobs } of perRun) {
    for (const j of jobs) {
      for (const { job, record: r } of completeLegs(j)) {
        const span = time(r.run.ended_at) - time(r.run.started_at);
        const jobMs = job.end - job.start;
        if (Number.isFinite(span) && Number.isFinite(jobMs)) {
          if (!setup.has(j.group)) setup.set(j.group, []);
          setup.get(j.group).push(Math.max(0, jobMs - span));
        }
        if (o.jobPrefix && !j.name.startsWith(o.jobPrefix)) continue;
        for (const f of r.files) {
          // A line whose ms is no finite time (JSON reads 1e400 as Infinity) is no sample, so
          // `n` counts exactly the times the median rests on and a file with none has no entry.
          if (!Number.isFinite(f.ms)) continue;
          if (!files.has(f.file)) files.set(f.file, new Map());
          const byGroup = files.get(f.file);
          const g = f.group ?? null;
          if (!byGroup.has(g)) byGroup.set(g, { samples: [], newest: f });
          byGroup.get(g).samples.push(f.ms);
        }
      }
    }
  }
  const byGroupName = ([a], [b]) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
  const outFiles = {};
  for (const p of [...files.keys()].sort()) {
    outFiles[p] = [...files.get(p)].sort(byGroupName).map(([g, e]) => ({
      group: g, ms: Math.round(median(e.samples)), workers: e.newest.workers ?? null,
      serial: e.newest.serial ?? null, n: e.samples.length,
    }));
  }
  const jobs = {};
  const times = groupTimes(perRun);
  for (const g of [...times.keys()].sort()) {
    const s = setup.get(g);
    jobs[g] = { ms: Math.round(median(times.get(g))), setup_ms: s?.length ? Math.round(median(s)) : null, n: times.get(g).length };
  }
  return { files: outFiles, jobs };
}

function historyHead(o) {
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  return { v: 1, repo: o.repo, workflow: o.workflow, event: o.event, branch: o.branch ?? null,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1, read_at: new Date().toISOString() };
}

async function history(o) {
  const want = o.runs ?? WINDOW;
  let perRun;
  try {
    perRun = await readWindow(o, want, (r) => r.conclusion === 'success');
  } catch (err) {
    // Under --allow-none any read error, refused or not, writes `none` with why.
    if (!o.allowNone) throw err;
    const why = `could not read: ${err.message || String(err)}`;
    fs.writeFileSync(o.out, JSON.stringify({ ...historyHead(o), source: 'none', why, runs: [], files: {}, jobs: {} }) + '\n');
    console.log(`::warning title=test-times history::${why}`);
    console.log(`history: none, ${why} -> ${o.out}`);
    return 0;
  }
  const { files, jobs } = historyFrom(o, perRun);
  const doc = { ...historyHead(o), source: 'history', why: null,
    runs: perRun.map(({ run }) => ({ id: run.id, attempt: run.attempt, sha: run.sha })), files, jobs };
  fs.writeFileSync(o.out, JSON.stringify(doc) + '\n');
  console.log(`history: ${Object.keys(files).length} files and ${Object.keys(jobs).length} job groups from ${perRun.length} runs -> ${o.out}`);
  return 0;
}

async function slowest(o, not) {
  const want = o.runs ?? WINDOW;
  const perRun = await readWindow(o, want, (r) => r.conclusion === 'success');
  const times = groupTimes(perRun);
  const medians = [...times].filter(([g]) => !o.ignore.includes(g))
    .map(([g, ts]) => ({ g, ms: median(ts), n: ts.length }))
    .sort((a, b) => b.ms - a.ms || (a.g < b.g ? -1 : 1));
  for (const m of medians) console.log(`${m.g}: ${minutes(m.ms)} min over ${m.n} runs`);
  const me = medians.find((m) => m.g === o.group);
  if (!me) {
    console.log(`${o.group} has no job in the ${perRun.length} runs read`);
    return 1;
  }
  const rest = medians.filter((m) => m.g !== o.group);
  const top = rest[0];
  if (!not) {
    if (!top || me.ms >= top.ms) { console.log(`${o.group} sets the wait: ${minutes(me.ms)} min`); return 0; }
    console.log(`${top.g} sets the wait: ${minutes(top.ms)} min against ${o.group} ${minutes(me.ms)} min`);
    return 1;
  }
  if (top && me.ms <= top.ms) {
    console.log(`${top.g} sets the wait: ${minutes(top.ms)} min against ${o.group} ${minutes(me.ms)} min`);
    return 0;
  }
  console.log(`${o.group} sets the wait: ${minutes(me.ms)} min against ${top ? `${top.g} ${minutes(top.ms)} min` : 'no other group'}`);
  return 1;
}

export async function main(argv) {
  try {
    const o = parseArgs(argv);
    if (o.mode === 'require-complete') return await requireComplete(o);
    if (o.mode === 'history') return await history(o);
    return await slowest(o, o.mode === 'not-slowest');
  } catch (err) {
    console.log(`could not read: ${err instanceof Refused ? err.message : err.stack ?? err}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
