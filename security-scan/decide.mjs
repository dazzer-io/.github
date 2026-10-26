#!/usr/bin/env node
// Security scan: settles the final job "security-scan" of .github/workflows/security-scan.yml
// from the scanners' own outputs (security-scan/README.md).
//
// Two branches, chosen by the calling repository's variable SECURITY_SCAN_NATIVE:
//   - native ("true"): GitHub's dependency review is the one scanner here; code scanning is
//     CodeQL default setup, required by the organisation ruleset, and secrets are push
//     protection's, so no open-source scanner runs and none is required;
//   - open source (unset, "false" or anything else): osv-scanner over the lockfiles at the
//     change and at its base (only what the change adds counts), with the lockfiles the change
//     deletes or renames listed beside it, so no change hides its dependencies by removing
//     them; gitleaks over the pull request's commits; and Semgrep's open-source engine against
//     the base commit.
//
// The mode is the variable SECURITY_SCAN_MODE, read on every run: "advisory" records every
// finding and passes, ending with the annotation "security-scan would block: N"; "blocking"
// fails on a critical or high finding the change brings in, from any dependency not marked
// development, that the calling repository's .github/security-accepted.json does not accept. Unset or anything else reads
// as blocking and says so. A scanner output that is missing or cannot be read blocks the
// same way a finding does, and in advisory mode counts as one would-block item: there every
// scanner job runs continue-on-error, so this job alone decides the workflow's result.
//
// The pure part is exported for the tests; main() reads the files the workflow wrote.
// Nothing here names an organisation, repository or company.

import { pathToFileURL } from 'node:url';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
// The severities that block in blocking mode.
export const BLOCKING_SEVERITIES = new Set(['critical', 'high']);
export const MODES = ['advisory', 'blocking'];
export const RECORD_PREFIX = 'records/risk-acceptance/';
export const NATIVE_OUTPUTS = ['dependency-review'];
export const OPEN_SOURCE_OUTPUTS = ['osv-head', 'osv-base', 'osv-removed', 'gitleaks', 'semgrep'];
export const LOCKFILE_REMOVED = 'lockfile-removed:';
export const EVERY_DEPENDENCY_FILE_REMOVED = 'osv-scanner: the change removes every dependency file its base had';

// The lockfile and manifest names osv-scanner reads its packages from. A file the change deletes
// or renames with one of these names leaves its dependencies unscanned at the change.
export const LOCKFILE_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'deno.lock',
  'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'gems.locked', 'go.mod', 'mix.lock',
  'poetry.lock', 'Pipfile.lock', 'pdm.lock', 'uv.lock', 'pylock.toml', 'pubspec.lock', 'renv.lock',
  'packages.lock.json', 'packages.config', 'conan.lock', 'gradle.lockfile', 'buildscript-gradle.lockfile',
  'verification-metadata.xml', 'pom.xml', 'Podfile.lock', 'Package.resolved', 'stack.yaml.lock',
  'cabal.project.freeze',
]);

export function isLockfile(file) {
  const name = String(file).split('/').pop();
  return LOCKFILE_NAMES.has(name) || /^requirements.*\.txt$/.test(name);
}
export const ANNOTATION_TITLE = 'security-scan';

// ---------- the switches ----------

export function readMode(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { mode: 'blocking', note: 'SECURITY_SCAN_MODE is unset; read as blocking' };
  }
  const v = String(raw).trim().toLowerCase();
  if (MODES.includes(v)) return { mode: v, note: null };
  return {
    mode: 'blocking',
    note: `SECURITY_SCAN_MODE is "${String(raw).slice(0, 40)}", which is neither advisory nor blocking; read as blocking`,
  };
}

export function readNative(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { native: false, note: null };
  const v = String(raw).trim().toLowerCase();
  if (v === 'true') return { native: true, note: null };
  if (v === 'false') return { native: false, note: null };
  return {
    native: false,
    note: `SECURITY_SCAN_NATIVE is "${String(raw).slice(0, 40)}", which is neither true nor false; the open-source scanners run`,
  };
}

