#!/usr/bin/env node
// Person tokens: the security scan's check that automation never signs in to GitHub as a person
// (security-scan/README.md, "Person tokens"). It runs in the job person-tokens of
// .github/workflows/security-scan.yml, on every branch; the final job security-scan settles what
// it writes, through decide.mjs, under the same mode as every scanner.
//
// A ratchet. It reads only the workflow files (.github/workflows/*.yml) and composite actions
// (.github/actions/**/action.yml) the change itself changes, at the change's head commit. In
// those files every use of a repository secret that signs in to GitHub is refused, unless the
// calling repository's .github/person-token-exceptions.json, read from the base branch, still
// allows it: an entry naming the file and the secret, with a one-line reason and an end date,
// counts through that date and stops the day after. So a use already there keeps working until
// its file changes after its end date, and a change cannot let a new use in by listing it.
//
// Allowed: the workflow's own token (secrets.GITHUB_TOKEN, github.token) and a token a GitHub App
// mints in the job (actions/create-github-app-token's outputs), which are no secret at all.
// Tokens for other services are not GitHub's business here and are never read as one.
//
// Line by line and dependency-free: the YAML is not parsed, only read the way GitHub would fill
// it in (README, "Known limits"). The pure part is exported for the tests; main() reads the
// change through git. Nothing here names an organisation, repository or company.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const EXCEPTIONS_FILE = '.github/person-token-exceptions.json';
export const WORKFLOW_TOKEN = 'GITHUB_TOKEN';

// The variables gh, octokit and GitHub's own actions read a GitHub token from.
export const GITHUB_TOKEN_VARIABLES = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']);
// Action inputs that hold a GitHub token whatever the action.
export const GITHUB_TOKEN_INPUTS = new Set(['github-token', 'github_token', 'gh-token', 'gh_token', 'repo-token', 'repo_token']);
// Actions whose plain "token" input is a GitHub token: GitHub's own, and a few that only talk to GitHub.
export const GITHUB_ACTION_OWNERS = new Set(['actions', 'github', 'octokit', 'peter-evans', 'dependabot']);
export const GITHUB_ACTIONS = new Set([
  'softprops/action-gh-release', 'ncipollo/release-action', 'googleapis/release-please-action',
  'google-github-actions/release-please-action', 'ad-m/github-push-action', 'endbug/add-and-commit',
]);
// A line of a script that signs in to GitHub with whatever secret it carries.
const SIGNS_IN_TO_GITHUB = /github\.com|githubusercontent\.com|ghcr\.io|x-access-token|\bgh\s+auth\s+login\b|\b(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)\s*=/i;

export const USE_INSTEAD = 'Use the workflow\'s own token instead (${{ github.token }}, with a permissions block granting what the job needs), or a GitHub App token minted in the job by actions/create-github-app-token (${{ steps.<id>.outputs.token }}).';

// ---------- which files ----------

// GitHub runs workflows only from the top of .github/workflows; a composite action is an
// action.yml or action.yaml in a folder of its own.
export function isCheckedFile(file) {
  const f = String(file);
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /^\.github\/actions\/(?:[^/]+\/)+action\.ya?ml$/.test(f);
}

// ---------- which secrets are a person's GitHub token ----------

// A secret's name says it is a GitHub token: GH or GITHUB with TOKEN or PAT, or PAT on its own
// (a personal access token). A GitHub App's id and private key are how an App token is minted,
// so they are not one; nor is the workflow's own GITHUB_TOKEN.
export function namedAsGitHubToken(name) {
  const n = String(name).toUpperCase();
  if (n === WORKFLOW_TOKEN) return false;
  const words = n.split(/_+/);
  const github = words.includes('GH') || n.includes('GITHUB');
  return words.includes('PAT') || (github && words.includes('TOKEN'));
}

// ---------- reading a workflow, line by line ----------

