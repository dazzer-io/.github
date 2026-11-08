// Proves machine-rule/ruleset.json, main-spelling.json, codeql-complete.json and
// machine-rule/apply-ruleset.mjs (decisions 121, 177, 192): the organisation ruleset
// machine-rule-required runs .github/workflows/machine-rule.yml, read from dazzer-io/.github by its
// repository id at refs/heads/main, on the default branch of every repository; main-spelling-refused
// restricts the creation of the fifteen other spellings of main in dazzer and dazzer-app; and
// codeql-complete-required requires codeql / CodeQL complete from GitHub Actions there. Each file is
// checked by its own check, each way it could be wrong red alone; the command's diff, write, guard
// and readings modes are run against a fake GitHub that answers lists a page at a time, holds each
// repository's branches, closed pull requests, branch rules and merge-group runs, and leaves each
// default branch's own head with no run, as a bot's merge does (decision 208), so nothing here
// reaches the network and no ruleset is written anywhere. Every failure starts "Could not find".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let A = null;
let missing = null;
try {
  A = await import('../machine-rule/apply-ruleset.mjs');
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
const SPELLING = 'main-spelling-refused';
const CODEQL = 'codeql-complete-required';
const CONTEXT = 'codeql / CodeQL complete';
// GitHub Actions' integration id, as every codeql / CodeQL complete on dazzer's and dazzer-app's
// pull requests carries it (decision 192) and as their main-protection rulesets name it.
const ACTIONS = 15368;
const REPOSITORIES = ['dazzer', 'dazzer-app'];
// The four patterns decision 192 names, in its words.
const PATTERNS = ['refs/heads/M[Aa][Ii][Nn]', 'refs/heads/mA[Ii][Nn]', 'refs/heads/maI[Nn]', 'refs/heads/maiN'];
// The sixteen spellings of main, each letter in either case, main itself first.
const SPELLINGS = Array.from({ length: 16 }, (_, m) => `refs/heads/${[...'main'].map((c, i) => ((m >> (3 - i)) & 1 ? c.toUpperCase() : c)).join('')}`);
// The checks of the two new rulesets, needed before any case reads them.
const needKept = () => {
  need();
  for (const k of ['checkMainSpelling', 'checkCodeqlComplete', 'namesMatched']) assert.equal(typeof A[k], 'function', `Could not find apply-ruleset.mjs's ${k}, so the rulesets main-spelling-refused and codeql-complete-required are not held to their files (decision 192)`);
};

test('ruleset.json is the rule\'s ruleset: machine-rule.yml of dazzer-io/.github at refs/heads/main, every repository\'s default branch, evaluate first', () => {
  need();
  const r = fileRuleset();
  assert.deepEqual(A.checkRuleset(r), [], 'Could not find machine-rule/ruleset.json passing checkRuleset');
  assert.equal(r.enforcement, 'evaluate', 'Could not find the ruleset written as evaluate, so it watches before it refuses (decision 177)');
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
  ];
  const misses = [];
  for (const [name, change, says] of cases) {
    const r = clone(base);
    change(r);
    const problems = A.checkRuleset(r);
    if (!problems.some((p) => says.test(p))) misses.push(`Could not find checkRuleset refusing ${name}: ${JSON.stringify(problems)}`);
  }
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
// A check run as GitHub lists one (gh api repos/<o>/<r>/commits/<sha>/check-runs): its id, the commit,
// its name, status and conclusion, and the app that posted it.
const checkRun = (sha, over = {}) => ({ id: 5000, head_sha: sha, name: CONTEXT, status: 'completed', conclusion: 'success', app: { id: ACTIONS, slug: 'github-actions' }, ...over });
// A made-up commit: forty hex digits from a short seed.
const sha = (seed) => String(seed).repeat(40).slice(0, 40);
// A closed pull request as GitHub lists one (gh api repos/<o>/<r>/pulls?state=closed): its number,
// when it was merged (null when closed unmerged) and last updated, its base and its head commit.
const pull = (number, head, merged_at, updated_at, base = 'main') => ({ number, state: 'closed', merged_at, updated_at, base: { ref: base }, head: { sha: head } });
// A workflow run a merge queue started (gh api repos/<o>/<r>/actions/runs?event=merge_group): its
// id, its event, its merge-group commit and when it was made.
const groupRun = (id, head, created_at, event = 'merge_group') => ({ id, event, head_sha: head, head_branch: `gh-readonly-queue/main/pr-${id}-${head}`, created_at });
// A repository whose default branch's own head is a merge by a bot, carrying no run at all, as
// dazzer-app's a9d93a8 did (decision 208), and whose newest pull request merged into that branch,
// #30, carries codeql / CodeQL complete passed from GitHub Actions on its head, beside a run of
// another name. Beside it: #31, closed unmerged and updated since, and #29, merged before it, each
// head's check failed; a branch whose name merely holds main; and no merge queue.
const passingRepo = (seed, mainSeed, branch = 'main') => {
  const head = sha(seed);
  const unmerged = sha(`${seed}1`);
  const older = sha(`${seed}2`);
  return {
    default_branch: branch,
    head: sha(mainSeed),
    branches: [branch, 'made-up-feature', 'maintenance', 'domain'],
    pulls: [
      pull(29, older, '2026-11-07T11:00:00Z', '2026-11-07T11:00:02Z', branch),
      pull(30, head, '2026-11-08T11:00:00Z', '2026-11-08T11:00:03Z', branch),
      pull(31, unmerged, null, '2026-11-08T12:00:00Z', branch),
    ],
    runs: {
      [head]: [checkRun(head), checkRun(head, { id: 4000, name: 'codeql / Analyze (actions)' })],
      [unmerged]: [checkRun(unmerged, { conclusion: 'failure' })],
      [older]: [checkRun(older, { conclusion: 'failure' })],
    },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    groups: [],
  };
};
const passingRepos = () => ({ dazzer: passingRepo('a', 'd'), 'dazzer-app': passingRepo('b', 'e') });
// dazzer-app's newest merged head, and its default branch's own head, in passingRepos.
const APP_HEAD = sha('b');
const APP_MAIN = sha('e');
// A fake GitHub holding the organisation's rulesets, dazzer-io/.github's id, and, for each repository
// repos names, its default branch and that branch's own head, its branches, its closed pull
// requests, the rules on its default branch, the workflow runs its merge queue started, and each
// commit's check runs; every call kept. Each list is answered a page at a time, as GitHub answers
// one: per_page 30 unless asked, at most 100, and page 1 unless asked. Pull requests are sorted as
// the List pull requests page says: by created (here their number) unless sort names updated, desc
// when sort is created or not given and asc otherwise unless direction says. write turns what a
// write sends into what GitHub keeps, for a GitHub that keeps something else; rejects names a
// ruleset whose write GitHub answers 422.
function fakeGitHub({ rulesets = [], sharedId = ID, write = null, rejects = null, repos = passingRepos() } = {}) {
  const calls = [];
  const held = rulesets.map((r) => clone(r));
  let next = 900;
  const kept = (body) => clone(write ? write(clone(body)) : body);
  const ok = (x) => ({ status: 200, text: JSON.stringify(x) });
  const page = (u, items) => {
    const per = Math.min(Number(u.searchParams.get('per_page') ?? 30), 100);
    const at = Number(u.searchParams.get('page') ?? 1);
    return items.slice((at - 1) * per, at * per);
  };
  const sortPulls = (u, pulls) => {
    const sort = u.searchParams.get('sort') ?? 'created';
    const desc = (u.searchParams.get('direction') ?? (sort === 'created' ? 'desc' : 'asc')) === 'desc';
    const key = (x) => (sort === 'updated' ? Date.parse(x.updated_at) : x.number);
    return [...pulls].sort((a, b) => (desc ? key(b) - key(a) : key(a) - key(b)));
  };
  const no422 = (body) => (rejects && body?.name === rejects ? { status: 422, text: JSON.stringify({ message: 'Validation Failed', errors: ['made-up refusal'], status: '422' }) } : refuses(body));
  const request = async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    const u = new URL(`https://api.github.com${path}`);
    const p = u.pathname;
    let m;
    if (method === 'GET' && p === '/orgs/dazzer-io/rulesets') return ok(page(u, held.map((r) => ({ id: r.id, name: r.name }))));
    if (method === 'GET' && (m = /^\/orgs\/dazzer-io\/rulesets\/(\d+)$/.exec(p))) {
      const r = held.find((x) => String(x.id) === m[1]);
      return r ? ok(readBack(r)) : { status: 404, text: '{}' };
    }
    if (method === 'GET' && p === '/repos/dazzer-io/.github') return ok({ id: sharedId, name: '.github', default_branch: 'main' });
    if (method === 'GET' && (m = /^\/repos\/dazzer-io\/([^/]+)(\/.*)?$/.exec(p)) && repos[m[1]]) {
      const h = repos[m[1]];
      const rest = m[2] ?? '';
      let n;
      if (h.status) return { status: h.status, text: '{}' };
      if (rest === '') return ok({ id: 77, name: m[1], default_branch: h.default_branch });
      if (rest === '/branches') return ok(page(u, h.branches.map((name) => ({ name, commit: { sha: name === h.default_branch ? h.head : sha('0') }, protected: name === h.default_branch }))));
      if ((n = /^\/branches\/(.+)$/.exec(rest))) return decodeURIComponent(n[1]) === h.default_branch ? ok({ name: h.default_branch, commit: { sha: h.head } }) : { status: 404, text: '{}' };
      if (rest === '/pulls') {
        if (h.pullsStatus) return { status: h.pullsStatus, text: '{}' };
        const state = u.searchParams.get('state') ?? 'open';
        const base = u.searchParams.get('base');
        return ok(page(u, sortPulls(u, h.pulls.filter((x) => (state === 'all' || x.state === state) && (base === null || x.base.ref === base)))));
      }
      if ((n = /^\/rules\/branches\/(.+)$/.exec(rest))) return ok(page(u, decodeURIComponent(n[1]) === h.default_branch ? h.rules : []));
      if (rest === '/actions/runs') {
        const event = u.searchParams.get('event');
        const runs = h.groups.filter((r) => event === null || r.event === event);
        return ok({ total_count: runs.length, workflow_runs: page(u, runs) });
      }
      if ((n = /^\/commits\/([^/]+)\/check-runs$/.exec(rest))) {
        // GitHub's page does not say whether check_name folds case, so this one folds it, and
        // the guard must hold the name exactly itself.
        const name = u.searchParams.get('check_name');
        const runs = (h.runs[n[1]] ?? []).filter((c) => name === null || c.name.toLowerCase() === name.toLowerCase());
        return ok({ total_count: runs.length, check_runs: runs });
      }
      return { status: 404, text: '{}' };
    }
    if (method === 'PUT' && (m = /^\/orgs\/dazzer-io\/rulesets\/(\d+)$/.exec(p))) {
      const at = held.findIndex((x) => String(x.id) === m[1]);
      if (at === -1) return { status: 404, text: '{}' };
      const no = no422(body);
      if (no) return no;
      held[at] = { ...kept(body), id: held[at].id };
      return ok(readBack(held[at]));
    }
    if (method === 'POST' && p === '/orgs/dazzer-io/rulesets') {
      const no = no422(body);
      if (no) return no;
      const r = { ...kept(body), id: next++ };
      held.push(r);
      return { status: 201, text: JSON.stringify(readBack(r)) };
    }
    return { status: 404, text: '{}' };
  };
  return { request, calls, held };
}
// The three rulesets the files keep, as GitHub would hold them, at ids of their own.
const allThree = () => [{ ...fileRuleset(), id: 7 }, { ...spellingFile(), id: 10 }, { ...codeqlFile(), id: 11 }];
async function run(argv, gh) {
  const out = [];
  const err = [];
  const code = await A.main(argv, { request: gh.request, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, all: [...out, ...err].join('\n') };
}
const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET');

test('the diff: exit 0 when every live ruleset is its file\'s, 1 naming each field when one differs or is absent, and it writes nothing', async () => {
  need();
  const file = fileRuleset();
  const misses = [];
  const same = fakeGitHub({ rulesets: [...allThree(), { id: 8, name: 'made-up-other', rules: [] }] });
  const s = await run([], same);
  if (s.code !== 0 || !/machine-rule-required \(7\) on dazzer-io is the file's version, enforcement evaluate/.test(s.all)) misses.push(`Could not find the matching ruleset read as the file's version, exit 0: ${s.code} ${s.all}`);
  for (const [name, id] of [[SPELLING, 10], [CODEQL, 11]]) if (!s.all.includes(`${name} (${id}) on dazzer-io is the file's version, enforcement active`)) misses.push(`Could not find ${name} read as its file's version: ${s.all}`);
  const drifted = clone(file);
  drifted.rules[0].parameters.workflows[0].ref = 'refs/heads/made-up-branch';
  const d = fakeGitHub({ rulesets: [{ ...drifted, id: 7 }, ...allThree().slice(1)] });
  const dr = await run([], d);
  if (dr.code !== 1 || !dr.all.includes('rules[0].parameters.workflows[0].ref: live "refs/heads/made-up-branch", file "refs/heads/main"')) misses.push(`Could not find a drifted ref named field by field, exit 1: ${dr.code} ${dr.all}`);
  const absent = fakeGitHub({ rulesets: [{ id: 8, name: 'made-up-other' }] });
  const ab = await run([], absent);
  if (ab.code !== 1 || !/is not on dazzer-io: --apply would create it/.test(ab.all)) misses.push(`Could not find an absent ruleset said as absent, exit 1: ${ab.code} ${ab.all}`);
  for (const gh of [same, d, absent]) if (writes(gh).length) misses.push(`Could not find the diff writing nothing: ${JSON.stringify(writes(gh))}`);
  const twice = fakeGitHub({ rulesets: [{ ...file, id: 7 }, { ...file, id: 9 }] });
  const tw = await run([], twice);
  if (tw.code !== 2 || !/holds 2 rulesets named machine-rule-required/.test(tw.all)) misses.push(`Could not find two rulesets of the name read as unread, exit 2: ${tw.code} ${tw.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('--apply writes each file\'s version to the ruleset of its name alone: a PUT to its own id, a POST when absent, refused when the repository id differs', async () => {
  need();
  const file = fileRuleset();
  const spelling = spellingFile();
  const codeql = codeqlFile();
  const other = { id: 8, name: 'made-up-other', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] };
  const misses = [];
  const there = fakeGitHub({ rulesets: [other, { ...file, id: 7, enforcement: 'active', rules: [] }, { ...spelling, id: 10, enforcement: 'evaluate' }] });
  const put = await run(['--apply'], there);
  const w = writes(there);
  const byName = (ws, name) => ws.filter((c) => c.body?.name === name);
  const mr = byName(w, 'machine-rule-required');
  if (put.code !== 0 || mr.length !== 1 || mr[0].method !== 'PUT' || mr[0].path !== '/orgs/dazzer-io/rulesets/7' || JSON.stringify(mr[0].body) !== JSON.stringify(file)) misses.push(`Could not find --apply writing ruleset.json as one PUT to ruleset 7 alone: ${put.code} ${put.all} ${JSON.stringify(w)}`);
  const sp = byName(w, SPELLING);
  if (sp.length !== 1 || sp[0].method !== 'PUT' || sp[0].path !== '/orgs/dazzer-io/rulesets/10' || JSON.stringify(sp[0].body) !== JSON.stringify(spelling)) misses.push(`Could not find --apply writing main-spelling.json as one PUT to ruleset 10, its own id: ${JSON.stringify(sp)}`);
  const cq = byName(w, CODEQL);
  if (cq.length !== 1 || cq[0].method !== 'POST' || cq[0].path !== '/orgs/dazzer-io/rulesets' || JSON.stringify(cq[0].body) !== JSON.stringify(codeql)) misses.push(`Could not find --apply creating codeql-complete-required from codeql-complete.json with one POST, as it is absent: ${JSON.stringify(cq)}`);
  if (w.length !== 3) misses.push(`Could not find --apply making three writes, one a file: ${JSON.stringify(w.map((c) => `${c.method} ${c.path} ${c.body?.name}`))}`);
  if (w.some((c) => /\/rulesets\/8$/.test(c.path))) misses.push('Could not find the other ruleset left unwritten');
  if (JSON.stringify(there.held.find((r) => r.id === 8)) !== JSON.stringify(other)) misses.push('Could not find the other ruleset left as it was');
  for (const name of ['machine-rule-required', SPELLING, CODEQL]) if (!new RegExp(`${name} \\(\\d+\\) on dazzer-io now is the file's version`).test(put.all)) misses.push(`Could not find --apply saying ${name} as read back is its file's version: ${put.all}`);
  const none = fakeGitHub({ rulesets: [other] });
  const post = await run(['--apply'], none);
  const p = writes(none);
  if (post.code !== 0 || p.length !== 3 || p.some((c) => c.method !== 'POST' || c.path !== '/orgs/dazzer-io/rulesets') || JSON.stringify(p.map((c) => c.body?.name)) !== JSON.stringify(['machine-rule-required', SPELLING, CODEQL])) misses.push(`Could not find --apply creating each absent ruleset with one POST of its own: ${post.code} ${post.all} ${JSON.stringify(p)}`);
  const moved = fakeGitHub({ rulesets: [{ ...file, id: 7 }], sharedId: 42 });
  const mv = await run(['--apply'], moved);
  if (mv.code !== 2 || writes(moved).length || !/repository id is 42 on GitHub, not 1433582766/.test(mv.all)) misses.push(`Could not find --apply refusing, writing nothing, when dazzer-io/.github's live id is not the file's: ${mv.code} ${mv.all}`);
  const ignored = fakeGitHub({ rulesets: allThree(), write: (b) => (b.name === 'machine-rule-required' ? { ...b, enforcement: 'disabled' } : b) });
  const ig = await run(['--apply'], ignored);
  if (ig.code !== 2 || !/machine-rule-required as read back still differs from the file/.test(ig.all)) misses.push(`Could not find --apply reading the ruleset back and refusing when it still differs: ${ig.code} ${ig.all}`);
  const spellingIgnored = fakeGitHub({ rulesets: allThree(), write: (b) => (b.name === SPELLING ? { ...b, rules: [] } : b) });
  const si = await run(['--apply'], spellingIgnored);
  if (si.code !== 2 || !/main-spelling-refused as read back still differs from the file/.test(si.all)) misses.push(`Could not find --apply reading main-spelling-refused back and refusing when GitHub kept it without its rule: ${si.code} ${si.all}`);
  const twice = fakeGitHub({ rulesets: [...allThree(), { ...spelling, id: 12 }] });
  const tw = await run(['--apply'], twice);
  if (tw.code !== 2 || writes(twice).length || !/holds 2 rulesets named main-spelling-refused/.test(tw.all)) misses.push(`Could not find two rulesets named main-spelling-refused read as unread, nothing written: ${tw.code} ${tw.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('a ruleset file that fails checkRuleset is never written, and the modes are one at a time', async () => {
  need();
  const misses = [];
  const gh = fakeGitHub({ rulesets: [] });
  const out = [];
  const err = [];
  const bad = clone(fileRuleset());
  bad.conditions.repository_name.include = ['dazzer'];
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'machine-rule-ruleset-'));
  writeFileSync(join(dir, 'ruleset.json'), JSON.stringify(bad));
  const code = await A.main(['--apply'], { request: gh.request, out: (l) => out.push(l), err: (l) => err.push(l), file: join(dir, 'ruleset.json') });
  if (code !== 2 || gh.calls.length || !/is not the rule's ruleset: .*narrower than every repository/.test(err.join('\n'))) misses.push(`Could not find a narrowed ruleset file refused before any call: ${code} ${err.join('\n')} ${JSON.stringify(gh.calls)}`);
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

test('checkRuleset refuses protected: true beside ~ALL in GitHub\'s own words, and --apply then calls nothing', async () => {
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
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'machine-rule-ruleset-'));
  writeFileSync(join(dir, 'ruleset.json'), JSON.stringify(bad));
  const gh = fakeGitHub({ rulesets: [] });
  const err = [];
  const code = await A.main(['--apply'], { request: gh.request, out: () => {}, err: (l) => err.push(l), file: join(dir, 'ruleset.json') });
  if (code !== 2 || gh.calls.length || !err.join('\n').includes(GITHUB_REFUSAL)) misses.push(`Could not find a ruleset file with protected: true beside ~ALL refused before any call to GitHub, in GitHub's words: ${code} ${err.join('\n')} ${JSON.stringify(gh.calls)}`);
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
  if (apply.code !== 0 || !/now is the file's version, enforcement evaluate/.test(apply.all)) misses.push(`Could not find --apply of the shipped file accepted by GitHub and read back as the file's version, exit 0: ${apply.code} ${apply.all}`);
  const after = await run([], gh);
  if (after.code !== 0 || !/is the file's version, enforcement evaluate/.test(after.all)) misses.push(`Could not find the read after --apply saying it matches, exit 0: ${after.code} ${after.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

// ================================================================ the two rules on main (decisions 188, 192, 195)
// main-spelling-refused restricts creating a branch spelled main in other letters in dazzer and
// dazzer-app, and codeql-complete-required requires the shared scan's codeql / CodeQL complete from
// GitHub Actions there before a merge. Both are kept as files beside ruleset.json and written by
// the same --apply. GitHub's rulesets pages name fnmatch with File::FNM_PATHNAME and say nothing
// of case, so the patterns hold either way: matched case-sensitively they take the fifteen other
// spellings and never main; folded, they take main too, and creation alone is restricted, which
// never touches a push to a branch that exists.

// fnmatch of literal characters and bracket classes alone, as a regular expression: this test's
// own reading, apart from apply-ruleset.mjs's, case-sensitive unless folded.
const asRegExp = (p, flags = '') => new RegExp(`^${p.replace(/\[([^\]]*)\]|([^[])/g, (_, cls, c) => (cls !== undefined ? `[${cls.replace(/[\\\]^-]/g, '\\$&')}]` : c.replace(/[.*+?^${}()|\\/]/g, '\\$&')))}$`, flags);
// How many names a pattern of literals and bracket classes of single letters names.
const sizeOf = (p) => (p.match(/\[[^\]]*\]/g) ?? []).reduce((n, cls) => n * new Set(cls.slice(1, -1)).size, 1);

test('main-spelling.json is main-spelling-refused: branches, active, no bypass, dazzer and dazzer-app by name, the four patterns with no exclude, one creation rule', () => {
  needKept();
  const r = spellingFile();
  assert.deepEqual(A.checkMainSpelling(r), [], `Could not find machine-rule/main-spelling.json passing checkMainSpelling: ${JSON.stringify(A.checkMainSpelling(r))}`);
  assert.deepEqual(r, {
    name: SPELLING,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: PATTERNS, exclude: [] }, repository_name: { include: REPOSITORIES, exclude: [], protected: true } },
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
    ['another repository in place of one', (r) => { r.conditions.repository_name.include = ['dazzer', 'made-up-tools']; }, /not dazzer and dazzer-app by name/],
    ['a third repository', (r) => { r.conditions.repository_name.include.push('made-up-tools'); }, /not dazzer and dazzer-app by name/],
    ['every repository', (r) => { r.conditions.repository_name.include = ['~ALL']; }, /not dazzer and dazzer-app by name/],
    ['a repository pattern', (r) => { r.conditions.repository_name.include = ['dazzer*']; }, /not dazzer and dazzer-app by name/],
    ['one repository alone', (r) => { r.conditions.repository_name.include = ['dazzer']; }, /not dazzer and dazzer-app by name/],
    ['a repository excluded', (r) => { r.conditions.repository_name.exclude = ['dazzer-app']; }, /repository condition excludes/],
    ['renaming left open', (r) => { r.conditions.repository_name.protected = false; }, /protected: true/],
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
  ];
  const misses = [];
  for (const [name, change, says] of cases) {
    const r = clone(base);
    change(r);
    const problems = A.checkMainSpelling(r);
    if (!problems.some((p) => says.test(p))) misses.push(`Could not find checkMainSpelling refusing ${name}: ${JSON.stringify(problems)}`);
  }
  const reordered = clone(base);
  reordered.conditions.ref_name.include.reverse();
  if (A.checkMainSpelling(reordered).length) misses.push(`Could not find the same four patterns in another order passing: ${JSON.stringify(A.checkMainSpelling(reordered))}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('codeql-complete.json is codeql-complete-required: branches, active, no bypass, the two repositories\' default branch, codeql / CodeQL complete from integration 15368, not on create, strict off', () => {
  needKept();
  const r = codeqlFile();
  assert.deepEqual(A.checkCodeqlComplete(r), [], `Could not find machine-rule/codeql-complete.json passing checkCodeqlComplete: ${JSON.stringify(A.checkCodeqlComplete(r))}`);
  assert.deepEqual(r, {
    name: CODEQL,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] }, repository_name: { include: REPOSITORIES, exclude: [], protected: true } },
    rules: [{ type: 'required_status_checks', parameters: { do_not_enforce_on_create: true, required_status_checks: [{ context: CONTEXT, integration_id: ACTIONS }], strict_required_status_checks_policy: false } }],
  }, `Could not find codeql-complete.json holding exactly decision 192's ruleset: ${JSON.stringify(r)}`);
});

test('checkCodeqlComplete refuses another context, another integration, a bypass, and each way it could require less or elsewhere, each red alone', () => {
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
    ['a repository excluded', (r) => { r.conditions.repository_name.exclude = ['dazzer']; }, /repository condition excludes/],
    ['renaming left open', (r) => { delete r.conditions.repository_name.protected; }, /protected: true/],
    ['a ref beyond the default branch', (r) => { r.conditions.ref_name.include.push('refs/heads/made-up'); }, /not the default branch alone/],
    ['a ref exclude', (r) => { r.conditions.ref_name.exclude = ['refs/heads/main']; }, /not the default branch alone/],
    ['a rule of another type', (r) => { r.rules = [{ type: 'creation' }]; }, /a rule of type "creation", not required_status_checks/],
    ['a second rule beside it', (r) => { r.rules.push({ type: 'deletion' }); }, /holds 2 rules, not one required_status_checks rule/],
    ['evaluate for active', (r) => { r.enforcement = 'evaluate'; }, /not active/],
    ['another name', (r) => { r.name = 'made-up'; }, /not codeql-complete-required/],
    ['a tag target', (r) => { r.target = 'tag'; }, /not branch/],
  ];
  const misses = [];
  for (const [name, change, says] of cases) {
    const r = clone(base);
    change(r);
    const problems = A.checkCodeqlComplete(r);
    if (!problems.some((x) => says.test(x))) misses.push(`Could not find checkCodeqlComplete refusing ${name}: ${JSON.stringify(problems)}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

// What a run without --apply says --apply would do, read from its closing line: each ruleset it would
// write, in order, with create, update or unchanged, and the one it would hold back, if any.
const planOf = (all) => {
  const m = /^--apply would write (.+?)(?:, and hold back (\S+), its guard refusing)?$/m.exec(all);
  if (!m) return null;
  return { write: m[1].split(', ').map((x) => { const y = /^(\S+) \((create|update|unchanged)\)$/.exec(x); return y ? [y[1], y[2]] : x; }), held: m[2] ?? null };
};
const MR = 'machine-rule-required';
// passingRepos with dazzer-app's newest merged head carrying a failed check.
const failingApp = () => {
  const repos = passingRepos();
  repos['dazzer-app'].runs[APP_HEAD] = [checkRun(APP_HEAD, { conclusion: 'failure' })];
  return repos;
};

test('codeql-complete-required\'s guard reads the head of the newest pull request merged into each default branch, never the branch\'s own head', async () => {
  needKept();
  const misses = [];
  // passingRepos: each default branch's own head carries no run, as a bot's merge leaves it; #31,
  // closed unmerged and updated last, and #29, merged before #30, each carry a failed check.
  const gh = fakeGitHub({ rulesets: [] });
  const r = await run(['--apply'], gh);
  const names = writes(gh).map((c) => c.body?.name);
  if (r.code !== 0 || !names.includes(CODEQL)) misses.push(`Could not find --apply writing codeql-complete-required once each newest merged pull request's head carries the check passed, though each default branch's own head carries no run: ${r.code} ${r.all} ${JSON.stringify(names)}`);
  for (const [repo, seed] of [['dazzer', 'a'], ['dazzer-app', 'b']]) if (!new RegExp(`dazzer-io/${repo}'s newest pull request merged into main, #30, head ${seed}{40} carries codeql / CodeQL complete passed from integration 15368`).test(r.all)) misses.push(`Could not find the guard saying it read ${repo}'s newest merged pull request, #30, at its head: ${r.all}`);
  const ownHeads = gh.calls.filter((c) => [sha('d'), APP_MAIN].some((h) => c.path.includes(h)) || /\/branches\/main$/.test(c.path));
  if (ownHeads.length) misses.push(`Could not find the guard leaving each default branch's own head unread: ${JSON.stringify(ownHeads.map((c) => c.path))}`);
  for (const repo of ['dazzer', 'dazzer-app']) if (!gh.calls.some((c) => c.path.startsWith(`/repos/dazzer-io/${repo}/pulls?`) && /[?&]state=closed(&|$)/.test(c.path) && /[?&]base=main(&|$)/.test(c.path))) misses.push(`Could not find the guard listing ${repo}'s closed pull requests into main: ${JSON.stringify(gh.calls.map((c) => c.path))}`);
  // The read reads the same commits.
  const rd = await run([], fakeGitHub({ rulesets: [] }));
  if (!/its guard reads: dazzer-io\/dazzer-app's newest pull request merged into main, #30, head b{40} carries codeql \/ CodeQL complete passed from integration 15368/.test(rd.all)) misses.push(`Could not find the read saying what the guard read: ${rd.all}`);
  // The default branch is read whatever it is named, and a pull request merged into another branch,
  // later, is not its.
  const trunk = { dazzer: passingRepo('a', 'd'), 'dazzer-app': passingRepo('c', 'e', 'trunk') };
  trunk['dazzer-app'].pulls.push(pull(40, sha('c3'), '2026-11-08T11:30:00Z', '2026-11-08T11:30:02Z', 'made-up-release'));
  trunk['dazzer-app'].runs[sha('c3')] = [checkRun(sha('c3'), { conclusion: 'failure' })];
  const t = fakeGitHub({ rulesets: [], repos: trunk });
  const tr = await run(['--apply'], t);
  if (tr.code !== 0 || !/dazzer-io\/dazzer-app's newest pull request merged into trunk, #30, head c{40} carries codeql \/ CodeQL complete passed/.test(tr.all) || !t.calls.some((c) => c.path.startsWith('/repos/dazzer-io/dazzer-app/pulls?') && /[?&]base=trunk(&|$)/.test(c.path))) misses.push(`Could not find the guard reading the newest pull request merged into dazzer-app's default branch trunk, and no other branch's: ${tr.code} ${tr.all}`);
  // The newest merged pull request is found on a later page, past a full page of pull requests
  // closed unmerged and updated since.
  const many = passingRepos();
  for (let i = 0; i < 100; i++) many['dazzer-app'].pulls.push(pull(100 + i, sha(`f${i % 10}`), null, `2026-11-08T13:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}Z`));
  const mg = fakeGitHub({ rulesets: [], repos: many });
  const mr = await run(['--apply'], mg);
  if (mr.code !== 0 || !/dazzer-io\/dazzer-app's newest pull request merged into main, #30, head b{40} carries/.test(mr.all)) misses.push(`Could not find the guard reading past a full first page of closed pull requests to the newest merged one: ${mr.code} ${mr.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('the guard holds codeql-complete-required back alone, saying why and what would pass it: no run, a failed, unfinished or other-app run, a newer run failed, a run on another commit', async () => {
  needKept();
  const misses = [];
  const heldFor = async (label, change, says, repo = 'dazzer-app') => {
    const repos = passingRepos();
    change(repos[repo], repo === 'dazzer-app' ? APP_HEAD : sha('a'));
    const gh = fakeGitHub({ rulesets: [], repos });
    const r = await run(['--apply'], gh);
    const names = writes(gh).map((c) => c.body?.name);
    if (r.code !== 1 || JSON.stringify(names) !== JSON.stringify([MR, SPELLING]) || !says.test(r.all) || !/REFUSED: codeql-complete-required was not written/.test(r.all) || !/it passes once/.test(r.all)) misses.push(`Could not find --apply holding codeql-complete-required back alone when ${label}, writing the other two, exit 1, saying ${says} and what would pass it: ${r.code} ${r.all} ${JSON.stringify(names)}`);
  };
  const at = "dazzer-io/dazzer-app's newest pull request merged into main, #30, head b{40}";
  await heldFor('the head carries no such check', (h, s) => { h.runs[s] = [checkRun(s, { name: 'codeql / Analyze (actions)' })]; }, new RegExp(`${at} carries no check run named codeql / CodeQL complete`));
  await heldFor('the check failed', (h, s) => { h.runs[s] = [checkRun(s, { conclusion: 'failure' })]; }, new RegExp(`${at}: its latest codeql / CodeQL complete from integration 15368 concluded failure, not success`));
  await heldFor('the check was skipped', (h, s) => { h.runs[s] = [checkRun(s, { conclusion: 'skipped' })]; }, /concluded skipped, not success/);
  await heldFor('the check is still running', (h, s) => { h.runs[s] = [checkRun(s, { status: 'in_progress', conclusion: null })]; }, /is in_progress, not completed/);
  await heldFor('the check passed from another app alone', (h, s) => { h.runs[s] = [checkRun(s, { app: { id: 57789, slug: 'made-up-app' } })]; }, /carries codeql \/ CodeQL complete only from integration 57789 \(made-up-app\), not from GitHub Actions \(integration 15368\)/);
  // The newer run is listed last, so a guard taking the first run listed passes it.
  await heldFor('a newer run failed after one passed', (h, s) => { h.runs[s] = [checkRun(s, { id: 5000 }), checkRun(s, { id: 6000, conclusion: 'failure' })]; }, /concluded failure, not success/);
  // GitHub answers a run on another commit under this one: it counts for nothing.
  await heldFor('the one passing run is on another commit', (h, s) => { h.runs[s] = [checkRun(sha('c'))]; }, new RegExp(`${at} carries no check run named codeql / CodeQL complete`));
  // The fake's check_name folds case, as GitHub's page does not say it does not; the name is held exactly.
  await heldFor('the one passing run is named in other letters', (h, s) => { h.runs[s] = [checkRun(s, { name: 'CodeQL / CodeQL Complete' })]; }, new RegExp(`${at} carries no check run named codeql / CodeQL complete`));
  await heldFor('another app passes beside a failure from GitHub Actions', (h, s) => { h.runs[s] = [checkRun(s, { conclusion: 'failure' }), checkRun(s, { id: 7000, app: { id: 57789, slug: 'made-up-app' } })]; }, /concluded failure, not success/);
  await heldFor('no pull request has been merged into main', (h) => { h.pulls = h.pulls.filter((x) => !x.merged_at); }, /dazzer-io\/dazzer-app has no pull request merged into main/);
  await heldFor('dazzer\'s check failed', (h, s) => { h.runs[s] = [checkRun(s, { conclusion: 'failure' })]; }, /dazzer-io\/dazzer's newest pull request merged into main, #30, head a{40}: its latest .* concluded failure/, 'dazzer');
  // A newer run that passed after one failed passes: the check was run again.
  const again = passingRepos();
  again['dazzer-app'].runs[APP_HEAD] = [checkRun(APP_HEAD, { id: 5000, conclusion: 'failure' }), checkRun(APP_HEAD, { id: 6000 })];
  const ag = fakeGitHub({ rulesets: [], repos: again });
  const a = await run(['--apply'], ag);
  if (a.code !== 0 || !writes(ag).some((c) => c.body?.name === CODEQL)) misses.push(`Could not find a newer run passing after one failed letting codeql-complete-required be written: ${a.code} ${a.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('the guard runs only when codeql-complete-required would be created or changed, in the read and --apply alike, and the read says exactly what --apply then does', async () => {
  needKept();
  const misses = [];
  const strict = () => { const c = clone(codeqlFile()); c.rules[0].parameters.strict_required_status_checks_policy = true; return c; };
  const scenarios = [
    ['every ruleset absent, the guard passing', () => [], passingRepos, { write: [[MR, 'create'], [SPELLING, 'create'], [CODEQL, 'create']], held: null }],
    ['every ruleset absent, the guard refusing', () => [], failingApp, { write: [[MR, 'create'], [SPELLING, 'create']], held: CODEQL }],
    ['codeql-complete-required differing, the guard refusing', () => [{ ...fileRuleset(), id: 7 }, { ...spellingFile(), id: 10, enforcement: 'evaluate' }, { ...strict(), id: 11 }], failingApp, { write: [[MR, 'unchanged'], [SPELLING, 'update']], held: CODEQL }],
    // The next change to machine-rule-required, codeql-complete-required live as its file and the
    // newest merged head failing: the guard is not read, and every ruleset is written.
    ['codeql-complete-required its file\'s version, the guard refusing', () => [{ ...fileRuleset(), id: 7, enforcement: 'active' }, ...allThree().slice(1)], failingApp, { write: [[MR, 'update'], [SPELLING, 'unchanged'], [CODEQL, 'unchanged']], held: null }],
  ];
  for (const [label, rulesets, repos, want] of scenarios) {
    const readGh = fakeGitHub({ rulesets: rulesets(), repos: repos() });
    const d = await run([], readGh);
    const said = planOf(d.all);
    if (JSON.stringify(said) !== JSON.stringify(want)) misses.push(`Could not find the read saying what --apply would do when ${label}: ${JSON.stringify(said)} for ${JSON.stringify(want)}\n${d.all}`);
    if (d.code !== 1 || writes(readGh).length) misses.push(`Could not find the read exiting 1, writing nothing, when ${label}: ${d.code} ${JSON.stringify(writes(readGh))}`);
    const applyGh = fakeGitHub({ rulesets: rulesets(), repos: repos() });
    const a = await run(['--apply'], applyGh);
    const did = writes(applyGh).map((c) => [c.body?.name, c.method]);
    const expected = want.write.map(([n, act]) => [n, act === 'create' ? 'POST' : 'PUT']);
    if (JSON.stringify(did) !== JSON.stringify(expected)) misses.push(`Could not find --apply doing what the read said when ${label}: ${JSON.stringify(did)} for ${JSON.stringify(expected)}\n${a.all}`);
    if (a.code !== (want.held ? 1 : 0)) misses.push(`Could not find --apply exiting ${want.held ? 1 : 0} when ${label}: ${a.code} ${a.all}`);
    const reads = want.held !== null || want.write.some(([n, act]) => n === CODEQL && act !== 'unchanged');
    for (const [mode, gh] of [['the read', readGh], ['--apply', applyGh]]) {
      const guarded = gh.calls.some((c) => /^\/repos\/dazzer-io\/[^/]+\/pulls\?/.test(c.path));
      if (guarded !== reads) misses.push(`Could not find ${mode} ${reads ? 'reading' : 'leaving unread'} the guard when ${label}: ${JSON.stringify(gh.calls.map((c) => c.path))}`);
    }
    if (want.held) {
      if (!/its guard refuses: dazzer-io\/dazzer-app's newest pull request merged into main, #30, head b{40}: its latest codeql \/ CodeQL complete from integration 15368 concluded failure, not success/.test(d.all) || !/it passes once/.test(d.all)) misses.push(`Could not find the read saying why the guard refuses and what would pass it when ${label}: ${d.all}`);
      for (const n of [MR, SPELLING]) if (!new RegExp(`${n} \\(\\d+\\) on dazzer-io now is the file's version`).test(a.all)) misses.push(`Could not find --apply writing and reading back ${n} though the guard refused when ${label}: ${a.all}`);
    }
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('where the default branch\'s rules hold a merge queue, the guard also reads the newest merge-group commit', async () => {
  needKept();
  const misses = [];
  const G1 = sha('c1');
  const G2 = sha('c2');
  const queue = { type: 'merge_queue', parameters: { check_response_timeout_minutes: 60, grouping_strategy: 'ALLGREEN', max_entries_to_build: 5, max_entries_to_merge: 5, merge_method: 'SQUASH', min_entries_to_merge: 1, min_entries_to_merge_wait_minutes: 5 } };
  // dazzer-app queued: an older merge group whose check failed, a later push whose check failed, and
  // the newest merge group, listed last.
  const queued = (newest) => {
    const repos = passingRepos();
    const h = repos['dazzer-app'];
    h.rules.push(queue);
    h.groups = [groupRun(800, G1, '2026-11-08T10:00:00Z'), groupRun(805, sha('c4'), '2026-11-08T12:30:00Z', 'push'), ...(newest ? [groupRun(801, G2, '2026-11-08T11:30:00Z')] : [])];
    h.runs[G1] = [checkRun(G1, { conclusion: 'failure' })];
    h.runs[sha('c4')] = [checkRun(sha('c4'), { conclusion: 'failure' })];
    return repos;
  };
  const passing = queued(true);
  passing['dazzer-app'].runs[G2] = [checkRun(G2)];
  const p = fakeGitHub({ rulesets: [], repos: passing });
  const pr = await run(['--apply'], p);
  if (pr.code !== 0 || !writes(p).some((c) => c.body?.name === CODEQL) || !/dazzer-io\/dazzer-app's newest merge-group commit (c2){20} carries codeql \/ CodeQL complete passed from integration 15368/.test(pr.all) || !/dazzer-io\/dazzer-app's newest pull request merged into main, #30, head b{40} carries/.test(pr.all)) misses.push(`Could not find the guard reading dazzer-app's newest merge-group commit beside its newest merged pull request, and passing when both carry the check: ${pr.code} ${pr.all}`);
  const missing = fakeGitHub({ rulesets: [], repos: queued(true) });
  const mr = await run(['--apply'], missing);
  if (mr.code !== 1 || writes(missing).some((c) => c.body?.name === CODEQL) || !/dazzer-io\/dazzer-app's newest merge-group commit (c2){20} carries no check run named codeql \/ CodeQL complete/.test(mr.all) || !/it passes once[^\n]*merge_group/.test(mr.all)) misses.push(`Could not find the guard holding codeql-complete-required back when the newest merge-group commit carries no such check, though the pull request's head does, saying merge_group would pass it: ${mr.code} ${mr.all}`);
  const none = fakeGitHub({ rulesets: [], repos: (() => { const repos = queued(false); repos['dazzer-app'].groups = []; return repos; })() });
  const nr = await run(['--apply'], none);
  if (nr.code !== 1 || writes(none).some((c) => c.body?.name === CODEQL) || !/dazzer-io\/dazzer-app's main holds a merge queue, and no workflow run started by merge_group names a merge-group commit/.test(nr.all)) misses.push(`Could not find the guard holding codeql-complete-required back when a queue is held and no merge group has run: ${nr.code} ${nr.all}`);
  // Without a queue no workflow runs are read; the rules on each default branch are.
  const plain = fakeGitHub({ rulesets: [] });
  await run(['--apply'], plain);
  if (plain.calls.some((c) => /\/actions\/runs/.test(c.path))) misses.push(`Could not find the guard leaving workflow runs unread where no merge queue is held: ${JSON.stringify(plain.calls.map((c) => c.path))}`);
  for (const repo of ['dazzer', 'dazzer-app']) if (!plain.calls.some((c) => c.path.startsWith(`/repos/dazzer-io/${repo}/rules/branches/main`))) misses.push(`Could not find the guard reading the rules on ${repo}'s main: ${JSON.stringify(plain.calls.map((c) => c.path))}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('the read and --apply refuse while a branch spelled main in other letters exists in dazzer or dazzer-app, naming it, and write nothing', async () => {
  needKept();
  const misses = [];
  const cases = [
    ['MAIN in dazzer', (repos) => { repos.dazzer.branches.push('MAIN'); }, /dazzer-io\/dazzer holds the branch MAIN/],
    ['Main in dazzer-app', (repos) => { repos['dazzer-app'].branches.push('Main'); }, /dazzer-io\/dazzer-app holds the branch Main/],
    ['maiN past dazzer\'s first page of branches', (repos) => { for (let i = 0; i < 120; i++) repos.dazzer.branches.push(`made-up-${i}`); repos.dazzer.branches.push('maiN'); }, /dazzer-io\/dazzer holds the branch maiN/],
  ];
  for (const [label, change, says] of cases) {
    for (const argv of [[], ['--apply']]) {
      const repos = passingRepos();
      change(repos);
      const gh = fakeGitHub({ rulesets: [], repos });
      const r = await run(argv, gh);
      const mode = argv.length ? '--apply' : 'the read';
      const nothing = argv.length ? /so nothing was written/ : /so --apply would write nothing/;
      if (r.code !== 2 || writes(gh).length || !says.test(r.all) || !/^REFUSED: /m.test(r.all) || !nothing.test(r.all)) misses.push(`Could not find ${mode} refusing, writing nothing, while ${label} exists, naming it: ${r.code} ${r.all} ${JSON.stringify(writes(gh))}`);
    }
  }
  // A name that only holds main, or spells it with a letter outside ASCII, is no spelling of main.
  const others = passingRepos();
  others.dazzer.branches.push('mainline', 'MAIN-made-up', 'ma\u0131n', 'remain');
  const o = fakeGitHub({ rulesets: [], repos: others });
  const or = await run(['--apply'], o);
  if (or.code !== 0) misses.push(`Could not find branches that only hold main left unrefused: ${or.code} ${or.all}`);
  for (const repo of ['dazzer', 'dazzer-app']) if (!o.calls.some((c) => c.path.startsWith(`/repos/dazzer-io/${repo}/branches?`))) misses.push(`Could not find ${repo}'s branches listed: ${JSON.stringify(o.calls.map((c) => c.path))}`);
  // A repository whose branches cannot be listed is unread, and nothing is written.
  const gone = passingRepos();
  gone['dazzer-app'] = { status: 404 };
  const g = fakeGitHub({ rulesets: [], repos: gone });
  const gr = await run(['--apply'], g);
  if (gr.code !== 2 || writes(g).length || !/UNREAD: could not list dazzer-io\/dazzer-app's branches: GitHub answered 404/.test(gr.all)) misses.push(`Could not find --apply unread, writing nothing, when dazzer-app's branches cannot be listed: ${gr.code} ${gr.all}`);
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

test('--apply says which rulesets it wrote before GitHub refused a later write, and a guard GitHub does not answer holds codeql-complete-required back alone', async () => {
  needKept();
  const misses = [];
  const gh = fakeGitHub({ rulesets: [], rejects: SPELLING });
  const r = await run(['--apply'], gh);
  if (r.code !== 2 || !/REFUSED: GitHub answered 422 to the creation of main-spelling-refused/.test(r.all) || !/written before it: machine-rule-required$/m.test(r.all) || writes(gh).length !== 2) misses.push(`Could not find --apply saying machine-rule-required was written before GitHub refused main-spelling-refused, and writing nothing after: ${r.code} ${r.all} ${JSON.stringify(writes(gh).map((c) => c.body?.name))}`);
  const unread = passingRepos();
  unread['dazzer-app'].pullsStatus = 503;
  const u = fakeGitHub({ rulesets: [], repos: unread });
  const ur = await run(['--apply'], u);
  const names = writes(u).map((c) => c.body?.name);
  if (ur.code !== 2 || JSON.stringify(names) !== JSON.stringify([MR, SPELLING]) || !/UNREAD: could not list dazzer-io\/dazzer-app's closed pull requests into main: GitHub answered 503/.test(ur.all) || !/codeql-complete-required was not written/.test(ur.all)) misses.push(`Could not find an unanswered guard holding codeql-complete-required back alone, unread, exit 2: ${ur.code} ${ur.all} ${JSON.stringify(names)}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('without --apply, each of the three is said as its file\'s version, differing field by field, or absent, with the codeql guard\'s reading, and nothing is written', async () => {
  needKept();
  const misses = [];
  const gh = fakeGitHub({ rulesets: [{ ...fileRuleset(), id: 7 }] });
  const r = await run([], gh);
  if (r.code !== 1) misses.push(`Could not find exit 1 while two rulesets are absent: ${r.code} ${r.all}`);
  if (!/machine-rule-required \(7\) on dazzer-io is the file's version/.test(r.all)) misses.push(`Could not find machine-rule-required said as its file's version: ${r.all}`);
  for (const [name, file] of [[SPELLING, 'main-spelling.json'], [CODEQL, 'codeql-complete.json']]) if (!new RegExp(`${name} is not on dazzer-io: --apply would create it from \\S*machine-rule/${file.replace('.', '\\.')}`).test(r.all)) misses.push(`Could not find ${name} said as absent, created from ${file}: ${r.all}`);
  if (!/its guard reads: dazzer-io\/dazzer's newest pull request merged into main, #30, head a{40} carries codeql \/ CodeQL complete passed from integration 15368/.test(r.all)) misses.push(`Could not find the guard's reading said beside the absent codeql-complete-required: ${r.all}`);
  if (writes(gh).length) misses.push(`Could not find the diff writing nothing: ${JSON.stringify(writes(gh))}`);
  const f = fakeGitHub({ rulesets: [{ ...fileRuleset(), id: 7 }], repos: failingApp() });
  const fr = await run([], f);
  if (fr.code !== 1 || !/codeql-complete-required is not on dazzer-io: --apply would not create it, its guard refusing/.test(fr.all) || !/its guard refuses: dazzer-io\/dazzer-app's newest pull request merged into main, #30, head b{40}: its latest codeql \/ CodeQL complete from integration 15368 concluded failure, not success/.test(fr.all) || !/main-spelling-refused is not on dazzer-io: --apply would create it/.test(fr.all)) misses.push(`Could not find the diff saying the guard holds codeql-complete-required back alone today: ${fr.code} ${fr.all}`);
  const drifted = clone(spellingFile());
  drifted.conditions.ref_name.exclude = ['refs/heads/MAIN'];
  const d = fakeGitHub({ rulesets: [{ ...fileRuleset(), id: 7 }, { ...drifted, id: 10 }, { ...codeqlFile(), id: 11 }] });
  const dr = await run([], d);
  if (dr.code !== 1 || !dr.all.includes('main-spelling-refused (10) on dazzer-io differs from') || !dr.all.includes('conditions.ref_name.exclude[0]: live "refs/heads/MAIN", file (none)')) misses.push(`Could not find a live exclude on main-spelling-refused named field by field, exit 1: ${dr.code} ${dr.all}`);
  if (/its guard/.test(dr.all)) misses.push(`Could not find the guard left unread while codeql-complete-required is its file's version: ${dr.all}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('a file that fails its check is never written, nor any other: every file is checked before GitHub is called', async () => {
  needKept();
  const misses = [];
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  for (const [name, file, change, says] of [
    [SPELLING, 'main-spelling.json', (r) => { r.conditions.ref_name.exclude = ['refs/heads/MAIN']; }, /is not the ruleset main-spelling-refused: .*excludes/],
    [CODEQL, 'codeql-complete.json', (r) => { r.rules[0].parameters.required_status_checks[0].integration_id = 57789; }, /is not the ruleset codeql-complete-required: .*integration 57789/],
  ]) {
    const bad = clone(name === SPELLING ? spellingFile() : codeqlFile());
    change(bad);
    const dir = mkdtempSync(join(tmpdir(), 'machine-rule-ruleset-'));
    writeFileSync(join(dir, file), JSON.stringify(bad));
    const gh = fakeGitHub({ rulesets: [] });
    const err = [];
    const code = await A.main(['--apply'], { request: gh.request, out: () => {}, err: (l) => err.push(l), files: { [name]: join(dir, file) } });
    if (code !== 2 || gh.calls.length || !says.test(err.join('\n'))) misses.push(`Could not find a bad ${file} refused before any call, nothing written: ${code} ${err.join('\n')} ${JSON.stringify(gh.calls)}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('machine-rule/README.md says what each ruleset holds, that --apply is Ben\'s command, where main-spelling-refused holds the locked shape to main, what the guard reads and gates, and the lint step\'s two ignores', () => {
  const md = readFileSync(join(ROOT, 'machine-rule/README.md'), 'utf8');
  const plain = md.replace(/\s+/g, ' ');
  const misses = [];
  for (const words of ['`main-spelling-refused`', '`main-spelling.json`', '`codeql-complete-required`', '`codeql-complete.json`', 'node machine-rule/apply-ruleset.mjs --apply', "Ben's own command", 'refs/heads/M[Aa][Ii][Nn]', 'refs/heads/mA[Ii][Nn]', 'refs/heads/maI[Nn]', 'refs/heads/maiN', 'integration 15368', 'do_not_enforce_on_create', 'without regard to case', "github.ref == 'refs/heads/main'", 'a branch named `MAIN`', 'held to main only in dazzer and dazzer-app, once `main-spelling-refused` is live and no other spelling of main exists there', 'keeps every `LOCKED_` setting empty until then', 'Holding it to main in any other repository is other work', 'the head of the newest pull request merged into', 'the newest merge-group commit', "never the branch's own head", 'still writes `machine-rule-required` and `main-spelling-refused`', 'a branch spelled main in other letters already exists', 'Its two ignores are narrow']) if (!plain.includes(words)) misses.push(`Could not find machine-rule/README.md saying ${JSON.stringify(words)}`);
  // Every sentence saying main-spelling-refused is live bounds the claim to the two repositories and
  // to no other spelling there (decision 208).
  for (const s of plain.split(/(?<=\.) /)) if (s.includes('`main-spelling-refused` is live') && !(s.includes('dazzer and dazzer-app') && s.includes('no other spelling of main'))) misses.push(`Could not find this sentence of machine-rule/README.md bounded to dazzer and dazzer-app, with no other spelling of main there: ${s}`);
  if (/Its one ignore/.test(plain)) misses.push('Could not find machine-rule/README.md rid of "Its one ignore": the lint step holds two (decision 201)');
  if (/default-branch head carries/.test(plain)) misses.push('Could not find machine-rule/README.md rid of the guard reading the default branch\'s own head (decision 208)');
  if (/one refusal and nothing is written/.test(plain)) misses.push('Could not find machine-rule/README.md rid of one guard refusal writing nothing (decision 208)');
  assert.ok(!misses.length, misses.join('\n'));
});

test('the repository\'s README.md says apply-ruleset.mjs writes three organisation rulesets, naming each', () => {
  const plain = readFileSync(join(ROOT, 'README.md'), 'utf8').replace(/\s+/g, ' ');
  const misses = [];
  for (const words of ['writes three organisation rulesets', '`machine-rule-required`', '`main-spelling-refused`', '`codeql-complete-required`', '`machine-rule/main-spelling.json`', '`machine-rule/codeql-complete.json`']) if (!plain.includes(words)) misses.push(`Could not find README.md saying ${JSON.stringify(words)}`);
  if (plain.includes('reads the ruleset and is the one command that writes it')) misses.push('Could not find README.md rid of apply-ruleset.mjs writing one ruleset');
  assert.ok(!misses.length, misses.join('\n'));
});
