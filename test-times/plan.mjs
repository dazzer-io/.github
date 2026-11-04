#!/usr/bin/env node
// The shared planner: deals test files into parts by their recorded time, with no dependency.
//
//   node plan.mjs --history <file or folder> --files <file> --parts <n> [--part <i> --out <file>] [--deal <file>] [--lane <job group>]
//   node plan.mjs --history <file or folder> --count --lane <job group> [--ignore <job group>]...
//   node plan.mjs --history <file or folder> --count --group <name> --under <ms>
//
// `--files` holds one "<path>\t<group>" per line, every test file the runner discovered at the
// run's commit; a line with no tab, or an empty group, is a file of no group. Paths are
// repository-relative with forward slashes, the form the record writes (record.mjs repoPath),
// or no history entry matches them. Every file the planner writes, to `--out` and in the deal
// line, is written in that same line form, so its group is never dropped.
//
// A part dealt nothing runs no test: it prints `part <i>/<n>: run no test`, writes `run=false`
// to $GITHUB_OUTPUT, and its caller never hands its runner the empty list, since a runner
// given no file runs every file it finds. Its record is the never-started one finish.mjs
// writes, carrying its deal line of no file, so a reader counts it as planned and run.
//
// The history file is read.mjs --history's (README.md beside this file). Handed a folder, the
// planner reads every history file in it at any depth and takes the one whose `attempt` is the
// highest not above GITHUB_RUN_ATTEMPT, so a part re-run alone deals the deal its first attempt
// dealt. Every part computes the whole deal itself from that one file and takes its own share.
//
// Exit codes: 0 dealt or counted; 1 refused, saying why (among them `a file was discovered
// twice: <file>`); 2 `plan.mjs: <what is wrong>` for arguments it does not take.
//
// The spec is work/release-stays-fast/spec-split.md in dev-cycle, "The planner, shared".

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { median } from './record.mjs';

export { median };
export const NOT_EXACTLY_ONCE = 'the deal does not hold every file exactly once';
export const NONE_DISCOVERED = 'no test file was discovered: a lane always holds at least one';
// GitHub's own limit on the jobs one matrix makes (its workflow syntax page, "jobs.<job_id>.strategy.matrix").
export const MATRIX_LIMIT = 256;

export class PlanError extends Error {}
class ArgError extends Error {}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const groupOf = (g) => (g === undefined || g === '' ? null : g);
const pairOf = (f) => [f.path, f.group];
const keyOf = (f) => JSON.stringify(pairOf(f));
export const label = (f) => (f.group === null ? f.path : `${f.path} (${f.group})`);
// A file as one line of --files: its path, then a tab and its group when it has one.
export const lineOf = (f) => (f.group === null ? f.path : `${f.path}\t${f.group}`);

// Path first, then group, null first: the one order every list here is written in.
function byPath(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.group === b.group) return 0;
  if (a.group === null) return -1;
  if (b.group === null) return 1;
  return a.group < b.group ? -1 : 1;
}

function normalise(files) {
  if (!Array.isArray(files)) throw new PlanError('files is a list of { path, group }');
  const seen = new Set();
  return files.map((f) => {
    const one = typeof f === 'string' ? { path: f, group: null } : { path: f?.path, group: groupOf(f?.group) };
    if (typeof one.path !== 'string' || !one.path) throw new PlanError(`a discovered file has no path: ${JSON.stringify(f)}`);
    if (one.group !== null && typeof one.group !== 'string') throw new PlanError(`${one.path} has a group that is not a name`);
    if (one.path.includes('\t')) throw new PlanError(`a discovered path holds a tab: ${JSON.stringify(one.path)}`);
    const k = keyOf(one);
    if (seen.has(k)) throw new PlanError(`a file was discovered twice: ${label(one)}`);
    seen.add(k);
    return one;
  });
}

