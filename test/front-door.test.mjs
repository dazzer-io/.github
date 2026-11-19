// This repository is public: it is the organisation's profile, its community defaults and the
// shared checks other repositories call. These tests hold what a stranger reading it meets: every
// workflow grants its token nothing at the top and pins every action by its full commit id, the
// community files are present and say what they promise, and no document or comment carries an
// internal reference. Every failure starts "Could not find", and each test lists every miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { loadList, oneWay } from '../leak-check/hashes.mjs';
import { matcher } from '../leak-check/scan.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const at = (f) => join(ROOT, f);
const text = (f) => (existsSync(at(f)) ? readFileSync(at(f), 'utf8') : null);
const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/;

test('every workflow grants its token nothing at the top, each job names its own grant, and every action is pinned by its full commit id', () => {
  const dir = at('.github/workflows');
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const SHARED = ['codeql.yml', 'decide-tests.yml', 'engineer-review.yml', 'security-scan.yml'];
  assert.ok(SHARED.every((f) => files.includes(f)), `Could not find the shared workflows ${SHARED.join(', ')} in .github/workflows: ${JSON.stringify(files)} found`);
  const misses = [];
  for (const f of files) {
    const wf = parse(readFileSync(join(dir, f), 'utf8'));
    if (!isMap(wf.permissions) || Object.keys(wf.permissions).length) misses.push(`Could not find ${f} granting its token nothing at the top (permissions: {}): it reads ${JSON.stringify(wf.permissions ?? null)}`);
    for (const [id, job] of Object.entries(wf.jobs ?? {})) {
      if (!isMap(job.permissions)) misses.push(`Could not find ${f}'s job ${id} naming its own grant as a map: it reads ${JSON.stringify(job.permissions ?? null)}`);
      const uses = [job.uses, ...(job.steps ?? []).map((s) => s.uses)].filter((u) => typeof u === 'string');
      for (const u of uses) if (!u.startsWith('./') && !PINNED.test(u)) misses.push(`Could not find ${f}'s job ${id} pinning ${u} by its full commit id`);
    }
  }
  for (const u of ['dazzer-io/.github/leak-check@v1', 'dazzer-io/.github/.github/workflows/codeql.yml@main', 'actions/checkout@main', 'actions/checkout@3d3c42e']) {
    if (PINNED.test(u)) misses.push(`Could not find ${u} refused as not pinned by its full commit id`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('the community files are present and say what they promise: licence, security policy, contributing, issue forms, pull request template, owners, dependency updates and the profile', () => {
  const misses = [];
  const says = (f, words) => {
    const t = text(f);
    if (t === null) { misses.push(`Could not find ${f}`); return; }
    for (const w of words) if (!(w instanceof RegExp ? w.test(t) : t.includes(w))) misses.push(`Could not find ${f} saying ${w}`);
  };
  says('LICENSE', ['MIT License', 'Copyright (c) 2026 Dazzer', 'Permission is hereby granted, free of charge']);
  says('SECURITY.md', ['**Security** tab', '**Report a vulnerability**', /within 5 business days/i, /within 10 business days/i, /coordinated disclosure/i]);
  says('CONTRIBUTING.md', ['SECURITY.md', 'https://dazzer.io']);
  says('.github/pull_request_template.md', ['## What this changes']);
  says('.github/CODEOWNERS', [/^\* @ben-dazzer$/m]);
  says('profile/README.md', ['https://github.com/dazzer-io/dazzer-plugin', 'https://dazzer.io', /trademarks? of Dazzer/]);
  // GitHub's default labels; a form naming any other adds nothing in a repository without it.
  const LABELS = new Set(['bug', 'documentation', 'duplicate', 'enhancement', 'good first issue', 'help wanted', 'invalid', 'question', 'wontfix']);
  for (const f of ['.github/ISSUE_TEMPLATE/bug-report.yml', '.github/ISSUE_TEMPLATE/feature-request.yml']) {
    const t = text(f);
    if (t === null) { misses.push(`Could not find ${f}`); continue; }
    const form = parse(t);
    if (!form.name || !form.description || !Array.isArray(form.body) || !form.body.some((b) => b.validations?.required === true)) misses.push(`Could not find ${f} as an issue form with a name, a description and a required field`);
    for (const l of form.labels ?? []) if (!LABELS.has(l)) misses.push(`Could not find ${f}'s label ${l} among GitHub's default labels`);
  }
  const config = text('.github/ISSUE_TEMPLATE/config.yml');
  if (config === null) misses.push('Could not find .github/ISSUE_TEMPLATE/config.yml');
  else {
    const c = parse(config);
    const urls = (c.contact_links ?? []).map((l) => l.url);
    if (c.blank_issues_enabled !== false) misses.push(`Could not find blank issues turned off in config.yml: blank_issues_enabled reads ${JSON.stringify(c.blank_issues_enabled ?? null)}`);
    if (!urls.some((u) => /SECURITY\.md$|\/security\b/.test(u ?? ''))) misses.push(`Could not find config.yml sending security reports to the security policy: ${JSON.stringify(urls)}`);
    if (!urls.some((u) => u === 'https://dazzer.io')) misses.push(`Could not find config.yml sending questions to https://dazzer.io: ${JSON.stringify(urls)}`);
  }
  const deps = text('.github/dependabot.yml');
  if (deps === null) misses.push('Could not find .github/dependabot.yml');
  else {
    const d = parse(deps);
    const ecosystems = (d.updates ?? []).map((u) => u['package-ecosystem']);
    for (const e of ['github-actions', 'npm']) if (!ecosystems.includes(e)) misses.push(`Could not find dependabot.yml keeping ${e} current: it names ${JSON.stringify(ecosystems)}`);
    for (const u of d.updates ?? []) {
      if (!(u.cooldown?.['default-days'] > 0)) misses.push(`Could not find a cooldown on dependabot.yml's ${u['package-ecosystem']} updates`);
      if (!isMap(u.groups) || !Object.values(u.groups).some((g) => Array.isArray(g.patterns) && g.patterns.length)) misses.push(`Could not find dependabot.yml grouping its ${u['package-ecosystem']} updates`);
    }
  }
  assert.ok(!misses.length, misses.join('\n'));
});

// The checks that judge which machine a job runs on and that record test times are internal: they
// live in a private repository, and nothing here holds, names or calls them. A tracked file under
// either folder, their workflow or their tests, or a line naming one of their files, is refused.
const INTERNAL = ['machine' + '-rule', 'test' + '-times'];
const INTERNAL_FILE = new RegExp(`^(?:${INTERNAL.join('|')})/|^\\.github/workflows/(?:${INTERNAL.join('|')})\\.ya?ml$|^test/(?:fixtures/)?(?:${INTERNAL.join('|')})`);
const INTERNAL_NAME = new RegExp(`\\b(?:${INTERNAL.join('|')})(?:/|\\.ya?ml\\b|\\.test\\.mjs\\b)`);
const INTERNAL_FAULT = 'the fresh repository holds an internal check file';

test('no internal check is held, named or called: no folder, workflow or test of the machine line or the test times', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(files.includes('README.md'), `Could not find this repository's files as git sees them: ${files.length} read`);
  const misses = files.filter((f) => INTERNAL_FILE.test(f)).map((f) => `Could not find this repository free of ${f}: ${INTERNAL_FAULT}`);
  for (const dir of INTERNAL) if (existsSync(at(dir))) misses.push(`Could not find this repository free of the folder ${dir}/: ${INTERNAL_FAULT}`);
  for (const f of files) {
    const t = text(f);
    if (t === null || f.startsWith('test/fixtures/')) continue;
    t.split('\n').forEach((l, i) => { if (INTERNAL_NAME.test(l)) misses.push(`Could not find ${f}:${i + 1} free of a name of an internal check file: ${l.trim().slice(0, 160)}`); });
  }
  // The rule refuses what it is for and nothing more: invented paths, read the same way.
  const [MR, TT] = INTERNAL;
  for (const [f, want] of [[`${MR}/judge.mjs`, true], [`${TT}/record.mjs`, true], [`.github/workflows/${MR}.yml`, true], [`test/${MR}.test.mjs`, true], [`test/fixtures/${TT}/history.json`, true], ['leak-check/scan.mjs', false], ['test/front-door.test.mjs', false]]) {
    if (INTERNAL_FILE.test(f) !== want) misses.push(`Could not find ${f} ${want ? 'refused' : 'admitted'} by the internal-file rule`);
  }
  assert.ok(!misses.length, `${misses.join('\n')}\n(${misses.length} lines)`);
});

// What no document or comment here may carry. The private repositories are read through the leak
// check's one-way list (leak-check/hashes.mjs), so this file names none of them.
const FAULTS = [
  ['a decision number', /\bdecisions? \d|\(decisions? [\d, and]+\)|\bD\d{1,3}\b/],
  ['a task or ticket id', /\br-\d+\.\d+\b|\bDZ-\d+\b/],
  ['a person', /\bBen\b|\boperator\b/i],
  ['a compliance programme', /\bSOC ?2\b|\bsoc2\b/i],
  ['a promise of an AI review', /\bAI review/i],
  ['the private records repository', /\brecords repository\b/i],
  ['a private path', /(?:^|[\s(`'"])(?:~\/(?:Dev|Desktop|Documents)\b|\/Users\/|work\/[a-z])|\.claude\//],
  ['a commit id', /(?<![\w@./-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![\w-])/],
];
// The leak check's own list; while it is not written yet, the run says so and reads no private name
// beyond the faults above, and the leak check step of the decide-tests check stops red on its absence.
const LIST = at('leak-check/hashes.json');
// A matcher over a one-way list's private repositories: a line gives the hashes of the private
// names it holds, matched as the leak check matches them (beside the owner, or alone when hyphenated).
const privateNames = (file) => {
  const { repositories, salt } = loadList(file);
  const match = matcher({ salt, repositories, all: repositories }, { owner: 'dazzer-io' });
  return { size: repositories.size, match: (line) => match(line, '').map((f) => f.hash) };
};
// The prose of a file: all of a document or an issue form, the comments of code and workflows.
const proseOf = (f, t) => {
  if (/\.md$/.test(f) || f.startsWith('.github/ISSUE_TEMPLATE/') || f === 'LICENSE') return t.split('\n');
  const marker = /\.(?:mjs|js)$/.test(f) ? /^\s*(?:\/\/|\/?\*)|\s\/\/\s/ : /\.ya?ml$|CODEOWNERS$/.test(f) ? /^\s*#|\s#\s/ : null;
  if (!marker) return [];
  return t.split('\n').map((l) => { const m = marker.exec(l); return m ? l.slice(m.index) : ''; });
};

test('no document or comment carries an internal reference: a decision number, a task id, a person, a private repository, a private path, a commit id or a promise the checks do not keep', (ctx) => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean).filter((f) => !f.startsWith('test/fixtures/'));
  assert.ok(files.includes('README.md') && files.includes('leak-check/scan.mjs'), `Could not find this repository's files as git tracks them: ${files.length} read`);
  const names = existsSync(LIST) ? privateNames(LIST) : null;
  if (names) assert.ok(names.size >= 1, `Could not find the private repositories in leak-check/hashes.json: ${names.size} found`);
  else ctx.diagnostic('leak-check/hashes.json is not written yet: no private repository name read here');
  const misses = [];
  let read = 0;
  for (const f of files) {
    const t = text(f);
    if (t === null) continue;
    proseOf(f, t).forEach((l, i) => {
      if (!l) return;
      read += 1;
      for (const [what, re] of FAULTS) if (re.test(l)) misses.push(`Could not find ${f}:${i + 1} free of ${what}: ${l.trim().slice(0, 160)}`);
      for (const h of names?.match(l) ?? []) misses.push(`Could not find ${f}:${i + 1} free of the private repository hashed ${h}`);
    });
  }
  assert.ok(read >= 1000, `Could not find the documents and comments to read: ${read} lines read`);
  assert.ok(!misses.length, `${misses.join('\n')}\n(${misses.length} lines)`);
});

// The private names are read through the one-way list alone: a list of invented names, written
// under the system's temp folder, finds each beside its owner or alone when hyphenated, never a
// public name or an ordinary word, and says no plain name.
test('a private repository is found in prose through the one-way list alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'front-door-'));
  const file = join(dir, 'hashes.json');
  const salt = 'invented-salt';
  writeFileSync(file, JSON.stringify({ salt, repositories: ['quillon-harbour', 'brackwater'].map((n) => oneWay(n, salt)) }));
  const { size, match } = privateNames(file);
  assert.equal(size, 2, `Could not find both invented names in the list: ${size} read`);
  const misses = [];
  for (const [line, want] of [
    ['// the Quillon-Harbour notes', 1], ['see dazzer-io/brackwater for more', 1], ['# brackwater alone is a word', 0],
    ['https://github.com/dazzer-io/dazzer-plugin', 0], ['nothing private here', 0],
  ]) if (match(line).length !== want) misses.push(`Could not find ${want} private name(s) in "${line}": ${match(line).length} found`);
  assert.ok(!misses.length, misses.join('\n'));
  assert.ok(match('dazzer-io/brackwater').every((h) => /^[0-9a-f]{64}$/.test(h)), 'Could not find the finding told by its hash alone');
});
