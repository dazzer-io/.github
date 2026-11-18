// This repository is public: it is the organisation's profile, its community defaults and the
// shared checks other repositories call. These tests hold what a stranger reading it meets: every
// workflow grants its token nothing at the top and pins every action by its full commit id, the
// community files are present and say what they promise, and no document or comment carries an
// internal reference. Every failure starts "Could not find", and each test lists every miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const at = (f) => join(ROOT, f);
const text = (f) => (existsSync(at(f)) ? readFileSync(at(f), 'utf8') : null);
const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/;

test('every workflow grants its token nothing at the top, each job names its own grant, and every action is pinned by its full commit id', () => {
  const dir = at('.github/workflows');
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.length >= 5, `Could not find the shared workflows in .github/workflows: ${files.length} found`);
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
    if (!urls.includes('https://dazzer.io')) misses.push(`Could not find config.yml sending questions to https://dazzer.io: ${JSON.stringify(urls)}`);
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

// What no document or comment here may carry. The private repositories are the ones the machine
// rule's own lists name, beside the two public ones, so this file names none of them itself.
const FAULTS = [
  ['a decision number', /\bdecisions? \d|\(decisions? [\d, and]+\)|\bD\d{1,3}\b/],
  ['a task or ticket id', /\br-\d+\.\d+\b|\bDZ-\d+\b/],
  ['a person', /\bBen\b|\boperator\b/i],
  ['a compliance programme', /\bSOC ?2\b|\bsoc2\b/i],
  ['a promise of an AI review', /\bAI review/i],
  ['a private path', /(?:^|[\s(`'"])(?:~\/(?:Dev|Desktop|Documents)\b|\/Users\/|work\/[a-z])|\.claude\//],
  ['a commit id', /(?<![\w@./-])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}(?![\w-])/],
];
const PUBLIC = new Set(['.github', 'dazzer-plugin']);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const privateNames = () => {
  const names = new Set();
  for (const f of readdirSync(at('machine-rule')).filter((x) => x.endsWith('.json'))) {
    for (const m of readFileSync(at(join('machine-rule', f)), 'utf8').matchAll(/dazzer-io\/([A-Za-z0-9_.-]+)/g)) if (!PUBLIC.has(m[1])) names.add(m[1]);
  }
  // A name that is also an ordinary word is matched only as an owner's name or a full one.
  return [...names].map((n) => [n, new RegExp(/-/.test(n) || n === 'dazzer' ? `(?<![\\w./-])${escape(n)}(?![\\w-]|\\.\\w)` : `(?<![\\w./-])${escape(n)}'|dazzer-io/${escape(n)}(?![\\w.-])`)]);
};
// The prose of a file: all of a document or an issue form, the comments of code and workflows.
const proseOf = (f, t) => {
  if (/\.md$/.test(f) || f.startsWith('.github/ISSUE_TEMPLATE/') || f === 'LICENSE') return t.split('\n');
  const marker = /\.(?:mjs|js)$/.test(f) ? /^\s*(?:\/\/|\/?\*)|\s\/\/\s/ : /\.ya?ml$|CODEOWNERS$/.test(f) ? /^\s*#|\s#\s/ : null;
  if (!marker) return [];
  return t.split('\n').map((l) => { const m = marker.exec(l); return m ? l.slice(m.index) : ''; });
};

test('no document or comment carries an internal reference: a decision number, a task id, a person, a private repository, a private path, a commit id or a promise the checks do not keep', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean).filter((f) => !f.startsWith('test/fixtures/'));
  assert.ok(files.includes('README.md') && files.includes('machine-rule/judge.mjs'), `Could not find this repository's files as git tracks them: ${files.length} read`);
  const names = privateNames();
  assert.ok(names.length >= 3, `Could not find the private repositories the machine rule's lists name: ${names.length} found`);
  const faults = [...FAULTS, ...names.map(([n, re]) => [`the private repository ${n}`, re])];
  const misses = [];
  let read = 0;
  for (const f of files) {
    const t = text(f);
    if (t === null) continue;
    proseOf(f, t).forEach((l, i) => {
      if (!l) return;
      read += 1;
      for (const [what, re] of faults) if (re.test(l)) misses.push(`Could not find ${f}:${i + 1} free of ${what}: ${l.trim().slice(0, 160)}`);
    });
  }
  assert.ok(read >= 1000, `Could not find the documents and comments to read: ${read} lines read`);
  assert.ok(!misses.length, `${misses.join('\n')}\n(${misses.length} lines)`);
});
