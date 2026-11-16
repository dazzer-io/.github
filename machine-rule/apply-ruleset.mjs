#!/usr/bin/env node
// The organisation rulesets this repository keeps as files, each written by Ben's hand alone:
//   machine-rule-required (machine-rule/ruleset.json): the workflows rule that runs
//     .github/workflows/machine-rule.yml, read from dazzer-io/.github (named by its repository id)
//     at refs/heads/main, on the default branch of every repository but the two
//     EXCLUDED_REPOSITORIES names, each with its reason, not on create, written active since r-3.37:
//     GitHub blocks a merge until that workflow has passed;
//   main-spelling-refused (machine-rule/main-spelling.json): in dazzer, dazzer-app and runners, the
//     repositories the locked runner group google-locked admits (runners for its locked canary,
//     r-3.45), creating a branch spelled main in other letters is refused, with no bypass
//     (decisions 188, 192);
//   codeql-complete-required (machine-rule/codeql-complete.json): in dazzer and dazzer-app alone, the
//     shared scan's codeql / CodeQL complete from GitHub Actions (integration 15368) on the default
//     branch, not on create, written active since r-3.27: GitHub blocks a merge until that check
//     has passed (decisions 188, 192, 210).
//
//   node machine-rule/apply-ruleset.mjs              reads each live ruleset with gh and says, for
//                                                    each, how it differs from its file and exactly
//                                                    what --apply would do with it: create, update,
//                                                    write again as it is, or hold back
//   node machine-rule/apply-ruleset.mjs --apply      writes each file's version, and only those
//                                                    rulesets: they are security settings, so this is
//                                                    Ben's own command (decisions 121, 177, 192);
//                                                    nothing else runs it
//   node machine-rule/apply-ruleset.mjs --readings [--moving <a,b>] [--only <a,b>] [--class production]
//                                                    runs machine-rule/judge.mjs over every private,
//                                                    non-archived repository's workflow folder at its
//                                                    default branch, read with gh, and lists each
//                                                    refusal
//
// Exit codes. The read and --apply: 0 when every kept ruleset is its file's version (for --apply,
// as read back after the writes); 1 when one or more were held back or differ (for the read, one
// --apply would create, update or hold back), each named, a write gh got no answer to among them;
// 2 when GitHub could not be read at all: the organisation's rulesets, listed before any write,
// could not be listed, so nothing was written. --readings: 0 when nothing is refused, 1 when
// something is, 2 when a repository could not be read. A wrong argument is 2.
//
// --moving treats the named repositories as moving (their literal-label jobs need kept.json
// entries) even where they read no setting; --only reads just those repositories; --class
// production lists only the refusals of jobs in workflows that sign in, so each milestone's
// finish check reads exactly what that milestone delivers.
//
// Each kept ruleset stands alone (decisions 210, 212): its file, read and checked; its own check on
// GitHub, which for machine-rule-required is that dazzer-io/.github's live repository id is the one
// its file names; its live version, found by name and read by the id the list names; its write; and
// its read-back. Every GitHub call about it sits inside its own containment. A refusal of one, a
// file that cannot be read or fails its check, a wrong repository id, two live rulesets of its name,
// a write GitHub refuses with a 4xx, a write gh gets no answer to or GitHub answers with a 5xx
// (said as one that may have landed), or an answer GitHub does not give about it or gives with no
// object or no integer id in it, holds back that one alone and names it, while the others are still
// written and read back. Each write goes to the ruleset of its file's name alone: a PUT to the id
// the list names when it is there, a POST when it is not, then read back, an update by that id and
// a creation by the id in GitHub's answer to it. No other ruleset is read for writing or written,
// and nothing else is read: no branch, pull request or check run. Every GitHub call goes through
// the request handed to main(), so tests need no network.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORG, SHARED, readLists, readings, Unread, ReadFailure } from './judge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULESET_NAME = 'machine-rule-required';
export const RULE_PATH = '.github/workflows/machine-rule.yml';
export const RULE_REF = 'refs/heads/main';
export const SHARED_REPOSITORY_ID = 1433582766;
// GitHub's own words when a repository name condition pairs protected: true with ~ALL (decision 187).
export const GITHUB_ALL_REFUSAL = 'Protected repository name conditions cannot include `~ALL`';
// The repositories machine-rule-required leaves out, each by name with its reason, held here alone
// (r-3.37): its check admits exactly these as the exclude beside ~ALL, and refuses any other
// exclude. A direct push to a default branch has not run the workflow, so an active workflows rule
// is taken to refuse it; these two land their default branch by a direct push, by design.
export const EXCLUDED_REPOSITORIES = [
  { name: 'dev-cycle', reason: 'its release door lands main as a fast-forward push after its own full check (machine rules 9)' },
  { name: 'dazzer-skills', reason: 'a mirror rewritten by a sync job, with no workflows to judge' },
];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Every way a ruleset differs from the one this repository keeps, each as a sentence. excluded is
// the list of repositories it leaves out, EXCLUDED_REPOSITORIES unless a test hands it another.
export function checkRuleset(r, { repositoryId = SHARED_REPOSITORY_ID, excluded = EXCLUDED_REPOSITORIES } = {}) {
  const problems = [];
  if (!isObj(r)) return ['the ruleset is not an object'];
  if (r.name !== RULESET_NAME) problems.push(`it is named ${JSON.stringify(r.name)}, not ${RULESET_NAME}`);
  if (r.target !== 'branch') problems.push(`its target is ${JSON.stringify(r.target)}, not branch`);
  // active blocks; evaluate is the way back an organisation owner may take, and the file is held
  // to active by its test (r-3.37).
  if (!['evaluate', 'active'].includes(r.enforcement)) problems.push(`its enforcement is ${JSON.stringify(r.enforcement)}, neither evaluate nor active`);
  if (!Array.isArray(r.bypass_actors) || r.bypass_actors.length) problems.push('it names bypass actors, so someone could merge past the rule');
  const ref = r.conditions?.ref_name;
  if (!isObj(ref) || !same(ref.include, ['~DEFAULT_BRANCH']) || !same(ref.exclude ?? [], [])) problems.push(`its ref condition is ${JSON.stringify(ref)}, not the default branch alone (include ~DEFAULT_BRANCH, exclude nothing)`);
  // The list of repositories it leaves out: each entry a name and a reason, no name twice.
  const list = Array.isArray(excluded) ? excluded : [];
  if (!Array.isArray(excluded)) problems.push(`the list of repositories it leaves out is ${JSON.stringify(excluded)}, no list`);
  const seen = new Set();
  for (const e of list) {
    if (!isObj(e) || typeof e.name !== 'string' || !e.name.trim()) { problems.push(`the list of repositories it leaves out holds ${JSON.stringify(e)}, naming no repository`); continue; }
    if (seen.has(e.name)) problems.push(`the list of repositories it leaves out names ${e.name} twice`);
    seen.add(e.name);
    if (typeof e.reason !== 'string' || !e.reason.trim()) problems.push(`the list of repositories it leaves out names ${e.name} with no reason, so nothing says why the rule does not reach it`);
  }
  const names = list.filter((e) => isObj(e) && typeof e.name === 'string').map((e) => e.name);
  const repo = r.conditions?.repository_name;
  if (!isObj(repo)) problems.push(`its repository condition is ${JSON.stringify(repo)}, narrower than every repository (include ~ALL)`);
  else {
    if (!same(repo.include, ['~ALL'])) problems.push(`its repository condition includes ${JSON.stringify(repo.include)}, narrower than every repository (include ~ALL)`);
    const exclude = repo.exclude ?? [];
    if (!Array.isArray(exclude) || !same([...exclude].sort(), [...names].sort())) problems.push(`its repository condition excludes ${JSON.stringify(repo.exclude)}, not exactly ${names.length ? inWords(names) : 'nothing'}, the repositories EXCLUDED_REPOSITORIES leaves out, each with its reason`);
  }
  // protected blocks renaming the repositories a list of names targets; GitHub refuses it beside
  // ~ALL, as it refused Ben's --apply of 8 Nov, and a renamed repository stays in ~ALL anyway.
  if (isObj(repo) && repo.protected === true && Array.isArray(repo.include) && repo.include.includes('~ALL')) problems.push(`its repository condition sets protected: true beside include ~ALL, which GitHub refuses with 422: "${GITHUB_ALL_REFUSAL}" (decision 187)`);
  for (const k of Object.keys(r.conditions ?? {})) if (!['ref_name', 'repository_name'].includes(k)) problems.push(`it holds the condition ${k}, which narrows the repositories it runs in`);
  if (!Array.isArray(r.rules) || r.rules.length !== 1) problems.push(`it holds ${Array.isArray(r.rules) ? r.rules.length : 'no'} rules, not one workflows rule`);
  for (const rule of Array.isArray(r.rules) ? r.rules : []) {
    if (rule?.type !== 'workflows') { problems.push(`it holds a rule of type ${JSON.stringify(rule?.type)}, not workflows`); continue; }
    const p = rule.parameters ?? {};
    if (p.do_not_enforce_on_create !== true) problems.push('its workflows rule is enforced on create, which the rule is not');
    const ws = Array.isArray(p.workflows) ? p.workflows : [];
    if (ws.length !== 1) { problems.push(`its workflows rule names ${ws.length} workflows, not machine-rule.yml alone`); continue; }
    const w = ws[0];
    if (!isObj(w)) { problems.push(`its workflows rule names ${JSON.stringify(w)}, not a workflow`); continue; }
    if (w.path !== RULE_PATH) problems.push(`its workflows rule runs ${JSON.stringify(w.path)}, not ${RULE_PATH}`);
    if (w.ref !== RULE_REF) problems.push(`its workflows rule reads the workflow at ${JSON.stringify(w.ref)}, not ${RULE_REF}`);
    if (w.repository_id === undefined || w.repository_id === null) problems.push(`its workflows rule names no repository id, so the workflow's repository is not ${SHARED}`);
    else if (w.repository_id !== repositoryId) problems.push(`its workflows rule names the repository id ${w.repository_id}, not ${repositoryId}, ${SHARED}'s`);
  }
  return problems;
}

