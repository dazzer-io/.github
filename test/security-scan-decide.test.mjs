// Security scan's decision over recorded scanner outputs (test/fixtures/scan-outputs.json).
// No network: every output the decision reads is in the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  decide, summary, annotations, readMode, readNative, readAccepted, allowGhsas,
  requiredOutputs, fromCvss, fromWord, blocks, OPEN_SOURCE_OUTPUTS,
} from '../security-scan/decide.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'scan-outputs.json'), 'utf8'));
const DECIDE = path.join(here, '..', 'security-scan', 'decide.mjs');

// Said only when a check goes red on a critical finding that passed in blocking mode.
const CRITICAL_PASSED = 'a critical finding did not block in blocking mode';
// Said only when a check goes red on a finding that blocked though it should not.
const WRONGLY_BLOCKED = 'a finding the change may carry blocked the scan';
// Said only when a check goes red on a high finding or unreadable output that passed.
const MISSED = 'a finding that should block did not block the scan';

function outputOf(key) {
  const o = fixture.outputs[key];
  assert.ok(o, `the fixture has no output named "${key}"`);
  return { exit: o.exit, text: 'body' in o ? JSON.stringify(o.body) : o.text };
}

function inputOf(name) {
  const s = fixture.scenarios[name];
  assert.ok(s, `the fixture has no scenario named "${name}"`);
  const outputs = {};
  for (const [slot, key] of Object.entries(s.outputs)) outputs[slot] = outputOf(key);
  let accepted = null;
  if (s.accepted) accepted = JSON.stringify(fixture.accepted[s.accepted]);
  if (s.acceptedText !== undefined) accepted = s.acceptedText;
  return { s, input: { mode: s.mode, native: s.native, accepted, outputs } };
}

function check(name) {
  const { s, input } = inputOf(name);
  const d = decide(input);
  const blockingIds = d.findings.filter((f) => f.blocks).map((f) => f.id);
  const hasCritical = d.findings.some((f) => f.severity === 'critical' && f.isNew && !f.accepted);
  const why = `"${name}": ${JSON.stringify({ result: d.result, blockingIds, errors: d.errors, notes: d.notes })}`;
  if (s.expect.result === 'fail') {
    assert.equal(d.result, 'fail',
      `${hasCritical && d.mode === 'blocking' ? CRITICAL_PASSED : MISSED}: ${why}`);
  } else {
    assert.equal(d.result, 'pass', `${WRONGLY_BLOCKED}: ${why}`);
  }
  assert.deepEqual(blockingIds, s.expect.blocking,
    `${s.expect.blocking.length > blockingIds.length ? MISSED : WRONGLY_BLOCKED}: ${why}`);
  assert.equal(d.wouldBlock, s.expect.wouldBlock, why);
  if (s.expect.findings !== undefined) assert.equal(d.findings.length, s.expect.findings, why);
  if (s.expect.errors !== undefined) assert.equal(d.errors.length, s.expect.errors, why);
  if (s.expect.mode) assert.equal(d.mode, s.expect.mode, why);
  if (s.expect.annotation) assert.equal(d.annotation, s.expect.annotation, why);
  if (s.expect.note) assert.ok(d.notes.some((n) => n.includes(s.expect.note)), `"${name}" never says "${s.expect.note}": ${why}`);
  if (s.expect.acceptedBy) assert.equal(d.findings[0].accepted, s.expect.acceptedBy, why);
  if (s.expect.severity) assert.equal(d.findings[0].severity, s.expect.severity, why);
  return d;
}