export function requiredOutputs(native) {
  return native ? [...NATIVE_OUTPUTS] : [...OPEN_SOURCE_OUTPUTS];
}

// ---------- the accepted list (.github/security-accepted.json at the change's head) ----------

// text: the file's content, or null when the file is absent.
// Returns { entries: [{ id, record }], notes: [], error: null | string }.
export function readAccepted(text) {
  if (text === null || text === undefined) return { entries: [], notes: [], error: null };
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    return { entries: [], notes: [], error: `.github/security-accepted.json is not JSON (${e.message})` };
  }
  if (!Array.isArray(parsed)) {
    return { entries: [], notes: [], error: '.github/security-accepted.json is not a list of { id, record } entries' };
  }
  const entries = [];
  const notes = [];
  parsed.forEach((entry, i) => {
    const id = entry && typeof entry.id === 'string' ? entry.id.trim() : '';
    const record = entry && typeof entry.record === 'string' ? entry.record.trim() : '';
    if (!id) { notes.push(`accepted entry ${i + 1} names no finding id; ignored`); return; }
    if (!record.startsWith(RECORD_PREFIX) || !record.endsWith('.md')) {
      notes.push(`accepted entry "${id}" names no risk-acceptance record under ${RECORD_PREFIX}; not accepted`);
      return;
    }
    entries.push({ id, record });
  });
  return { entries, notes, error: null };
}

const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/i;

// The comma list handed to the dependency-review action's allow-ghsas input.
export function allowGhsas(accepted) {
  return (accepted.entries || []).map((e) => e.id).filter((id) => GHSA.test(id)).join(',');
}

function acceptedRecord(accepted, ids) {
  for (const entry of accepted.entries || []) {
    if (ids.includes(entry.id)) return entry.record;
  }
  return null;
}

// ---------- severity: one scale for every scanner ----------

export function fromCvss(score) {
  const n = Number(score);
  if (score === '' || score === null || score === undefined || !Number.isFinite(n)) return null;
  if (n >= 9.0) return 'critical';
  if (n >= 7.0) return 'high';
  if (n >= 4.0) return 'medium';
  return 'low';
}

const WORDS = {
  critical: 'critical', high: 'high', moderate: 'medium', medium: 'medium', low: 'low',
  error: 'high', warning: 'medium', info: 'low',
};
export function fromWord(word) {
  if (typeof word !== 'string') return null;
  return WORDS[word.trim().toLowerCase()] || null;
}

// ---------- each scanner's output read as findings ----------
// output: { exit: <exit code or step outcome as text>, text: <what the scanner wrote> },
// or undefined when the workflow wrote nothing for it.
// A finding: { scanner, id, ids, severity, scope, where, words, isNew, note }.
// Each reader returns { findings, notes } or { error }.

function parseJson(name, text) {
  if (typeof text !== 'string' || text.trim() === '') return { error: `${name} wrote no output` };
  try { return { value: JSON.parse(text) }; } catch (e) {
    return { error: `${name} output is not JSON (${e.message})` };
  }
}