function entryOf(history, f) {
  const list = history?.files?.[f.path];
  if (!Array.isArray(list)) return null;
  const e = list.find((x) => groupOf(x?.group) === f.group);
  return e && typeof e.ms === 'number' && Number.isFinite(e.ms) && e.ms >= 0 ? e : null;
}

// Each discovered file's weight: its history entry's median ms divided by its workers, or its
// whole ms when it runs one at a time. A file with no history weighs the median of the known
// weights, and is serial when the known files of its group are. With no history at all every
// file weighs the same, 1, and the deal is `timed: false`.
export function weigh({ files, history }) {
  const list = normalise(files);
  const out = list.map((f) => {
    const e = entryOf(history, f);
    if (!e) return { ...f, known: false, weight: null, serial: null };
    const serial = e.serial === true;
    const workers = Number.isInteger(e.workers) && e.workers > 0 ? e.workers : 1;
    return { ...f, known: true, weight: serial ? e.ms : e.ms / workers, serial };
  });
  const known = out.filter((f) => f.known);
  const mid = median(known.map((f) => f.weight));
  for (const f of out) {
    if (f.known) continue;
    const kin = known.filter((k) => k.group === f.group);
    f.serial = kin.length > 0 && kin.every((k) => k.serial);
    f.weight = mid ?? 1;
  }
  return { files: out, timed: known.length > 0 };
}

// Whether the parts hold every discovered file exactly once and nothing else. Throws naming the
// first file that is missing, dealt twice or never discovered. The planner's test oracle (deal,
// below): no gate calls it.
export function checkDeal(files, partLists) {
  const want = new Map(normalise(files).map((f) => [keyOf(f), f]));
  const got = new Map();
  for (const list of partLists) {
    for (const raw of list) {
      const f = { path: raw.path, group: groupOf(raw.group) };
      const k = keyOf(f);
      if (!want.has(k) || got.has(k)) throw new PlanError(`${NOT_EXACTLY_ONCE}: ${label(f)}`);
      got.set(k, f);
    }
  }
  for (const [k, f] of want) if (!got.has(k)) throw new PlanError(`${NOT_EXACTLY_ONCE}: ${label(f)}`);
}

// The hash of a deal: SHA-256 of its parts' file lists, each [path, group], as canonical JSON,
// in part order. The first 16 characters are what is printed.
export function hashDeal(partLists) {
  return sha256(JSON.stringify(partLists.map((list) => list.map((f) => [f.path, groupOf(f.group)]))));
}

// The hash of everything the runner discovered: SHA-256 of the sorted [path, group] list.
export function hashDiscovered(files) {
  return sha256(JSON.stringify(normalise(files).sort(byPath).map(pairOf)));
}

// The deal. Heaviest first, ties by path; each file onto the part with the least total so far,
// ties to the lower part. Each part's prediction is its total plus the lane's median set-up
// (history.jobs[lane].setup_ms); with none, the set-up is unknown and the prediction is the
// total alone. The same inputs, in any order, always give the same deal.
//
// It runs no checkDeal of its own: the placement puts each discovered file into exactly one
// part by construction, after normalise has refused a file discovered twice, so such a check
// could never fire. checkDeal is the planner's test oracle: the tests prove the placement
// against it at every count. CI Gate does not call it. It holds the shares' records, not the
// discovered list checkDeal takes, and checks them itself, in its own words: their `discovered`
// and `history` hashes, their file lists and `discovered_count` (spec-split.md in dev-cycle,
// "CI Gate checks every file ran exactly once").
export function deal({ files, history, parts, lane = null }) {
  if (!Number.isInteger(parts) || parts < 1) throw new PlanError(`parts is a whole number above 0, not ${parts}`);
  if (Array.isArray(files) && !files.length) throw new PlanError(NONE_DISCOVERED);
  const { files: weighed, timed } = weigh({ files, history });
  const order = [...weighed].sort((a, b) => b.weight - a.weight || byPath(a, b));
  const totals = new Array(parts).fill(0);
  const lists = Array.from({ length: parts }, () => []);
  for (const f of order) {
    let at = 0;
    for (let i = 1; i < parts; i++) if (totals[i] < totals[at]) at = i;
    totals[at] += f.weight;
    lists[at].push(f);
  }
  for (const list of lists) list.sort(byPath);
  const setup = lane !== null && typeof history?.jobs?.[lane]?.setup_ms === 'number' ? history.jobs[lane].setup_ms : null;
  const out = lists.map((list, i) => ({
    part: i + 1,
    files: list.map(({ path: p, group }) => ({ path: p, group })),
    total_ms: timed ? Math.round(totals[i]) : null,
    predicted_ms: timed ? Math.round(totals[i] + (setup ?? 0)) : null,
    with_history: list.filter((f) => f.known).length,
    serial: list.filter((f) => f.serial).length,
  }));
  const recorded = Object.keys(history?.files ?? {}).length;
  return { parts: out, timed, setup_ms: setup, hash: hashDeal(lists), recorded, matched: weighed.filter((f) => f.known).length };
}