test('every scenario in the fixture is checked here', () => {
  const named = new Set(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .match(/check\('([^']+)'\)/g).map((m) => m.slice(7, -2)));
  for (const name of Object.keys(fixture.scenarios)) {
    assert.ok(named.has(name), `the scenario "${name}" is in the fixture but no test checks it`);
  }
});

// ---------- the dependency review (native branch) ----------

test('a runtime high the change adds blocks in blocking mode', () => {
  check('native: a runtime high added, blocking');
});

test('a runtime high the change adds passes in advisory mode, with the would-block annotation last', () => {
  const d = check('native: a runtime high added, advisory');
  const lines = annotations(d);
  assert.equal(lines.at(-1), '::warning title=security-scan::security-scan would block: 1');
  assert.match(summary(d), /Prototype pollution in harbor-lane-parser/);
  assert.match(summary(d), /security-scan would block: 1/);
});

test('a runtime critical the change adds blocks in blocking mode', () => {
  const d = check('native: a runtime critical added, blocking');
  assert.equal(annotations(d).at(-1), '::error title=security-scan::security-scan blocks: 1');
});

test('a development-scope high does not block, and is still recorded', () => {
  const d = check('native: a development-scope high added, blocking');
  assert.equal(d.findings[0].scope, 'development');
  assert.match(summary(d), /harbor-lane-test-runner/);
});

test('a vulnerable dependency the change removes is not its finding', () => {
  check('native: a removed critical, blocking');
});

test('an accepted advisory passes, naming its record', () => {
  const d = check('native: an accepted advisory, blocking');
  assert.match(summary(d), /records\/risk-acceptance\/2026-10-harbor-lane-parser\.md/);
});

test('an accepted entry with no risk-acceptance record accepts nothing', () => {
  const d = check('native: an accepted advisory naming no record, blocking');
  assert.ok(d.notes.some((n) => /names no risk-acceptance record/.test(n)), JSON.stringify(d.notes));
});

test('on a native repository no open-source job is required', () => {
  const d = check('native: no dependency changes and no open-source output, blocking');
  assert.deepEqual(d.required, ['dependency-review']);
  assert.deepEqual(requiredOutputs(true), ['dependency-review']);
  for (const name of OPEN_SOURCE_OUTPUTS) assert.ok(!d.required.includes(name), name);
  assert.equal(d.branch, 'native');
});

test('a dependency review that refused and wrote nothing blocks', () => {
  check('native: the dependency review refused and wrote nothing, blocking');
});

test('a missing dependency review output blocks', () => {
  check('native: the dependency review output missing, blocking');
});

// ---------- the open-source scanners ----------

test('elsewhere, clean scanners pass, and all four outputs are required', () => {
  const d = check('open source: everything clean, blocking');
  assert.deepEqual(d.required, ['osv-head', 'osv-base', 'gitleaks', 'semgrep']);
  assert.equal(d.branch, 'open source');
});

test('elsewhere, a gitleaks finding on the change blocks, and its secret is never shown', () => {
  const d = check('open source: a gitleaks finding on the change, blocking');
  assert.equal(d.findings[0].severity, 'critical');
  const text = summary(d);
  assert.match(text, /generic-api-key/);
  assert.ok(!text.includes('harborLaneToken = REDACTED'), 'the summary shows the matched line');
});

test('gitleaks saying it found leaks but listing none blocks', () => {
  check('open source: gitleaks says leaks but lists none, blocking');
});

test('a dependency advisory the change adds blocks', () => {
  check('open source: a dependency advisory the change adds, blocking');
});

test('a dependency advisory already on the base is recorded and does not block', () => {
  const d = check('open source: a dependency advisory already on the base, blocking');
  assert.equal(d.findings[0].isNew, false);
  assert.match(summary(d), /on the base already/);
});

test('an advisory accepted under its alias passes', () => {
  check('open source: a dependency advisory accepted by its alias, blocking');
});

test('with no score the severity word is read, and a critical blocks', () => {
  check('open source: a critical by severity word alone, blocking');
});

test('a development-only dependency advisory does not block', () => {
  check('open source: a development-only dependency advisory, blocking');
});

test('a repository with no dependency files passes the dependency job with the note', () => {
  check('open source: no dependency files, blocking');
});

test('an ERROR-level Semgrep result blocks', () => {
  const d = check('open source: an ERROR-level Semgrep result, blocking');
  assert.equal(d.findings[0].severity, 'high');
});

test('a WARNING-level Semgrep result is recorded and does not block', () => {
  const d = check('open source: a WARNING-level Semgrep result, blocking');
  assert.equal(d.findings[0].severity, 'medium');
  assert.ok(d.notes.some((n) => /semgrep reported 1/.test(n)), JSON.stringify(d.notes));
});

// ---------- output that cannot be read ----------

test('malformed scanner output blocks in blocking mode', () => {
  check('open source: malformed osv-scanner output, blocking');
});

test('malformed scanner output is counted, and passes, in advisory mode', () => {
  check('open source: malformed osv-scanner output, advisory');
});

test('a scanner that crashed blocks', () => {
  check('open source: osv-scanner crashed, blocking');
  check('open source: Semgrep crashed, blocking');
});

test('a scanner job that did not run blocks', () => {
  check('open source: the gitleaks job did not run, blocking');
});

test('a malformed accepted list blocks', () => {
  check('open source: a malformed accepted list, blocking');
});

// ---------- the mode ----------

test('an unset mode reads as blocking and says so', () => {
  const d = check('unset mode: a runtime high added');
  assert.equal(annotations(d)[0], '::warning title=security-scan::SECURITY_SCAN_MODE is unset; read as blocking');
});

test('an unknown mode reads as blocking and says so', () => {
  check('unknown mode: a runtime high added');
});

test('the switches read as written', () => {
  assert.deepEqual(readMode('advisory'), { mode: 'advisory', note: null });
  assert.deepEqual(readMode(' Blocking '), { mode: 'blocking', note: null });
  assert.equal(readMode('').mode, 'blocking');
  assert.equal(readNative('true').native, true);
  assert.equal(readNative('TRUE').native, true);
  assert.equal(readNative(undefined).native, false);
  assert.equal(readNative('false').native, false);
  const odd = readNative('yes');
  assert.equal(odd.native, false);
  assert.match(odd.note, /open-source scanners run/);
});

test('severity is one scale for every scanner', () => {
  assert.equal(fromCvss('9.0'), 'critical');
  assert.equal(fromCvss('8.9'), 'high');
  assert.equal(fromCvss('7.0'), 'high');
  assert.equal(fromCvss('6.9'), 'medium');
  assert.equal(fromCvss('3.9'), 'low');
  assert.equal(fromCvss(''), null);
  assert.equal(fromWord('MODERATE'), 'medium');
  assert.equal(fromWord('ERROR'), 'high');
  assert.equal(fromWord('WARNING'), 'medium');
  assert.equal(fromWord('INFO'), 'low');
  assert.equal(fromWord('odd'), null);
});

test('the dependency review is handed only accepted advisories that name a record', () => {
  const accepted = readAccepted(JSON.stringify([
    ...fixture.accepted['parser-advisory'],
    ...fixture.accepted['parser-advisory-no-record'].map((e) => ({ ...e, id: 'GHSA-c3pq-7v5r-hj8x' })),
    ...fixture.accepted['utils-advisory-by-alias'],
  ]));
  assert.equal(allowGhsas(accepted), 'GHSA-2m4c-9fq8-wx7h');
  assert.equal(allowGhsas(readAccepted(null)), '');
});

// ---------- unknown scope, Semgrep acceptance, advisory failures ----------

test('a dependency of unknown scope blocks like runtime', () => {
  const d = check('native: an unknown-scope high added, blocking');
  assert.equal(d.findings[0].scope, 'unknown');
  check('native: an unknown-scope high added, advisory');
  assert.equal(blocks({ isNew: true, severity: 'high', scope: 'unknown', accepted: null }), true, MISSED);
  assert.equal(blocks({ isNew: true, severity: 'critical', scope: 'runtime', accepted: null }), true, MISSED);
  assert.equal(blocks({ isNew: true, severity: 'critical', scope: 'development', accepted: null }), false, WRONGLY_BLOCKED);
});

test('a Semgrep entry naming only a rule id accepts nothing, and the summary says so', () => {
  const d = check('open source: a Semgrep result accepted by its bare rule id, blocking');
  assert.deepEqual(d.findings[0].ids, ['javascript.lang.security.audit.eval-detected:src/run.js']);
  assert.match(summary(d), /names a Semgrep rule without a path/);
  check('open source: a Semgrep result accepted by rule and path, blocking');
});

test('in advisory mode a scanner job that failed counts as one would-block item and passes', () => {
  check('native: the dependency review refused, advisory');
  check('open source: the osv-scanner job failed, advisory');
  const d = check('open source: every scanner job failed, advisory');
  assert.match(summary(d), /each counts as one would-block item/);
  assert.equal(annotations(d).at(-1), '::warning title=security-scan::security-scan would block: 3');
});

// ---------- the workflow, as GitHub runs it ----------

const WORKFLOW = path.join(here, '..', '.github', 'workflows', 'security-scan.yml');
const workflowLines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
const SCANNER_JOBS = ['dependency-review', 'osv-scanner', 'gitleaks', 'semgrep'];
const OPEN_SOURCE_JOBS = ['osv-scanner', 'gitleaks', 'semgrep'];
const QUIETING_FILES = ['.semgrepignore', '.gitleaksignore', '.gitleaks.toml', 'osv-scanner.toml'];
const STRIP_STEP = 'Remove the files a change could quiet the scan with';
// Said only when a check goes red on a change that quieted the scan from inside itself.
const QUIETED = 'a change quieted the scan from inside itself';
// Said only when a check goes red on an advisory run a scanner job could turn red.
const ADVISORY_RED = 'in advisory mode a scanner job can still turn the workflow red';

function jobLines(name) {
  const start = workflowLines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `the workflow has no job "${name}"`);
  let end = start + 1;
  while (end < workflowLines.length && !/^ {0,2}\S/.test(workflowLines[end])) end++;
  return workflowLines.slice(start, end);
}