// ---------------------------------------------------------------- the two rules on main (decision 192)
// Field by field, as docs.github.com's REST reference for organisation rulesets
// (rest/orgs/rules, "Create an organization repository ruleset") gives them:
// conditions.ref_name and conditions.repository_name each hold include and exclude, arrays of
// names or patterns, and repository_name's protected says whether renaming its repositories is
// prevented; a creation rule is { type: 'creation' }, "only allow users with bypass permission to
// create matching refs"; a required_status_checks rule's parameters hold required_status_checks,
// each a context and "the optional integration ID that this status check must originate from",
// strict_required_status_checks_policy, and do_not_enforce_on_create, "allow repositories and
// branches to be created if a check would otherwise prohibit it".
export const MAIN_SPELLING_NAME = 'main-spelling-refused';
export const CODEQL_COMPLETE_NAME = 'codeql-complete-required';
// main-spelling-refused reaches every repository the locked runner group google-locked admits:
// dazzer and dazzer-app, and runners, whose one dispatch-only locked-canary.yml the group admits at
// refs/heads/main alone; held to main only within the existing-branch bound, since a creation rule
// never touches a branch that is already there (r-3.45). codeql-complete-required stays in dazzer
// and dazzer-app alone.
export const MAIN_SPELLING_REPOSITORIES = ['dazzer', 'dazzer-app', 'runners'];
export const CODEQL_REPOSITORIES = ['dazzer', 'dazzer-app'];
export const CODEQL_CONTEXT = 'codeql / CodeQL complete';
// GitHub Actions' integration id: every codeql / CodeQL complete on dazzer's and dazzer-app's pull
// requests carries it (decision 192, read 8 Nov), as their main-protection rulesets name it.
export const ACTIONS_INTEGRATION_ID = 15368;
// The sixteen spellings of main, each letter in either case, main itself first, and the fifteen
// that are not main.
export const SPELLINGS_OF_MAIN = Array.from({ length: 16 }, (_, m) => `refs/heads/${[...'main'].map((c, i) => ((m >> (3 - i)) & 1 ? c.toUpperCase() : c)).join('')}`);
export const OTHER_SPELLINGS = SPELLINGS_OF_MAIN.filter((s) => s !== RULE_REF);
const MOST_NAMES = 4096;