const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;

function heaviest(weighed) {
  return [...weighed].sort((a, b) => b.weight - a.weight || byPath(a, b))[0] ?? null;
}

// The count, by one rule from recorded figures only (D15, spec-split.md "How many parts"),
// counting no higher than GitHub's matrix limit. The first of these that some count meets
// decides, and the count is the smallest that meets it:
//   1. its slowest part, set-up included where it is recorded, is no longer than the figure;
//   2. where a set-up is recorded, its slowest part's own tests, the part less the set-up, are
//      no longer than the figure: the set-up keeps the lane over (`setup_over`);
//   3. the heaviest file stands alone and sets the wait, its part the slowest (`alone`).
// Where none is met up to the limit, the smallest count at the lowest slowest part (`capped`).
// At the figure itself 1 ms of set-up either side never swings the count: 300 serial 1 s files
// held to 50 000 ms take 6 parts at 49 999 ms of set-up and at 50 000. The count still jumps
// where the figure stops being reachable at any count up to the limit, at a set-up of the
// figure less the lowest slowest part's own tests: those 300 files take rule 1 at 150 parts with
// 48 000 ms of set-up (two files each, 2 000 + 48 000 = 50 000), and with 48 001 no count up to
// the limit meets it, so rule 2 gives 6 parts, the slowest 98 001 ms. Rule 1 also steps on its
// own: 47 000 ms gives 100 parts, 47 001 gives 150. `entries` come from the history itself.
function smallest({ entries, history, lane, against, addSetup }) {
  const { files: weighed } = weigh({ files: entries, history });
  const top = heaviest(weighed);
  const most = Math.min(entries.length, MATRIX_LIMIT);
  let own = null; let alone = null; let best = null;
  for (let n = 1; n <= most; n++) {
    const d = deal({ files: entries, history, parts: n, lane: addSetup ? lane : null });
    const slowest = Math.max(...d.parts.map((p) => p.predicted_ms));
    const tests = Math.max(...d.parts.map((p) => p.total_ms));
    const at = { count: n, slowest_ms: slowest, tests_ms: tests, setup_ms: d.setup_ms };
    // Rule 1 returns at once and rule 2 waits its turn, so the first set-up at which rule 1 is out
    // of reach at every count drops the count to rule 2's, which can be far smaller (above).
    if (slowest <= against) return { ...at, alone: null, capped: false, setup_over: false };
    if (!own && d.setup_ms !== null && tests <= against) own = at;
    if (!best || slowest < best.slowest_ms) best = at;
    // Standing alone, the heaviest file sets the lowest slowest part any count reaches, so rule
    // 1 is out of reach from here on, and so is rule 2 if it has not been met.
    if (tests <= Math.round(top.weight)) { alone = at; break; }
  }
  if (own) return { ...own, alone: null, capped: false, setup_over: true };
  if (alone) return { ...alone, alone: label(top), capped: false, setup_over: false };
  return { ...best, alone: null, capped: true, setup_over: false };
}