// GitHub's dependency-review action: its "vulnerable-changes" output and the action step's
// outcome. Run with fail-on-scopes runtime, unknown, the action already leaves out development
// changes and accepted advisories, and, in blocking mode, anything below high; this reads
// scope, severity and acceptance again, so the decision never rests on the action's filters.
// A scope the action calls unknown is kept as written and blocks like runtime.
// An empty output from a successful step is the action's "no dependency changes".
export function readDependencyReview(output) {
  if (!output) return { error: 'dependency review wrote no output' };
  const outcome = String(output.exit ?? '').trim();
  if (outcome === 'success' && (output.text === undefined || String(output.text).trim() === '')) {
    return { findings: [], notes: ['dependency review: no dependency changes'] };
  }
  const p = parseJson('dependency review', output.text);
  if (p.error) return { error: outcome && outcome !== 'success' ? `${p.error}; the action ended ${outcome}` : p.error };
  if (!Array.isArray(p.value)) return { error: 'dependency review output is not a list of changes' };
  const findings = [];
  for (const change of p.value) {
    if (!change || typeof change !== 'object') return { error: 'dependency review output holds an entry that is not a change' };
    if (change.change_type !== 'added') continue;
    const vulns = change.vulnerabilities;
    if (vulns === undefined || vulns === null) continue;
    if (!Array.isArray(vulns)) return { error: `dependency review change ${change.name} has unreadable vulnerabilities` };
    // As the action reads it: a change with no scope is runtime.
    const scope = change.scope || 'runtime';
    for (const v of vulns) {
      const id = v && typeof v.advisory_ghsa_id === 'string' ? v.advisory_ghsa_id : '';
      if (!id) return { error: `dependency review change ${change.name} has a vulnerability with no advisory id` };
      const sev = fromWord(v.severity);
      findings.push({
        scanner: 'dependency review', id, ids: [id],
        severity: sev || 'high', scope,
        where: `${change.manifest || '?'}: ${change.name}@${change.version}`,
        words: v.advisory_summary || '',
        isNew: true,
        note: sev ? null : `severity "${v.severity}" unknown; read as high`,
      });
    }
  }
  return { findings, notes: [] };
}

function osvFindings(name, output) {
  if (!output) return { error: `${name} wrote no output` };
  const exit = String(output.exit ?? '').trim();
  if (exit === '128') return { none: true, findings: [] };
  if (exit !== '0' && exit !== '1') {
    return { error: `${name} ended with exit ${exit || 'unknown'}, not a finished scan` };
  }
  const p = parseJson(name, output.text);
  if (p.error) return { error: p.error };
  if (!p.value || !Array.isArray(p.value.results)) return { error: `${name} output has no results list` };
  const findings = [];
  for (const source of p.value.results) {
    for (const pkg of (source && source.packages) || []) {
      const info = (pkg && pkg.package) || {};
      const groups = Array.isArray(pkg.dependency_groups) ? pkg.dependency_groups : [];
      const scope = groups.length > 0 && groups.every((g) => /^dev/i.test(String(g))) ? 'development' : 'runtime';
      const vulns = Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities : [];
      const byId = new Map(vulns.map((v) => [v && v.id, v]));
      const pkgGroups = Array.isArray(pkg.groups) && pkg.groups.length > 0
        ? pkg.groups
        : vulns.map((v) => ({ ids: [v.id], aliases: v.aliases || [], max_severity: '' }));
      for (const g of pkgGroups) {
        const ids = [...new Set([...(g.ids || []), ...(g.aliases || [])])].filter(Boolean);
        if (ids.length === 0) return { error: `${name} output holds a vulnerability with no id` };
        const first = byId.get((g.ids || [])[0]) || {};
        let sev = fromCvss(g.max_severity);
        let note = null;
        if (!sev) {
          const word = first.database_specific && first.database_specific.severity;
          sev = fromWord(word);
          if (!sev) { sev = 'high'; note = 'no score and no severity word; read as high'; }
        }
        findings.push({
          scanner: 'osv-scanner', id: (g.ids || ids)[0], ids, severity: sev, scope,
          where: `${info.ecosystem || '?'}: ${info.name || '?'}@${info.version || '?'}`,
          words: first.summary || first.details || '',
          key: `${info.ecosystem}|${info.name}`,
          note,
        });
      }
    }
  }
  return { findings };
}

