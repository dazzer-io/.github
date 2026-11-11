// Proves machine-rule/ruleset.json, main-spelling.json, codeql-complete.json and
// machine-rule/apply-ruleset.mjs (decisions 121, 177, 192, 210): the organisation ruleset
// machine-rule-required runs .github/workflows/machine-rule.yml, read from dazzer-io/.github by its
// repository id at refs/heads/main, on the default branch of every repository; main-spelling-refused
// restricts the creation of the fifteen other spellings of main in dazzer, dazzer-app and runners,
// the repositories the locked runner group google-locked admits; and codeql-complete-required
// requires codeql / CodeQL complete from GitHub Actions in dazzer and dazzer-app alone.
// codeql-complete-required is written active, so it blocks, and a file written as evaluate is refused
// (r-3.27); machine-rule-required stays in evaluate, watching, until r-3.37 reads every repository and
// direct pushes to a default branch. Each file is checked by its own check, each
// way it could be wrong red alone; the command's read, write and readings modes are run against a
// fake GitHub that answers the organisation's rulesets a page at a time and dazzer-io/.github's id,
// and nothing else, so each kept ruleset is seen standing alone, nothing here reaches the network,
// and no ruleset is written anywhere. Every failure starts "Could not find".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let A = null;
// What ghRequest throws when gh gets no HTTP status back, so the fake GitHub can fail the same way.
let ReadFailure = null;
let missing = null;
try {
  A = await import('../machine-rule/apply-ruleset.mjs');
  ({ ReadFailure } = await import('../machine-rule/judge.mjs'));
} catch (e) {
  missing = e;
}
const need = () => assert.ok(A, `Could not find machine-rule/apply-ruleset.mjs, the ruleset's one writer: ${missing?.message ?? 'it did not load'}`);
const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch (e) {
    assert.fail(`Could not find ${rel} read as JSON: ${e.message}`);
  }
};
const fileRuleset = () => readJson('machine-rule/ruleset.json');
const spellingFile = () => readJson('machine-rule/main-spelling.json');
const codeqlFile = () => readJson('machine-rule/codeql-complete.json');
const clone = (x) => JSON.parse(JSON.stringify(x));
const ID = 1433582766;
const MR = 'machine-rule-required';
const SPELLING = 'main-spelling-refused';
const CODEQL = 'codeql-complete-required';
const CONTEXT = 'codeql / CodeQL complete';
// GitHub Actions' integration id, as every codeql / CodeQL complete on dazzer's and dazzer-app's
// pull requests carries it (decision 192) and as their main-protection rulesets name it.
const ACTIONS = 15368;
// main-spelling-refused reaches every repository the locked runner group google-locked admits:
// dazzer and dazzer-app, and runners for its locked canary (r-3.45); codeql-complete-required stays
// in dazzer and dazzer-app alone.
const SPELLING_REPOSITORIES = ['dazzer', 'dazzer-app', 'runners'];
const CODEQL_REPOSITORIES = ['dazzer', 'dazzer-app'];
// The four patterns decision 192 names, in its words.
const PATTERNS = ['refs/heads/M[Aa][Ii][Nn]', 'refs/heads/mA[Ii][Nn]', 'refs/heads/maI[Nn]', 'refs/heads/maiN'];
// The sixteen spellings of main, each letter in either case, main itself first.
const SPELLINGS = Array.from({ length: 16 }, (_, m) => `refs/heads/${[...'main'].map((c, i) => ((m >> (3 - i)) & 1 ? c.toUpperCase() : c)).join('')}`);
// The checks of the two new rulesets, needed before any case reads them.
const needKept = () => {
  need();
  for (const k of ['checkMainSpelling', 'checkCodeqlComplete', 'namesMatched']) assert.equal(typeof A[k], 'function', `Could not find apply-ruleset.mjs's ${k}, so the rulesets main-spelling-refused and codeql-complete-required are not held to their files (decision 192)`);
};
// A file of its own in a fresh folder under the system's temp folder, for a case that hands the
// command a file other than the one kept here.
const scratch = (name, text) => {
  const path = join(mkdtempSync(join(tmpdir(), 'machine-rule-ruleset-')), name);
  if (text !== undefined) writeFileSync(path, text);
  return path;
};
// Each [name, change, says] case run against apply-ruleset.mjs's check of that name: a clone of base,
// changed, then checked, and a miss for each case whose problems hold none that says matches, or
// whose check throws rather than returning a problem.
const refusalsMissed = (check, base, cases) => {
  const misses = [];
  for (const [name, change, says] of cases) {
    const r = clone(base);
    change(r);
    let problems;
    try { problems = A[check](r); } catch (e) { misses.push(`Could not find ${check} returning a problem for ${name}: it threw ${e?.constructor?.name} ${e?.message}`); continue; }
    if (!problems.some((p) => says.test(p))) misses.push(`Could not find ${check} refusing ${name}: ${JSON.stringify(problems)}`);
  }
  return misses;
};

test('ruleset.json is the rule\'s ruleset: machine-rule.yml of dazzer-io/.github at refs/heads/main, every repository\'s default branch, evaluate until r-3.37', () => {
  need();
  const r = fileRuleset();
  assert.deepEqual(A.checkRuleset(r), [], 'Could not find machine-rule/ruleset.json passing checkRuleset');
  assert.equal(r.enforcement, 'evaluate', `Could not find machine-rule-required written as evaluate: it stays watching until r-3.37 reads every repository, public ones included, and direct pushes to a default branch, which its 21 passing pull requests do not (decision 177): ${JSON.stringify(r.enforcement)}`);
  assert.equal(A.SHARED_REPOSITORY_ID, ID, 'Could not find dazzer-io/.github\'s repository id as GitHub gives it');
  const w = r.rules?.[0]?.parameters?.workflows?.[0];
  assert.deepEqual(w, { path: '.github/workflows/machine-rule.yml', ref: 'refs/heads/main', repository_id: ID }, `Could not find the workflows rule naming machine-rule.yml of dazzer-io/.github at refs/heads/main: ${JSON.stringify(w)}`);
});

test('checkRuleset refuses each way a ruleset could run another workflow, from elsewhere, or in fewer places, each red alone', () => {
  need();
  const base = fileRuleset();
  const wfOf = (r) => r.rules[0].parameters.workflows[0];
  const cases = [
    ['another workflow', (r) => { wfOf(r).path = '.github/workflows/made-up.yml'; }, /runs "\.github\/workflows\/made-up\.yml", not \.github\/workflows\/machine-rule\.yml/],
    ['the workflow in another letter case', (r) => { wfOf(r).path = '.github/workflows/Machine-Rule.yml'; }, /not \.github\/workflows\/machine-rule\.yml/],
    ['no repository id', (r) => { delete wfOf(r).repository_id; }, /names no repository id/],
    ['another repository id', (r) => { wfOf(r).repository_id = 1; }, /names the repository id 1, not 1433582766/],
    ['the id written as text', (r) => { wfOf(r).repository_id = String(ID); }, /names the repository id 1433582766, not 1433582766/],
    ['another ref', (r) => { wfOf(r).ref = 'refs/heads/made-up-branch'; }, /reads the workflow at "refs\/heads\/made-up-branch", not refs\/heads\/main/],
    ['a commit for a ref', (r) => { wfOf(r).ref = '0123456789abcdef0123456789abcdef01234567'; }, /not refs\/heads\/main/],
    ['no ref', (r) => { delete wfOf(r).ref; }, /reads the workflow at undefined, not refs\/heads\/main/],
    ['a second workflow beside it', (r) => { r.rules[0].parameters.workflows.push({ path: '.github/workflows/made-up.yml', ref: 'refs/heads/main', repository_id: ID }); }, /names 2 workflows, not machine-rule\.yml alone/],
    ['a repository condition naming some repositories', (r) => { r.conditions.repository_name.include = ['dazzer', 'dazzer-app']; }, /narrower than every repository/],
    ['a repository condition excluding one', (r) => { r.conditions.repository_name.exclude = ['made-up-tools']; }, /narrower than every repository/],
    ['no repository condition', (r) => { delete r.conditions.repository_name; }, /narrower than every repository/],
    ['a property condition in its place', (r) => { delete r.conditions.repository_name; r.conditions.repository_property = { include: [], exclude: [] }; }, /holds the condition repository_property/],
    ['a ref condition beyond the default branch', (r) => { r.conditions.ref_name.include = ['~DEFAULT_BRANCH', 'refs/heads/made-up']; }, /not the default branch alone/],
    ['a ref condition excluding the default branch', (r) => { r.conditions.ref_name.exclude = ['~DEFAULT_BRANCH']; }, /not the default branch alone/],
    ['a non-workflows rule', (r) => { r.rules = [{ type: 'required_status_checks', parameters: {} }]; }, /a rule of type "required_status_checks", not workflows/],
    ['a second rule beside it', (r) => { r.rules.push({ type: 'deletion' }); }, /holds 2 rules, not one workflows rule/],
    ['enforced on create', (r) => { r.rules[0].parameters.do_not_enforce_on_create = false; }, /enforced on create/],
    ['a bypass actor', (r) => { r.bypass_actors = [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }]; }, /names bypass actors/],
    ['enforcement disabled', (r) => { r.enforcement = 'disabled'; }, /neither evaluate nor active/],
    ['another name', (r) => { r.name = 'made-up'; }, /not machine-rule-required/],
    ['a tag target', (r) => { r.target = 'tag'; }, /its target is "tag", not branch/],
    // A null where an object stands is a problem, never a throw (D212).
    ['a null workflow', (r) => { r.rules[0].parameters.workflows = [null]; }, /its workflows rule names null, not a workflow/],
    ['a null rule', (r) => { r.rules = [null]; }, /a rule of type undefined, not workflows/],
    ['null parameters', (r) => { r.rules[0].parameters = null; }, /enforced on create/],
    ['null conditions', (r) => { r.conditions = null; }, /narrower than every repository/],
  ];
  const misses = refusalsMissed('checkRuleset', base, cases);
  const active = clone(base);
  active.enforcement = 'active';
  if (A.checkRuleset(active).length) misses.push(`Could not find the same ruleset made active passing: ${JSON.stringify(A.checkRuleset(active))}`);
  assert.ok(!misses.length, misses.join('\n'));
});

