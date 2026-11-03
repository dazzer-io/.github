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
// Which runs, attempts, pairing a record with its job, job groups: README.md beside this file.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readRunFile } from './record.mjs';

export const KEEP_STEP = 'Keep the test times';
const WINDOW = 10; // the release door's own window (dev-cycle scripts/door-time.mjs)
const AT_ONCE = 6;
const SLACK_MS = 1000; // GitHub's job times are whole seconds; a record's are milliseconds

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

function client() {
  const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const auth = token();
  const headers = { authorization: `Bearer ${auth}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28', 'user-agent': 'dazzer-io-test-times' };
  const call = async (pathname, params = {}, opts = {}) => {
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    let res;
    try { res = await fetch(url, { headers, redirect: opts.redirect ?? 'follow' }); } catch (err) {
      throw new Refused(`GET ${pathname}: ${err.cause?.code ?? err.message}`);
    }
    return res;
  };
  return {
    async json(pathname, params) {
      const res = await call(pathname, params);
      if (!res.ok) throw new Refused(`GET ${pathname} answered ${res.status}`);
      try { return await res.json(); } catch { throw new Refused(`GET ${pathname} answered no JSON`); }
    },
    // A run file's bytes. GitHub answers with a redirect to its storage, which is followed
    // without the token.
    async bytes(pathname) {
      let res = await call(pathname, {}, { redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Refused(`GET ${pathname} answered ${res.status} with nowhere to go`);
        try { res = await fetch(loc); } catch (err) {
          throw new Refused(`the run file behind ${pathname}: ${err.cause?.code ?? err.message}`);
        }
      }
      if (!res.ok) throw new Refused(`GET ${pathname} answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
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

// One run: its jobs of every attempt, each with the record paired to it.
async function readRun(gh, o, run) {
  const jobs = await paged(gh, `/repos/${o.repo}/actions/runs/${run.id}/jobs`, { filter: 'all' }, 'jobs');
  const artifacts = await paged(gh, `/repos/${o.repo}/actions/runs/${run.id}/artifacts`, {}, 'artifacts');
  const kept = artifacts.filter((a) => /^test-times-/.test(a.name) && !/^test-times-history-/.test(a.name) && !a.expired);
  const records = await pool(kept, AT_ONCE, async (a) => {
    const bytes = await gh.bytes(`/repos/${o.repo}/actions/artifacts/${a.id}/zip`);
    try { return { name: a.name, record: readRunFile(bytes) }; } catch (err) {
      throw new Refused(`run file ${a.name} of run ${run.id}: ${err.message}`);
    }
  });
  const js = jobs.map((j) => ({
    id: j.id, name: j.name, attempt: j.run_attempt ?? 1, conclusion: j.conclusion,
    start: time(j.started_at), end: time(j.completed_at), runner: j.runner_name ?? null,
    keep: (j.steps ?? []).some((s) => s.name === KEEP_STEP && s.conclusion && s.conclusion !== 'skipped'),
    record: null,
  }));
  for (const { record } of records) {
    const head = record.run ?? record.head ?? {};
    const rs = time(head.started_at); const re = time(head.ended_at);
    const fits = js.filter((j) => !j.record && head.runner_name && j.runner === head.runner_name
      && (head.run_attempt == null || j.attempt === head.run_attempt)
      && (Number.isNaN(rs) || (j.start - SLACK_MS <= rs && (Number.isNaN(j.end) || rs <= j.end + SLACK_MS)))
      && (Number.isNaN(re) || Number.isNaN(j.end) || re <= j.end + SLACK_MS));
    fits.sort((a, b) => Math.abs(a.start - rs) - Math.abs(b.start - rs));
    if (fits[0]) fits[0].record = record;
  }
  return { id: run.id, attempt: run.run_attempt ?? 1, sha: run.head_sha ?? null, jobs: js };
}

// Per job name in one run: the attempt whose times count (the newest that ran) and the state
// of its record. The newest attempt that left a complete record counts; a later attempt that
// left none never hides it.
function jobsOf(run) {
  const byName = new Map();
  for (const j of run.jobs) {
    if (!byName.has(j.name)) byName.set(j.name, []);
    byName.get(j.name).push(j);
  }
  const out = [];
  for (const [name, atts] of byName) {
    atts.sort((a, b) => b.attempt - a.attempt || b.start - a.start);
    const latest = atts.find((j) => j.conclusion !== 'skipped' && !Number.isNaN(j.start) && !Number.isNaN(j.end));
    const key = atts.find((j) => j.record?.run?.job_key)?.record.run.job_key ?? null;
    let state = null;
    const complete = atts.find((j) => j.record?.complete);
    const kept = atts.find((j) => j.keep);
    if (complete) state = { state: 'complete', job: complete, record: complete.record };
    else if (kept) {
      const r = kept.record;
      if (!r) state = { state: 'incomplete', why: 'no run file was kept', job: kept };
      else if (r.neverStarted && kept.conclusion === 'success') state = { state: 'none', job: kept, record: r };
      else state = { state: 'incomplete', why: r.why, job: kept, record: r };
    }
    out.push({ name, key, latest, state });
  }
  return out;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const minutes = (ms) => (ms / 60000).toFixed(1);

async function readWindow(o, want, keep) {
  const gh = client();
  const runs = await listRuns(gh, o, want, keep);
  const read = [];
  for (const r of runs) read.push(await readRun(gh, o, r));
  // A job that kept no record is grouped by the job id its name carried in any run read, so
  // one missing upload never splits a matrix into a group of its own; else by its name.
  const nameToKey = new Map();
  const perRun = read.map((run) => ({ run, jobs: jobsOf(run) }));
  for (const { jobs } of perRun) for (const j of jobs) if (j.key) nameToKey.set(j.name, j.key);
  for (const { jobs } of perRun) for (const j of jobs) j.group = j.key ?? nameToKey.get(j.name) ?? j.name;
  return perRun;
}

// Each group's time in each run: its longest job's, from start to end.
function groupTimes(perRun) {
  const times = new Map();
  for (const { jobs } of perRun) {
    const longest = new Map();
    for (const j of jobs) {
      if (!j.latest) continue;
      const ms = j.latest.end - j.latest.start;
      if (ms >= 0) longest.set(j.group, Math.max(longest.get(j.group) ?? 0, ms));
    }
    for (const [g, ms] of longest) {
      if (!times.has(g)) times.set(g, []);
      times.get(g).push(ms);
    }
  }
  return times;
}

function groupState(jobs) {
  const owed = jobs.filter((j) => j.state);
  if (!owed.length) return null;
  const bad = owed.filter((j) => j.state.state === 'incomplete');
  if (bad.length) {
    const why = bad.map((j) => (owed.length > 1 ? `${j.name}: ${j.state.why}` : j.state.why)).join('; ');
    return { state: 'incomplete', why };
  }
  const done = owed.filter((j) => j.state.state === 'complete');
  if (!done.length) return { state: 'none' };
  return {
    state: 'complete',
    tests: done.reduce((n, j) => n + j.state.record.tests.length, 0),
    files: done.reduce((n, j) => n + j.state.record.files.length, 0),
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
  const newestHas = newest && newest.jobs.some((j) => j.state?.state === 'complete');
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

function historyFrom(o, perRun) {
  const files = new Map(); // path -> group -> { samples, newest }
  const setup = new Map();
  for (const { jobs } of perRun) {
    for (const j of jobs) {
      if (j.state?.state !== 'complete') continue;
      const r = j.state.record;
      const span = time(r.run.ended_at) - time(r.run.started_at);
      const job = j.state.job;
      const jobMs = job.end - job.start;
      if (Number.isFinite(span) && Number.isFinite(jobMs)) {
        if (!setup.has(j.group)) setup.set(j.group, []);
        setup.get(j.group).push(Math.max(0, jobMs - span));
      }
      if (o.jobPrefix && !j.name.startsWith(o.jobPrefix)) continue;
      for (const f of r.files) {
        if (typeof f.ms !== 'number') continue;
        if (!files.has(f.file)) files.set(f.file, new Map());
        const byGroup = files.get(f.file);
        const g = f.group ?? null;
        if (!byGroup.has(g)) byGroup.set(g, { samples: [], newest: f });
        byGroup.get(g).samples.push(f.ms);
      }
    }
  }
  const outFiles = {};
  for (const p of [...files.keys()].sort()) {
    const byGroup = files.get(p);
    const entry = (e) => ({ ms: Math.round(median(e.samples)), workers: e.newest.workers ?? null,
      serial: e.newest.serial ?? null, group: e.newest.group ?? null, n: e.samples.length });
    const [first] = byGroup.values(); // the group of the file's newest record
    outFiles[p] = entry(first);
    if (byGroup.size > 1) {
      outFiles[p].by_group = Object.fromEntries([...byGroup].map(([g, e]) => [g ?? '', entry(e)]));
    }
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
    if (!(err instanceof Refused) || !o.allowNone) throw err;
    const why = `could not read: ${err.message}`;
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