// The files the change deletes, renames counted as deletions: the output of
// git diff --name-only -z --no-renames --diff-filter=D <base> HEAD, and git's exit code.
// Each lockfile among them is one finding: high, runtime, new, accepted only through the
// accepted list as lockfile-removed:<path>, so a change that retires a lockfile on purpose
// says so in a reviewed record.
export function readRemovedLockfiles(output) {
  const name = 'osv-scanner (removed lockfiles)';
  if (!output) return { error: `${name} wrote no output` };
  const exit = String(output.exit ?? '').trim();
  if (exit !== '0') return { error: `${name}: git diff ended with exit ${exit || 'unknown'}, so the lockfiles the change removes are unknown` };
  const files = String(output.text ?? '').split('\0').filter((f) => f !== '');
  const findings = files.filter(isLockfile).map((file) => {
    const id = `${LOCKFILE_REMOVED}${file}`;
    return {
      scanner: 'osv-scanner', id, ids: [id], severity: 'high', scope: 'runtime',
      where: file,
      words: 'the change deletes or renames this lockfile, so the dependencies it pinned are no longer scanned',
      isNew: true, note: null,
    };
  });
  return { findings };
}

// osv-scanner at the change (head) and at its base: a finding counts as the change's own
// only when the base does not already carry that package with that vulnerability.
// Exit 128 is osv-scanner's "no packages found": at the change it passes only when the base
// had none either; when the base's scan finished (exit 0 or 1) the change removed them all.
export function readOsv(head, base, removed) {
  const h = osvFindings('osv-scanner (change)', head);
  if (h.error) return { error: h.error };
  const r = readRemovedLockfiles(removed);
  if (r.error) return { error: r.error };
  const b = osvFindings('osv-scanner (base)', base);
  if (b.error) return { error: b.error };
  if (h.none) {
    if (!b.none) return { error: EVERY_DEPENDENCY_FILE_REMOVED };
    return { findings: r.findings, notes: ['osv-scanner: no dependency files'] };
  }
  const onBase = new Set();
  for (const f of b.findings) for (const id of f.ids) onBase.add(`${f.key}|${id}`);
  const findings = h.findings.map(({ key, ...f }) => ({
    ...f, isNew: !f.ids.some((id) => onBase.has(`${key}|${id}`)),
  }));
  return { findings: [...findings, ...r.findings], notes: [] };
}

// gitleaks over the pull request's commits, run with --redact and --exit-code 2:
// exit 0 found nothing, 2 found leaks, anything else did not finish. Every finding is a
// secret in the code, so it is critical; the secret itself is never read here.
export function readGitleaks(output) {
  if (!output) return { error: 'gitleaks wrote no output' };
  const exit = String(output.exit ?? '').trim();
  if (exit !== '0' && exit !== '2') return { error: `gitleaks ended with exit ${exit || 'unknown'}, not a finished scan` };
  const p = parseJson('gitleaks', output.text);
  if (p.error) return { error: p.error };
  if (!Array.isArray(p.value)) return { error: 'gitleaks output is not a list of findings' };
  if (exit === '2' && p.value.length === 0) return { error: 'gitleaks said it found leaks but listed none' };
  const findings = [];
  for (const leak of p.value) {
    if (!leak || typeof leak.RuleID !== 'string') return { error: 'gitleaks output holds a finding with no rule' };
    const fp = typeof leak.Fingerprint === 'string' && leak.Fingerprint
      ? leak.Fingerprint : `${leak.Commit}:${leak.File}:${leak.RuleID}:${leak.StartLine}`;
    findings.push({
      scanner: 'gitleaks', id: fp, ids: [fp], severity: 'critical', scope: 'runtime',
      where: `${leak.File}:${leak.StartLine} in ${String(leak.Commit || '').slice(0, 12)}`,
      words: `${leak.RuleID}: ${leak.Description || ''}`.trim(),
      isNew: true, note: null,
    });
  }
  return { findings, notes: [] };
}