// The names a ref pattern matches, matched case-sensitively, for a pattern of literal characters
// and bracket classes alone, so that the names can be listed. GitHub reads a ruleset's patterns
// with fnmatch and File::FNM_PATHNAME, supports bracket classes, never complemented with ^, and
// never a backslash (docs.github.com, "Creating rulesets for a repository", "Using fnmatch
// syntax"); its pages say nothing of case, so this reads none. A wildcard matches names beyond
// any list, so it is a problem here, as are a complement, a backslash and a class it cannot read.
export function namesMatched(pattern) {
  const no = (why) => ({ problem: `the pattern ${JSON.stringify(pattern)} ${why}` });
  if (typeof pattern !== 'string' || !pattern) return no('is no pattern');
  if (pattern === '~DEFAULT_BRANCH') return { problem: 'the pattern ~DEFAULT_BRANCH, which takes in the default branch, main itself' };
  if (pattern === '~ALL') return { problem: 'the pattern ~ALL, which takes in every branch, main itself' };
  if (/[^\x21-\x7e]/.test(pattern)) return no('holds a character outside printable ASCII, which this check does not read');
  const parts = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' || c === '?') return no(`holds the wildcard ${c}, so the names it matches are more than any list`);
    if (c === '\\') return no('holds a backslash, which GitHub does not support in a pattern');
    if (c === ']') return no('closes a class it never opened');
    if (c !== '[') { parts.push([c]); continue; }
    const end = pattern.indexOf(']', i + 1);
    if (end === -1) return no('opens a class it never closes');
    const body = pattern.slice(i + 1, end);
    if (!body) return no('holds an empty class');
    if (body[0] === '^' || body[0] === '!') return no(`complements a class with ${body[0]}, which GitHub does not support`);
    if (body.includes('[')) return no('opens a class inside a class');
    if (body.includes('/')) return no('holds / inside a class, which FNM_PATHNAME never matches there');
    const set = new Set();
    for (let k = 0; k < body.length; k++) {
      if (body[k + 1] === '-' && k + 2 < body.length) {
        const lo = body.charCodeAt(k);
        const hi = body.charCodeAt(k + 2);
        if (lo > hi) return no(`holds the range ${body.slice(k, k + 3)}, which runs backwards`);
        for (let x = lo; x <= hi; x++) set.add(String.fromCharCode(x));
        k += 2;
      } else set.add(body[k]);
    }
    parts.push([...set]);
    i = end;
  }
  let names = [''];
  for (const p of parts) {
    if (names.length * p.length > MOST_NAMES) return no(`matches more than ${MOST_NAMES} names, more than this check lists`);
    names = names.flatMap((n) => p.map((c) => n + c));
  }
  return { names };
}