// GitHub's own words when a repository name condition pairs protected: true with ~ALL: its 422 to
// Ben's --apply of 8 Nov (decision 187).
const GITHUB_REFUSAL = 'Protected repository name conditions cannot include `~ALL`';
// A ruleset as GitHub reads one back (gh api orgs/dazzer-io/rulesets/<id>): its own fields beside
// the meaning, and a repository name condition's protected always there, false when the write
// left it out.
function readBack(r) {
  const out = { ...clone(r), source_type: 'Organization', source: 'dazzer-io', node_id: `RRS_made_up_${r.id}`, created_at: '2026-11-08T09:00:00.000+02:00', updated_at: '2026-11-08T09:00:00.000+02:00', _links: { self: { href: `https://api.github.com/orgs/dazzer-io/rulesets/${r.id}` } } };
  const repo = out.conditions?.repository_name;
  if (repo && typeof repo === 'object' && repo.protected === undefined) repo.protected = false;
  return out;
}
// GitHub's 422 to a write it refuses, in the words it gave Ben.
const refuses = (body) => {
  const repo = body?.conditions?.repository_name;
  return repo?.protected === true && Array.isArray(repo.include) && repo.include.includes('~ALL')
    ? { status: 422, text: JSON.stringify({ message: 'Validation Failed', errors: [GITHUB_REFUSAL], documentation_url: 'https://docs.github.com/rest/orgs/rules#create-an-organization-repository-ruleset', status: '422' }) }
    : null;
};
// A fake GitHub holding the organisation's rulesets and dazzer-io/.github's id, every call kept, and
// answering nothing else: any other path is a 404, kept with the rest. The rulesets are listed a
// page at a time, as GitHub lists them: per_page 30 unless asked, at most 100, and page 1 unless
// asked. write turns what a write sends into what GitHub keeps, for a GitHub that keeps something
// else; rejects names a ruleset whose write GitHub answers 422; listStatus gives the status each
// page of the list is answered with; sharedStatus is dazzer-io/.github's; unreadable holds the ids of
// rulesets GitHub will not answer for, read alone; unreadBack holds the names of rulesets GitHub
// will not answer for once written. byId, created and shared turn the answer to a read by id, to a
// creation and to dazzer-io/.github's read into another, for a GitHub that answers 200 with less;
// listedAs is the id the list names a ruleset this fake created by, read by id as nothing, so only
// the id in the creation's answer reads it. unanswered names the calls gh gets no HTTP status back
// for: each has its effect, so a write lands, and then throws as ghRequest throws. writeStatus
// gives the status a write is answered with in place of GitHub's own: a 4xx before the write, as
// GitHub refuses one, and a 5xx after it has landed, as a write GitHub answers 500 to may have.
function fakeGitHub({ rulesets = [], sharedId = ID, write = null, rejects = null, listStatus = () => 200, sharedStatus = 200, unreadable = [], unreadBack = [], byId = (x) => x, created = (x) => x, shared = (x) => x, listedAs = (id) => id, unanswered = () => false, writeStatus = () => null } = {}) {
  const calls = [];
  const held = rulesets.map((r) => clone(r));
  const written = new Set();
  const made = new Set();
  let next = 900;
  const kept = (body) => clone(write ? write(clone(body)) : body);
  const ok = (x) => ({ status: 200, text: JSON.stringify(x) });
  const page = (u, items) => {
    const per = Math.min(Number(u.searchParams.get('per_page') ?? 30), 100);
    const at = Number(u.searchParams.get('page') ?? 1);
    return items.slice((at - 1) * per, at * per);
  };
  const no422 = (body) => (rejects && body?.name === rejects ? { status: 422, text: JSON.stringify({ message: 'Validation Failed', errors: ['made-up refusal'], status: '422' }) } : refuses(body));
  const answer = ({ method = 'GET', path, body }) => {
    const u = new URL(`https://api.github.com${path}`);
    const p = u.pathname;
    let m;
    if (method === 'GET' && p === '/orgs/dazzer-io/rulesets') {
      const status = listStatus(Number(u.searchParams.get('page') ?? 1));
      return status === 200 ? ok(page(u, held.map((r) => ({ id: made.has(r.id) ? listedAs(r.id) : r.id, name: r.name })))) : { status, text: '{}' };
    }
    if (method === 'GET' && (m = /^\/orgs\/dazzer-io\/rulesets\/(\d+)$/.exec(p))) {
      const r = held.find((x) => String(x.id) === m[1]);
      if (r && (unreadable.includes(r.id) || (written.has(r.id) && unreadBack.includes(r.name)))) return { status: 503, text: '{}' };
      return r ? ok(byId(readBack(r), r.id)) : { status: 404, text: '{}' };
    }
    if (method === 'GET' && p === '/repos/dazzer-io/.github') return sharedStatus === 200 ? ok(shared({ id: sharedId, name: '.github', default_branch: 'main' })) : { status: sharedStatus, text: '{}' };
    if (method === 'PUT' && (m = /^\/orgs\/dazzer-io\/rulesets\/(\d+)$/.exec(p))) {
      const at = held.findIndex((x) => String(x.id) === m[1]);
      if (at === -1) return { status: 404, text: '{}' };
      const no = no422(body);
      if (no) return no;
      held[at] = { ...kept(body), id: held[at].id };
      written.add(held[at].id);
      return ok(readBack(held[at]));
    }
    if (method === 'POST' && p === '/orgs/dazzer-io/rulesets') {
      const no = no422(body);
      if (no) return no;
      const r = { ...kept(body), id: next++ };
      held.push(r);
      written.add(r.id);
      made.add(r.id);
      return { status: 201, text: JSON.stringify(created(readBack(r), body)) };
    }
    return { status: 404, text: '{}' };
  };
  const request = async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    const status = method === 'GET' ? null : writeStatus({ method, path, body });
    const instead = status && { status, text: JSON.stringify({ message: `made-up answer ${status}`, status: String(status) }) };
    if (status && status < 500) return instead;
    const a = answer({ method, path, body });
    if (unanswered({ method, path, body })) throw new ReadFailure(`gh could not reach GitHub for ${method} ${path}: error connecting to api.github.com`);
    return instead || a;
  };
  return { request, calls, held };
}
// The three rulesets the files keep, as GitHub would hold them, at ids of their own.
const allThree = () => [{ ...fileRuleset(), id: 7 }, { ...spellingFile(), id: 10 }, { ...codeqlFile(), id: 11 }];
// machine-rule-required its file's version at 7, main-spelling-refused absent, and
// codeql-complete-required live as evaluate at 11, which its file is not: --apply's plan is unchanged,
// create and update, so a PUT, a POST and a PUT, in that order.
const oneOfEach = () => [{ ...fileRuleset(), id: 7 }, { ...codeqlFile(), id: 11, enforcement: 'evaluate' }];
// One run of main(): its exit code, or "threw" with what it threw among its error lines, so a run
// that throws fails a case by its message rather than ending the test.
async function run(argv, gh, options = {}) {
  const out = [];
  const err = [];
  let code;
  try { code = await A.main(argv, { request: gh.request, out: (l) => out.push(l), err: (l) => err.push(l), ...options }); } catch (e) { code = 'threw'; err.push(`main threw ${e?.constructor?.name}: ${e?.message}`); }
  return { code, all: [...out, ...err].join('\n'), out: out.join('\n'), err: err.join('\n') };
}
const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET');
const nowFile = (name) => new RegExp(`^${name} \\(\\d+\\) on dazzer-io now is the file's version, enforcement (evaluate|active)$`, 'm');