// Semgrep's open-source engine with --baseline-commit (only results the change adds) and
// --json, without --error: exit 0 is a finished scan, anything else is not.
export function readSemgrep(output) {
  if (!output) return { error: 'semgrep wrote no output' };
  const exit = String(output.exit ?? '').trim();
  if (exit !== '0') return { error: `semgrep ended with exit ${exit || 'unknown'}, not a finished scan` };
  const p = parseJson('semgrep', output.text);
  if (p.error) return { error: p.error };
  if (!p.value || !Array.isArray(p.value.results)) return { error: 'semgrep output has no results list' };
  const findings = [];
  for (const r of p.value.results) {
    if (!r || typeof r.check_id !== 'string' || typeof r.path !== 'string') {
      return { error: 'semgrep output holds a result with no rule or path' };
    }
    const word = r.extra && r.extra.severity;
    const sev = fromWord(word);
    // A Semgrep finding is accepted only as <rule id>:<path>; a bare rule id accepts nothing,
    // so one entry can never accept a rule on every path.
    const id = `${r.check_id}:${r.path}`;
    findings.push({
      scanner: 'semgrep', id, ids: [id], rule: r.check_id, severity: sev || 'high', scope: 'runtime',
      where: `${r.path}:${(r.start && r.start.line) || '?'}`,
      words: (r.extra && r.extra.message) || r.check_id,
      isNew: true, note: sev ? null : `severity "${word}" unknown; read as high`,
    });
  }
  const notes = Array.isArray(p.value.errors) && p.value.errors.length > 0
    ? [`semgrep reported ${p.value.errors.length} file or rule error(s) it skipped past`] : [];
  return { findings, notes };
}

// ---------- the decision ----------

// A dependency counts as runtime unless its scanner says development: an unknown scope blocks.
export function blocks(f) {
  return f.isNew && BLOCKING_SEVERITIES.has(f.severity) && f.scope !== 'development' && !f.accepted;
}

// input: { mode, native, accepted: <file text or null>, outputs: { <name>: { exit, text } } }
export function decide(input) {
  const { mode, note: modeNote } = readMode(input.mode);
  const { native, note: nativeNote } = readNative(input.native);
  const accepted = readAccepted(input.accepted === undefined ? null : input.accepted);
  const outputs = input.outputs || {};
  const notes = [modeNote, nativeNote, ...accepted.notes].filter(Boolean);
  const errors = accepted.error ? [accepted.error] : [];
  const reads = native
    ? [readDependencyReview(outputs['dependency-review'])]
    : [readOsv(outputs['osv-head'], outputs['osv-base'], outputs['osv-removed']), readGitleaks(outputs.gitleaks), readSemgrep(outputs.semgrep)];
  const findings = [];
  for (const r of reads) {
    if (r.error) { errors.push(r.error); continue; }
    notes.push(...(r.notes || []));
    for (const f of r.findings) {
      const record = acceptedRecord(accepted, f.ids);
      findings.push({ ...f, accepted: record });
    }
  }
  for (const f of findings) f.blocks = blocks(f);
  const acceptedIds = new Set((accepted.entries || []).map((e) => e.id));
  const bare = new Set(findings.filter((f) => f.rule && acceptedIds.has(f.rule)).map((f) => f.rule));
  for (const rule of bare) {
    notes.push(`accepted entry "${rule}" names a Semgrep rule without a path; a Semgrep entry must name <rule id>:<path>, so it accepts nothing`);
  }
  const wouldBlock = findings.filter((f) => f.blocks).length + errors.length;
  const pass = mode === 'advisory' || wouldBlock === 0;
  const annotation = mode === 'advisory'
    ? `security-scan would block: ${wouldBlock}`
    : (wouldBlock === 0 ? 'security-scan passes: nothing blocks' : `security-scan blocks: ${wouldBlock}`);
  return {
    mode, native, branch: native ? 'native' : 'open source',
    required: requiredOutputs(native), notes, errors, findings, wouldBlock,
    result: pass ? 'pass' : 'fail', annotation,
  };
}

function cell(s) {
  return String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').slice(0, 300);
}