// Names in words: a, a and b, or a, b and c; with or for the last, a or b.
const inWords = (names, last = 'and') => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} ${last} ${names[names.length - 1]}`);

// What the two rules on main share: a branch ruleset in one of the enforcements it is given, with
// no bypass, in exactly the repositories it is given by name, protected so that renaming one cannot
// take it out of the rule, holding the conditions ref_name and repository_name alone, and one rule
// of the type it names.
function checkOnMain(r, name, ruleType, enforcements, repositories) {
  const problems = [];
  if (!isObj(r)) return { problems: ['the ruleset is not an object'], rule: null };
  if (r.name !== name) problems.push(`it is named ${JSON.stringify(r.name)}, not ${name}`);
  if (r.target !== 'branch') problems.push(`its target is ${JSON.stringify(r.target)}, not branch`);
  if (!enforcements.includes(r.enforcement)) problems.push(`its enforcement is ${JSON.stringify(r.enforcement)}, ${enforcements.length === 1 ? `not ${enforcements[0]}` : `neither ${enforcements.join(' nor ')}`}`);
  if (!Array.isArray(r.bypass_actors) || r.bypass_actors.length) problems.push('it names bypass actors, so someone could pass the rule');
  const repo = r.conditions?.repository_name;
  if (!isObj(repo) || !same(repo.include, repositories)) problems.push(`its repository condition includes ${JSON.stringify(isObj(repo) ? repo.include : repo)}, not ${inWords(repositories)} by name`);
  if (isObj(repo) && !same(repo.exclude ?? [], [])) problems.push(`its repository condition excludes ${JSON.stringify(repo.exclude)}`);
  if (isObj(repo) && repo.protected !== true) problems.push(`its repository condition sets protected ${JSON.stringify(repo.protected)}, not protected: true, so renaming ${inWords(repositories, 'or')} would take it out of the rule`);
  for (const k of Object.keys(r.conditions ?? {})) if (!['ref_name', 'repository_name'].includes(k)) problems.push(`it holds the condition ${k}, which narrows the repositories it runs in`);
  const rules = Array.isArray(r.rules) ? r.rules : [];
  if (rules.length !== 1) problems.push(`it holds ${Array.isArray(r.rules) ? r.rules.length : 'no'} rules, not one ${ruleType} rule`);
  for (const rule of rules) if (rule?.type !== ruleType) problems.push(`it holds a rule of type ${JSON.stringify(rule?.type)}, not ${ruleType}`);
  return { problems, rule: rules.length === 1 && rules[0]?.type === ruleType ? rules[0] : null };
}

// Every way a ruleset differs from main-spelling-refused, each as a sentence. It is active, in
// dazzer, dazzer-app and runners exactly, the repositories google-locked admits. Its
// patterns, matched case-sensitively, must match exactly the fifteen other spellings of main and
// never main itself, with no exclude, and its one rule is creation: so among those sixteen it holds
// whether GitHub folds case or not, and even folded it restricts only the creation of main, never a
// push to it (decision 192).
export function checkMainSpelling(r) {
  const { problems, rule } = checkOnMain(r, MAIN_SPELLING_NAME, 'creation', ['active'], MAIN_SPELLING_REPOSITORIES);
  if (!isObj(r)) return problems;
  if (rule && Object.keys(rule).some((k) => k !== 'type')) problems.push(`its creation rule holds ${JSON.stringify(Object.keys(rule).filter((k) => k !== 'type'))} beside its type`);
  const ref = r.conditions?.ref_name;
  if (!isObj(ref) || !Array.isArray(ref.include)) { problems.push(`it holds no ref condition including patterns: ${JSON.stringify(ref)}`); return problems; }
  if (!same(ref.exclude ?? [], [])) problems.push(`its ref condition excludes ${JSON.stringify(ref.exclude)}, so a spelling of main it names could be let through`);
  const matched = new Set();
  for (const p of ref.include) {
    const m = namesMatched(p);
    if (m.problem) problems.push(`its ref condition includes ${m.problem}`);
    else for (const n of m.names) matched.add(n);
  }
  if (matched.has(RULE_REF)) problems.push(`its patterns, matched case-sensitively, match ${RULE_REF} itself, so the rule reaches main, where it is meant to reach only the other spellings`);
  const missed = OTHER_SPELLINGS.filter((s) => !matched.has(s)).sort();
  if (missed.length) problems.push(`its patterns, matched case-sensitively, miss ${missed.join(', ')}, so such a branch could be created`);
  const beyond = [...matched].filter((n) => !SPELLINGS_OF_MAIN.includes(n)).sort();
  if (beyond.length) problems.push(`its patterns match ${beyond.slice(0, 5).join(', ')}${beyond.length > 5 ? ` and ${beyond.length - 5} more` : ''}, no spelling of main`);
  return problems;
}

// Every way a ruleset differs from codeql-complete-required, each as a sentence: in dazzer and
// dazzer-app exactly, runners never among them; active, as its file is written since r-3.27, or
// evaluate, the way back an organisation owner may take, and nothing else (decision 210); the default branch alone, one required check, codeql /
// CodeQL complete from integration 15368, not enforced on create, strict policy off.
export function checkCodeqlComplete(r) {
  const { problems, rule } = checkOnMain(r, CODEQL_COMPLETE_NAME, 'required_status_checks', ['evaluate', 'active'], CODEQL_REPOSITORIES);
  if (!isObj(r)) return problems;
  const ref = r.conditions?.ref_name;
  if (!isObj(ref) || !same(ref.include, ['~DEFAULT_BRANCH']) || !same(ref.exclude ?? [], [])) problems.push(`its ref condition is ${JSON.stringify(ref)}, not the default branch alone (include ~DEFAULT_BRANCH, exclude nothing)`);
  if (!rule) return problems;
  const p = isObj(rule.parameters) ? rule.parameters : {};
  if (p.do_not_enforce_on_create !== true) problems.push(`its required_status_checks rule is enforced on create (do_not_enforce_on_create ${JSON.stringify(p.do_not_enforce_on_create)}), which the rule is not`);
  if (p.strict_required_status_checks_policy !== false) problems.push(`its strict policy is ${JSON.stringify(p.strict_required_status_checks_policy)}, not false`);
  const checks = Array.isArray(p.required_status_checks) ? p.required_status_checks : [];
  if (checks.length !== 1) problems.push(`it requires ${checks.length} checks, not ${CODEQL_CONTEXT} alone`);
  for (const c of checks) {
    if (c?.context !== CODEQL_CONTEXT) problems.push(`its required_status_checks rule names the check ${JSON.stringify(c?.context)}, not ${CODEQL_CONTEXT}`);
    if (c?.integration_id !== ACTIONS_INTEGRATION_ID) problems.push(`its required check ${JSON.stringify(c?.context)} is from integration ${JSON.stringify(c?.integration_id)}, not ${ACTIONS_INTEGRATION_ID}, GitHub Actions`);
  }
  return problems;
}

// GitHub reads a repository name condition back with protected always there, false where the
// write left it out (decision 187), so a protected left out and one set false mean the same.
const conditionsOf = (c) => {
  if (!isObj(c) || !isObj(c.repository_name)) return c;
  const repo = c.repository_name;
  return { ...c, repository_name: { ...repo, protected: repo.protected === undefined ? false : repo.protected } };
};
// The parts of a ruleset that are its meaning, as GitHub returns them and as the file writes them.
const meaningOf = (r) => ({
  name: r?.name,
  target: r?.target,
  enforcement: r?.enforcement,
  bypass_actors: r?.bypass_actors ?? [],
  conditions: conditionsOf(r?.conditions),
  rules: r?.rules,
});
function flatten(x, at = '', out = {}) {
  if (Array.isArray(x)) { if (!x.length) out[at] = '[]'; x.forEach((v, i) => flatten(v, `${at}[${i}]`, out)); }
  else if (isObj(x)) { const keys = Object.keys(x).sort(); if (!keys.length) out[at] = '{}'; for (const k of keys) flatten(x[k], at ? `${at}.${k}` : k, out); }
  else out[at] = JSON.stringify(x);
  return out;
}
// How the live ruleset differs from the file: one line a field, live then file.
export function diffRuleset(live, file) {
  const a = flatten(meaningOf(live));
  const b = flatten(meaningOf(file));
  const lines = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) if (a[k] !== b[k]) lines.push(`${k}: live ${a[k] ?? '(none)'}, file ${b[k] ?? '(none)'}`);
  return lines;
}

// One GitHub call through gh: { status, text }. gh exits non-zero on any status but 2xx, and
// still prints the answer it got with --include, so the status is read from that answer.
export function ghRequest({ method = 'GET', path, body, accept = 'application/vnd.github+json' }) {
  const args = ['api', '--include', '-X', method, '-H', `Accept: ${accept}`, '-H', 'X-GitHub-Api-Version: 2022-11-28', path];
  if (body !== undefined) args.push('--input', '-');
  let out;
  try {
    out = execFileSync('gh', args, { encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body), stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    out = typeof e.stdout === 'string' ? e.stdout : '';
    if (!/^HTTP\/[\d.]+ \d{3}/.test(out)) throw new ReadFailure(`gh could not reach GitHub for ${method} ${path}: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`);
  }
  const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(out)?.[1]);
  const split = out.search(/\r?\n\r?\n/);
  const text = split === -1 ? '' : out.slice(split).replace(/^\r?\n\r?\n/, '');
  return { status, text };
}

const parse = (r, what) => {
  try { return JSON.parse(r.text); } catch { throw new ReadFailure(`${what}: GitHub's answer is not JSON`); }
};
// Every page of a list GitHub answers a page at a time. The list takes per_page, "The number of
// results per page (max 100)", and page, "The page number of the results to fetch", so pages 1,
// 2, ... are read until one holds fewer than 100.
const PER_PAGE = 100;
const MOST_PAGES = 50;
async function readPages(request, path, what) {
  const all = [];
  for (let page = 1; page <= MOST_PAGES; page++) {
    const r = await request({ path: `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}` });
    if (r.status !== 200) throw new ReadFailure(`could not list ${what}: GitHub answered ${r.status}`);
    const items = parse(r, what);
    if (!Array.isArray(items)) throw new ReadFailure(`could not list ${what}: the answer is no list`);
    all.push(...items);
    if (items.length < PER_PAGE) return all;
  }
  throw new ReadFailure(`${what} run past ${MOST_PAGES} pages of ${PER_PAGE}, more than this command reads`);
}
// Why an answer GitHub gave, said as whose, holds no object with an integer id, or null when it
// does. Such an answer is unread, never absent: a ruleset GitHub answers for with nothing in it is
// not known to be missing (D212).
const idLeftOut = (x, whose) => {
  if (!isObj(x)) return `${whose} is ${String(JSON.stringify(x)).slice(0, 80)}, no object`;
  if (!Number.isInteger(x.id)) return `${whose} names ${x.id === undefined ? 'no id' : `the id ${JSON.stringify(x.id)}, no integer`}`;
  return null;
};
// One object GitHub answered 200 for, with its integer id; anything else is unread.
async function readOne(request, path, what) {
  const r = await request({ path });
  if (r.status !== 200) throw new ReadFailure(`could not read ${what}: GitHub answered ${r.status}`);
  const x = parse(r, what);
  const no = idLeftOut(x, "GitHub's answer");
  if (no) throw new ReadFailure(`could not read ${what}: ${no}`);
  return x;
}
// One ruleset as GitHub holds it, read by its own id.
const readRuleset = (request, name, id) => readOne(request, `/orgs/${ORG}/rulesets/${id}`, `the ruleset ${name} (${id})`);