test('the read: exit 0 when every live ruleset is its file\'s, 1 naming each field when one differs or is absent, and it writes nothing', async () => {
  need();
  const file = fileRuleset();
  const misses = [];
  const same = fakeGitHub({ rulesets: [...allThree(), { id: 8, name: 'made-up-other', rules: [] }] });
  const s = await run([], same);
  if (s.code !== 0 || !/machine-rule-required \(7\) on dazzer-io is the file's version, enforcement evaluate/.test(s.all)) misses.push(`Could not find the matching ruleset read as the file's version, exit 0: ${s.code} ${s.all}`);
  for (const [name, id, r] of [[SPELLING, 10, spellingFile()], [CODEQL, 11, codeqlFile()]]) if (!s.all.includes(`${name} (${id}) on dazzer-io is the file's version, enforcement ${r.enforcement}`)) misses.push(`Could not find ${name} read as its file's version: ${s.all}`);
  const drifted = clone(file);
  drifted.rules[0].parameters.workflows[0].ref = 'refs/heads/made-up-branch';
  const d = fakeGitHub({ rulesets: [{ ...drifted, id: 7 }, ...allThree().slice(1)] });
  const dr = await run([], d);
  if (dr.code !== 1 || !dr.all.includes('rules[0].parameters.workflows[0].ref: live "refs/heads/made-up-branch", file "refs/heads/main"')) misses.push(`Could not find a drifted ref named field by field, exit 1: ${dr.code} ${dr.all}`);
  const absent = fakeGitHub({ rulesets: [{ id: 8, name: 'made-up-other' }] });
  const ab = await run([], absent);
  if (ab.code !== 1 || !/is not on dazzer-io: --apply would create it/.test(ab.all)) misses.push(`Could not find an absent ruleset said as absent, exit 1: ${ab.code} ${ab.all}`);
  for (const gh of [same, d, absent]) if (writes(gh).length) misses.push(`Could not find the read writing nothing: ${JSON.stringify(writes(gh))}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('--apply writes each file\'s version to the ruleset of its name alone, a PUT to its own id or a POST when absent, and reads each back by that id', async () => {
  need();
  const file = fileRuleset();
  const spelling = spellingFile();
  const codeql = codeqlFile();
  const other = { id: 8, name: 'made-up-other', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] };
  const misses = [];
  // Once created, codeql-complete-required is listed as 1900, an id that reads nothing, so only the
  // id in GitHub's answer to its creation, 900, reads it back.
  const there = fakeGitHub({ rulesets: [other, { ...file, id: 7, enforcement: 'active', rules: [] }, { ...spelling, id: 10, enforcement: 'evaluate' }], listedAs: (id) => id + 1000 });
  const put = await run(['--apply'], there);
  const w = writes(there);
  const byName = (ws, name) => ws.filter((c) => c.body?.name === name);
  const mr = byName(w, MR);
  if (put.code !== 0 || mr.length !== 1 || mr[0].method !== 'PUT' || mr[0].path !== '/orgs/dazzer-io/rulesets/7' || JSON.stringify(mr[0].body) !== JSON.stringify(file)) misses.push(`Could not find --apply writing ruleset.json as one PUT to ruleset 7 alone: ${put.code} ${put.all} ${JSON.stringify(w)}`);
  const sp = byName(w, SPELLING);
  if (sp.length !== 1 || sp[0].method !== 'PUT' || sp[0].path !== '/orgs/dazzer-io/rulesets/10' || JSON.stringify(sp[0].body) !== JSON.stringify(spelling)) misses.push(`Could not find --apply writing main-spelling.json as one PUT to ruleset 10, its own id: ${JSON.stringify(sp)}`);
  const cq = byName(w, CODEQL);
  if (cq.length !== 1 || cq[0].method !== 'POST' || cq[0].path !== '/orgs/dazzer-io/rulesets' || JSON.stringify(cq[0].body) !== JSON.stringify(codeql)) misses.push(`Could not find --apply creating codeql-complete-required from codeql-complete.json with one POST, as it is absent: ${JSON.stringify(cq)}`);
  if (w.length !== 3) misses.push(`Could not find --apply making three writes, one a file: ${JSON.stringify(w.map((c) => `${c.method} ${c.path} ${c.body?.name}`))}`);
  if (w.some((c) => /\/rulesets\/8$/.test(c.path))) misses.push('Could not find the other ruleset left unwritten');
  if (JSON.stringify(there.held.find((r) => r.id === 8)) !== JSON.stringify(other)) misses.push('Could not find the other ruleset left as it was');
  for (const name of [MR, SPELLING, CODEQL]) if (!nowFile(name).test(put.all)) misses.push(`Could not find --apply saying ${name} as read back is its file's version: ${put.all}`);
  // Each written one is read back by its own id: 7 and 10 as they were, the created one by the id
  // GitHub's answer gave it, never by the id a later list names it by, and with no list read after
  // the first write.
  const backs = there.calls.filter((c) => c.method === 'GET' && /^\/orgs\/dazzer-io\/rulesets\/\d+$/.test(c.path)).map((c) => c.path);
  for (const id of [7, 10, 900]) if (backs.filter((p) => p === `/orgs/dazzer-io/rulesets/${id}`).length < (id === 900 ? 1 : 2)) misses.push(`Could not find ruleset ${id} read by its own id ${id === 900 ? 'after its creation' : 'before and after its write'}: ${JSON.stringify(backs)}`);
  if (backs.includes('/orgs/dazzer-io/rulesets/1900')) misses.push(`Could not find the created ruleset read back by the id in GitHub's 201 answer alone, not by the id the list names: ${JSON.stringify(backs)}`);
  const firstWrite = there.calls.findIndex((c) => c.method !== 'GET');
  if (there.calls.slice(firstWrite).some((c) => c.method === 'GET' && /^\/orgs\/dazzer-io\/rulesets\?/.test(c.path))) misses.push(`Could not find --apply reading the rulesets list only before its writes: ${JSON.stringify(there.calls.map((c) => `${c.method} ${c.path}`))}`);
  const none = fakeGitHub({ rulesets: [other] });
  const post = await run(['--apply'], none);
  const p = writes(none);
  if (post.code !== 0 || p.length !== 3 || p.some((c) => c.method !== 'POST' || c.path !== '/orgs/dazzer-io/rulesets') || JSON.stringify(p.map((c) => c.body?.name)) !== JSON.stringify([MR, SPELLING, CODEQL])) misses.push(`Could not find --apply creating each absent ruleset with one POST of its own: ${post.code} ${post.all} ${JSON.stringify(p)}`);
  // A GitHub that keeps something else than was written: that ruleset is said as differing, exit 1,
  // and the others are read back as their files'.
  for (const [name, change] of [[MR, (b) => ({ ...b, enforcement: 'disabled' })], [SPELLING, (b) => ({ ...b, rules: [] })]]) {
    const gh = fakeGitHub({ rulesets: allThree(), write: (b) => (b.name === name ? change(b) : b) });
    const r = await run(['--apply'], gh);
    if (r.code !== 1 || !new RegExp(`REFUSED: ${name} as read back still differs from the file`).test(r.all)) misses.push(`Could not find --apply reading ${name} back and saying it still differs, exit 1: ${r.code} ${r.all}`);
    for (const n of [MR, SPELLING, CODEQL].filter((x) => x !== name)) if (!nowFile(n).test(r.all)) misses.push(`Could not find ${n} read back as its file's though ${name} differs: ${r.all}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('a ruleset.json that fails checkRuleset is never written, the others are, and the modes are one at a time', async () => {
  need();
  const misses = [];
  const gh = fakeGitHub({ rulesets: [] });
  const bad = clone(fileRuleset());
  bad.conditions.repository_name.include = ['dazzer'];
  const r = await run(['--apply'], gh, { file: scratch('ruleset.json', JSON.stringify(bad)) });
  const names = writes(gh).map((c) => c.body?.name);
  if (r.code !== 1 || names.includes(MR) || !/is not the rule's ruleset: .*narrower than every repository/.test(r.err)) misses.push(`Could not find a narrowed ruleset file refused and left unwritten, exit 1: ${r.code} ${r.all} ${JSON.stringify(names)}`);
  if (JSON.stringify(names) !== JSON.stringify([SPELLING, CODEQL])) misses.push(`Could not find the other two written though ruleset.json is refused: ${JSON.stringify(names)}`);
  const both = await run(['--apply', '--readings'], fakeGitHub());
  if (both.code !== 2 || !/two runs/.test(both.all)) misses.push(`Could not find --apply with --readings refused: ${both.code} ${both.all}`);
  const cls = await run(['--readings', '--class', 'made-up'], fakeGitHub());
  if (cls.code !== 2) misses.push(`Could not find --class with another word refused: ${cls.code} ${cls.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('--readings runs the judge over every private, non-archived repository GitHub lists, through the request it is handed, writing nothing', async () => {
  need();
  const calls = [];
  const ci = 'name: made up\non: pull_request\npermissions:\n  contents: read\njobs:\n  check:\n    runs-on: dazzer-checks-2-core\n    steps:\n      - run: echo made-up\n';
  const request = async ({ method = 'GET', path }) => {
    calls.push({ method, path });
    const u = new URL(`https://api.github.com${path}`);
    if (u.pathname === '/orgs/dazzer-io/repos') return { status: 200, text: JSON.stringify(u.searchParams.get('page') === '1' ? [{ name: 'made-up-tools', private: true, archived: false }] : []) };
    if (u.pathname === '/repos/dazzer-io/made-up-tools') return { status: 200, text: JSON.stringify({ default_branch: 'main', visibility: 'private', private: true }) };
    if (u.pathname === '/repos/dazzer-io/made-up-tools/contents/.github/workflows') return { status: 200, text: JSON.stringify([{ name: 'ci.yml', type: 'file' }]) };
    if (u.pathname === '/repos/dazzer-io/made-up-tools/contents/.github/workflows/ci.yml') return { status: 200, text: ci };
    return { status: 404, text: '{}' };
  };
  const out = [];
  const err = [];
  const code = await A.main(['--readings'], { request, out: (l) => out.push(l), err: (l) => err.push(l) });
  const all = [...out, ...err].join('\n');
  const misses = [];
  if (code !== 1 || !/^readings: every private, non-archived dazzer-io repository read at its default branch: 1 refused/m.test(all) || !/REFUSED dazzer-io\/made-up-tools on main \.github\/workflows\/ci\.yml:\d+ jobs\.check: /.test(all)) misses.push(`Could not find --readings reading made-up-tools and refusing its literal machine, exit 1: ${code}\n${all}`);
  if (calls.some((c) => c.method !== 'GET')) misses.push(`Could not find --readings making reads alone: ${JSON.stringify(calls)}`);
  const down = await A.main(['--readings'], { request: async () => ({ status: 503, text: '' }), out: () => {}, err: (l) => err.push(l) });
  if (down !== 2 || !/UNREAD: could not list dazzer-io's repositories: GitHub answered 503/.test(err.join('\n'))) misses.push(`Could not find a GitHub that does not answer read as unread, exit 2: ${down} ${err.join('\n')}`);
  assert.ok(!misses.length, misses.join('\n'));
});

// Decision 187: GitHub refused Ben's --apply of 8 Nov with 422, "Protected repository name
// conditions cannot include `~ALL`", since ruleset.json named every repository as ~ALL with
// protected: true. protected blocks renaming the repositories a list of names targets; with ~ALL a
// renamed repository stays included, so the file leaves it out, and GitHub reads it back as false.
test('ruleset.json names every repository in a shape GitHub accepts: ~ALL, nothing excluded, no protected: true', () => {
  need();
  const r = fileRuleset();
  const repo = r.conditions?.repository_name;
  assert.deepEqual(A.checkRuleset(r), [], `Could not find machine-rule/ruleset.json passing checkRuleset: ${JSON.stringify(A.checkRuleset(r))}`);
  assert.deepEqual(repo?.include, ['~ALL'], `Could not find the repository condition including ~ALL: ${JSON.stringify(repo)}`);
  assert.deepEqual(repo?.exclude, [], `Could not find the repository condition excluding nothing: ${JSON.stringify(repo)}`);
  assert.notEqual(repo?.protected, true, `Could not find the repository condition free of protected: true, which GitHub refuses beside ~ALL with 422 (decision 187): ${JSON.stringify(repo)}`);
});

test('checkRuleset refuses protected: true beside ~ALL in GitHub\'s own words, and --apply then never writes machine-rule-required', async () => {
  need();
  const misses = [];
  const bad = clone(fileRuleset());
  bad.conditions.repository_name = { include: ['~ALL'], exclude: [], protected: true };
  const problems = A.checkRuleset(bad);
  if (!problems.some((p) => p.includes(GITHUB_REFUSAL) && /protected: true/.test(p) && /422/.test(p))) misses.push(`Could not find checkRuleset refusing protected: true beside ~ALL, quoting GitHub's 422 "${GITHUB_REFUSAL}": ${JSON.stringify(problems)}`);
  for (const [name, protectedIs] of [['protected: false', false], ['protected left out', undefined]]) {
    const ok = clone(fileRuleset());
    ok.conditions.repository_name = { include: ['~ALL'], exclude: [] };
    if (protectedIs !== undefined) ok.conditions.repository_name.protected = protectedIs;
    if (A.checkRuleset(ok).length) misses.push(`Could not find ~ALL with ${name} passing checkRuleset: ${JSON.stringify(A.checkRuleset(ok))}`);
  }
  const gh = fakeGitHub({ rulesets: [] });
  const r = await run(['--apply'], gh, { file: scratch('ruleset.json', JSON.stringify(bad)) });
  if (r.code !== 1 || writes(gh).some((c) => c.body?.name === MR) || !r.err.includes(GITHUB_REFUSAL)) misses.push(`Could not find a ruleset file with protected: true beside ~ALL refused in GitHub's words and never sent to GitHub, exit 1: ${r.code} ${r.all} ${JSON.stringify(writes(gh).map((c) => c.body?.name))}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('the read-back counts a repository condition GitHub reads as protected: false the same as one the file leaves out or sets false', async () => {
  need();
  const misses = [];
  const file = clone(fileRuleset());
  delete file.conditions.repository_name.protected;
  const live = readBack({ ...clone(file), id: 7, enforcement: 'evaluate' });
  if (live.conditions.repository_name.protected !== false) misses.push('Could not find the fake GitHub reading protected back as false');
  const left = A.diffRuleset(live, file);
  if (left.length) misses.push(`Could not find a live protected: false matching a file that leaves protected out: ${JSON.stringify(left)}`);
  const setFalse = clone(file);
  setFalse.conditions.repository_name.protected = false;
  const f = A.diffRuleset(live, setFalse);
  if (f.length) misses.push(`Could not find a live protected: false matching a file that sets it false: ${JSON.stringify(f)}`);
  const lockedLive = clone(live);
  lockedLive.conditions.repository_name.protected = true;
  const t = A.diffRuleset(lockedLive, file);
  if (!t.some((l) => l.startsWith('conditions.repository_name.protected: live true'))) misses.push(`Could not find a live protected: true still read as differing from a file that leaves it out: ${JSON.stringify(t)}`);
  // Ben's next run: --apply of the shipped file onto an organisation without the ruleset, GitHub
  // reading it back in its own shape, then the no-argument read.
  const gh = fakeGitHub({ rulesets: [{ id: 8, name: 'made-up-other', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] }] });
  const apply = await run(['--apply'], gh);
  if (apply.code !== 0 || !/machine-rule-required \(\d+\) on dazzer-io now is the file's version, enforcement evaluate/.test(apply.all)) misses.push(`Could not find --apply of the shipped file accepted by GitHub and read back as the file's version, exit 0: ${apply.code} ${apply.all}`);
  const after = await run([], gh);
  if (after.code !== 0 || !/machine-rule-required \(\d+\) on dazzer-io is the file's version, enforcement evaluate/.test(after.all)) misses.push(`Could not find the read after --apply saying it matches, exit 0: ${after.code} ${after.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

// ================================================================ the two rules on main (decisions 188, 192, 195, 210)
// main-spelling-refused restricts creating a branch spelled main in other letters in dazzer,
// dazzer-app and runners, and codeql-complete-required, written active, reads the shared scan's
// codeql / CodeQL complete from GitHub Actions in dazzer and dazzer-app before a merge. Both are kept as files beside
// ruleset.json and written by the same --apply. GitHub's rulesets pages name fnmatch with
// File::FNM_PATHNAME and say nothing of case, so the patterns hold either way among the sixteen
// ASCII spellings: matched case-sensitively they take the fifteen other spellings and never main;
// folded, they take main too, and creation alone is restricted, which never touches a push to a
// branch that exists.

// fnmatch of literal characters and bracket classes alone, as a regular expression: this test's
// own reading, apart from apply-ruleset.mjs's, case-sensitive unless folded.
const asRegExp = (p, flags = '') => new RegExp(`^${p.replace(/\[([^\]]*)\]|([^[])/g, (_, cls, c) => (cls !== undefined ? `[${cls.replace(/[\\\]^-]/g, '\\$&')}]` : c.replace(/[.*+?^${}()|\\/]/g, '\\$&')))}$`, flags);
// How many names a pattern of literals and bracket classes of single letters names.
const sizeOf = (p) => (p.match(/\[[^\]]*\]/g) ?? []).reduce((n, cls) => n * new Set(cls.slice(1, -1)).size, 1);

test('main-spelling.json is main-spelling-refused: branches, active, no bypass, dazzer, dazzer-app and runners by name, the four patterns with no exclude, one creation rule', () => {
  needKept();
  const r = spellingFile();
  assert.deepEqual(A.checkMainSpelling(r), [], `Could not find machine-rule/main-spelling.json passing checkMainSpelling: ${JSON.stringify(A.checkMainSpelling(r))}`);
  assert.ok((r.conditions?.repository_name?.include ?? []).includes('runners'), `Could not find runners in main-spelling-refused's repositories, though the locked runner group admits runners' locked canary: ${JSON.stringify(r.conditions?.repository_name)}`);
  assert.deepEqual(r, {
    name: SPELLING,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: PATTERNS, exclude: [] }, repository_name: { include: SPELLING_REPOSITORIES, exclude: [], protected: true } },
    rules: [{ type: 'creation' }],
  }, `Could not find main-spelling.json holding exactly decision 192's ruleset: ${JSON.stringify(r)}`);
});

test('the four patterns, matched case-sensitively, match exactly the fifteen other spellings of main and never main itself; folded, the rule still restricts creation alone', () => {
  needKept();
  const misses = [];
  const include = spellingFile().conditions?.ref_name?.include ?? [];
  if (SPELLINGS.length !== 16 || new Set(SPELLINGS).size !== 16 || SPELLINGS[0] !== 'refs/heads/main') misses.push(`Could not find the sixteen spellings of main built: ${JSON.stringify(SPELLINGS)}`);
  const others = SPELLINGS.slice(1);
  // This test's own reading: each pattern names as many names as it matches among the sixteen, so
  // it names nothing else; together they match the fifteen and never main.
  if (include.some((p) => /[*?\\{}!^-]/.test(p))) misses.push(`Could not find patterns of literals and bracket classes alone: ${JSON.stringify(include)}`);
  const hit = new Set();
  for (const p of include) {
    const re = asRegExp(p);
    const among = SPELLINGS.filter((s) => re.test(s));
    if (among.length !== sizeOf(p)) misses.push(`Could not find ${p} matching only spellings of main: it names ${sizeOf(p)} names, ${among.length} of them spellings of main`);
    for (const s of among) hit.add(s);
  }
  if (hit.has('refs/heads/main')) misses.push(`Could not find the patterns, matched case-sensitively, leaving refs/heads/main itself unmatched: ${JSON.stringify(include)}`);
  const missed = others.filter((s) => !hit.has(s));
  if (missed.length) misses.push(`Could not find the patterns matching each of the fifteen other spellings: ${missed.join(', ')} unmatched`);
  // apply-ruleset.mjs's reading agrees, name for name.
  const theirs = new Set(include.flatMap((p) => A.namesMatched(p).names ?? []));
  if (JSON.stringify([...theirs].sort()) !== JSON.stringify([...others].sort())) misses.push(`Could not find namesMatched reading the four patterns as exactly the fifteen other spellings: ${JSON.stringify([...theirs].sort())}`);
  // Folded, every pattern matches main too: the rule then restricts only creating main, which is
  // there already, so a push to main is never touched either way.
  for (const p of include) if (!asRegExp(p, 'i').test('refs/heads/main')) misses.push(`Could not find ${p} read folded taking main, as a folding GitHub would read it`);
  if (JSON.stringify(spellingFile().rules) !== JSON.stringify([{ type: 'creation' }])) misses.push(`Could not find creation as the rule's one rule, so a folded match never touches a push to main: ${JSON.stringify(spellingFile().rules)}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('namesMatched reads literals and bracket classes, and refuses what it cannot list', () => {
  needKept();
  const misses = [];
  const reads = [
    ['refs/heads/maiN', ['refs/heads/maiN']],
    ['refs/heads/maI[Nn]', ['refs/heads/maIN', 'refs/heads/maIn']],
    ['refs/heads/[a-c]x', ['refs/heads/ax', 'refs/heads/bx', 'refs/heads/cx']],
    ['refs/heads/[-a]', ['refs/heads/-', 'refs/heads/a']],
  ];
  for (const [p, names] of reads) {
    const got = A.namesMatched(p);
    if (got.problem || JSON.stringify([...got.names].sort()) !== JSON.stringify([...names].sort())) misses.push(`Could not find namesMatched reading ${p} as ${JSON.stringify(names)}: ${JSON.stringify(got)}`);
  }
  const refused = [
    ['refs/heads/m*', /wildcard \*/],
    ['refs/heads/mai?', /wildcard \?/],
    ['refs/heads/**/main', /wildcard \*/],
    ['refs/heads/[^m]ain', /complement/],
    ['refs/heads/[!m]ain', /complement/],
    ['refs/heads/m\\ain', /backslash/],
    ['refs/heads/[Mm', /never closes/],
    ['refs/heads/[]main', /empty/],
    ['refs/heads/[z-a]ain', /range/],
    ['refs/heads/m[a/]in', /\//],
    ['refs/heads/ma\u0131n', /outside printable ASCII/],
    ['~DEFAULT_BRANCH', /takes in/],
    ['~ALL', /takes in/],
  ];
  for (const [p, says] of refused) {
    const got = A.namesMatched(p);
    if (!got.problem || !says.test(got.problem)) misses.push(`Could not find namesMatched refusing ${JSON.stringify(p)} saying ${says}: ${JSON.stringify(got)}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('checkMainSpelling refuses a bypass, another repository, an exclude, a rule other than creation, and a pattern set that misses a spelling or matches main, each red alone', () => {
  needKept();
  const base = spellingFile();
  const inc = (r) => r.conditions.ref_name.include;
  const cases = [
    ['a bypass actor', (r) => { r.bypass_actors = [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }]; }, /names bypass actors/],
    ['a bypass for a pull request alone', (r) => { r.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }]; }, /names bypass actors/],
    ['another repository in place of one', (r) => { r.conditions.repository_name.include = ['dazzer', 'dazzer-app', 'made-up-tools']; }, /not dazzer, dazzer-app and runners by name/],
    ['runners left out', (r) => { r.conditions.repository_name.include = ['dazzer', 'dazzer-app']; }, /not dazzer, dazzer-app and runners by name/],
    ['a fourth repository', (r) => { r.conditions.repository_name.include.push('made-up-tools'); }, /not dazzer, dazzer-app and runners by name/],
    ['every repository', (r) => { r.conditions.repository_name.include = ['~ALL']; }, /not dazzer, dazzer-app and runners by name/],
    ['a repository pattern', (r) => { r.conditions.repository_name.include = ['dazzer*', 'runners']; }, /not dazzer, dazzer-app and runners by name/],
    ['one repository alone', (r) => { r.conditions.repository_name.include = ['runners']; }, /not dazzer, dazzer-app and runners by name/],
    ['a repository excluded', (r) => { r.conditions.repository_name.exclude = ['runners']; }, /repository condition excludes/],
    ['renaming left open', (r) => { r.conditions.repository_name.protected = false; }, /not protected: true, so renaming dazzer, dazzer-app or runners/],
    ['an exclude', (r) => { r.conditions.ref_name.exclude = ['refs/heads/MAIN']; }, /ref condition excludes \["refs\/heads\/MAIN"\]/],
    ['no ref condition', (r) => { delete r.conditions.ref_name; }, /no ref condition/],
    ['a property condition beside them', (r) => { r.conditions.repository_property = { include: [], exclude: [] }; }, /holds the condition repository_property/],
    ['an update rule for the creation rule', (r) => { r.rules = [{ type: 'update', parameters: { update_allows_fetch_and_merge: false } }]; }, /a rule of type "update", not creation/],
    ['a deletion rule beside it', (r) => { r.rules.push({ type: 'deletion' }); }, /holds 2 rules, not one creation rule/],
    ['no rule', (r) => { r.rules = []; }, /holds 0 rules, not one creation rule/],
    ['a pattern set missing one spelling', (r) => { r.conditions.ref_name.include = inc(r).filter((p) => p !== 'refs/heads/maiN'); }, /miss refs\/heads\/maiN/],
    ['a pattern set missing MAIN', (r) => { inc(r)[0] = 'refs/heads/M[a][Ii][Nn]'; }, /miss refs\/heads\/MAIN, refs\/heads\/MAIn, refs\/heads\/MAiN, refs\/heads\/MAin/],
    ['a pattern that matches main', (r) => { inc(r)[3] = 'refs/heads/mai[Nn]'; }, /match refs\/heads\/main itself/],
    ['main itself beside them', (r) => { inc(r).push('refs/heads/main'); }, /match refs\/heads\/main itself/],
    ['a pattern taking every branch', (r) => { inc(r).push('refs/heads/*'); }, /wildcard \*/],
    ['the default branch', (r) => { inc(r).push('~DEFAULT_BRANCH'); }, /~DEFAULT_BRANCH, which takes in/],
    ['a pattern naming a branch no spelling of main', (r) => { inc(r).push('refs/heads/made-up'); }, /refs\/heads\/made-up, no spelling of main/],
    ['a complemented class', (r) => { inc(r)[3] = 'refs/heads/mai[^n]'; }, /complement/],
    ['evaluate for active', (r) => { r.enforcement = 'evaluate'; }, /its enforcement is "evaluate", not active/],
    ['disabled', (r) => { r.enforcement = 'disabled'; }, /not active/],
    ['another name', (r) => { r.name = 'made-up'; }, /not main-spelling-refused/],
    ['a tag target', (r) => { r.target = 'tag'; }, /its target is "tag", not branch/],
    ['a null pattern', (r) => { inc(r).push(null); }, /the pattern null is no pattern/],
    ['a null rule', (r) => { r.rules = [null]; }, /a rule of type undefined, not creation/],
    ['a null repository condition', (r) => { r.conditions.repository_name = null; }, /not dazzer, dazzer-app and runners by name/],
    ['null conditions', (r) => { r.conditions = null; }, /no ref condition/],
  ];
  const misses = refusalsMissed('checkMainSpelling', base, cases);
  const reordered = clone(base);
  reordered.conditions.ref_name.include.reverse();
  if (A.checkMainSpelling(reordered).length) misses.push(`Could not find the same four patterns in another order passing: ${JSON.stringify(A.checkMainSpelling(reordered))}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('codeql-complete.json is codeql-complete-required: branches, active, no bypass, the two repositories\' default branch, codeql / CodeQL complete from integration 15368, not on create, strict off', () => {
  needKept();
  const r = codeqlFile();
  assert.deepEqual(A.checkCodeqlComplete(r), [], `Could not find machine-rule/codeql-complete.json passing checkCodeqlComplete: ${JSON.stringify(A.checkCodeqlComplete(r))}`);
  assert.equal(r.enforcement, 'active', `Could not find codeql-complete-required written as active, so it blocks a merge without codeql / CodeQL complete; decision 210's watching in evaluate is over (r-3.27): ${JSON.stringify(r.enforcement)}`);
  assert.deepEqual(r, {
    name: CODEQL,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] }, repository_name: { include: CODEQL_REPOSITORIES, exclude: [], protected: true } },
    rules: [{ type: 'required_status_checks', parameters: { do_not_enforce_on_create: true, required_status_checks: [{ context: CONTEXT, integration_id: ACTIONS }], strict_required_status_checks_policy: false } }],
  }, `Could not find codeql-complete.json holding exactly decisions 192's and 210's ruleset: ${JSON.stringify(r)}`);
});

test('checkCodeqlComplete accepts evaluate or active and nothing else, and refuses another context, another integration, a bypass, and each way it could require less or elsewhere, each red alone', () => {
  needKept();
  const base = codeqlFile();
  const p = (r) => r.rules[0].parameters;
  const cases = [
    ['another context', (r) => { p(r).required_status_checks[0].context = 'CodeQL'; }, /names the check "CodeQL", not codeql \/ CodeQL complete/],
    ['the context in another case', (r) => { p(r).required_status_checks[0].context = 'Codeql / CodeQL complete'; }, /not codeql \/ CodeQL complete/],
    ['another integration', (r) => { p(r).required_status_checks[0].integration_id = 57789; }, /from integration 57789, not 15368/],
    ['any source', (r) => { delete p(r).required_status_checks[0].integration_id; }, /from integration undefined, not 15368/],
    ['the integration written as text', (r) => { p(r).required_status_checks[0].integration_id = '15368'; }, /from integration "15368", not 15368/],
    ['a second check beside it', (r) => { p(r).required_status_checks.push({ context: 'made-up', integration_id: ACTIONS }); }, /requires 2 checks, not codeql \/ CodeQL complete alone/],
    ['no check', (r) => { p(r).required_status_checks = []; }, /requires 0 checks/],
    ['a bypass actor', (r) => { r.bypass_actors = [{ actor_id: 1, actor_type: 'OrganizationAdmin', bypass_mode: 'always' }]; }, /names bypass actors/],
    ['enforced on create', (r) => { p(r).do_not_enforce_on_create = false; }, /enforced on create/],
    ['the strict policy', (r) => { p(r).strict_required_status_checks_policy = true; }, /strict policy is true, not false/],
    ['another repository', (r) => { r.conditions.repository_name.include = ['dazzer', 'made-up-tools']; }, /not dazzer and dazzer-app by name/],
    ['runners beside them', (r) => { r.conditions.repository_name.include.push('runners'); }, /includes \["dazzer","dazzer-app","runners"\], not dazzer and dazzer-app by name/],
    ['a repository excluded', (r) => { r.conditions.repository_name.exclude = ['dazzer']; }, /repository condition excludes/],
    ['renaming left open', (r) => { delete r.conditions.repository_name.protected; }, /not protected: true, so renaming dazzer or dazzer-app/],
    ['a ref beyond the default branch', (r) => { r.conditions.ref_name.include.push('refs/heads/made-up'); }, /not the default branch alone/],
    ['a ref exclude', (r) => { r.conditions.ref_name.exclude = ['refs/heads/main']; }, /not the default branch alone/],
    ['a rule of another type', (r) => { r.rules = [{ type: 'creation' }]; }, /a rule of type "creation", not required_status_checks/],
    ['a second rule beside it', (r) => { r.rules.push({ type: 'deletion' }); }, /holds 2 rules, not one required_status_checks rule/],
    ['enforcement disabled', (r) => { r.enforcement = 'disabled'; }, /its enforcement is "disabled", neither evaluate nor active/],
    ['no enforcement', (r) => { delete r.enforcement; }, /its enforcement is undefined, neither evaluate nor active/],
    ['another name', (r) => { r.name = 'made-up'; }, /not codeql-complete-required/],
    ['a tag target', (r) => { r.target = 'tag'; }, /not branch/],
    ['a null check', (r) => { p(r).required_status_checks = [null]; }, /names the check undefined, not codeql \/ CodeQL complete/],
    ['null parameters', (r) => { r.rules[0].parameters = null; }, /enforced on create/],
    ['a null rule', (r) => { r.rules = [null]; }, /a rule of type undefined, not required_status_checks/],
    ['null conditions', (r) => { r.conditions = null; }, /not the default branch alone/],
  ];
  const misses = refusalsMissed('checkCodeqlComplete', base, cases);
  // Evaluate, as written, and active, as r-3.27 makes it once its readings show no merge it would have refused.
  for (const enforcement of ['evaluate', 'active']) {
    const r = clone(base);
    r.enforcement = enforcement;
    if (A.checkCodeqlComplete(r).length) misses.push(`Could not find codeql-complete-required in ${enforcement} passing its check: ${JSON.stringify(A.checkCodeqlComplete(r))}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

// What a run without --apply says --apply would do, read from its closing line: each ruleset it would
// write, in order, with create, update or unchanged, and each it would hold back.
const saidPlan = (all) => {
  const m = /^--apply would write (.+?)(?:, and hold back (.+))?$/m.exec(all);
  if (!m) return null;
  return {
    write: m[1] === 'nothing' ? [] : m[1].split(', ').map((x) => { const y = /^(\S+) \((create|update|unchanged)\)$/.exec(x); return y ? [y[1], y[2]] : [x, null]; }),
    held: m[2] ? m[2].split(', ') : [],
  };
};
// The rulesets a run named as held back, from its lines: REFUSED or UNREAD, then the name.
const heldNamed = (all, verb) => [...all.matchAll(new RegExp(`^(?:REFUSED|UNREAD): (\\S+) ${verb} held back`, 'gm'))].map((m) => m[1]);

test('each kept ruleset stands alone: a refusal of one holds back that one alone and names it, the others are written and read back, and the read says exactly what --apply does', async () => {
  needKept();
  const misses = [];
  const live = oneOfEach;
  const plan = [[MR, 'unchanged'], [SPELLING, 'create'], [CODEQL, 'update']];
  const badSpelling = clone(spellingFile());
  badSpelling.conditions.ref_name.exclude = ['refs/heads/MAIN'];
  const badRule = clone(fileRuleset());
  badRule.conditions.repository_name.include = ['dazzer'];
  const nullWorkflow = clone(fileRuleset());
  nullWorkflow.rules[0].parameters.workflows = [null];
  const scenarios = [
    ['ruleset.json holds a null workflow', MR, () => ({ file: scratch('ruleset.json', JSON.stringify(nullWorkflow)) }), {}, /^REFUSED: machine-rule-required (?:would be|was) held back[^\n]*: \S+ruleset\.json is not the rule's ruleset: [^\n]*names null, not a workflow/m],
    ['dazzer-io/.github is answered 200 with null', MR, () => ({}), { shared: () => null }, /^UNREAD: machine-rule-required (?:would be|was) held back[^\n]*: could not read dazzer-io\/\.github: GitHub's answer is null, no object/m],
    ['codeql-complete-required is answered 200 with null by its id', CODEQL, () => ({}), { byId: (x, id) => (id === 11 ? null : x) }, /^UNREAD: codeql-complete-required (?:would be|was) held back[^\n]*: could not read the ruleset codeql-complete-required \(11\): GitHub's answer is null, no object/m],
    ['codeql-complete-required is answered by its id with no id', CODEQL, () => ({}), { byId: (x, id) => (id === 11 ? { ...x, id: undefined } : x) }, /^UNREAD: codeql-complete-required (?:would be|was) held back[^\n]*: could not read the ruleset codeql-complete-required \(11\): GitHub's answer names no id/m],
    ['codeql-complete-required is answered by its id with the id as text', CODEQL, () => ({}), { byId: (x, id) => (id === 11 ? { ...x, id: '11' } : x) }, /^UNREAD: codeql-complete-required (?:would be|was) held back[^\n]*: could not read the ruleset codeql-complete-required \(11\): GitHub's answer names the id "11", no integer/m],
    ['main-spelling.json fails its check', SPELLING, () => ({ files: { [SPELLING]: scratch('main-spelling.json', JSON.stringify(badSpelling)) } }), {}, /^REFUSED: main-spelling-refused (?:would be|was) held back[^\n]*: \S+main-spelling\.json is not the ruleset main-spelling-refused: [^\n]*excludes/m],
    ['codeql-complete.json is not there to read', CODEQL, () => ({ files: { [CODEQL]: scratch('codeql-complete.json') } }), {}, /^REFUSED: codeql-complete-required (?:would be|was) held back[^\n]*: \S+codeql-complete\.json could not be read as JSON/m],
    ['codeql-complete.json is not JSON', CODEQL, () => ({ files: { [CODEQL]: scratch('codeql-complete.json', '{ "name": ') } }), {}, /^REFUSED: codeql-complete-required (?:would be|was) held back[^\n]*: \S+codeql-complete\.json could not be read as JSON/m],
    ['ruleset.json fails its check', MR, () => ({ file: scratch('ruleset.json', JSON.stringify(badRule)) }), {}, /^REFUSED: machine-rule-required (?:would be|was) held back[^\n]*: \S+ruleset\.json is not the rule's ruleset: [^\n]*narrower than every repository/m],
    ['dazzer-io/.github\'s live id is not the one ruleset.json names', MR, () => ({}), { sharedId: 42 }, /^REFUSED: machine-rule-required (?:would be|was) held back[^\n]*: dazzer-io\/\.github's repository id is 42 on GitHub, not 1433582766/m],
    ['dazzer-io/.github cannot be read', MR, () => ({}), { sharedStatus: 503 }, /^UNREAD: machine-rule-required (?:would be|was) held back[^\n]*: could not read dazzer-io\/\.github: GitHub answered 503/m],
    ['two live rulesets are named main-spelling-refused', SPELLING, () => ({}), { extra: [{ ...spellingFile(), id: 10 }, { ...spellingFile(), id: 12 }] }, /^REFUSED: main-spelling-refused (?:would be|was) held back[^\n]*: dazzer-io holds 2 rulesets named main-spelling-refused \(10, 12\)/m],
    ['two live rulesets are named codeql-complete-required', CODEQL, () => ({}), { extra: [{ ...codeqlFile(), id: 13 }] }, /^REFUSED: codeql-complete-required (?:would be|was) held back[^\n]*: dazzer-io holds 2 rulesets named codeql-complete-required \(11, 13\)/m],
    ['codeql-complete-required cannot be read by its id', CODEQL, () => ({}), { unreadable: [11] }, /^UNREAD: codeql-complete-required (?:would be|was) held back[^\n]*: could not read the ruleset codeql-complete-required \(11\): GitHub answered 503/m],
  ];
  for (const [label, name, options, gitHub, says] of scenarios) {
    const { extra = [], ...rest } = gitHub;
    const fake = () => fakeGitHub({ rulesets: [...live(), ...extra], ...rest });
    const opts = options();
    const others = plan.filter(([n]) => n !== name);
    const readGh = fake();
    const d = await run([], readGh, opts);
    const said = saidPlan(d.out);
    if (JSON.stringify(said) !== JSON.stringify({ write: others, held: [name] })) misses.push(`Could not find the read saying --apply would write the others and hold back ${name} alone when ${label}: ${JSON.stringify(said)}\n${d.all}`);
    if (d.code !== 1 || writes(readGh).length || !says.test(d.all) || JSON.stringify(heldNamed(d.all, 'would be')) !== JSON.stringify([name])) misses.push(`Could not find the read naming ${name} alone as held back and why, writing nothing, exit 1, when ${label}: ${d.code} ${d.all}`);
    const applyGh = fake();
    const a = await run(['--apply'], applyGh, opts);
    const did = writes(applyGh).map((c) => [c.body?.name, c.method]);
    const expected = others.map(([n, act]) => [n, act === 'create' ? 'POST' : 'PUT']);
    if (JSON.stringify(did) !== JSON.stringify(expected)) misses.push(`Could not find --apply writing exactly what the read said, the others, when ${label}: ${JSON.stringify(did)} for ${JSON.stringify(expected)}\n${a.all}`);
    if (a.code !== 1 || !says.test(a.all) || JSON.stringify(heldNamed(a.all, 'was')) !== JSON.stringify([name])) misses.push(`Could not find --apply naming ${name} alone as held back and why, exit 1, when ${label}: ${a.code} ${a.all}`);
    for (const [n] of others) if (!nowFile(n).test(a.out)) misses.push(`Could not find --apply reading ${n} back as its file's version though ${name} was held back when ${label}: ${a.all}`);
  }
  // The update goes to the id the list named, whatever id GitHub's answer by that id carries.
  const elsewhere = fakeGitHub({ rulesets: live(), byId: (x, id) => (id === 11 ? { ...x, id: 99 } : x) });
  const e = await run(['--apply'], elsewhere);
  const toCodeql = writes(elsewhere).filter((c) => c.body?.name === CODEQL).map((c) => `${c.method} ${c.path}`);
  if (e.code !== 0 || JSON.stringify(toCodeql) !== JSON.stringify(['PUT /orgs/dazzer-io/rulesets/11'])) misses.push(`Could not find the update of codeql-complete-required sent to 11, the id the list names, though GitHub's answer by that id names 99, exit 0: ${e.code} ${JSON.stringify(toCodeql)}\n${e.all}`);
  // Nothing held back: the read says all three, and --apply writes and reads back all three, exit 0.
  const d = await run([], fakeGitHub({ rulesets: live() }));
  if (d.code !== 1 || JSON.stringify(saidPlan(d.out)) !== JSON.stringify({ write: plan, held: [] })) misses.push(`Could not find the read saying --apply would write all three, holding none back: ${d.code} ${JSON.stringify(saidPlan(d.out))}\n${d.all}`);
  const gh = fakeGitHub({ rulesets: live() });
  const a = await run(['--apply'], gh);
  if (a.code !== 0 || JSON.stringify(writes(gh).map((c) => [c.body?.name, c.method])) !== JSON.stringify([[MR, 'PUT'], [SPELLING, 'POST'], [CODEQL, 'PUT']])) misses.push(`Could not find --apply writing all three, exit 0, when none is held back: ${a.code} ${a.all}`);
  const after = await run([], gh);
  if (after.code !== 0 || JSON.stringify(saidPlan(after.out)) !== JSON.stringify({ write: [[MR, 'unchanged'], [SPELLING, 'unchanged'], [CODEQL, 'unchanged']], held: [] })) misses.push(`Could not find the read after --apply saying every ruleset is its file's, exit 0: ${after.code} ${after.all}`);
  // Every one held back: the read says --apply would write nothing; --apply writes nothing, exit 1.
  const allBad = { file: scratch('ruleset.json', JSON.stringify(badRule)), files: { [SPELLING]: scratch('main-spelling.json', JSON.stringify(badSpelling)), [CODEQL]: scratch('codeql-complete.json') } };
  const n = await run([], fakeGitHub({ rulesets: live() }), allBad);
  if (n.code !== 1 || JSON.stringify(saidPlan(n.out)) !== JSON.stringify({ write: [], held: [MR, SPELLING, CODEQL] })) misses.push(`Could not find the read saying --apply would write nothing and hold back all three when every file is refused: ${n.code} ${JSON.stringify(saidPlan(n.out))}\n${n.all}`);
  const ng = fakeGitHub({ rulesets: live() });
  const na = await run(['--apply'], ng, allBad);
  if (na.code !== 1 || writes(ng).length || JSON.stringify(heldNamed(na.all, 'was')) !== JSON.stringify([MR, SPELLING, CODEQL])) misses.push(`Could not find --apply writing nothing and naming all three held back, exit 1, when every file is refused: ${na.code} ${na.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('a write GitHub refuses, or a ruleset GitHub will not read back, is that ruleset\'s alone: the others are still written and read back, exit 1', async () => {
  needKept();
  const misses = [];
  const gh = fakeGitHub({ rulesets: [], rejects: SPELLING });
  const r = await run(['--apply'], gh);
  const tried = writes(gh).map((c) => c.body?.name);
  if (r.code !== 1 || !/^REFUSED: GitHub answered 422 to the creation of main-spelling-refused/m.test(r.err)) misses.push(`Could not find --apply naming GitHub's 422 to main-spelling-refused, exit 1: ${r.code} ${r.all}`);
  if (JSON.stringify(tried) !== JSON.stringify([MR, SPELLING, CODEQL]) || JSON.stringify(gh.held.map((x) => x.name)) !== JSON.stringify([MR, CODEQL])) misses.push(`Could not find --apply still writing codeql-complete-required after GitHub refused main-spelling-refused: ${JSON.stringify(tried)} ${JSON.stringify(gh.held.map((x) => x.name))}`);
  for (const n of [MR, CODEQL]) if (!nowFile(n).test(r.out)) misses.push(`Could not find ${n} read back as its file's version though GitHub refused main-spelling-refused: ${r.all}`);
  // The list names each created ruleset by another id, so the read-back names 900, the id in
  // GitHub's 201 answer, only if it reads by that id.
  const u = fakeGitHub({ rulesets: [], unreadBack: [MR], listedAs: (id) => id + 1000 });
  const ur = await run(['--apply'], u);
  if (ur.code !== 1 || !/^UNREAD: machine-rule-required was written, and not read back: could not read the ruleset machine-rule-required \(900\): GitHub answered 503/m.test(ur.err)) misses.push(`Could not find --apply naming machine-rule-required written and not read back by 900, the id in GitHub's 201 answer, exit 1: ${ur.code} ${ur.all}`);
  for (const n of [SPELLING, CODEQL]) if (!nowFile(n).test(ur.out)) misses.push(`Could not find ${n} read back as its file's version though machine-rule-required was not: ${ur.all}`);
  // A 201 answer naming no id, or holding no object, is held back: written, and read back by no
  // other id, while the others are read back.
  for (const [label, answer, says] of [['naming no id', (x) => ({ ...x, id: undefined }), /names no id/], ['naming the id as text', (x) => ({ ...x, id: String(x.id) }), /names the id "\d+", no integer/], ['of null', () => null, /is null, no object/]]) {
    const gh = fakeGitHub({ rulesets: [], created: (x, body) => (body?.name === SPELLING ? answer(x) : x) });
    const r = await run(['--apply'], gh);
    const line = new RegExp(`^UNREAD: main-spelling-refused was written, and not read back: GitHub's answer to its creation ${says.source}`, 'm');
    if (r.code !== 1 || !line.test(r.err)) misses.push(`Could not find --apply holding back main-spelling-refused when GitHub's 201 answer is ${label}, exit 1: ${r.code} ${r.all}`);
    if (gh.calls.some((c) => c.method === 'GET' && c.path === '/orgs/dazzer-io/rulesets/901')) misses.push(`Could not find main-spelling-refused left unread when GitHub's 201 answer is ${label}, never found by another way: ${JSON.stringify(gh.calls.map((c) => `${c.method} ${c.path}`))}`);
    for (const n of [MR, CODEQL]) if (!nowFile(n).test(r.out)) misses.push(`Could not find ${n} read back as its file's version though GitHub's 201 answer for main-spelling-refused is ${label}: ${r.all}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

// gh gets no HTTP status back (a network drop, DNS, gh itself failing), and ghRequest throws. Each
// GitHub call about one kept ruleset is that ruleset's alone: a write that may have landed holds it
// back, saying so, a read before it holds it back unwritten, and the others are still tried, exit 1.
// Only the organisation's list unread is exit 2, before any write (D212).
test('gh failing to reach GitHub on one call about one ruleset holds back that ruleset alone, saying a write may have landed, while the others are still tried, exit 1', async () => {
  needKept();
  const misses = [];
  const live = oneOfEach;
  const is = (method, path) => (c) => c.method === method && c.path === path;
  const landed = (name, act) => new RegExp(`^UNREAD: ${name} was held back, its ${act} may have landed: GitHub's answer never came[^\\n]*: gh could not reach GitHub for `, 'm');
  const unwritten = (name) => new RegExp(`^UNREAD: ${name} was held back, not written: gh could not reach GitHub for `, 'm');
  const scenarios = [
    ['the POST of main-spelling-refused', SPELLING, is('POST', '/orgs/dazzer-io/rulesets'), landed(SPELLING, 'creation'), [MR, SPELLING, CODEQL], false],
    ['the PUT of machine-rule-required', MR, is('PUT', '/orgs/dazzer-io/rulesets/7'), landed(MR, 'update'), [MR, SPELLING, CODEQL], false],
    ['the PUT of codeql-complete-required', CODEQL, is('PUT', '/orgs/dazzer-io/rulesets/11'), landed(CODEQL, 'update'), [MR, SPELLING, CODEQL], false],
    ['the read of dazzer-io/.github', MR, is('GET', '/repos/dazzer-io/.github'), unwritten(MR), [SPELLING, CODEQL], true],
    ['the read of codeql-complete-required by its id', CODEQL, is('GET', '/orgs/dazzer-io/rulesets/11'), unwritten(CODEQL), [MR, SPELLING], true],
    ['the read-back of main-spelling-refused', SPELLING, is('GET', '/orgs/dazzer-io/rulesets/900'), /^UNREAD: main-spelling-refused was written, and not read back: gh could not reach GitHub for GET \/orgs\/dazzer-io\/rulesets\/900/m, [MR, SPELLING, CODEQL], false],
  ];
  for (const [label, name, unanswered, says, tried, beforeWrites] of scenarios) {
    const gh = fakeGitHub({ rulesets: live(), unanswered });
    const a = await run(['--apply'], gh);
    const did = writes(gh).map((c) => c.body?.name);
    if (a.code !== 1 || !says.test(a.err)) misses.push(`Could not find --apply holding back ${name} alone and saying what is known of it, exit 1, when gh gets no answer to ${label}: ${a.code} ${a.all}`);
    if (/nothing was written/.test(a.all)) misses.push(`Could not find --apply rid of "nothing was written" when gh gets no answer to ${label}: ${a.all}`);
    if (JSON.stringify(did) !== JSON.stringify(tried)) misses.push(`Could not find --apply still trying the others when gh gets no answer to ${label}: wrote ${JSON.stringify(did)}, for ${JSON.stringify(tried)}`);
    for (const n of [MR, SPELLING, CODEQL].filter((x) => x !== name)) if (!nowFile(n).test(a.out)) misses.push(`Could not find ${n} read back as its file's version though gh got no answer to ${label}: ${a.all}`);
    // The read alone: a read before any write that gets no answer holds back that one.
    if (beforeWrites) {
      const d = await run([], fakeGitHub({ rulesets: live(), unanswered }));
      if (d.code !== 1 || JSON.stringify(heldNamed(d.all, 'would be')) !== JSON.stringify([name])) misses.push(`Could not find the read holding back ${name} alone, exit 1, when gh gets no answer to ${label}: ${d.code} ${d.all}`);
    }
  }
  // The organisation's list unanswered: exit 2, nothing written, in the read and --apply alike.
  for (const argv of [[], ['--apply']]) {
    const gh = fakeGitHub({ rulesets: live(), unanswered: (c) => c.method === 'GET' && c.path.startsWith('/orgs/dazzer-io/rulesets?') });
    const r = await run(argv, gh);
    if (r.code !== 2 || writes(gh).length || !/^UNREAD: gh could not reach GitHub for GET \/orgs\/dazzer-io\/rulesets\?[^\n]*, so nothing was written$/m.test(r.err)) misses.push(`Could not find ${argv.length ? '--apply' : 'the read'} exiting 2, writing nothing, when gh gets no answer to the organisation's list: ${r.code} ${r.all}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

// A 5xx answer to a write is GitHub failing after the write may have landed, so it is said as an
// unanswered write is: held back alone, exit 1, whether it is its file's version unknown. A 4xx is
// GitHub refusing it, so nothing landed and it is not its file's version.
test('a 5xx answer to a write holds back that ruleset alone as one that may have landed, exit 1, while a 4xx is still GitHub refusing it', async () => {
  needKept();
  const misses = [];
  const writes5xx = [[SPELLING, 'creation', 'POST', '/orgs/dazzer-io/rulesets'], [MR, 'update', 'PUT', '/orgs/dazzer-io/rulesets/7'], [CODEQL, 'update', 'PUT', '/orgs/dazzer-io/rulesets/11']];
  for (const status of [500, 502, 503, 504]) {
    for (const [name, act, method, path] of writes5xx) {
      const gh = fakeGitHub({ rulesets: oneOfEach(), writeStatus: (c) => (c.method === method && c.path === path ? status : null) });
      const a = await run(['--apply'], gh);
      const says = new RegExp(`^UNREAD: ${name} was held back, its ${act} may have landed: GitHub answered ${status}, so whether it is its file's version is unknown until the run without --apply reads it`, 'm');
      if (a.code !== 1 || !says.test(a.err) || /^REFUSED: GitHub answered/m.test(a.err)) misses.push(`Could not find --apply holding back ${name}, its ${act} said as one that may have landed, when GitHub answers it ${status}, never as refused, exit 1: ${a.code} ${a.all}`);
      const tried = writes(gh).map((c) => c.body?.name);
      if (JSON.stringify(tried) !== JSON.stringify([MR, SPELLING, CODEQL])) misses.push(`Could not find --apply still writing the others after GitHub answered ${status} to the ${act} of ${name}: ${JSON.stringify(tried)}`);
      const rest = [MR, SPELLING, CODEQL].filter((x) => x !== name && !nowFile(x).test(a.out));
      if (rest.length) misses.push(`Could not find ${rest.join(' and ')} read back as its file's version after GitHub answered ${status} to the ${act} of ${name}: ${a.all}`);
    }
  }
  for (const status of [404, 409, 422]) {
    const gh = fakeGitHub({ rulesets: oneOfEach(), writeStatus: (c) => (c.method === 'PUT' && c.path === '/orgs/dazzer-io/rulesets/11' ? status : null) });
    const a = await run(['--apply'], gh);
    const says = new RegExp(`^REFUSED: GitHub answered ${status} to the update of codeql-complete-required, so it is not its file's version`, 'm');
    if (a.code !== 1 || !says.test(a.err) || /may have landed/.test(a.all)) misses.push(`Could not find --apply saying GitHub refused the update of codeql-complete-required with ${status}, so it is not its file's version, exit 1: ${a.code} ${a.all}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('exit 2 when GitHub could not be read at all: the organisation\'s rulesets unlisted, any page of them, in the read and --apply alike, and nothing is written', async () => {
  needKept();
  const misses = [];
  const many = Array.from({ length: 130 }, (_, i) => ({ id: 1000 + i, name: `made-up-${i}`, target: 'branch', enforcement: 'active', rules: [] }));
  for (const [label, rulesets, listStatus] of [['every page answered 503', allThree(), () => 503], ['the second page answered 502', [...many, ...allThree()], (page) => (page === 2 ? 502 : 200)]]) {
    for (const argv of [[], ['--apply']]) {
      const gh = fakeGitHub({ rulesets, listStatus });
      const r = await run(argv, gh);
      if (r.code !== 2 || writes(gh).length || !/^UNREAD: could not list dazzer-io's rulesets: GitHub answered 50[23]/m.test(r.err)) misses.push(`Could not find ${argv.length ? '--apply' : 'the read'} exiting 2, writing nothing, when ${label}: ${r.code} ${r.all} ${JSON.stringify(writes(gh).map((c) => c.path))}`);
    }
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('the command reads only the organisation\'s rulesets and dazzer-io/.github\'s id: no branch, pull request, branch rule, workflow run or check run (decision 210)', async () => {
  needKept();
  const misses = [];
  const ours = (path) => /^\/orgs\/dazzer-io\/rulesets(\/\d+)?(\?|$)/.test(path) || path === '/repos/dazzer-io/.github';
  for (const [label, rulesets] of [['every ruleset absent', () => []], ['every ruleset its file\'s', allThree], ['codeql-complete-required live as evaluate', () => [{ ...fileRuleset(), id: 7 }, { ...spellingFile(), id: 10 }, { ...codeqlFile(), id: 11, enforcement: 'evaluate' }]]]) {
    for (const argv of [[], ['--apply']]) {
      const gh = fakeGitHub({ rulesets: rulesets() });
      const r = await run(argv, gh);
      const beyond = gh.calls.filter((c) => !ours(c.path)).map((c) => `${c.method} ${c.path}`);
      if (beyond.length) misses.push(`Could not find ${argv.length ? '--apply' : 'the read'} reading only the organisation's rulesets and dazzer-io/.github when ${label}: ${JSON.stringify(beyond)}`);
      if (argv.length && r.code !== 0) misses.push(`Could not find --apply writing all three and reading them back, exit 0, when ${label}: ${r.code} ${r.all}`);
    }
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('the organisation\'s rulesets are read across every page, so a kept one past the first hundred is updated by its own id, never created twice', async () => {
  needKept();
  const misses = [];
  const many = Array.from({ length: 130 }, (_, i) => ({ id: 1000 + i, name: `made-up-${i}`, target: 'branch', enforcement: 'active', rules: [] }));
  const gh = fakeGitHub({ rulesets: [...many, ...allThree()] });
  const d = await run([], gh);
  if (d.code !== 0 || ![`${MR} (7)`, `${SPELLING} (10)`, `${CODEQL} (11)`].every((s) => d.all.includes(`${s} on dazzer-io is the file's version`))) misses.push(`Could not find the read finding each kept ruleset on the second page of the organisation's rulesets: ${d.code} ${d.all}`);
  const a = await run(['--apply'], gh);
  const w = writes(gh);
  if (a.code !== 0 || w.some((c) => c.method === 'POST') || JSON.stringify(w.map((c) => c.path)) !== JSON.stringify(['/orgs/dazzer-io/rulesets/7', '/orgs/dazzer-io/rulesets/10', '/orgs/dazzer-io/rulesets/11'])) misses.push(`Could not find --apply writing each kept ruleset past the first page to its own id, creating none: ${a.code} ${a.all} ${JSON.stringify(w.map((c) => `${c.method} ${c.path}`))}`);
  if (gh.held.length !== 133) misses.push(`Could not find the organisation still holding 133 rulesets: ${gh.held.length}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('without --apply, each of the three is said as its file\'s version, differing field by field, or absent, closing on what --apply would do, and nothing is written', async () => {
  needKept();
  const misses = [];
  const gh = fakeGitHub({ rulesets: [{ ...fileRuleset(), id: 7 }] });
  const r = await run([], gh);
  if (r.code !== 1) misses.push(`Could not find exit 1 while two rulesets are absent: ${r.code} ${r.all}`);
  if (!/machine-rule-required \(7\) on dazzer-io is the file's version/.test(r.all)) misses.push(`Could not find machine-rule-required said as its file's version: ${r.all}`);
  for (const [name, file] of [[SPELLING, 'main-spelling.json'], [CODEQL, 'codeql-complete.json']]) if (!new RegExp(`${name} is not on dazzer-io: --apply would create it from \\S*machine-rule/${file.replace('.', '\\.')}`).test(r.all)) misses.push(`Could not find ${name} said as absent, created from ${file}: ${r.all}`);
  if (JSON.stringify(saidPlan(r.out)) !== JSON.stringify({ write: [[MR, 'unchanged'], [SPELLING, 'create'], [CODEQL, 'create']], held: [] })) misses.push(`Could not find the read closing on what --apply would do with each: ${JSON.stringify(saidPlan(r.out))}\n${r.all}`);
  if (writes(gh).length) misses.push(`Could not find the read writing nothing: ${JSON.stringify(writes(gh))}`);
  const drifted = clone(spellingFile());
  drifted.conditions.ref_name.exclude = ['refs/heads/MAIN'];
  const d = fakeGitHub({ rulesets: [{ ...fileRuleset(), id: 7 }, { ...drifted, id: 10 }, { ...codeqlFile(), id: 11 }] });
  const dr = await run([], d);
  if (dr.code !== 1 || !dr.all.includes('main-spelling-refused (10) on dazzer-io differs from') || !dr.all.includes('conditions.ref_name.exclude[0]: live "refs/heads/MAIN", file (none)')) misses.push(`Could not find a live exclude on main-spelling-refused named field by field, exit 1: ${dr.code} ${dr.all}`);
  if (JSON.stringify(saidPlan(dr.out)) !== JSON.stringify({ write: [[MR, 'unchanged'], [SPELLING, 'update'], [CODEQL, 'unchanged']], held: [] })) misses.push(`Could not find the read saying --apply would update main-spelling-refused alone: ${JSON.stringify(saidPlan(dr.out))}\n${dr.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('machine-rule/README.md says what each ruleset holds, that --apply is Ben\'s command, that each ruleset stands alone and what each exit code means, where the locked shape is held to main, that machine-rule-required watches until r-3.37, that codeql-complete-required is required (blocking) and the way back, and the lint step\'s two ignores', () => {
  const md = readFileSync(join(ROOT, 'machine-rule/README.md'), 'utf8');
  const plain = md.replace(/\s+/g, ' ');
  const misses = [];
  for (const words of [
    '`main-spelling-refused`', '`main-spelling.json`', '`codeql-complete-required`', '`codeql-complete.json`', 'node machine-rule/apply-ruleset.mjs --apply', "Ben's own command",
    'refs/heads/M[Aa][Ii][Nn]', 'refs/heads/mA[Ii][Nn]', 'refs/heads/maI[Nn]', 'refs/heads/maiN', 'integration 15368', 'do_not_enforce_on_create',
    'without regard to case', "github.ref == 'refs/heads/main'", 'a branch named `MAIN`',
    "the locked shape below, the guarded `LOCKED_` setting, reaches dazzer and dazzer-app alone, and is held to main there only once `main-spelling-refused` is live and the locked machines' switch-on finds no other spelling of main there, non-ASCII ones included",
    "runners' locked canary reads no `LOCKED_` setting: it names its sets literally, and the runner group admits it to them",
    'keeps every `LOCKED_` setting empty until then', "So runners' apply never writes a `google-locked` repository list naming a repository `main-spelling-refused` does not cover", 'this command reads no branch',
    '`machine-rule-required` still watches: it is written `evaluate` until r-3.37',
    '`codeql-complete-required` is required (blocking): it is written `active`',
    // The rule reaches direct pushes too, and its basis is a reading of pushes and check runs (review of a8bbdaa).
    'A direct push to the default branch of dazzer or dazzer-app is refused unless its commit already passed `codeql / CodeQL complete`, the same as their own rulesets already require',
    'both repositories\' own main-protection rulesets are active with no bypass and already require status checks on every update of the default branch (dazzer: CI Gate, PR-diff gates (fast), CodeQL, Drizzle migration journal (drizzle-kit check), actionlint; dazzer-app: CI Gate), so this rule adds no new kind of refusal',
    'Every push to main since 8 Nov in both repositories was a merged pull request: 17 of 17 (dazzer 1397, 1399, 1403, 1404, 1410, 1412, 1414, 1415, 1419, 1420, 1421, 1422; dazzer-app 376, 377, 379, 380, 381), and `codeql / CodeQL complete` passed on each one\'s head, read on 9 Nov',
    'This is a reading of the pushes and check runs, not of GitHub\'s evaluate record: GitHub\'s rule-suite listing records no evaluate result for `codeql-complete-required`',
    'The way back: an organisation owner sets `codeql-complete-required` to `evaluate` with a local edit of `codeql-complete.json` and `node machine-rule/apply-ruleset.mjs --apply`, or in GitHub\'s organisation settings; `main-spelling-refused` accepts only `active`',
    'Each kept ruleset stands alone', 'holds back that one alone and names it', 'the others are still written and read back',
    "Exit 0 means every ruleset is its file's version", 'exit 1 means one or more were held back or differ', 'exit 2 means GitHub could not be read at all',
    // D212: a write gh gets no answer to is that ruleset's alone, and the ids a write and its read-back go to.
    'a write GitHub refuses with a 4xx', 'a write gh gets no answer to or GitHub answers with a 5xx, said as one that may have landed', "a created one by the id in GitHub's answer to its creation", 'an update goes to the id the list names',
    'Its two ignores are narrow',
    // main-spelling-refused reaches runners too, for its locked canary, and the canary's main guard
    // is not the protection by itself (r-3.45).
    'refuses the creation of a branch spelled main in other letters in dazzer, dazzer-app and runners, the repositories the locked runner group `google-locked` admits',
    "runners is admitted for one workflow alone, `locked-canary.yml`, dispatched by hand: `google-locked` admits it to the locked machines at `refs/heads/main` alone, and it is held to main only within the existing-branch bound, since a creation rule never touches a branch that is already there",
    '`codeql-complete-required` stays in dazzer and dazzer-app alone',
    "A dispatch runs the branch's own copy of the file, so the main guard is not the protection by itself",
    "the runner group's selected-workflow admission at `refs/heads/main`, with `main-spelling-refused` in each repository it admits, is",
    // runners is held to main within the same bound as dazzer and dazzer-app, and runners' own
    // reads clear it (runners pull request 41; review of 4f57c6a).
    'In runners too, a creation rule never touches a branch that is already there',
    "runners' routine settings apply refuses to write `google-locked`'s repository list while any repository it admits is not under a live `main-spelling-refused` creation rule or holds a branch spelled main in other letters, ASCII or not",
    'its `switch-on --locked` reads the same before the locked settings are written (runners pull request 41)',
  ]) if (!plain.includes(words)) misses.push(`Could not find machine-rule/README.md saying ${JSON.stringify(words)}`);
  for (const words of ['so a dispatch from another branch runs nothing on the locked sets', 'It names the two by name', 'Holding it to main in any other repository is other work', 'does not admit is other work', "held to main by the runner group's admission", 'run from main alone', '`main-spelling-refused` covers runners too']) if (plain.includes(words)) misses.push(`Could not find machine-rule/README.md rid of ${JSON.stringify(words)}: a dispatch runs its branch's own copy, main-spelling-refused names three repositories, and runners is held to main only within the existing-branch bound (r-3.45)`);
  // Every sentence saying main-spelling-refused is live bounds the claim to the two repositories and
  // to the locked switch-on finding no other spelling there, non-ASCII ones included (decision 210).
  for (const s of plain.split(/(?<=\.) /)) if (s.includes('`main-spelling-refused` is live') && !(s.includes('dazzer and dazzer-app') && s.includes("the locked machines' switch-on finds no other spelling of main there, non-ASCII ones included"))) misses.push(`Could not find this sentence of machine-rule/README.md bounded to dazzer and dazzer-app, with the locked switch-on finding no other spelling of main there, non-ASCII ones included: ${s}`);
  // codeql-complete-required no longer watches (r-3.27), and machine-rule-required is not called required
  // while it is written evaluate (review of dazzer-io/.github 27, finding 1).
  for (const words of ['watches, in `evaluate`, until it is made active', '`machine-rule-required` is required (blocking)', 'passed on all 21 pull requests', 'read reporting on dazzer 1421 and 1407', 'sets a ruleset to `evaluate`']) if (plain.includes(words)) misses.push(`Could not find machine-rule/README.md rid of ${JSON.stringify(words)}: codeql-complete-required is required (blocking), machine-rule-required watches until r-3.37`);
  if (/Its one ignore/.test(plain)) misses.push('Could not find machine-rule/README.md rid of "Its one ignore": the lint step holds two (decision 201)');
  // The guard and the branch read are gone, and their account with them (decision 210).
  for (const words of ['default-branch head carries', 'one refusal and nothing is written', 'Any of these and nothing is written', 'the head of the newest pull request merged into', 'the newest merge-group commit', 'a branch spelled main in other letters already exists', 'its guard reads']) if (plain.includes(words)) misses.push(`Could not find machine-rule/README.md rid of ${JSON.stringify(words)}, the guard or the branch read decision 210 removed`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('no sentence of either README, a comment of apply-ruleset.mjs or judge.mjs, or a reason in kept.json says more than the rulesets and the runner group give', () => {
  const plain = readFileSync(join(ROOT, 'machine-rule/README.md'), 'utf8').replace(/\s+/g, ' ');
  const misses = [];
  // Every sentence, in either README, a comment of apply-ruleset.mjs or judge.mjs, or a reason in
  // kept.json, read without regard to case, that names a runner, google-locked or the locked canary
  // beside a claim that something runs, is admitted, stays or is held from, on or to main carries
  // the bound (a creation rule never touches a branch that is already there) or points to it
  // (within the existing-branch bound). A LOCKED_RUNNER_<N> setting names no runner group, and the
  // scan machines' runner group admits the shared workflows at refs/heads/main, where a call at
  // @main reads this repository's own main, so neither is this claim. No sentence says
  // main-spelling-refused reaches dazzer and dazzer-app without runners, but where it speaks of the
  // LOCKED_ setting, which reaches those two alone; and none says codeql-complete-required is
  // written, kept or left in evaluate, since it is active (r-3.27, r-3.46).
  const comments = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\n').map((l) => /^\s*\/\/(.*)$/.exec(l)?.[1]).filter((l) => l !== undefined).join(' ').replace(/\s+/g, ' ');
  const top = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  const kept = readJson('machine-rule/kept.json');
  const sources = [
    ['machine-rule/README.md', plain],
    ['README.md', top],
    ['a comment of machine-rule/apply-ruleset.mjs', comments('machine-rule/apply-ruleset.mjs')],
    ['a comment of machine-rule/judge.mjs', comments('machine-rule/judge.mjs')],
    ...(Array.isArray(kept?.entries) ? kept.entries : []).map((e) => [`machine-rule/kept.json's reason for ${e?.repository} ${e?.workflow}`, String(e?.reason ?? '')]),
  ];
  for (const [where, text] of sources) {
    for (const s of text.split(/(?<=\.) /)) {
      const bare = s.replace(/`/g, '').toLowerCase();
      if (/(?<!_)runner|google-locked|locked canary|locked-canary/.test(bare) && !/\bscan machines' runner group\b|\bscan runner group\b/.test(bare)
        && /\b(?:from|on|to) main(?![-\w])|\bmain alone\b|admit\w*\b[^.]*refs\/heads\/main/.test(bare)
        && !bare.includes('never touches a branch that is already there') && !bare.includes('within the existing-branch bound')) misses.push(`Could not find this sentence of ${where} bounded by a creation rule never touching a branch that is already there, or pointing within the existing-branch bound: ${s}`);
      if (/main-spelling/.test(bare) && /\bdazzer and dazzer-app\b/.test(bare) && !/\brunners\b/.test(bare) && !bare.includes('locked_')) misses.push(`Could not find this sentence of ${where} naming runners beside dazzer and dazzer-app for main-spelling-refused, which covers all three (r-3.45): ${s}`);
      if (/codeql-complete/.test(bare) && /\b(?:written|kept|stays|left|is) (?:in )?evaluate\b|\bevaluate,? as its file is written\b/.test(bare)) misses.push(`Could not find this sentence of ${where} saying codeql-complete-required is active, as its file is written (r-3.27): ${s}`);
    }
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('the repository\'s README.md says apply-ruleset.mjs writes three organisation rulesets, naming each', () => {
  const plain = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  const misses = [];
  for (const words of ['writes three organisation rulesets', '`machine-rule-required`', '`main-spelling-refused`', '`codeql-complete-required`', '`machine-rule/main-spelling.json`', '`machine-rule/codeql-complete.json`']) if (!plain.includes(words)) misses.push(`Could not find README.md saying ${JSON.stringify(words)}`);
  if (plain.includes('reads the ruleset and is the one command that writes it')) misses.push('Could not find README.md rid of apply-ruleset.mjs writing one ruleset');
  assert.ok(!misses.length, misses.join('\n'));
});
