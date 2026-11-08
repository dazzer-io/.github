#!/usr/bin/env node
// The organisation ruleset machine-rule-required (machine-rule/ruleset.json): the workflows rule
// that runs .github/workflows/machine-rule.yml, read from dazzer-io/.github (named by its
// repository id) at refs/heads/main, on the default branch of every repository, not on create.
//
//   node machine-rule/apply-ruleset.mjs              reads the live ruleset with gh and prints how it
//                                                    differs from the file (exit 0 when they match,
//                                                    1 when they differ or it is not there)
//   node machine-rule/apply-ruleset.mjs --apply      writes the file's version, and only that ruleset:
//                                                    it is a security setting, so this is Ben's own
//                                                    command (decisions 121, 177); nothing else runs it
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
// Before writing, the file must pass checkRuleset, and the live repository id of dazzer-io/.github
// must equal the one the file names. The write goes to the ruleset named machine-rule-required
// alone: a PUT to its own id when it is there, a POST when it is not. No other ruleset is read for
// writing or written. Every GitHub call goes through the request handed to main(), so tests need
// no network.
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

// The parts of a ruleset that are its meaning, as GitHub returns them and as the file writes them.
const meaningOf = (r) => ({
  name: r?.name,
  target: r?.target,
  enforcement: r?.enforcement,
  bypass_actors: r?.bypass_actors ?? [],
  conditions: r?.conditions,
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
async function liveRuleset(request) {
  const list = await request({ path: `/orgs/${ORG}/rulesets?per_page=100` });
  if (list.status !== 200) throw new ReadFailure(`could not list ${ORG}'s rulesets: GitHub answered ${list.status}`);
  const found = parse(list, `${ORG}'s rulesets`);
  if (!Array.isArray(found)) throw new ReadFailure(`could not list ${ORG}'s rulesets: the answer is no list`);
  const named = found.filter((r) => r?.name === RULESET_NAME);
  if (named.length > 1) throw new ReadFailure(`${ORG} holds ${named.length} rulesets named ${RULESET_NAME}, so which one is the rule's is unknown`);
  if (!named.length) return null;
  const one = await request({ path: `/orgs/${ORG}/rulesets/${named[0].id}` });
  if (one.status !== 200) throw new ReadFailure(`could not read the ruleset ${RULESET_NAME} (${named[0].id}): GitHub answered ${one.status}`);
  return parse(one, `the ruleset ${RULESET_NAME}`);
}

const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const USAGE = 'usage: node machine-rule/apply-ruleset.mjs [--apply | --readings [--moving <a,b>] [--only <a,b>] [--class production]]';

export async function main(argv, { request = ghRequest, out = console.log, err = console.error, file = join(HERE, 'ruleset.json'), listsDir = HERE } = {}) {
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
    const wanted = JSON.parse(readFileSync(file, 'utf8'));
    const problems = checkRuleset(wanted);
    if (problems.length) { err(`REFUSED: ${file} is not the rule's ruleset: ${problems.join('; ')}`); return 2; }
    const live = await liveRuleset(request);
    if (mode === 'diff') {
      if (!live) { out(`${RULESET_NAME} is not on ${ORG}: --apply would create it from ${file}`); return 1; }
      const lines = diffRuleset(live, wanted);
      if (!lines.length) { out(`${RULESET_NAME} (${live.id}) on ${ORG} is the file's version, enforcement ${live.enforcement}`); return 0; }
      out(`${RULESET_NAME} (${live.id}) on ${ORG} differs from ${file}:`);
      for (const l of lines) out(`  ${l}`);
      return 1;
    }
    const repo = await request({ path: `/repos/${SHARED}` });
    if (repo.status !== 200) throw new ReadFailure(`could not read ${SHARED}: GitHub answered ${repo.status}`);
    const id = parse(repo, SHARED).id;
    const named = wanted.rules[0].parameters.workflows[0].repository_id;
    if (id !== named) { err(`REFUSED: ${SHARED}'s repository id is ${id} on GitHub, not ${named}, the one ${file} names, so nothing was written`); return 2; }
    const wrote = live
      ? await request({ method: 'PUT', path: `/orgs/${ORG}/rulesets/${live.id}`, body: wanted })
      : await request({ method: 'POST', path: `/orgs/${ORG}/rulesets`, body: wanted });
    if (wrote.status !== 200 && wrote.status !== 201) { err(`REFUSED: GitHub answered ${wrote.status} to the ${live ? 'update' : 'creation'} of ${RULESET_NAME}: ${wrote.text.slice(0, 300)}`); return 2; }
    const after = await liveRuleset(request);
    const left = after ? diffRuleset(after, wanted) : ['the ruleset is not there after the write'];
    if (left.length) { err(`REFUSED: ${RULESET_NAME} as read back still differs from the file:\n  ${left.join('\n  ')}`); return 2; }
    out(`${RULESET_NAME} (${after.id}) on ${ORG} now is the file's version, enforcement ${after.enforcement}`);
    return 0;
  } catch (e) {
    if (!(e instanceof ReadFailure) && !(e instanceof Unread)) throw e;
    err(`UNREAD: ${e.message}`);
    return 2;
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) process.exitCode = await main(process.argv.slice(2));