// machine-rule-required's own check on GitHub: the repository id its file names is
// dazzer-io/.github's, as GitHub gives it. Returns the refusal, or null.
async function sharedIdHolds(request, body, path) {
  const { id } = await readOne(request, `/repos/${SHARED}`, SHARED);
  const named = body.rules[0].parameters.workflows[0].repository_id;
  return id === named ? null : `${SHARED}'s repository id is ${id} on GitHub, not ${named}, the one ${path} names`;
}

// The rulesets this command keeps, each with its file in this folder, its check, and, where it has
// one, its own check on GitHub, in the order they are written. Each stands alone.
const KEPT = [
  { name: RULESET_NAME, file: 'ruleset.json', what: "the rule's ruleset", check: (r) => checkRuleset(r), onGitHub: sharedIdHolds },
  { name: MAIN_SPELLING_NAME, file: 'main-spelling.json', what: `the ruleset ${MAIN_SPELLING_NAME}`, check: checkMainSpelling },
  { name: CODEQL_COMPLETE_NAME, file: 'codeql-complete.json', what: `the ruleset ${CODEQL_COMPLETE_NAME}`, check: checkCodeqlComplete },
];

// One kept ruleset's file, read and held to its check, before GitHub is called: its body, or why
// it is held back.
function fileOf(k, path) {
  let body;
  try { body = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { ...k, path, action: 'hold', kind: 'REFUSED', why: `${path} could not be read as JSON: ${e.message}` }; }
  const problems = k.check(body);
  if (problems.length) return { ...k, path, action: 'hold', kind: 'REFUSED', why: `${path} is not ${k.what}: ${problems.join('; ')}` };
  return { ...k, path, body };
}