// Where a YAML comment starts on a line outside a block scalar: a # after a space, outside a
// quoted value and outside ${{ }}. A value is quoted only when it starts with a quote.
function commentAt(line, from) {
  let i = from;
  while (line[i] === ' ') i++;
  if (line[i] === '"') {
    i++;
    while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
    i++;
  } else if (line[i] === '\'') {
    i++;
    while (i < line.length && !(line[i] === '\'' && line[i + 1] !== '\'')) i += line[i] === '\'' ? 2 : 1;
    i++;
  }
  let depth = 0;
  for (; i < line.length; i++) {
    if (line.startsWith('${{', i)) { depth++; i += 2; continue; }
    if (depth > 0 && line.startsWith('}}', i)) { depth--; i++; continue; }
    if (depth === 0 && line[i] === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

const KEY_LINE = /^( *)((?:- +)*)(?:(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]*)\3 *:(?= |$))?(.*)$/;
const BLOCK_SCALAR = /^\s*[|>][-+0-9]*\s*$/;

// Each line as { n, text, col, dash, key, value, block, blank }: col is where the line's key (or
// value) starts, after any "- ". A block scalar's lines (run: | and the like) keep their text
// whole, comments included: GitHub fills in ${{ }} there before any shell reads it.
export function readLines(text) {
  const out = [];
  let block = null;
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const indent = raw.match(/^ */)[0].length;
    if (block !== null) {
      if (raw.trim() === '' || indent > block) { out.push({ n, text: raw, block: true }); return; }
      block = null;
    }
    if (/^\s*#/.test(raw) || raw.trim() === '') { out.push({ n, text: '', blank: true }); return; }
    const m = raw.match(KEY_LINE);
    const col = m[1].length + m[2].length;
    const valueFrom = raw.length - m[5].length;
    const cut = commentAt(raw, valueFrom);
    const value = (cut >= 0 ? raw.slice(valueFrom, cut) : raw.slice(valueFrom)).trim();
    if (BLOCK_SCALAR.test(value)) block = m[4] ? col : m[1].length;
    out.push({ n, text: cut >= 0 ? raw.slice(0, cut) : raw, col, dash: m[2] !== '', key: m[4] || null, value });
  });
  return out;
}

// The secrets a piece of text names inside ${{ }}: secrets.NAME and secrets['NAME'].
export function secretsNamed(text) {
  const names = [];
  for (const expr of String(text).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    for (const m of expr[1].matchAll(/\bsecrets\s*(?:\.\s*([A-Za-z0-9_]+)|\[\s*(['"])([^'"]+)\2\s*\])/g)) {
      names.push(m[1] || m[3]);
    }
  }
  return names;
}

const structural = (l) => l && !l.blank && !l.block;

// The mapping a key line sits in, as { uses, text }: the step (or job) its parent belongs to.
// For "token:" under "with:", that is the step, whose uses: may come before or after.
function stepOf(lines, i) {
  const col = lines[i].col;
  let p = i - 1;
  while (p >= 0 && !(structural(lines[p]) && lines[p].col < col)) p--;
  if (p < 0) return { uses: null, text: '' };
  const pc = lines[p].col;
  let start = p;
  while (!lines[start].dash || lines[start].col !== pc) {
    let s = start - 1;
    while (s >= 0 && !structural(lines[s])) s--;
    if (s < 0 || lines[s].col < pc) break;
    start = s;
  }
  let end = p + 1;
  while (end < lines.length && !(structural(lines[end]) && (lines[end].col < pc || (lines[end].col === pc && lines[end].dash)))) end++;
  const mapping = lines.slice(start, end);
  const uses = mapping.find((l) => structural(l) && l.col === pc && l.key === 'uses');
  const action = uses ? uses.value.replace(/^["']|["']$/g, '').split('@')[0] : null;
  return { uses: action, text: mapping.map((l) => l.text).join('\n') };
}

function githubFacing(action) {
  const a = String(action || '').toLowerCase();
  if (!a || a.startsWith('./') || a.startsWith('docker://')) return false;
  const [owner, repo] = a.split('/');
  return GITHUB_ACTION_OWNERS.has(owner) || GITHUB_ACTIONS.has(`${owner}/${repo}`);
}

// How a secret on line i signs in to GitHub, in words, or null when it does not.
function howItSignsIn(lines, i, name) {
  const l = lines[i];
  if (!l.block && l.key) {
    const key = l.key;
    if (GITHUB_TOKEN_VARIABLES.has(key.toUpperCase())) {
      return `as ${key}, which gh and GitHub's own tools sign in to GitHub with`;
    }
    if (GITHUB_TOKEN_INPUTS.has(key.toLowerCase())) {
      const step = stepOf(lines, i);
      return `as the input ${key} of ${step.uses || 'its step'}, which is a GitHub token`;
    }
    if (key.toLowerCase() === 'token') {
      const step = stepOf(lines, i);
      if (githubFacing(step.uses)) return `as the input token of ${step.uses}, which signs in to GitHub with it`;
    }
    if (key.toLowerCase() === 'password') {
      const step = stepOf(lines, i);
      if (/^docker\/login-action$/i.test(step.uses || '') && /ghcr\.io/i.test(step.text)) {
        return `as the password ${step.uses} signs in to ghcr.io with`;
      }
    }
  }
  if (SIGNS_IN_TO_GITHUB.test(l.text)) return 'on a line that signs in to GitHub with it';
  if (namedAsGitHubToken(name)) return 'whose name says it is a GitHub token';
  return null;
}

// Every use of a repository secret that signs in to GitHub, as { line, secret, how }.
export function findPersonTokens(text) {
  const lines = readLines(text);
  const uses = [];
  lines.forEach((l, i) => {
    if (l.blank) return;
    const seen = new Set();
    for (const name of secretsNamed(l.block ? l.text : l.value)) {
      if (name.toUpperCase() === WORKFLOW_TOKEN || seen.has(name.toUpperCase())) continue;
      seen.add(name.toUpperCase());
      const how = howItSignsIn(lines, i, name);
      if (how) uses.push({ line: l.n, secret: name, how });
    }
  });
  return uses;
}

// ---------- the exceptions (.github/person-token-exceptions.json on the base branch) ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function isDate(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// text: the file's content, or null when the file is absent (no exceptions).
// Returns { entries: [{ file, secret, reason, until, ended }], notes, error }.
export function readExceptions(text, today, label = EXCEPTIONS_FILE) {
  if (text === null || text === undefined) return { entries: [], notes: [], error: null };
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    return { entries: [], notes: [], error: `${label} is not JSON (${e.message})` };
  }
  if (!Array.isArray(parsed)) {
    return { entries: [], notes: [], error: `${label} is not a list of { file, secret, reason, until } entries` };
  }
  const entries = [];
  const notes = [];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  parsed.forEach((entry, i) => {
    const file = str(entry && entry.file);
    const secret = str(entry && entry.secret);
    const reason = str(entry && entry.reason);
    const until = str(entry && entry.until);
    if (!file || !secret) { notes.push(`${label}: entry ${i + 1} names no file or no secret; it does not count`); return; }
    const which = `the entry for ${secret} in ${file}`;
    if (!reason || /[\r\n]/.test(reason)) { notes.push(`${label}: ${which} gives no one-line reason; it does not count`); return; }
    if (!isDate(until)) { notes.push(`${label}: ${which} gives no end date as YYYY-MM-DD (until); it does not count`); return; }
    entries.push({ file, secret, reason, until, ended: until < today });
  });
  return { entries, notes, error: null };
}

// ---------- the check ----------

function wordsOf(use) {
  const what = `${use.secret} ${use.how}`;
  if (use.allowed) return `${what}; allowed until ${use.exception.until}: ${use.exception.reason}`;
  if (use.exception) return `${what}; its exception ended on ${use.exception.until}`;
  return `${what}; ${use.added ? 'this change adds it' : 'already in this file, with no exception'}`;
}

function messageOf(use) {
  const found = `${use.file} line ${use.line} uses the repository secret ${use.secret} ${use.how}.`;
  if (use.allowed) {
    return `${found} Allowed until ${use.exception.until} by ${EXCEPTIONS_FILE} on the base branch: ${use.exception.reason}`;
  }
  const why = 'A GitHub token kept as a repository secret is a person\'s own, so this automation would sign in to GitHub as that person: refused.';
  let status;
  if (use.exception) status = `Its exception in ${EXCEPTIONS_FILE} ended on ${use.exception.until}.`;
  else if (use.added) status = `This change adds it, and ${EXCEPTIONS_FILE} on the base branch lists no exception for it.`;
  else status = `It was already in this file, and ${EXCEPTIONS_FILE} on the base branch lists no exception for it, so a change to this file must move it off the person's token.`;
  return `${found} ${why} ${status} ${USE_INSTEAD}`;
}

// files: [{ file, head, base }] — each changed workflow's text at the change's head and at its
// merge base (null when the file is new). exceptions: the exceptions file at the base branch, or
// null. changedExceptions: the exceptions file at the change's head when the change writes it.
// Returns { looked_at, uses, notes, error }, which the job writes for the final job.
export function check({ files, exceptions, changedExceptions, today }) {
  const ex = readExceptions(exceptions, today);
  const notes = [];
  if (ex.error) notes.push(`${ex.error}; no exception counts`);
  notes.push(...ex.notes);
  let error = null;
  if (changedExceptions !== undefined && changedExceptions !== null) {
    const mine = readExceptions(changedExceptions, today, `the ${EXCEPTIONS_FILE} this change writes`);
    error = mine.error;
    notes.push(...mine.notes);
    notes.push(`this change writes ${EXCEPTIONS_FILE}; exceptions are read from the base branch, so its edits apply to later changes, never to this one`);
  }
  const uses = [];
  for (const f of files) {
    const before = new Set(findPersonTokens(f.base).map((u) => u.secret.toUpperCase()));
    for (const u of findPersonTokens(f.head)) {
      const matching = ex.entries
        .filter((e) => e.file === f.file && e.secret.toUpperCase() === u.secret.toUpperCase())
        .sort((a, b) => b.until.localeCompare(a.until));
      const e = matching[0] || null;
      const use = {
        file: f.file, line: u.line, secret: u.secret, how: u.how,
        added: !before.has(u.secret.toUpperCase()),
        allowed: Boolean(e && !e.ended),
        exception: e && { reason: e.reason, until: e.until, ended: e.ended },
      };
      uses.push({ ...use, words: wordsOf(use), message: messageOf(use) });
    }
  }
  return { looked_at: files.map((f) => f.file), uses, notes, error };
}

// ---------- reading the change through git ----------

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// git: (args) => { status, stdout, stderr }. The changed files are those between the merge base
// of the base and the head, and the head (what the pull request's own commits change); a file's
// earlier text is read at that merge base, and the exceptions at the base itself.
export function collect(git, base, head) {
  const must = (args) => {
    const r = git(args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} ended with exit ${r.status}: ${String(r.stderr || '').trim().slice(0, 300)}`);
    return r.stdout;
  };
  for (const [name, sha] of [['base', base], ['head', head]]) {
    if (!SHA.test(String(sha || ''))) throw new Error(`the ${name} commit "${String(sha || '').slice(0, 80)}" is not a commit id`);
    must(['cat-file', '-e', `${sha}^{commit}`]);
  }
  const mergeBase = must(['merge-base', base, head]).trim();
  const changed = must(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=d', mergeBase, head]).split('\0').filter(Boolean);
  const show = (sha, file) => (git(['cat-file', '-e', `${sha}:${file}`]).status === 0 ? must(['show', `${sha}:${file}`]) : null);
  const files = changed.filter(isCheckedFile).map((file) => ({ file, head: show(head, file), base: show(mergeBase, file) }));
  return {
    files,
    exceptions: show(base, EXCEPTIONS_FILE),
    changedExceptions: changed.includes(EXCEPTIONS_FILE) ? show(head, EXCEPTIONS_FILE) : undefined,
  };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] !== 'scan' || !argValue(argv, 'target')) {
    console.error('usage: person-tokens.mjs scan --target <checkout> --base <commit> --head <commit> [--today YYYY-MM-DD]');
    return 2;
  }
  const target = argValue(argv, 'target');
  const today = argValue(argv, 'today') || todayUtc();
  if (!isDate(today)) throw new Error(`--today "${today}" is not a date as YYYY-MM-DD`);
  const git = (args) => spawnSync('git', ['-C', target, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const result = check({ ...collect(git, argValue(argv, 'base'), argValue(argv, 'head')), today });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const refused = result.uses.filter((u) => !u.allowed).length;
  console.error(`Looked at ${result.looked_at.length} changed workflow file(s): ${result.uses.length} person-token use(s), ${refused} not allowed.`);
  return 0;
}

const invoked = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`the person-token check could not read the change: ${err.message}`);
    process.exitCode = 1;
  }
}
