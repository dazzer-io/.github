// Proves machine-rule/ruleset.json and machine-rule/apply-ruleset.mjs (decisions 121, 177): the
// organisation ruleset machine-rule-required runs .github/workflows/machine-rule.yml, read from
// dazzer-io/.github by its repository id at refs/heads/main, on the default branch of every
// repository. The ruleset file is checked by checkRuleset, each way a ruleset could run another
// workflow, from another repository or ref, or in fewer repositories red alone; the command's
// diff, write and readings modes are run against a fake GitHub, so nothing here reaches the
// network and no ruleset is written anywhere. Every failure starts "Could not find".
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
const fileRuleset = () => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'machine-rule/ruleset.json'), 'utf8'));
  } catch (e) {
    assert.fail(`Could not find machine-rule/ruleset.json read as JSON: ${e.message}`);
  }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const ID = 1433582766;

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

// A fake GitHub holding the organisation's rulesets and dazzer-io/.github's id; every call kept.
function fakeGitHub({ rulesets = [], sharedId = ID, write = null } = {}) {
  const calls = [];
  const held = rulesets.map((r) => clone(r));
  let next = 900;
  const request = async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    let m;
    if (method === 'GET' && path === '/orgs/dazzer-io/rulesets?per_page=100') return { status: 200, text: JSON.stringify(held.map((r) => ({ id: r.id, name: r.name }))) };
    if (method === 'GET' && (m = /^\/orgs\/dazzer-io\/rulesets\/(\d+)$/.exec(path))) {
      const r = held.find((x) => String(x.id) === m[1]);
      return r ? { status: 200, text: JSON.stringify(r) } : { status: 404, text: '{}' };
    }
    if (method === 'GET' && path === '/repos/dazzer-io/.github') return { status: 200, text: JSON.stringify({ id: sharedId, name: '.github' }) };
    if (method === 'PUT' && (m = /^\/orgs\/dazzer-io\/rulesets\/(\d+)$/.exec(path))) {
      const at = held.findIndex((x) => String(x.id) === m[1]);
      if (at === -1) return { status: 404, text: '{}' };
      held[at] = { ...clone(write ?? body), id: held[at].id };
      return { status: 200, text: JSON.stringify(held[at]) };
    }
    if (method === 'POST' && path === '/orgs/dazzer-io/rulesets') {
      const r = { ...clone(write ?? body), id: next++ };
      held.push(r);
      return { status: 201, text: JSON.stringify(r) };
    }
    return { status: 404, text: '{}' };
  };
  return { request, calls, held };
}
async function run(argv, gh) {
  const out = [];
  const err = [];
  const code = await A.main(argv, { request: gh.request, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, all: [...out, ...err].join('\n') };
}
const writes = (gh) => gh.calls.filter((c) => c.method !== 'GET');

test('the diff: exit 0 when the live ruleset is the file\'s, 1 naming each field when it differs or is absent, and it writes nothing', async () => {
  need();
  const file = fileRuleset();
  const misses = [];
  const same = fakeGitHub({ rulesets: [{ ...file, id: 7 }, { id: 8, name: 'made-up-other', rules: [] }] });
  const s = await run([], same);
  if (s.code !== 0 || !/is the file's version, enforcement evaluate/.test(s.all)) misses.push(`Could not find the matching ruleset read as the file's version, exit 0: ${s.code} ${s.all}`);
  const drifted = clone(file);
  drifted.rules[0].parameters.workflows[0].ref = 'refs/heads/made-up-branch';
  const d = fakeGitHub({ rulesets: [{ ...drifted, id: 7 }] });
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

test('--apply writes the file\'s version to the ruleset of that name alone: a PUT to its own id, a POST when absent, refused when the repository id differs', async () => {
  need();
  const file = fileRuleset();
  const other = { id: 8, name: 'made-up-other', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] };
  const misses = [];
  const there = fakeGitHub({ rulesets: [other, { ...file, id: 7, enforcement: 'active', rules: [] }] });
  const put = await run(['--apply'], there);
  const w = writes(there);
  if (put.code !== 0 || w.length !== 1 || w[0].method !== 'PUT' || w[0].path !== '/orgs/dazzer-io/rulesets/7' || JSON.stringify(w[0].body) !== JSON.stringify(file)) misses.push(`Could not find --apply writing the file as one PUT to ruleset 7 alone: ${put.code} ${put.all} ${JSON.stringify(w)}`);
  if (JSON.stringify(there.held.find((r) => r.id === 8)) !== JSON.stringify(other)) misses.push('Could not find the other ruleset left as it was');
  const none = fakeGitHub({ rulesets: [other] });
  const post = await run(['--apply'], none);
  const p = writes(none);
  if (post.code !== 0 || p.length !== 1 || p[0].method !== 'POST' || p[0].path !== '/orgs/dazzer-io/rulesets') misses.push(`Could not find --apply creating the ruleset with one POST when it is absent: ${post.code} ${post.all} ${JSON.stringify(p)}`);
  const moved = fakeGitHub({ rulesets: [{ ...file, id: 7 }], sharedId: 42 });
  const mv = await run(['--apply'], moved);
  if (mv.code !== 2 || writes(moved).length || !/repository id is 42 on GitHub, not 1433582766/.test(mv.all)) misses.push(`Could not find --apply refusing, writing nothing, when dazzer-io/.github's live id is not the file's: ${mv.code} ${mv.all}`);
  const ignored = fakeGitHub({ rulesets: [{ ...file, id: 7 }], write: { ...file, enforcement: 'disabled' } });
  const ig = await run(['--apply'], ignored);
  if (ig.code !== 2 || !/as read back still differs from the file/.test(ig.all)) misses.push(`Could not find --apply reading the ruleset back and refusing when it still differs: ${ig.code} ${ig.all}`);
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