// One kept ruleset's plan, given its file and the organisation's rulesets as listed: its own check
// on GitHub, its live version found by name and read by the id the list names, and so what --apply
// does with it: create, update, unchanged (written again as it is), or hold it back, saying why.
// Every GitHub call here is inside this one ruleset's containment: what GitHub does not answer
// about it, or answers with no ruleset or no id in it, holds back this one alone.
async function planOne(request, f, found) {
  const hold = (kind, why) => ({ ...f, action: 'hold', kind, why });
  try {
    const no = f.onGitHub ? await f.onGitHub(request, f.body, f.path) : null;
    if (no) return hold('REFUSED', no);
    const named = found.filter((r) => r?.name === f.name);
    if (named.length > 1) return hold('REFUSED', `${ORG} holds ${named.length} rulesets named ${f.name} (${named.map((r) => r.id).join(', ')}), so which one is its file's is unknown`);
    if (!named.length) return { ...f, action: 'create' };
    const { id } = named[0];
    const live = await readRuleset(request, f.name, id);
    const diff = diffRuleset(live, f.body);
    return { ...f, id, live, diff, action: diff.length ? 'update' : 'unchanged' };
  } catch (e) {
    if (!(e instanceof ReadFailure)) throw e;
    return hold('UNREAD', e.message);
  }
}