const historyEntries = (history, keep = () => true) => {
  const out = [];
  for (const [p, list] of Object.entries(history?.files ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const f = { path: p, group: groupOf(e?.group) };
      if (entryOf(history, f) && keep(f)) out.push(f);
    }
  }
  return out.sort(byPath);
};

// How many parts or shares.
//   count({ history, lane, ignore })  a lane's part count: the smallest count whose predicted
//     slowest part, set-up included where it is known, is no longer than the longest median of
//     the other job groups in history.jobs, leaving out the lane's own and those in `ignore`.
//     The lane's files are every file in the history, which the plan job limits to the lane's
//     jobs with read.mjs --job-prefix.
//   count({ history, group, under })  one group's share count: the smallest count whose
//     slowest share of that group's files is no longer than `under` ms.
// With no history, or no other job group to hold a lane to, one. Where no count holds the
// slowest part under, `smallest` above says which count, by one rule; no count is ever above
// MATRIX_LIMIT. `tests_ms` is the slowest part's own tests, the part less the set-up.
// Answers { count, slowest_ms, tests_ms, against_ms, against, setup_ms, alone, capped, setup_over, why }.
export function count({ history, lane = null, ignore = [], group, under } = {}) {
  const one = (why, extra = {}) => ({ count: 1, slowest_ms: null, tests_ms: null, against_ms: null, against: null, setup_ms: null,
    alone: null, capped: false, setup_over: false, why, ...extra });
  const byGroup = group !== undefined;
  if (byGroup && !(typeof under === 'number' && Number.isFinite(under) && under > 0)) throw new PlanError(`under is a time in ms above 0, not ${under}`);
  if (!byGroup && (typeof lane !== 'string' || !lane)) throw new PlanError('name a lane, or a group and under');
  if (!history || history.source === 'none') return one(`no history: ${history?.why ?? 'none was read'}`);
  const entries = historyEntries(history, byGroup ? (f) => f.group === groupOf(group) : () => true);
  if (!entries.length) return one(byGroup ? `no recorded file in group ${group}` : 'no recorded file');
  if (byGroup) {
    const r = smallest({ entries, history, lane: null, against: under, addSetup: false });
    return { ...r, setup_ms: null, against_ms: under, against: null, setup_over: false, why: null };
  }
  const others = Object.entries(history.jobs ?? {})
    .filter(([g, j]) => g !== lane && !ignore.includes(g) && typeof j?.ms === 'number')
    .sort(([ga, a], [gb, b]) => b.ms - a.ms || (ga < gb ? -1 : 1));
  if (!others.length) return one(`no other job group to hold ${lane} to`);
  const [against, { ms: againstMs }] = others[0];
  const r = smallest({ entries, history, lane, against: againstMs, addSetup: true });
  return { ...r, against_ms: againstMs, against, why: null };
}