function jobKey(name, key) {
  const line = jobLines(name).find((l) => l.startsWith(`    ${key}:`));
  return line === undefined ? undefined : line.slice(`    ${key}:`.length).trim();
}

function runOf(lines) {
  const i = lines.findIndex((l) => /^ {8}run: \|\s*$/.test(l));
  if (i < 0) {
    const one = lines.find((l) => /^ {8}run: /.test(l));
    return one === undefined ? null : one.replace(/^ {8}run: /, '');
  }
  const body = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() === '') { body.push(''); continue; }
    if (!l.startsWith(' '.repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join('\n');
}

function steps(name) {
  const out = [];
  let cur = null;
  for (const line of jobLines(name)) {
    const m = line.match(/^ {6}- name: (.*)$/);
    if (m) { cur = { name: m[1].trim(), lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out.map((s) => ({ name: s.name, text: s.lines.join('\n'), run: runOf(s.lines) }));
}

function scanStepIndex(list) {
  return list.findIndex((s) => s.run && /"\$RUNNER_TEMP\/osv-scanner" scan|"\$RUNNER_TEMP\/gitleaks" git|semgrep scan/.test(s.run));
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-scan-workflow-'));
  const runner = path.join(dir, 'runner-temp');
  fs.mkdirSync(runner);
  const gitConfig = path.join(dir, 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  const env = {
    PATH: process.env.PATH, HOME: dir, RUNNER_TEMP: runner,
    GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1',
  };
  return { dir, runner, env };
}

function bash(script, box, extraEnv = {}) {
  const r = spawnSync('bash', ['-c', script], { cwd: box.dir, env: { ...box.env, ...extraEnv }, encoding: 'utf8' });
  assert.equal(r.status, 0, `the step ended with exit ${r.status}: ${r.stderr}${r.stdout}`);
  return r;
}

function git(box, ...args) {
  const r = spawnSync('git', ['-C', path.join(box.dir, 'target'), '-c', 'user.name=Mira Okafor',
    '-c', 'user.email=mira@harbor-lane.example', '-c', 'commit.gpgsign=false', ...args],
  { env: box.env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root, rel, text = 'x\n') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function filesUnder(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && e.name === '.git') continue;
      if (e.isDirectory()) walk(p); else out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}

// A change that brings its own ignore files at the root and deeper down, one as a link.
function changeWithIgnoreFiles(box) {
  const target = path.join(box.dir, 'target');
  write(target, 'src/app.js', 'run(input)\n');
  write(target, 'keep.txt', 'kept\n');
  for (const f of QUIETING_FILES) write(target, f, '*\n');
  write(target, 'services/harbor-lane/osv-scanner.toml', '[[IgnoredVulns]]\nid = "GHSA-c3pq-7v5r-hj8x"\n');
  write(target, 'services/harbor-lane/.semgrepignore', 'src/\n');
  fs.symlinkSync('../keep.txt', path.join(target, 'services', '.gitleaksignore'));
  return target;
}

test('every open-source scanner job removes the change\'s own ignore files before it scans', () => {
  let reference = null;
  for (const job of OPEN_SOURCE_JOBS) {
    const list = steps(job);
    const strip = list.findIndex((s) => s.name === STRIP_STEP);
    assert.ok(strip >= 0, `${QUIETED}: the job ${job} has no step "${STRIP_STEP}"`);
    const scan = scanStepIndex(list);
    assert.ok(scan >= 0, `the job ${job} has no scan step`);
    assert.ok(strip < scan, `${QUIETED}: the job ${job} scans before it removes the ignore files`);
    if (reference === null) reference = list[strip].run;
    assert.equal(list[strip].run, reference, `the job ${job} removes different files from the others`);

    const box = sandbox();
    try {
      const target = changeWithIgnoreFiles(box);
      write(target, '.git/.gitleaksignore', 'kept inside .git\n');
      const r = bash(list[strip].run, box);
      const left = filesUnder(target).filter((f) => QUIETING_FILES.includes(path.basename(f)));
      assert.deepEqual(left, [], `${QUIETED}: the job ${job} left ${left.join(', ')} in the checkout`);
      assert.deepEqual(filesUnder(target), ['keep.txt', 'src/app.js'], `the job ${job} removed more than the ignore files`);
      assert.ok(fs.existsSync(path.join(target, '.git', '.gitleaksignore')), `the job ${job} reached into .git`);
      assert.match(r.stdout, /Removed before scanning/);
      assert.ok(r.stdout.split('\n').every((l) => !l.startsWith('::')), 'a removed file name became a workflow command');
    } finally {
      fs.rmSync(box.dir, { recursive: true, force: true });
    }
  }
});

test('in the Semgrep job the removal is committed, so the baseline scan reads a clean tree and the change', () => {
  const list = steps('semgrep');
  const strip = list.find((s) => s.name === STRIP_STEP);
  assert.ok(strip, `${QUIETED}: the Semgrep job has no step "${STRIP_STEP}"`);
  const scan = scanStepIndex(list);
  const commit = list.findIndex((s) => s.run && /commit/.test(s.run) && /status --porcelain/.test(s.run));
  assert.ok(commit >= 0 && commit < scan, 'the Semgrep job does not commit the removal before it scans');
  const box = sandbox();
  try {
    const target = path.join(box.dir, 'target');
    write(target, 'src/app.js', 'run(input)\n');
    write(target, '.semgrepignore', 'vendor/\n');
    git(box, 'init', '--quiet');
    git(box, 'add', '--all');
    git(box, 'commit', '--quiet', '--message', 'base');
    const base = git(box, 'rev-parse', 'HEAD');
    changeWithIgnoreFiles(box);
    write(target, 'src/new.js', 'eval(input)\n');
    git(box, 'add', '--all');
    git(box, 'commit', '--quiet', '--message', 'the change');
    const change = git(box, 'rev-parse', 'HEAD');
    bash(strip.run, box);
    bash(list[commit].run, box);
    assert.equal(git(box, 'status', '--porcelain', '--untracked-files=no'), '', 'the tree Semgrep reads is not clean');
    const tracked = git(box, 'ls-files').split('\n');
    const left = tracked.filter((f) => QUIETING_FILES.includes(path.basename(f)));
    assert.deepEqual(left, [], `${QUIETED}: the commit Semgrep scans still holds ${left.join(', ')}`);
    assert.equal(git(box, 'rev-parse', 'HEAD~1'), change, 'the removal is not committed on top of the change');
    const changed = git(box, 'diff', '--name-only', base, 'HEAD').split('\n');
    assert.ok(changed.includes('src/new.js'), 'the code the change adds is no longer between the base and the scanned commit');
    // Run again on a clean tree: nothing to commit, and the step still succeeds.
    bash(list[commit].run, box);
    assert.equal(git(box, 'rev-parse', 'HEAD~1'), change, 'a clean tree gained a second commit');
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('osv-scanner reads an empty config the workflow writes and scans ignored lockfiles, at the change and at its base', () => {
  const list = steps('osv-scanner');
  const scan = list[scanStepIndex(list)];
  assert.ok(scan, 'the osv-scanner job has no scan step');
  const box = sandbox();
  try {
    const target = path.join(box.dir, 'target');
    write(target, 'package-lock.json', '{}\n');
    git(box, 'init', '--quiet');
    git(box, 'add', '--all');
    git(box, 'commit', '--quiet', '--message', 'base');
    const base = git(box, 'rev-parse', 'HEAD');
    write(target, 'osv-scanner.toml', '[[IgnoredVulns]]\nid = "GHSA-c3pq-7v5r-hj8x"\n');
    write(target, '.gitignore', 'package-lock.json\n');
    git(box, 'add', '--all');
    git(box, 'commit', '--quiet', '--message', 'the change');
    const fake = path.join(box.runner, 'osv-scanner');
    fs.writeFileSync(fake, [
      '#!/bin/sh',
      'cfg=""; prev=""',
      'for a in "$@"; do if [ "$prev" = "--config" ]; then cfg="$a"; fi; prev="$a"; done',
      'size=missing',
      'if [ -n "$cfg" ] && [ -f "$cfg" ]; then size=$(wc -c < "$cfg" | tr -d " "); fi',
      'printf "%s|config=%s|bytes=%s\\n" "$*" "$cfg" "$size" >> "$RUNNER_TEMP/osv-calls"',
      'echo \'{"results":[]}\'',
      '',
    ].join('\n'));
    fs.chmodSync(fake, 0o755);
    bash(scan.run, box, { BASE_SHA: base });
    const calls = fs.readFileSync(path.join(box.runner, 'osv-calls'), 'utf8').trim().split('\n');
    assert.equal(calls.length, 2, `osv-scanner ran ${calls.length} time(s), not at the change and at its base`);
    for (const call of calls) {
      const [argv, cfg, bytes] = call.split('|');
      assert.match(` ${argv} `, / --no-ignore /, `${QUIETED}: osv-scanner skips a lockfile .gitignore lists: ${argv}`);
      assert.equal(bytes, 'bytes=0', `${QUIETED}: osv-scanner reads a config that is not the workflow's empty one: ${call}`);
      const file = cfg.slice('config='.length);
      assert.ok(file.startsWith(box.runner) && !file.startsWith(path.join(box.runner, 'base')),
        `${QUIETED}: osv-scanner's config comes from a checkout: ${file}`);
    }
    assert.equal(fs.readFileSync(path.join(box.dir, 'scan', 'osv-head.exit'), 'utf8').trim(), '0');
    assert.equal(fs.readFileSync(path.join(box.dir, 'scan', 'osv-base.exit'), 'utf8').trim(), '0');
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('the dependency review fails on runtime and unknown scopes, never development', () => {
  const line = jobLines('dependency-review').find((l) => /^\s+fail-on-scopes:/.test(l));
  assert.ok(line, 'the dependency review names no fail-on-scopes');
  const scopes = line.split(':')[1].split(',').map((x) => x.trim());
  assert.ok(scopes.includes('runtime'), `${MISSED}: fail-on-scopes leaves out runtime`);
  assert.ok(scopes.includes('unknown'), `${MISSED}: fail-on-scopes leaves out unknown`);
  assert.ok(!scopes.includes('development'), `${WRONGLY_BLOCKED}: fail-on-scopes includes development`);
});

test('in advisory mode only the security-scan job decides the workflow\'s result', () => {
  for (const job of SCANNER_JOBS) {
    assert.equal(jobKey(job, 'continue-on-error'), "${{ needs.plan.outputs.mode == 'advisory' }}",
      `${ADVISORY_RED}: the job ${job}`);
  }
  assert.equal(jobKey('plan', 'continue-on-error'), "${{ vars.SECURITY_SCAN_MODE == 'advisory' }}",
    `${ADVISORY_RED}: the job plan`);
  assert.equal(jobKey('security-scan', 'continue-on-error'), undefined,
    'the security-scan job itself is continue-on-error, so it never fails the run');
  assert.match(jobKey('security-scan', 'if'), /!cancelled\(\)/, 'the security-scan job does not run after a scanner job fails');
  for (const job of SCANNER_JOBS) {
    const upload = steps(job).find((s) => /upload-artifact/.test(s.text));
    assert.ok(upload && /if: \$\{\{ !cancelled\(\) \}\}/.test(upload.text), `the job ${job} drops its output when a step fails`);
  }
});

// ---------- the command, as the workflow runs it ----------

function settle(mode, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-scan-test-'));
  try {
    for (const [name, key] of Object.entries(files)) {
      const o = outputOf(key);
      fs.writeFileSync(path.join(dir, `${name}.exit`), `${o.exit}\n`);
      fs.writeFileSync(path.join(dir, `${name}.out`), o.text ?? '');
    }
    const summaryFile = path.join(dir, 'summary.md');
    const env = { ...process.env, SECURITY_SCAN_MODE: mode, SECURITY_SCAN_NATIVE: 'true', GITHUB_STEP_SUMMARY: summaryFile };
    if (mode === undefined) delete env.SECURITY_SCAN_MODE;
    const r = spawnSync(process.execPath, [DECIDE, 'settle', '--outputs', dir, '--accepted', path.join(dir, 'absent.json')],
      { env, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, summary: fs.readFileSync(summaryFile, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the settle command fails the job on a critical in blocking mode and passes it in advisory', () => {
  const blocking = settle('blocking', { 'dependency-review': 'dr-runtime-critical' });
  assert.equal(blocking.status, 1, `${CRITICAL_PASSED}: ${blocking.stdout}`);
  assert.match(blocking.summary, /okafor-template/);
  const advisory = settle('advisory', { 'dependency-review': 'dr-runtime-critical' });
  assert.equal(advisory.status, 0, `${WRONGLY_BLOCKED}: ${advisory.stdout}`);
  assert.equal(advisory.stdout.trim().split('\n').at(-1), '::warning title=security-scan::security-scan would block: 1');
});