// --apply for one planned ruleset: a PUT to the id the list named where it is there, a POST where
// it is not, then read back at once, an update by that id and a creation by the id in GitHub's
// answer to it. Says what came of it, and returns whether it is now its file's. Every GitHub call
// here is inside this one ruleset's containment, so gh getting no answer holds back this one alone
// and the others are still tried (D212): before GitHub answers the write, the write may have
// landed; after, it was written and is not read back. A 5xx answer is GitHub failing after the
// write may have landed, so it is said the same way; a 4xx is GitHub refusing it, so it did not.
async function applyOne(request, s, out, err) {
  if (s.action === 'hold') { err(`${s.kind}: ${s.name} was held back, not written: ${s.why}`); return false; }
  const act = s.action === 'create' ? 'creation' : 'update';
  const mayHaveLanded = (what, detail) => `UNREAD: ${s.name} was held back, its ${act} may have landed: ${what}, so whether it is its file's version is unknown until the run without --apply reads it: ${detail}`;
  let answered = false;
  try {
    const wrote = s.action === 'create'
      ? await request({ method: 'POST', path: `/orgs/${ORG}/rulesets`, body: s.body })
      : await request({ method: 'PUT', path: `/orgs/${ORG}/rulesets/${s.id}`, body: s.body });
    answered = true;
    if (wrote.status >= 500 && wrote.status <= 599) { err(mayHaveLanded(`GitHub answered ${wrote.status}`, wrote.text.slice(0, 300))); return false; }
    if (wrote.status !== 200 && wrote.status !== 201) { err(`REFUSED: GitHub answered ${wrote.status} to the ${act} of ${s.name}, so it is not its file's version: ${wrote.text.slice(0, 300)}`); return false; }
    let id = s.id;
    if (s.action === 'create') {
      const made = parse(wrote, `GitHub's answer to the creation of ${s.name}`);
      const no = idLeftOut(made, "GitHub's answer to its creation");
      if (no) throw new ReadFailure(no);
      id = made.id;
    }
    const back = await readRuleset(request, s.name, id);
    const d = diffRuleset(back, s.body);
    if (d.length) { err(`REFUSED: ${s.name} as read back still differs from the file:\n  ${d.join('\n  ')}`); return false; }
    out(`${s.name} (${id}) on ${ORG} now is the file's version, enforcement ${back.enforcement}`);
    return true;
  } catch (e) {
    if (!(e instanceof ReadFailure)) throw e;
    err(answered
      ? `UNREAD: ${s.name} was written, and not read back: ${e.message}`
      : mayHaveLanded("GitHub's answer never came", e.message));
    return false;
  }
}