function isHistory(doc) {
  return doc && typeof doc === 'object' && doc.v === 1 && doc.files && typeof doc.files === 'object'
    && doc.jobs && typeof doc.jobs === 'object' && Number.isInteger(doc.attempt);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

// The history a part deals from: the file handed, or, in a folder at any depth, the history
// file of the highest attempt not above `attempt`, which the command line reads from the part's
// own GITHUB_RUN_ATTEMPT. An attempt not given, or not a whole number above 0, caps nothing, and
// the highest is taken. Answers { history, file, hash }, the hash over the file's bytes.
export function loadHistory(where, attempt) {
  let stat;
  try { stat = fs.statSync(where); } catch { throw new PlanError(`no history at ${where}`); }
  const read = (file) => {
    const bytes = fs.readFileSync(file);
    let doc;
    try { doc = JSON.parse(bytes.toString('utf8')); } catch { return null; }
    return isHistory(doc) ? { history: doc, file, hash: sha256(bytes) } : null;
  };
  if (!stat.isDirectory()) {
    const one = read(where);
    if (!one) throw new PlanError(`${where} is not a history file read.mjs --history writes`);
    return one;
  }
  const cap = Number(attempt);
  const capped = Number.isInteger(cap) && cap > 0;
  const all = walk(where).map(read).filter(Boolean);
  const fit = all.filter((h) => !capped || h.history.attempt <= cap);
  if (!fit.length) {
    throw new PlanError(`no history file${capped ? ` of an attempt not above ${cap}` : ''} in ${where}${all.length ? `: it holds attempts ${[...new Set(all.map((h) => h.history.attempt))].sort((a, b) => a - b).join(', ')}` : ''}`);
  }
  const top = Math.max(...fit.map((h) => h.history.attempt));
  const newest = fit.filter((h) => h.history.attempt === top);
  if (new Set(newest.map((h) => h.hash)).size > 1) {
    throw new PlanError(`two different history files of attempt ${top}: ${newest.map((h) => path.relative(where, h.file)).join(', ')}`);
  }
  return newest[0];
}

// The record's deal line for part i (spec-record.md): its files, one per dealt file in the line
// form of --files (its path, and a tab and its group when it has one), the hash of everything
// discovered and of the history file the deal was made from.
export function dealLine({ dealt, part, files, historyHash }) {
  return {
    type: 'deal', parts: dealt.parts.length, part,
    files: dealt.parts[part - 1].files.map(lineOf),
    discovered: hashDiscovered(files), discovered_count: files.length, history: historyHash,
  };
}

export function readFilesList(text) {
  return String(text).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim()).map((l) => {
    const tab = l.indexOf('\t');
    return tab < 0 ? { path: l, group: null } : { path: l.slice(0, tab), group: groupOf(l.slice(tab + 1)) };
  });
}

function describeHistory(h) {
  const doc = h.history;
  if (doc.source === 'none') return `history: none (${doc.why ?? 'no reason given'}), attempt ${doc.attempt}, ${h.hash.slice(0, 16)} ${h.file}: every file weighs the same`;
  return `history: ${Object.keys(doc.files).length} files from ${(doc.runs ?? []).length} runs, attempt ${doc.attempt}, ${h.hash.slice(0, 16)} ${h.file}`;
}

function parseArgs(argv) {
  const o = { ignore: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ArgError(`${a} needs a value`);
      return v;
    };
    const whole = (v) => {
      if (!/^[1-9]\d*$/.test(v)) throw new ArgError(`${a} is a whole number above 0, not ${v}`);
      return Number(v);
    };
    switch (a) {
      case '--history': o.history = next(); break;
      case '--files': o.files = next(); break;
      case '--parts': o.parts = whole(next()); break;
      case '--part': o.part = whole(next()); break;
      case '--out': o.out = next(); break;
      case '--deal': o.deal = next(); break;
      case '--lane': o.lane = next(); break;
      case '--count': o.count = true; break;
      case '--ignore': o.ignore.push(next()); break;
      case '--group': o.group = next(); break;
      case '--under': o.under = whole(next()); break;
      default: throw new ArgError(`an argument this planner does not know: ${a}`);
    }
  }
  if (!o.history) throw new ArgError('--history is missing');
  if (o.count) {
    if ((o.lane === undefined) === (o.group === undefined)) throw new ArgError('--count takes --lane or --group, one of them');
    if (o.group !== undefined && o.under === undefined) throw new ArgError('--count --group needs --under <ms>');
    if (o.group !== undefined && o.ignore.length) throw new ArgError('--ignore goes with --lane');
    return o;
  }
  if (!o.files) throw new ArgError('--files is missing');
  if (!o.parts) throw new ArgError('--parts is missing');
  if ((o.out || o.deal) && !o.part) throw new ArgError('--out and --deal need --part <i>');
  if (o.part && o.part > o.parts) throw new ArgError(`--part ${o.part} is above --parts ${o.parts}`);
  return o;
}

export const RUN_NO_TEST = 'run no test';

