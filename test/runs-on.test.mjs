// Every job of every workflow here names its machine by what it holds and what starts it, never
// by its name (decisions 36 and 93 of the checks-on-google job, which moved the checks off GitHub's
// computers):
//
//   - A WRITE TOKEN ON PULL REQUESTS. A job of a workflow started by pull_request,
//     pull_request_target, issue_comment, pull_request_review or merge_group that is granted any
//     write (`<scope>: write`, or `write-all`) by its workflow's `permissions:` or its own, or whose
//     workflow and job write no `permissions:` key at all (the repository's default token, which may
//     be read-write), runs on one of GitHub's standard machines written as a literal label, and
//     reads no CHECKS_, SCAN_ or LOCKED_ setting anywhere in the job or the workflow's top: on a
//     machine of ours that token is within reach of whatever ran there before it. A workflow's grant
//     counts even where the job's own permissions would replace it, so the reading errs toward
//     GitHub's machines. engineer-review.yml is such a job (statuses: write).
//   - THE SECURITY SCAN. Every other job of .github/workflows/security-scan.yml, the file the
//     organisation ruleset security-scan-required runs on every gated repository, reads exactly
//     ${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}: the scan machines, where no change's own code
//     runs, so the change it scans cannot reach the scan from a job of its own.
//   - EVERY OTHER JOB reads exactly ${{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}, the
//     organisation's change-check machines.
// Either setting empty sends its jobs back to GitHub's computers, which is how the fallback
// watcher stops the work from ever waiting on our machines. A job that calls a reusable workflow
// (`uses:` at the job's level) has no machine of its own and is accepted; the called workflow's jobs
// are judged where they are written.
//
// GitHub's standard machines are the labels dazzer's check-runner-setting gate takes for them
// (GITHUB_STANDARD_CORES in its scripts/checks/check-test-width-matches-the-machine.mjs):
// ubuntu-latest, ubuntu-24.04 and ubuntu-22.04.
//
// THE READER. This repository has no YAML package and adds none, so the workflows are read by
// their lines, as test/decide-tests-workflow.test.mjs and test/security-scan-decide.test.mjs read
// them, in the block layout every workflow here is written in. Its limits, stated:
//   - top keys at column zero (a quoted `"on":` is read as on), `jobs:` among them; each job id two
//     spaces in, plain (`  <id>:` with nothing after it but a comment); each job key four spaces in;
//   - a value is the text after `<key>:` on its line, a trailing ` # comment` dropped; a key with
//     nothing after it holds the more-indented lines below it (a list, a mapping);
//   - `on:` as one trigger, a flow list `[a, b]`, or the keys or `- ` items of the first indent
//     below it; `permissions:` as one word (read-all, write-all), a flow mapping `{ a: write }`, or
//     `<scope>: <access>` lines below it; any other spelling of permissions counts as a write;
//   - a setting is read where a line that is not a whole-line comment holds `vars.CHECKS_`,
//     `vars.SCAN_` or `vars.LOCKED_` (or `vars['...']`, in any case); a setting named by a value
//     worked out as the run goes (`vars[format(...)]`) is not seen;
//   - the expression is compared as written: another spacing, quotes around it, or another
//     fallback is another machine line, and refused;
//   - what it cannot read is refused rather than passed: no workflow file, no `jobs:` at column
//     zero or `jobs:` written on one line, a job id that is not plain, a tab in an indent, a
//     workflow with no trigger it can read, and a reading that found no job at all.
// It does not run GitHub's own parser; a file another reader takes differently inside this
// layout would not be seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const SCAN_WORKFLOW = 'security-scan.yml';
const CHECKS = "${{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}";
const SCAN = "${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}";
const GITHUB_STANDARD = ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04'];
const PULL_REQUEST_TRIGGERS = ['pull_request', 'pull_request_target', 'issue_comment', 'pull_request_review', 'merge_group'];
const OUR_SETTING = /\bvars\s*(?:\.\s*|\[\s*['"])\s*(CHECKS|SCAN|LOCKED)_\w*/i;

const isComment = (line) => /^\s*(#.*)?$/.test(line);
const indentOf = (line) => line.match(/^ */)[0].length;

// The value after a key: a quoted value up to its closing quote, a plain one up to ` #`.
function valueOf(rest) {
  const s = rest.trim();
  if (s.startsWith('#')) return '';
  for (const q of ["'", '"']) {
    if (!s.startsWith(q)) continue;
    for (let i = 1; i < s.length; i++) {
      if (s[i] !== q) continue;
      if (q === "'" && s[i + 1] === "'") { i++; continue; }
      if (q === '"' && s[i - 1] === '\\') continue;
      return s.slice(0, i + 1);
    }
    return s;
  }
  const k = s.search(/\s#/);
  return (k < 0 ? s : s.slice(0, k)).trim();
}

function unquote(v) {
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

const KEY = /^(\S[^:]*?)\s*:(?=\s|$)(.*)$/;

// A block's entries at one indent: { key, value, body, line }, body the deeper lines under it.
function entries(lines, indent, firstLine) {
  const out = [];
  lines.forEach((l, i) => {
    const ind = indentOf(l);
    if (isComment(l) || ind > indent) { if (out.length) out.at(-1).body.push(l); return; }
    const m = ind === indent ? l.slice(indent).match(KEY) : null;
    out.push({ key: m ? unquote(m[1]) : null, raw: l, value: m ? valueOf(m[2]) : '', body: [], line: firstLine + i });
  });
  return out;
}

function readTriggers(on) {
  if (!on) return [];
  if (on.value.startsWith('[')) return on.value.replace(/^\[|\]$/g, '').split(',').map((s) => unquote(s.trim())).filter(Boolean);
  if (on.value) return [unquote(on.value)];
  const body = on.body.filter((l) => !isComment(l));
  if (!body.length) return [];
  const indent = indentOf(body[0]);
  const out = [];
  for (const l of body) {
    if (indentOf(l) !== indent) continue;
    const item = l.slice(indent).match(/^-\s+(.*)$/);
    if (item) { out.push(unquote(valueOf(item[1]))); continue; }
    const m = l.slice(indent).match(KEY);
    if (m) out.push(unquote(m[1]));
  }
  return out;
}

// What a permissions: key grants: { set, write, how }.
function readGrant(entry, where) {
  if (!entry) return { set: false, write: false };
  const v = unquote(entry.value);
  if (v === 'read-all' || v === '{}') return { set: true, write: false };
  if (v === 'write-all') return { set: true, write: true, how: `${where} permissions: write-all` };
  let pairs;
  if (v.startsWith('{') && v.endsWith('}')) pairs = v.slice(1, -1).split(',').map((p) => p.split(':').map((s) => unquote(s.trim())));
  else if (v === '') pairs = entry.body.filter((l) => !isComment(l)).map((l) => valueOf(l).split(':').map((s) => unquote(s.trim())));
  else return { set: true, write: true, how: `${where} permissions: ${v}, a spelling this reader counts as a write` };
  const writes = pairs.filter(([scope, access]) => access === 'write').map(([scope]) => `${scope}: write`);
  return writes.length ? { set: true, write: true, how: `${where} permissions ${writes.join(', ')}` } : { set: true, write: false };
}

function readWorkflow(file) {
  const where = `.github/workflows/${file}`;
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
  const refusals = [];
  const tab = lines.findIndex((l) => /^ *\t/.test(l));
  if (tab >= 0) refusals.push(`Could not find a plain indent in ${where}: line ${tab + 1} indents with a tab, which this reader does not read`);
  const top = entries(lines, 0, 1);
  const on = top.find((e) => e.key === 'on' || e.key === 'true');
  const triggers = readTriggers(on);
  if (!triggers.length) refusals.push(`Could not find the triggers of ${where}: no on: key this reader reads at column zero`);
  const jobsEntry = top.find((e) => e.key === 'jobs');
  if (!jobsEntry || jobsEntry.value) {
    refusals.push(`Could not find the jobs of ${where}: ${jobsEntry ? 'jobs: is written on one line' : 'no jobs: key at column zero'}, where each job id must sit two spaces in`);
    return { where, file, triggers, refusals, jobs: [] };
  }
  const topText = top.filter((e) => e !== jobsEntry).flatMap((e) => [e.raw, ...e.body]).filter((l) => !isComment(l));
  const workflowGrant = readGrant(top.find((e) => e.key === 'permissions'), 'the workflow\'s');
  const jobs = [];
  for (const j of entries(jobsEntry.body, 2, jobsEntry.line + 1)) {
    const id = j.raw.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/)?.[1];
    if (!id) {
      refusals.push(`Could not find a plain job id in ${where} on line ${j.line}: it reads ${j.raw.trim()}, where a job is written as two spaces, its id and a colon`);
      continue;
    }
    const keys = entries(j.body, 4, j.line + 1);
    const key = (k) => keys.find((e) => e.key === k);
    jobs.push({
      id, line: j.line, runsOn: key('runs-on'), uses: key('uses'), steps: key('steps'),
      grant: readGrant(key('permissions'), `the job's`),
      text: [j.raw, ...j.body].filter((l) => !isComment(l)),
    });
  }
  if (!jobs.length && !refusals.length) refusals.push(`Could not find any job in ${where}: a reading of nothing would pass everything`);
  return { where, file, triggers, refusals, jobs, topText, workflowGrant };
}

// What a runs-on holds, in words, for a refusal.
function machineOf(runsOn) {
  if (!runsOn) return 'no runs-on';
  const body = runsOn.body.filter((l) => !isComment(l)).map((l) => l.trim());
  if (!runsOn.value && body.length) {
    const shape = body[0].startsWith('-') ? 'a list' : 'a group or labels mapping';
    return `runs-on: ${shape} (${body.join(' ')})`;
  }
  return `runs-on: ${runsOn.value || '(empty)'}`;
}

function judge(wf) {
  const refusals = [...wf.refusals];
  const pullRequest = wf.triggers.filter((t) => PULL_REQUEST_TRIGGERS.includes(t));
  for (const job of wf.jobs) {
    if (job.uses) continue;
    const named = `job ${job.id} of ${wf.where}`;
    const value = job.runsOn && !job.runsOn.body.some((l) => !isComment(l)) ? job.runsOn.value : null;
    const defaultToken = !wf.workflowGrant.set && !job.grant.set;
    const write = defaultToken || wf.workflowGrant.write || job.grant.write;
    if (pullRequest.length && write) {
      const how = [wf.workflowGrant.how, job.grant.how].filter(Boolean).join(' and ')
        || 'no permissions: key in the workflow or the job, so the repository\'s default token, which may write';
      const why = `holds a write token on ${pullRequest.join(', ')} (${how})`;
      if (value === null || !GITHUB_STANDARD.includes(unquote(value))) {
        refusals.push(`Could not find one of GitHub's standard machines (${GITHUB_STANDARD.join(', ')}) as the machine of ${named}: it ${why} and reads ${machineOf(job.runsOn)}. On a machine of ours that token is within reach of whatever ran there before it (decision 36).`);
      }
      for (const [lines, part] of [[job.text, 'the job'], [wf.topText, 'the workflow\'s top']]) {
        const hit = lines.map((l) => l.match(OUR_SETTING)).find(Boolean);
        if (hit) refusals.push(`Could not find ${named} free of the organisation's machine settings: it ${why}, and ${part} reads ${hit[0]}, a CHECKS_, SCAN_ or LOCKED_ setting such a job never reads (decision 36).`);
      }
      continue;
    }
    const [want, machines] = wf.file === SCAN_WORKFLOW
      ? [SCAN, 'the scan machines, where no change\'s own code runs (decision 93)']
      : [CHECKS, 'the organisation\'s change-check machines'];
    if (value !== want) {
      refusals.push(`Could not find ${want} as the machine of ${named}: it reads ${machineOf(job.runsOn)}. Its machine is ${machines}, GitHub's own while the setting is empty.`);
    }
  }
  return refusals;
}

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()
  : [];

test('the workflow folder holds workflows to read', () => {
  assert.ok(files.length > 0, `Could not find any workflow in .github/workflows/: a reading of nothing would pass everything`);
});

for (const file of files) {
  test(`every job of ${file} names its machine by what it holds and what starts it`, () => {
    const refusals = judge(readWorkflow(file));
    assert.ok(refusals.length === 0, refusals.join('\n'));
  });
}