// The read for one planned ruleset: what it is on GitHub against its file, and what --apply would
// do with it. Returns whether it is its file's version.
function sayOne(s, out, err) {
  if (s.action === 'hold') { err(`${s.kind}: ${s.name} would be held back by --apply, not written: ${s.why}`); return false; }
  if (s.action === 'unchanged') { out(`${s.name} (${s.id}) on ${ORG} is the file's version, enforcement ${s.live.enforcement}`); return true; }
  if (s.action === 'create') { out(`${s.name} is not on ${ORG}: --apply would create it from ${s.path}`); return false; }
  out(`${s.name} (${s.id}) on ${ORG} differs from ${s.path}:`);
  for (const line of s.diff) out(`  ${line}`);
  return false;
}
// The read's closing line: what --apply would write, each with its action, and what it would hold back.
const sayPlan = (plans) => {
  const written = plans.filter((s) => s.action !== 'hold').map((s) => `${s.name} (${s.action})`);
  const held = plans.filter((s) => s.action === 'hold').map((s) => s.name);
  return `--apply would write ${written.length ? written.join(', ') : 'nothing'}${held.length ? `, and hold back ${held.join(', ')}` : ''}`;
};

const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const USAGE = 'usage: node machine-rule/apply-ruleset.mjs [--apply | --readings [--moving <a,b>] [--only <a,b>] [--class production]]';

// file names machine-rule-required's file, as it always has; files names any kept ruleset's file
// by the ruleset's name. Each defaults to its file in this folder.
export async function main(argv, { request = ghRequest, out = console.log, err = console.error, file, files = {}, listsDir = HERE } = {}) {
  let mode = 'diff';
  let moving = [];
  let only = null;
  let production = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') mode = mode === 'diff' ? 'apply' : 'both';
    else if (a === '--readings') mode = mode === 'diff' ? 'readings' : 'both';
    else if (a === '--moving') moving = list(argv[++i]);
    else if (a === '--only') only = list(argv[++i]);
    else if (a === '--class') { if (argv[++i] !== 'production') { err(`${USAGE}\n--class takes production alone`); return 2; } production = true; }
    else { err(`${USAGE}\nunknown argument ${a}`); return 2; }
  }
  if (mode === 'both') { err(`${USAGE}\n--apply and --readings are two runs`); return 2; }
  if (mode === 'readings') {
    try {
      const lists = readLists(listsDir);
      const call = (path, accept) => request({ path, accept });
      const compare = async ({ owner, repo, base, head }) => {
        const r = await request({ path: `/repos/${owner}/${repo}/compare/${base}...${head}` });
        if (r.status !== 200) throw new Error(`GitHub answered ${r.status}`);
        return parse(r, 'the compare').status;
      };
      const r = await readings({ call, lists, moving, only, production, compare });
      out(`readings: ${only ? `${only.join(', ')}` : `every private, non-archived ${ORG} repository`} read at its default branch${production ? ', refusals of jobs in workflows that sign in alone' : ''}${moving.length ? `, ${moving.join(', ')} read as moving` : ''}: ${r.refused} refused${r.unread.length ? `, ${r.unread.length} unread` : ''}`);
      for (const l of r.lines) out(l);
      for (const l of r.unread) err(l);
      return r.unread.length ? 2 : r.refused ? 1 : 0;
    } catch (e) {
      if (!(e instanceof ReadFailure) && !(e instanceof Unread)) throw e;
      err(`UNREAD: ${e.message}`);
      return 2;
    }
  }
  // Each file is read and checked before GitHub is called; then the organisation's rulesets are
  // listed once, across every page, before any write, and that list alone failing is GitHub not
  // read at all, exit 2. Everything after it is one ruleset's alone (D212).
  const filesRead = KEPT.map((k) => fileOf(k, files[k.name] ?? (k.name === RULESET_NAME ? file : undefined) ?? join(HERE, k.file)));
  let found;
  try {
    found = await readPages(request, `/orgs/${ORG}/rulesets`, `${ORG}'s rulesets`);
  } catch (e) {
    if (!(e instanceof ReadFailure)) throw e;
    err(`UNREAD: ${e.message}, so nothing was written`);
    return 2;
  }
  // The read and --apply read one plan, so the read says exactly what --apply would then do.
  const plans = [];
  for (const f of filesRead) plans.push(f.action === 'hold' ? f : await planOne(request, f, found));
  let all = true;
  if (mode === 'diff') {
    for (const s of plans) if (!sayOne(s, out, err)) all = false;
    out(sayPlan(plans));
    return all ? 0 : 1;
  }
  for (const s of plans) if (!(await applyOne(request, s, out, err))) all = false;
  return all ? 0 : 1;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exitCode = await main(process.argv.slice(2));