function printDeal(dealt) {
  if (dealt.recorded > 0 && dealt.matched === 0) {
    console.log(`::warning title=test-times plan::none of the ${dealt.parts.reduce((n, p) => n + p.files.length, 0)} discovered files matched any of the history's ${dealt.recorded} files, so every file weighs the same: --files paths are repository-relative with forward slashes, as the record writes them`);
  }
  const slowest = dealt.timed ? Math.max(...dealt.parts.map((p) => p.predicted_ms)) : null;
  const n = dealt.parts.length;
  for (const p of dealt.parts) {
    if (!p.files.length) { console.log(`part ${p.part}/${n}: ${RUN_NO_TEST}`); continue; }
    const files = `${p.files.length} file${p.files.length === 1 ? '' : 's'}`;
    let time;
    if (!dealt.timed) time = 'predicted time unknown: no file has a recorded time';
    else if (dealt.setup_ms === null) time = `${minutes(p.predicted_ms)} predicted, set-up unknown`;
    else time = `${minutes(p.predicted_ms)} predicted with ${minutes(dealt.setup_ms)} set-up`;
    let line = `part ${p.part}/${n}: ${files}, ${time}, ${p.with_history} with history`;
    if (n > 1 && dealt.timed && p.files.length === 1 && p.predicted_ms === slowest) line += `; ${label(p.files[0])} alone sets the wait`;
    console.log(line);
  }
  console.log(`deal ${dealt.hash.slice(0, 16)}`);
}

export function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (err) {
    if (!(err instanceof ArgError)) throw err;
    console.log(`plan.mjs: ${err.message}`);
    return 2;
  }
  try {
    const h = loadHistory(o.history, process.env.GITHUB_RUN_ATTEMPT);
    console.log(describeHistory(h));
    if (o.count) {
      const c = count(o.group !== undefined
        ? { history: h.history, group: o.group, under: o.under }
        : { history: h.history, lane: o.lane, ignore: o.ignore });
      if (c.why) console.log(`count 1: ${c.why}`);
      else {
        const what = o.group !== undefined ? 'slowest share' : 'slowest part';
        const set = o.group !== undefined ? '' : c.setup_ms === null ? ', set-up unknown' : ` with ${minutes(c.setup_ms)} set-up`;
        const fig = o.group !== undefined ? `the ${minutes(c.against_ms)} given` : `${c.against} ${minutes(c.against_ms)}`;
        console.log(`count ${c.count}: ${what} ${minutes(c.slowest_ms)}${set} against ${fig}`);
        if (c.setup_over) console.log(`no count holds it under: the lane's set-up, ${minutes(c.setup_ms)}, keeps it over ${fig}, and every part pays it: the count holds the slowest part's own tests, ${minutes(c.tests_ms)}, under it`);
        if (c.alone) console.log(`no count holds it under: ${c.alone} alone sets the wait`);
        if (c.capped) console.log(`no count up to GitHub's ${MATRIX_LIMIT}-job matrix limit holds it under: the count stops at ${c.count}`);
      }
      if (process.env.GITHUB_OUTPUT) {
        const parts = Array.from({ length: c.count }, (_, i) => i + 1);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${c.count}\nparts=${JSON.stringify(parts)}\n`);
      }
      return 0;
    }
    let text;
    try { text = fs.readFileSync(o.files, 'utf8'); } catch { throw new PlanError(`cannot read --files ${o.files}`); }
    const files = readFilesList(text);
    const dealt = deal({ files, history: h.history, parts: o.parts, lane: o.lane ?? null });
    printDeal(dealt);
    if (o.part) {
      const mine = dealt.parts[o.part - 1].files;
      if (o.out) fs.writeFileSync(o.out, mine.map((f) => `${lineOf(f)}\n`).join(''));
      if (o.deal) fs.writeFileSync(o.deal, JSON.stringify(dealLine({ dealt, part: o.part, files, historyHash: h.hash })) + '\n');
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${mine.length > 0}\nfile_count=${mine.length}\n`);
    }
    return 0;
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    console.log(err.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
