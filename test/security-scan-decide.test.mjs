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
  requiredOutputs, fromCvss, fromWord, OPEN_SOURCE_OUTPUTS,
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
