#!/usr/bin/env node
// The organisation rulesets this repository keeps as files, each written by Ben's hand alone:
//   machine-rule-required (machine-rule/ruleset.json): the workflows rule that runs
//     .github/workflows/machine-rule.yml, read from dazzer-io/.github (named by its repository id)
//     at refs/heads/main, on the default branch of every repository, not on create;
//   main-spelling-refused (machine-rule/main-spelling.json): in dazzer and dazzer-app, creating a
//     branch spelled main in other letters is refused, with no bypass (decisions 188, 192);
//   codeql-complete-required (machine-rule/codeql-complete.json): in dazzer and dazzer-app, the
//     shared scan's codeql / CodeQL complete from GitHub Actions (integration 15368) is required
//     on the default branch, not on create (decisions 188, 192).
//
//   node machine-rule/apply-ruleset.mjs              reads each live ruleset with gh and prints how it
//                                                    differs from its file, and exactly what --apply
//                                                    would then do (exit 0 when every one matches,
//                                                    1 when one differs or is not there, 2 refused
//                                                    or unread)
//   node machine-rule/apply-ruleset.mjs --apply      writes each file's version, and only those
//                                                    rulesets: they are security settings, so this is
//                                                    Ben's own command (decisions 121, 177, 192);
//                                                    nothing else runs it (exit 0 when each is read
//                                                    back as its file's, 1 when the guard held
//                                                    codeql-complete-required back and the others
//                                                    were, 2 refused or unread)
//   node machine-rule/apply-ruleset.mjs --readings [--moving <a,b>] [--only <a,b>] [--class production]
//                                                    runs machine-rule/judge.mjs over every private,
//                                                    non-archived repository's workflow folder at its
//                                                    default branch, read with gh, and lists each
//                                                    refusal (exit 0 none, 1 some, 2 unread)
//
// --moving treats the named repositories as moving (their literal-label jobs need kept.json
// entries) even where they read no setting; --only reads just those repositories; --class
// production lists only the refusals of jobs in workflows that sign in, so each milestone's
// finish check reads exactly what that milestone delivers.
//
// Before anything is written, every file must pass its own check, the live repository id of
// dazzer-io/.github must equal the one ruleset.json names, and no branch spelled main in other
// letters may exist in dazzer or dazzer-app, since main-spelling-refused's creation rule never
// touches one already there: one of those refusals and nothing is written (decision 208).
// codeql-complete-required's guard is read, in the read and in --apply alike, only when that
// ruleset would be created or changed, and gates its write alone: each repository the file names
// must carry codeql / CodeQL complete passed from integration 15368 on the head of the newest pull
// request merged into its default branch, and on the newest merge-group commit where that branch's
// rules hold a merge queue, never on the branch's own head. While it refuses, the others are still
// written, and the refusal says what would pass it. Each write goes to the ruleset of its file's
// name alone: a PUT to its own id when it is there, a POST when it is not. No other ruleset is read
// for writing or written. Each written one is read back after. Every GitHub call goes through the
// request handed to main(), so tests need no network.
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
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Every way a ruleset differs from the one this repository keeps, each as a sentence.
export function checkRuleset(r, { repositoryId = SHARED_REPOSITORY_ID } = {}) {
  const problems = [];
  if (!isObj(r)) return ['the ruleset is not an object'];
  if (r.name !== RULESET_NAME) problems.push(`it is named ${JSON.stringify(r.name)}, not ${RULESET_NAME}`);
  if (r.target !== 'branch') problems.push(`its target is ${JSON.stringify(r.target)}, not branch`);
  if (!['evaluate', 'active'].includes(r.enforcement)) problems.push(`its enforcement is ${JSON.stringify(r.enforcement)}, neither evaluate nor active`);
  if (!Array.isArray(r.bypass_actors) || r.bypass_actors.length) problems.push('it names bypass actors, so someone could merge past the rule');
  const ref = r.conditions?.ref_name;
  if (!isObj(ref) || !same(ref.include, ['~DEFAULT_BRANCH']) || !same(ref.exclude ?? [], [])) problems.push(`its ref condition is ${JSON.stringify(ref)}, not the default branch alone (include ~DEFAULT_BRANCH, exclude nothing)`);
  const repo = r.conditions?.repository_name;
  if (!isObj(repo) || !same(repo.include, ['~ALL']) || !same(repo.exclude ?? [], [])) problems.push(`its repository condition is ${JSON.stringify(repo)}, narrower than every repository (include ~ALL, exclude nothing)`);
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
export const RULE_REPOSITORIES = ['dazzer', 'dazzer-app'];
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

// What the two rules on main share: a branch ruleset, active, with no bypass, in dazzer and
// dazzer-app by name, protected so that renaming either cannot take it out of the rule, holding
// the conditions ref_name and repository_name alone, and one rule of the type it names.
function checkOnMain(r, name, ruleType) {
  const problems = [];
  if (!isObj(r)) return { problems: ['the ruleset is not an object'], rule: null };
  if (r.name !== name) problems.push(`it is named ${JSON.stringify(r.name)}, not ${name}`);
  if (r.target !== 'branch') problems.push(`its target is ${JSON.stringify(r.target)}, not branch`);
  if (r.enforcement !== 'active') problems.push(`its enforcement is ${JSON.stringify(r.enforcement)}, not active`);
  if (!Array.isArray(r.bypass_actors) || r.bypass_actors.length) problems.push('it names bypass actors, so someone could pass the rule');
  const repo = r.conditions?.repository_name;
  if (!isObj(repo) || !same(repo.include, RULE_REPOSITORIES)) problems.push(`its repository condition includes ${JSON.stringify(isObj(repo) ? repo.include : repo)}, not dazzer and dazzer-app by name`);
  if (isObj(repo) && !same(repo.exclude ?? [], [])) problems.push(`its repository condition excludes ${JSON.stringify(repo.exclude)}`);
  if (isObj(repo) && repo.protected !== true) problems.push(`its repository condition sets protected ${JSON.stringify(repo.protected)}, not protected: true, so renaming dazzer or dazzer-app would take it out of the rule`);
  for (const k of Object.keys(r.conditions ?? {})) if (!['ref_name', 'repository_name'].includes(k)) problems.push(`it holds the condition ${k}, which narrows the repositories it runs in`);
  const rules = Array.isArray(r.rules) ? r.rules : [];
  if (rules.length !== 1) problems.push(`it holds ${Array.isArray(r.rules) ? r.rules.length : 'no'} rules, not one ${ruleType} rule`);
  for (const rule of rules) if (rule?.type !== ruleType) problems.push(`it holds a rule of type ${JSON.stringify(rule?.type)}, not ${ruleType}`);
  return { problems, rule: rules.length === 1 && rules[0]?.type === ruleType ? rules[0] : null };
}

// Every way a ruleset differs from main-spelling-refused, each as a sentence. Its patterns,
// matched case-sensitively, must match exactly the fifteen other spellings of main and never main
// itself, with no exclude, and its one rule is creation: so it holds whether GitHub folds case or
// not, and even folded it restricts only the creation of main, never a push to it (decision 192).
export function checkMainSpelling(r) {
  const { problems, rule } = checkOnMain(r, MAIN_SPELLING_NAME, 'creation');
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

// Every way a ruleset differs from codeql-complete-required, each as a sentence: the default
// branch alone, one required check, codeql / CodeQL complete from integration 15368, not enforced
// on create, strict policy off.
export function checkCodeqlComplete(r) {
  const { problems, rule } = checkOnMain(r, CODEQL_COMPLETE_NAME, 'required_status_checks');
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

// The rulesets this command keeps, each with its file in this folder and its check, in the order
// they are written. A guard, read only when its ruleset would be created or changed, gates that
// ruleset's own write alone.
const KEPT = [
  { name: RULESET_NAME, file: 'ruleset.json', what: "the rule's ruleset", check: (r) => checkRuleset(r) },
  { name: MAIN_SPELLING_NAME, file: 'main-spelling.json', what: `the ruleset ${MAIN_SPELLING_NAME}`, check: checkMainSpelling },
  { name: CODEQL_COMPLETE_NAME, file: 'codeql-complete.json', what: `the ruleset ${CODEQL_COMPLETE_NAME}`, check: checkCodeqlComplete, guard: (request, body) => readCodeqlGuard(request, body.conditions.repository_name.include) },
];

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
// Every page of a list GitHub answers a page at a time. Each list page below takes per_page, "The
// number of results per page (max 100)", and page, "The page number of the results to fetch", so
// pages 1, 2, ... are read until one holds fewer than 100, or until done, given every item so far,
// says no later page can matter. pick takes the list out of an answer that wraps it.
const PER_PAGE = 100;
const MOST_PAGES = 50;
async function readPages(request, path, what, { pick = (x) => x, done = () => false } = {}) {
  const all = [];
  for (let page = 1; page <= MOST_PAGES; page++) {
    const r = await request({ path: `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}` });
    if (r.status !== 200) throw new ReadFailure(`could not list ${what}: GitHub answered ${r.status}`);
    const items = pick(parse(r, what));
    if (!Array.isArray(items)) throw new ReadFailure(`could not list ${what}: the answer is no list`);
    all.push(...items);
    if (items.length < PER_PAGE || done(all)) return all;
  }
  throw new ReadFailure(`${what} run past ${MOST_PAGES} pages of ${PER_PAGE}, more than this command reads`);
}
const segments = (branch) => branch.split('/').map(encodeURIComponent).join('/');

// Each kept ruleset as GitHub holds it, by name, read by its own id: null when it is not there.
// The organisation's rulesets are listed across every page (docs.github.com, rest/orgs/rules, "Get
// all organization repository rulesets", per_page and page, each carrying id and name), so a kept
// one past the first hundred is never read as absent and created twice.
async function liveRulesets(request) {
  const found = await readPages(request, `/orgs/${ORG}/rulesets`, `${ORG}'s rulesets`);
  const live = new Map();
  for (const { name } of KEPT) {
    const named = found.filter((r) => r?.name === name);
    if (named.length > 1) throw new ReadFailure(`${ORG} holds ${named.length} rulesets named ${name}, so which one is the rule's is unknown`);
    if (!named.length) { live.set(name, null); continue; }
    const one = await request({ path: `/orgs/${ORG}/rulesets/${named[0].id}` });
    if (one.status !== 200) throw new ReadFailure(`could not read the ruleset ${name} (${named[0].id}): GitHub answered ${one.status}`);
    live.set(name, parse(one, `the ruleset ${name}`));
  }
  return live;
}

// Each branch spelled main in other letters, one of the fifteen, in the repositories
// main-spelling-refused names (decision 208). Its one rule is creation, which never touches a
// branch already there, so while one exists the guard github.ref == 'refs/heads/main', which
// ignores case, is true on a push to it. Every branch is listed across every page
// (docs.github.com, rest/branches/branches, "List branches", each carrying its name).
async function otherSpellings(request, repositories) {
  const found = [];
  for (const name of repositories) {
    const branches = await readPages(request, `/repos/${ORG}/${name}/branches`, `${ORG}/${name}'s branches`);
    for (const b of branches) if (OTHER_SPELLINGS.includes(`refs/heads/${b?.name}`)) found.push(`${ORG}/${name} holds the branch ${b.name}`);
  }
  return found;
}

// codeql-complete-required's guard (decisions 192, 208). With the strict policy off, a required
// check is judged on the commit being merged: a pull request's head, or a merge queue's merge-group
// commit. The default branch's own head never decides it, and a merge by github-actions[bot] leaves
// that head with no run at all. So for each repository the file names, the guard reads the head of
// the newest pull request merged into its default branch and, where that branch's rules hold a
// merge queue, the newest merge-group commit, and each must carry codeql / CodeQL complete passed
// from GitHub Actions, or the rule would refuse merges there from the moment it is written. Read
// from docs.github.com's REST pages:
//   - rest/repos/repos, "Get a repository": GET /repos/{owner}/{repo}, its default_branch;
//   - rest/pulls/pulls, "List pull requests": GET /repos/{owner}/{repo}/pulls with state closed,
//     base the default branch, sort updated and direction desc (sort updated is asc unless
//     direction says), each carrying number, merged_at (null on one closed unmerged), updated_at,
//     base.ref and head.sha. A merge updates a pull request, so its updated_at is never before its
//     merged_at: once a page ends on one updated before the newest merged_at seen, no later page
//     holds a newer merge;
//   - rest/repos/rules, "Get rules for a branch": GET /repos/{owner}/{repo}/rules/branches/{branch},
//     every active rule on the branch whatever level sets it, a merge queue's of type merge_queue;
//   - rest/actions/workflow-runs, "List workflow runs for a repository": GET
//     /repos/{owner}/{repo}/actions/runs with event merge_group, each carrying id, event, head_sha
//     and created_at. The page names no order, so every page is read and the latest created_at,
//     then the highest id, is the newest merge-group commit;
//   - rest/checks/runs, "List check runs for a Git reference": GET
//     /repos/{owner}/{repo}/commits/{ref}/check-runs with check_name, each carrying id, name,
//     head_sha, status, conclusion and app.id.
// A run counts only if it is on that commit's exact head_sha, from integration 15368, named exactly
// codeql / CodeQL complete; the newest such run, by id, decides: completed, concluded success. A
// run of that name from another app counts for nothing. Returns what it read, a line a commit, each
// refusal with its reason, what GitHub would not answer, and whether a merge queue was read.
async function readCodeqlGuard(request, repositories) {
  const passed = [];
  const refusals = [];
  const unread = [];
  let queue = false;
  const judge = async (name, at, sha) => {
    const runs = await request({ path: `/repos/${ORG}/${name}/commits/${sha}/check-runs?check_name=${encodeURIComponent(CODEQL_CONTEXT)}&filter=latest&per_page=100` });
    if (runs.status !== 200) throw new ReadFailure(`could not list the check runs on ${at}: GitHub answered ${runs.status}`);
    const body = parse(runs, `the check runs on ${at}`);
    if (!isObj(body) || !Array.isArray(body.check_runs)) throw new ReadFailure(`the check runs on ${at} are no list`);
    if (Number(body.total_count) > body.check_runs.length) throw new ReadFailure(`${at} holds ${body.total_count} check runs named ${CODEQL_CONTEXT}, more than one page`);
    const named = body.check_runs.filter((c) => c?.name === CODEQL_CONTEXT && c?.head_sha === sha);
    const ours = named.filter((c) => c?.app?.id === ACTIONS_INTEGRATION_ID);
    if (!named.length) { refusals.push(`${at} carries no check run named ${CODEQL_CONTEXT}`); return; }
    if (!ours.length) {
      const apps = [...new Set(named.map((c) => `integration ${c?.app?.id}${c?.app?.slug ? ` (${c.app.slug})` : ''}`))].join(', ');
      refusals.push(`${at} carries ${CODEQL_CONTEXT} only from ${apps}, not from GitHub Actions (integration ${ACTIONS_INTEGRATION_ID})`);
      return;
    }
    const last = ours.reduce((a, c) => (Number(c.id) > Number(a.id) ? c : a));
    if (last.status !== 'completed') refusals.push(`${at}: its latest ${CODEQL_CONTEXT} from integration ${ACTIONS_INTEGRATION_ID} is ${last.status}, not completed`);
    else if (last.conclusion !== 'success') refusals.push(`${at}: its latest ${CODEQL_CONTEXT} from integration ${ACTIONS_INTEGRATION_ID} concluded ${last.conclusion}, not success`);
    else passed.push(`${at} carries ${CODEQL_CONTEXT} passed from integration ${ACTIONS_INTEGRATION_ID}`);
  };
  const isSha = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
  for (const name of repositories) {
    try {
      const repo = await request({ path: `/repos/${ORG}/${name}` });
      if (repo.status !== 200) throw new ReadFailure(`could not read ${ORG}/${name}: GitHub answered ${repo.status}`);
      const branch = parse(repo, `${ORG}/${name}`).default_branch;
      if (typeof branch !== 'string' || !branch) throw new ReadFailure(`${ORG}/${name} names no default branch`);
      const merged = (all) => all.filter((p) => p?.base?.ref === branch && typeof p?.merged_at === 'string' && !Number.isNaN(Date.parse(p.merged_at)))
        .reduce((a, p) => (!a || Date.parse(p.merged_at) > Date.parse(a.merged_at) || (Date.parse(p.merged_at) === Date.parse(a.merged_at) && p.number > a.number) ? p : a), null);
      const pulls = await readPages(request, `/repos/${ORG}/${name}/pulls?state=closed&base=${encodeURIComponent(branch)}&sort=updated&direction=desc`, `${ORG}/${name}'s closed pull requests into ${branch}`, {
        done: (all) => { const n = merged(all); return n !== null && Date.parse(all[all.length - 1]?.updated_at) < Date.parse(n.merged_at); },
      });
      const newest = merged(pulls);
      if (!newest) refusals.push(`${ORG}/${name} has no pull request merged into ${branch}, so no commit shows how ${CODEQL_CONTEXT} reads there`);
      else if (!isSha(newest.head?.sha)) throw new ReadFailure(`${ORG}/${name}'s pull request #${newest.number} names no head commit`);
      else await judge(name, `${ORG}/${name}'s newest pull request merged into ${branch}, #${newest.number}, head ${newest.head.sha}`, newest.head.sha);
      const rules = await readPages(request, `/repos/${ORG}/${name}/rules/branches/${segments(branch)}`, `the rules on ${ORG}/${name}'s ${branch}`);
      if (!rules.some((r) => r?.type === 'merge_queue')) continue;
      queue = true;
      const runs = await readPages(request, `/repos/${ORG}/${name}/actions/runs?event=merge_group`, `${ORG}/${name}'s workflow runs started by merge_group`, { pick: (b) => (isObj(b) ? b.workflow_runs : null) });
      const groups = runs.filter((r) => r?.event === 'merge_group' && isSha(r?.head_sha) && !Number.isNaN(Date.parse(r?.created_at)));
      if (!groups.length) { refusals.push(`${ORG}/${name}'s ${branch} holds a merge queue, and no workflow run started by merge_group names a merge-group commit, so nothing shows how ${CODEQL_CONTEXT} reads on a queued merge`); continue; }
      const g = groups.reduce((a, r) => (Date.parse(r.created_at) > Date.parse(a.created_at) || (Date.parse(r.created_at) === Date.parse(a.created_at) && Number(r.id) > Number(a.id)) ? r : a));
      await judge(name, `${ORG}/${name}'s newest merge-group commit ${g.head_sha}`, g.head_sha);
    } catch (e) {
      if (!(e instanceof ReadFailure)) throw e;
      unread.push(e.message);
    }
  }
  return { passed, refusals, unread, queue };
}
// What would make codeql-complete-required's guard pass, said beside its refusal.
const passesOnce = (g) => `it passes once the newest pull request merged into each repository's default branch carries ${CODEQL_CONTEXT} passed from integration ${ACTIONS_INTEGRATION_ID} on its head: the repository's caller of the shared scan runs on pull_request, and the next pull request merged there passes the check${g.queue ? `; and, where the branch's rules hold a merge queue, once its newest merge-group commit carries it too: merge_group among the caller's triggers, and the next queued merge passing the check` : ''}`;

// What --apply would do, read in full before anything is written, and what the read prints: a
// refusal, which writes nothing, or each kept ruleset with its action (create, update, or
// unchanged, written again as it is) and, where it would be created or changed, its guard's
// reading. A file that fails its check, dazzer-io/.github's id differing from ruleset.json's, and a
// branch spelled main in other letters each refuse every write; a guard refuses its ruleset alone.
async function planOf(request, wanted) {
  const live = await liveRulesets(request);
  const refusals = [];
  const mr = wanted.find((w) => w.name === RULESET_NAME);
  const repo = await request({ path: `/repos/${SHARED}` });
  if (repo.status !== 200) throw new ReadFailure(`could not read ${SHARED}: GitHub answered ${repo.status}`);
  const id = parse(repo, SHARED).id;
  const named = mr.body.rules[0].parameters.workflows[0].repository_id;
  if (id !== named) refusals.push(`${SHARED}'s repository id is ${id} on GitHub, not ${named}, the one ${mr.path} names`);
  const spelling = wanted.find((w) => w.name === MAIN_SPELLING_NAME);
  for (const line of await otherSpellings(request, spelling.body.conditions.repository_name.include)) refusals.push(`${line}, spelled main in other letters, which ${MAIN_SPELLING_NAME}'s creation rule never touches since it already exists: delete or rename it, then run this again`);
  if (refusals.length) return { refusals };
  const steps = [];
  for (const w of wanted) {
    const l = live.get(w.name);
    const diff = l ? diffRuleset(l, w.body) : null;
    const action = !l ? 'create' : diff.length ? 'update' : 'unchanged';
    steps.push({ ...w, live: l, diff, action, read: w.guard && action !== 'unchanged' ? await w.guard(request, w.body) : null });
  }
  return { steps };
}
const heldBack = (s) => Boolean(s.read && (s.read.refusals.length || s.read.unread.length));
const heldWhy = (s) => (s.read.unread.length ? 'its guard unread' : 'its guard refusing');
// The read's closing line: what --apply would write, each with its action, and what it would hold back.
const sayPlan = (steps) => {
  const written = steps.filter((s) => !heldBack(s)).map((s) => `${s.name} (${s.action})`);
  const held = steps.filter(heldBack);
  return `--apply would write ${written.length ? written.join(', ') : 'nothing'}${held.length ? `, and hold back ${held.map((s) => s.name).join(', ')}, ${heldWhy(held[0])}` : ''}`;
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
  try {
    if (mode === 'readings') {
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
    }
    // Every file is read and checked before GitHub is called, so a bad one writes nothing at all.
    const wanted = [];
    const bad = [];
    for (const k of KEPT) {
      const path = files[k.name] ?? (k.name === RULESET_NAME ? file : undefined) ?? join(HERE, k.file);
      let body;
      try { body = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { bad.push(`REFUSED: ${path} could not be read as JSON: ${e.message}`); continue; }
      const problems = k.check(body);
      if (problems.length) bad.push(`REFUSED: ${path} is not ${k.what}: ${problems.join('; ')}`);
      else wanted.push({ ...k, path, body });
    }
    if (bad.length) { for (const l of bad) err(l); return 2; }
    // The read and --apply read one plan, so the read says exactly what --apply would then do.
    const plan = await planOf(request, wanted);
    if (plan.refusals) {
      for (const l of plan.refusals) err(`REFUSED: ${l}, so ${mode === 'diff' ? '--apply would write nothing' : 'nothing was written'}`);
      return 2;
    }
    const { steps } = plan;
    const unread = steps.some((s) => s.read?.unread.length);
    // A guard's reading: each commit it passed, each refusal with what would pass it, and each
    // answer GitHub did not give.
    const sayRead = (s, at, lead) => {
      for (const line of s.read.passed) out(`${at}${lead}reads: ${line}`);
      for (const line of s.read.refusals) out(`${at}${lead}refuses: ${line}`);
      if (s.read.refusals.length) out(`${at}${passesOnce(s.read)}`);
      for (const line of s.read.unread) err(`UNREAD: ${line}`);
    };
    if (mode === 'diff') {
      let differs = false;
      for (const s of steps) {
        const held = heldBack(s);
        if (s.action === 'unchanged') { out(`${s.name} (${s.live.id}) on ${ORG} is the file's version, enforcement ${s.live.enforcement}`); continue; }
        differs = true;
        if (s.action === 'create') out(`${s.name} is not on ${ORG}: --apply would ${held ? `not create it, ${heldWhy(s)}` : `create it from ${s.path}`}`);
        else {
          out(`${s.name} (${s.live.id}) on ${ORG} differs from ${s.path}:`);
          for (const line of s.diff) out(`  ${line}`);
          if (held) out(`  --apply would not change it, ${heldWhy(s)}`);
        }
        if (s.read) sayRead(s, '  ', 'its guard ');
      }
      out(sayPlan(steps));
      return unread ? 2 : differs ? 1 : 0;
    }
    for (const s of steps) if (s.read) for (const line of s.read.passed) out(`${s.name}'s guard reads: ${line}`);
    const held = steps.filter(heldBack);
    // A ruleset its guard holds back is said with why, and what would pass it, whatever the writes.
    const sayHeld = () => {
      for (const s of held) {
        for (const line of s.read.unread) err(`UNREAD: ${line}`);
        err(`REFUSED: ${s.name} was not written, ${heldWhy(s)}${s.read.refusals.length ? `:\n  ${s.read.refusals.join('\n  ')}\n  ${passesOnce(s.read)}` : ''}`);
      }
    };
    const toWrite = steps.filter((s) => !heldBack(s));
    const written = [];
    for (const s of toWrite) {
      const wrote = s.live
        ? await request({ method: 'PUT', path: `/orgs/${ORG}/rulesets/${s.live.id}`, body: s.body })
        : await request({ method: 'POST', path: `/orgs/${ORG}/rulesets`, body: s.body });
      if (wrote.status !== 200 && wrote.status !== 201) {
        err(`REFUSED: GitHub answered ${wrote.status} to the ${s.live ? 'update' : 'creation'} of ${s.name}: ${wrote.text.slice(0, 300)}${written.length ? `\n  written before it: ${written.join(', ')}` : ''}`);
        sayHeld();
        return 2;
      }
      written.push(s.name);
    }
    const after = await liveRulesets(request);
    const left = [];
    for (const s of toWrite) {
      const a = after.get(s.name);
      const d = a ? diffRuleset(a, s.body) : ['the ruleset is not there after the write'];
      if (d.length) left.push(`REFUSED: ${s.name} as read back still differs from the file:\n  ${d.join('\n  ')}`);
    }
    if (left.length) { for (const l of left) err(l); sayHeld(); return 2; }
    for (const s of toWrite) out(`${s.name} (${after.get(s.name).id}) on ${ORG} now is the file's version, enforcement ${after.get(s.name).enforcement}`);
    sayHeld();
    return unread ? 2 : held.length ? 1 : 0;
  } catch (e) {
    if (!(e instanceof ReadFailure) && !(e instanceof Unread)) throw e;
    err(`UNREAD: ${e.message}`);
    return 2;
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exitCode = await main(process.argv.slice(2));