export function summary(d) {
  const lines = ['## Security scan', ''];
  lines.push(`Mode **${d.mode}**; branch **${d.branch}** (${d.native
    ? 'GitHub dependency review; CodeQL and push protection run on their own'
    : 'osv-scanner, gitleaks, Semgrep'}).`);
  for (const n of d.notes) lines.push(`- ${cell(n)}`);
  lines.push('');
  if (d.errors.length > 0) {
    lines.push(d.mode === 'advisory'
      ? '### Outputs that could not be read, or that hide what the change brings in (each counts as one would-block item)'
      : '### Outputs that could not be read, or that hide what the change brings in (each blocks like a finding)', '');
    for (const e of d.errors) lines.push(`- ${cell(e)}`);
    lines.push('');
  }
  if (d.findings.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push('| Scanner | Severity | Scope | New | Accepted | Id | Where | In the scanner\'s words | Blocks |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const f of d.findings) {
      lines.push(`| ${cell(f.scanner)} | ${cell(f.severity)}${f.note ? ` (${cell(f.note)})` : ''} | ${cell(f.scope)} | ${f.isNew ? 'yes' : 'no, on the base already'} | ${f.accepted ? cell(f.accepted) : 'no'} | ${cell(f.id)} | ${cell(f.where)} | ${cell(f.words)} | ${f.blocks ? 'yes' : 'no'} |`);
    }
  }
  lines.push('', `**${d.annotation}**`, '');
  return lines.join('\n');
}

// An annotation's message, escaped as GitHub's workflow commands read it.
export function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

// The lines the step prints for GitHub to read as annotations; the last is the verdict.
export function annotations(d) {
  const out = d.notes
    .filter((n) => /^SECURITY_SCAN_/.test(n))
    .map((n) => `::warning title=${ANNOTATION_TITLE}::${escapeData(n)}`);
  const level = d.mode === 'advisory' ? 'warning' : (d.result === 'fail' ? 'error' : 'notice');
  out.push(`::${level} title=${ANNOTATION_TITLE}::${d.annotation}`);
  return out;
}

// ---------- the command ----------

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function readOutputs(fs, path, dir) {
  const outputs = {};
  for (const name of [...NATIVE_OUTPUTS, ...OPEN_SOURCE_OUTPUTS]) {
    const exitFile = path.join(dir, `${name}.exit`);
    if (!fs.existsSync(exitFile)) continue;
    const outFile = path.join(dir, `${name}.out`);
    outputs[name] = {
      exit: fs.readFileSync(exitFile, 'utf8').trim(),
      text: fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '',
    };
  }
  return outputs;
}

function readOptional(fs, file) {
  return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

async function main() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const argv = process.argv.slice(2);
  const env = process.env;
  if (argv[0] === 'plan') {
    // Names the branch and the action's inputs for the scanner jobs.
    const { mode, note } = readMode(env.SECURITY_SCAN_MODE);
    const { native, note: nativeNote } = readNative(env.SECURITY_SCAN_NATIVE);
    const accepted = readAccepted(readOptional(fs, argValue(argv, 'accepted')));
    for (const n of [note, nativeNote, accepted.error, ...accepted.notes].filter(Boolean)) {
      console.log(`::warning title=${ANNOTATION_TITLE}::${escapeData(n)}`);
    }
    const lines = [`native=${native}`, `mode=${mode}`, `warn_only=${mode === 'advisory'}`, `allow_ghsas=${allowGhsas(accepted)}`];
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
    return 0;
  }
  if (argv[0] !== 'settle') {
    console.error('usage: decide.mjs plan [--accepted <file>] | settle --outputs <dir> [--accepted <file>]');
    return 2;
  }
  const dir = argValue(argv, 'outputs');
  const d = decide({
    mode: env.SECURITY_SCAN_MODE,
    native: env.SECURITY_SCAN_NATIVE,
    accepted: readOptional(fs, argValue(argv, 'accepted')),
    outputs: dir && fs.existsSync(dir) ? readOutputs(fs, path, dir) : {},
  });
  const text = summary(d);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.stdout.write(`${text}\n`);
  for (const line of annotations(d)) console.log(line);
  return d.result === 'pass' ? 0 : 1;
}

const invoked = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`::error title=${ANNOTATION_TITLE}::the security scan could not be settled: ${escapeData(err.message)}`);
    process.exitCode = 1;
  });
}
