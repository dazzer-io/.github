// The leak check (leak-check/action.yml, leak-check/scan.mjs): it reads every tracked file and the
// tip of every branch, tag and pull request ref the remote serves, matches the names its one-way
// hash list holds, refuses a finding in the files that leak-check/known.json does not accept, and
// records its counts as one notice titled "Leak check". Every name here is invented, the hash list
// is a fixture, and the refs come from a repository built in a temporary folder: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const FIXTURES = path.join(here, 'fixtures', 'leak-check');
const HASHES = path.join(FIXTURES, 'hashes.json');
const NOTES = path.join(FIXTURES, 'repo', 'notes.md');
const SCAN = path.join(ROOT, 'leak-check', 'scan.mjs');
const NOT_REFUSED = 'a new leak finding was not refused';
// The invented private names the fixture list holds, which no output may repeat.
const PLAIN = ['lantern-vault', 'quill', 'Odalys', 'Fenwick', 'marlo@'];

const load = async (file) => {
  try { return await import(path.join(ROOT, 'leak-check', file)); } catch (e) { return { missing: e.message }; }
};
const hashes = await load('hashes.mjs');
const scan = await load('scan.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leak-check-'));
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const commitAll = (cwd, message) => { git(cwd, 'add', '-A'); git(cwd, 'commit', '-q', '-m', message); return git(cwd, 'rev-parse', 'HEAD'); };

// A git repository holding the fixture notes as its one tracked file.
const notesRepo = () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  fs.copyFileSync(NOTES, path.join(dir, 'notes.md'));
  commitAll(dir, 'notes');
  return dir;
};
const run = (args) => {
  const r = spawnSync(process.execPath, [SCAN, ...args], { encoding: 'utf8', env: GIT_ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const writeKnown = (dir, known) => { const f = path.join(dir, 'known.json'); fs.writeFileSync(f, JSON.stringify(known)); return f; };
const noticeOf = (out) => (out.match(/^::notice title=Leak check::(.*)$/m) ?? [])[1] ?? null;
const HEAD = /^files: (\d+) read, (\d+) new findings, (\d+) known; refs: not read\b/;
const NOTICE = /^files: (\d+) read, (\d+) new findings, (\d+) known; refs: (\d+) read, (\d+) findings on branches and tags, (\d+) on pull request refs/;
const assertNoPlain = (out) => {
  for (const p of PLAIN) assert.ok(!out.includes(p), `the run's output repeats the private name it found, which would publish it (${p}): ${out}`);
};

// What the fixture notes hold, by line: dazzer-io/quill (5), lantern-vault (6), Odalys Fenwick (7),
// marlo@brightfen.example (8). The bare quill (5), the role address (8) and the public repository (9) are not findings.
const EXPECTED = [
  { line: 5, kind: 'repositories' },
  { line: 6, kind: 'repositories' },
  { line: 7, kind: 'people' },
  { line: 8, kind: 'addresses' },
];
const ROLES = ['help@brightfen.example'];

test('the matcher finds each kind of private name by line, and passes an ordinary word, a role address and a public repository', () => {
  assert.equal(typeof scan.matcher, 'function', `${NOT_REFUSED}: leak-check/scan.mjs has no matcher (${scan.missing ?? 'not exported'})`);
  assert.equal(typeof hashes.loadList, 'function', `${NOT_REFUSED}: leak-check/hashes.mjs has no loadList (${hashes.missing ?? 'not exported'})`);
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  const found = match(fs.readFileSync(NOTES, 'utf8'), 'notes.md');
  assert.deepEqual(found.map((f) => ({ line: f.line, kind: f.kind })), EXPECTED, `${NOT_REFUSED}: the matcher found ${JSON.stringify(found)}`);
  for (const f of found) {
    assert.equal(f.path, 'notes.md', `a finding does not name its file: ${JSON.stringify(f)}`);
    assert.match(f.hash, /^[0-9a-f]{64}$/, `a finding does not carry the one-way hash it matched: ${JSON.stringify(f)}`);
  }
  assertNoPlain(JSON.stringify(found));
});

test('a name split over two lines, in capitals or as a possessive is still the person', () => {
  assert.equal(typeof scan.matcher, 'function', `${NOT_REFUSED}: leak-check/scan.mjs has no matcher (${scan.missing ?? 'not exported'})`);
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  const found = match('Thanks to ODALYS\nFENWICK, and to Odalys Fenwick\'s notes.\n', 'thanks.md');
  assert.deepEqual(found.map((f) => [f.line, f.kind]), [[1, 'people'], [2, 'people']],`${NOT_REFUSED}: the matcher found ${JSON.stringify(found)}`);
});

test('a hash list with a salt is matched with that salt, and a list without one still loads as before', () => {
  assert.equal(typeof hashes.loadList, 'function', `leak-check/hashes.mjs has no loadList (${hashes.missing ?? 'not exported'})`);
  const list = hashes.loadList(HASHES);
  assert.equal(list.salt, 'fixture-only-salt', `the list's salt was read as ${list.salt}`);
  assert.ok(list.repositories.has(hashes.oneWay('Lantern-Vault ', list.salt)), 'a salted name was not found in its list');
  assert.ok(!list.repositories.has(hashes.oneWay('lantern-vault')), 'an unsalted hash matched a salted list');
  assert.equal(hashes.loadHashes(HASHES).size, 4, 'loadHashes does not hold every hash of the salted list');
  const dir = tmp();
  const bad = path.join(dir, 'salt.json');
  fs.writeFileSync(bad, JSON.stringify({ salt: 7, repositories: ['a'.repeat(64)] }));
  assert.throws(() => hashes.loadList(bad), /^Error: no one-way hash list\b.*salt/, 'a salt that is not a string was read');
});

test('the scan refuses a new finding in the tracked files, naming file, line and kind, never the name', () => {
  const dir = notesRepo();
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] });
  const r = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir]);
  assert.notEqual(r.status, 0, `${NOT_REFUSED}: the scan passed four findings in notes.md: ${r.out}`);
  for (const { line, kind } of EXPECTED) {
    const said = new RegExp(`^::error file=notes\\.md,line=${line},title=Leak finding::.*${kind === 'repositories' ? 'repository' : kind === 'people' ? 'person' : 'address'}`, 'm');
    assert.match(r.out, said, `${NOT_REFUSED}: no error names notes.md line ${line} (${kind}): ${r.out}`);
  }
  const notice = noticeOf(r.out);
  assert.match(notice ?? '', HEAD, `the run records no "Leak check" notice in its counted form: ${r.out}`);
  const [, files, fresh, knownCount] = notice.match(HEAD);
  assert.deepEqual([files, fresh, knownCount], ['1', '4', '0'], `${NOT_REFUSED}: the notice reads ${notice}`);
  assertNoPlain(r.out);
});

test('a finding known.json accepts is counted known and passes; the same name in another file is still new', () => {
  const dir = notesRepo();
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  const findings = match(fs.readFileSync(NOTES, 'utf8'), 'notes.md').map(({ path: p, kind, hash }) => ({ repository: 'dazzer-io/example', path: p, kind, hash }));
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings });
  const clean = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir]);
  assert.equal(clean.status, 0, `four accepted findings were refused: ${clean.out}`);
  assert.match(noticeOf(clean.out) ?? '', /^files: 1 read, 0 new findings, 4 known;/, `the notice does not count four known findings: ${clean.out}`);
  // Another repository's acceptance does not carry over.
  const other = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/elsewhere', '--root', dir]);
  assert.notEqual(other.status, 0, `${NOT_REFUSED}: findings accepted for one repository passed in another: ${other.out}`);
  fs.writeFileSync(path.join(dir, 'more.md'), 'A second mention of lantern-vault.\n');
  commitAll(dir, 'more');
  const more = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir]);
  assert.notEqual(more.status, 0, `${NOT_REFUSED}: a known name added to a new file passed: ${more.out}`);
  assert.match(more.out, /^::error file=more\.md,line=1,title=Leak finding::/m, `${NOT_REFUSED}: no error names more.md: ${more.out}`);
  assert.match(noticeOf(more.out) ?? '', /^files: 2 read, 1 new findings, 4 known;/, `the notice reads ${noticeOf(more.out)}`);
  assertNoPlain(more.out);
});

test('an untracked file is not read; a tracked binary holding no name is read as bytes and passes', () => {
  const dir = notesRepo();
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] });
  fs.writeFileSync(path.join(dir, 'notes.md'), 'nothing private\n');
  // An image's first bytes: a NUL, a stray 0xff, no name anywhere.
  fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0x00]));
  commitAll(dir, 'clean');
  fs.writeFileSync(path.join(dir, 'scratch.md'), 'lantern-vault, not tracked\n');
  const r = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir]);
  assert.equal(r.status, 0, `a clean tracked tree holding an image was refused: ${r.out}`);
  assert.match(noticeOf(r.out) ?? '', /^files: 2 read, 0 new findings, 0 known; refs: not read, no remote was named$/, `the notice does not count the image as read: ${r.out}`);
  assert.match(r.out, /^read as bytes: logo\.png /m, `the run does not name the file it read as bytes: ${r.out}`);
});

// A repository holding one tracked file of these bytes, scanned with no accepted findings.
const scanBytes = (name, bytes) => {
  const dir = tmp();
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, name), bytes);
  commitAll(dir, name);
  return run(['--hashes', HASHES, '--known', writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] }), '--repository', 'dazzer-io/example', '--root', dir]);
};
const utf16le = (s) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const utf16be = (s) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, 'utf16le').swap16()]);

test('a private name in a file that is not UTF-8 is still refused: UTF-16 with a byte-order mark, a stray Windows-1252 byte, a NUL', () => {
  const cases = [
    ['minutes.txt', utf16le('Minutes\r\nDrafted by Odalys Fenwick.\r\n'), 2, 'person', 'UTF-16 (little-endian) with a byte-order mark'],
    ['minutes-be.txt', utf16be('Minutes\nThe mirror is dazzer-io/quill.\n'), 2, 'repository', 'UTF-16 (big-endian) with a byte-order mark'],
    ['letter.md', Buffer.concat([Buffer.from('A note\nIt\'s lantern-vault'), Buffer.from([0x92]), Buffer.from('s backup.\n')]), 2, 'repository', 'UTF-8 with one stray 0x92 byte'],
    ['dump.bin', Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from('\nwrite to marlo@brightfen.example\n'), Buffer.from([0x00])]), 2, 'address', 'a file holding a NUL byte'],
  ];
  for (const [name, bytes, line, said, what] of cases) {
    const r = scanBytes(name, bytes);
    assert.notEqual(r.status, 0, `${NOT_REFUSED}: a private name in ${what} passed the scan: ${r.out}`);
    const error = new RegExp(`^::error file=${name.replace(/\./g, '\\.')},line=${line},title=Leak finding::.*${said}`, 'm');
    assert.match(r.out, error, `${NOT_REFUSED}: no error names ${name} line ${line} (${what}): ${r.out}`);
    assertNoPlain(r.out);
  }
});

test('a file name or path holding a line break cannot forge a workflow command in the log', () => {
  const dir = notesRepo();
  const odd = 'odd\n::warning title=forged::known.md';
  fs.writeFileSync(path.join(dir, odd), 'A mention of lantern-vault.\n');
  commitAll(dir, 'odd');
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  const findings = [
    ...match(fs.readFileSync(NOTES, 'utf8'), 'notes.md'),
    ...match('A mention of lantern-vault.\n', odd),
  ].map(({ path: p, kind, hash }) => ({ path: p, kind, hash }));
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings });
  const r = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir, 'notes.md', odd, 'gone\n::error title=forged::gone.md']);
  assert.match(r.out, /^known: odd%0A::warning title=forged::known\.md:1 /m, `the known finding's path was not escaped: ${r.out}`);
  assert.match(r.out, /^could not read gone%0A::error title=forged::gone\.md: /m, `the unopened path was not escaped: ${r.out}`);
  assert.doesNotMatch(r.out, /^::(?:warning|error) title=forged/m, `a file name forged a workflow command in the log: ${r.out}`);
});

test('a known-findings list that is not readable stops the scan red, naming the entry by place', () => {
  const dir = notesRepo();
  const work = tmp();
  for (const [name, body] of [['gone.json', null], ['broken.json', '{'], ['plain.json', JSON.stringify({ findings: [{ path: 'notes.md', kind: 'people', hash: 'Odalys Fenwick' }] })]]) {
    const f = path.join(work, name);
    if (body !== null) fs.writeFileSync(f, body);
    const r = run(['--hashes', HASHES, '--known', f, '--repository', 'dazzer-io/example', '--root', dir]);
    assert.notEqual(r.status, 0, `the scan ran on the unreadable ${name}: ${r.out}`);
    assert.match(r.out, /no known-findings list/, `the scan stopped on ${name} without saying "no known-findings list": ${r.out}`);
    assertNoPlain(r.out);
  }
  const r = run(['--hashes', HASHES, '--known', path.join(work, 'plain.json'), '--root', dir]);
  assert.match(r.out, /findings\[0\]/, `the refusal does not name the entry by place: ${r.out}`);
});

test('the tip of every branch, tag and pull request ref the remote serves is read; their findings are counted apart and do not refuse the change', () => {
  const origin = tmp();
  git(origin, 'init', '-q');
  fs.writeFileSync(path.join(origin, 'README.md'), 'A public readme.\n');
  const main = commitAll(origin, 'readme');
  git(origin, 'tag', '-a', 'v1', '-m', 'first');
  git(origin, 'checkout', '-q', '-b', 'parked');
  fs.writeFileSync(path.join(origin, 'parked.md'), 'Parked work for lantern-vault.\n');
  commitAll(origin, 'parked');
  git(origin, 'checkout', '-q', '-b', 'pull-3', 'main');
  fs.writeFileSync(path.join(origin, 'draft.md'), 'Drafted by Odalys Fenwick for dazzer-io/quill.\n');
  const pull = commitAll(origin, 'draft');
  git(origin, 'update-ref', 'refs/pull/3/head', pull);
  git(origin, 'checkout', '-q', 'main');
  git(origin, 'branch', '-q', '-D', 'pull-3');
  assert.equal(git(origin, 'rev-parse', 'HEAD'), main);

  const work = tmp();
  git(work, 'clone', '-q', '--depth=1', `file://${origin}`, 'copy');
  const dir = path.join(work, 'copy');
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] });
  const r = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir, '--refs', 'origin']);
  assert.equal(r.status, 0, `findings on branches and pull request refs refused a change whose files are clean: ${r.out}`);
  const notice = noticeOf(r.out);
  assert.match(notice ?? '', NOTICE, `the run records no "Leak check" notice in its counted form: ${r.out}`);
  const [, files, fresh, , refs, onBranches, onPulls] = notice.match(NOTICE);
  assert.deepEqual({ files, fresh, refs, onBranches, onPulls }, { files: '1', fresh: '0', refs: '4', onBranches: '1', onPulls: '2' },
    `the notice does not read main, parked, v1 and the pull request ref, with one finding on a branch and two on the pull request ref: ${notice}`);
  assert.match(r.out, /refs\/heads\/parked: parked\.md:1 /, `the run does not say where the finding on the branch is: ${r.out}`);
  assert.match(r.out, /refs\/pull\/3\/head: draft\.md:1 /, `the run does not say where the findings on the pull request ref are: ${r.out}`);
  assertNoPlain(r.out);
});

test('a remote that serves nothing is read as unknown refs, never as none', () => {
  const dir = notesRepo();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'nothing private\n');
  commitAll(dir, 'clean');
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] });
  const r = run(['--hashes', HASHES, '--known', known, '--root', dir, '--refs', 'nowhere']);
  assert.match(r.out, /could not read the refs of the remote --refs names/, `a remote that could not be listed was not said: ${r.out}`);
  assert.match(noticeOf(r.out) ?? '', /refs: unknown/, `a remote that could not be listed was counted as read: ${r.out}`);
});

test('the shipped known.json is hashes and places only', () => {
  const file = path.join(ROOT, 'leak-check', 'known.json');
  assert.ok(fs.existsSync(file), 'leak-check/known.json is not there');
  const known = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(known.findings), 'known.json holds no findings list');
  for (const [i, f] of known.findings.entries()) assert.match(f.hash ?? '', /^[0-9a-f]{64}$/, `known.json findings[${i}] holds no one-way hash`);
  assert.ok(Array.isArray(known['role-addresses']) && known['role-addresses'].every((a) => /^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(a)), 'known.json holds no role-address list');
});

test('the action reads the files and refs, pins every outside action by its full commit and puts no input into its script', () => {
  const file = path.join(ROOT, 'leak-check', 'action.yml');
  assert.ok(fs.existsSync(file), `${NOT_REFUSED}: leak-check/action.yml is not there`);
  const action = parse(fs.readFileSync(file, 'utf8'));
  assert.equal(action.runs?.using, 'composite', 'the leak check is not a composite action');
  const steps = action.runs.steps ?? [];
  for (const s of steps) {
    if (typeof s.uses === 'string') assert.match(s.uses, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/, `the action uses ${s.uses} without pinning it by its full commit`);
    if (typeof s.run === 'string') assert.doesNotMatch(s.run, /\$\{\{/, `a step's script reads an expression directly, not through its environment: ${s.run}`);
  }
  const scanStep = steps.find((s) => typeof s.run === 'string' && /scan\.mjs/.test(s.run));
  assert.ok(scanStep, `${NOT_REFUSED}: no step runs leak-check/scan.mjs`);
  for (const flag of ['--hashes', '--known', '--repository', '--refs']) assert.ok(scanStep.run.includes(flag), `the scan step does not pass ${flag}`);
});

// ---------- names, ref names, hidden letters, hostnames ----------

test('a private name as a file or folder name is a finding, and the log hides that part of the path', () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'docs', 'lantern-vault'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'lantern-vault', 'readme.md'), 'nothing private\n');
  fs.mkdirSync(path.join(dir, 'dazzer-io', 'quill'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dazzer-io', 'quill', 'a.md'), 'nothing private\n');
  fs.writeFileSync(path.join(dir, 'Odalys Fenwick.txt'), 'nothing private\n');
  commitAll(dir, 'names');
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] });
  const r = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir]);
  assert.notEqual(r.status, 0, `${NOT_REFUSED}: private names as file and folder names passed: ${r.out}`);
  const named = r.out.split('\n').filter((l) => /^::error .*title=Leak finding::.*file or folder name/.test(l));
  assert.equal(named.length, 3, `${NOT_REFUSED}: not one name finding for each of the three paths: ${r.out}`);
  assert.match(noticeOf(r.out) ?? '', /^files: 3 read, 3 new findings, 0 known;/, `the notice does not count the three name findings: ${r.out}`);
  assertNoPlain(r.out);
});

test('a private name in a ref name, or in a file name on a ref, is found on that ref', () => {
  const origin = tmp();
  git(origin, 'init', '-q');
  fs.writeFileSync(path.join(origin, 'README.md'), 'A public readme.\n');
  commitAll(origin, 'readme');
  git(origin, 'branch', 'feature/lantern-vault');
  git(origin, 'checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(origin, 'Odalys-Fenwick.md'), 'nothing private\n');
  commitAll(origin, 'side');
  git(origin, 'checkout', '-q', 'main');
  const work = tmp();
  git(work, 'clone', '-q', '--depth=1', `file://${origin}`, 'copy');
  const dir = path.join(work, 'copy');
  const known = writeKnown(tmp(), { 'role-addresses': ROLES, findings: [] });
  const r = run(['--hashes', HASHES, '--known', known, '--repository', 'dazzer-io/example', '--root', dir, '--refs', 'origin']);
  assert.equal(r.status, 0, `findings on refs refused a change whose files are clean: ${r.out}`);
  assert.match(r.out, /^refs\/heads\/feature\/\S+: ref name .*repository/m, `the ref name holding a private repository name is not a finding: ${r.out}`);
  assert.match(r.out, /^refs\/heads\/side: \S+ \(file or folder name\) .*person/m, `a private name as a file name on a ref is not a finding: ${r.out}`);
  const [, , , , , onBranches] = (noticeOf(r.out) ?? '').match(NOTICE) ?? [];
  assert.equal(onBranches, '2', `the notice does not count the two name findings on refs: ${noticeOf(r.out)}`);
  assertNoPlain(r.out);
});

test('a name split by format characters, or in fullwidth or decomposed letters, is still found', () => {
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  const cases = [
    ['lantern\u200d-vault', 'repositories', 'a zero-width joiner'],
    ['lan\u00adtern-vault', 'repositories', 'a soft hyphen'],
    ['dazzer-io/qu\u200bill', 'repositories', 'a zero-width space'],
    ['\uff4c\uff41\uff4e\uff54\uff45\uff52\uff4e\uff0d\uff56\uff41\uff55\uff4c\uff54', 'repositories', 'fullwidth letters'],
    ['Odalys Fenwic\u200ek', 'people', 'a left-to-right mark'],
  ];
  for (const [text, kind, what] of cases) {
    const found = match(`${text}\n`, 'x.md');
    assert.deepEqual(found.map((f) => f.kind), [kind], `${NOT_REFUSED}: a name written with ${what} was not found: ${JSON.stringify(found)}`);
  }
  const list = { salt: '', repositories: new Set(), people: new Set([hashes.oneWay('ren\u00e9e caul')]), addresses: new Set() };
  const decomposed = scan.matcher(list)('Signed, Rene\u0301e Caul.\n', 'x.md');
  assert.equal(decomposed.length, 1, `${NOT_REFUSED}: a name in decomposed letters was not found: ${JSON.stringify(decomposed)}`);
});

test('a listed address domain is found as a hostname: in a URL, bare, and as a subdomain\'s parent', () => {
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  for (const text of ['See https://brightfen.example/docs for more.', 'Hosted at brightfen.example.', 'Mirror: http://cdn.eu.brightfen.example:8080/x', 'mail marlo@mail.brightfen.example']) {
    const found = match(`${text}\n`, 'x.md');
    assert.deepEqual(found.map((f) => f.kind), ['addresses'], `${NOT_REFUSED}: the listed domain was not found in "${text.replace(/brightfen/g, 'b…')}": ${JSON.stringify(found)}`);
  }
  for (const text of ['Ask help@brightfen.example.', 'A brightfenx.example site and notbrightfen.example.org.', 'file notes.md']) {
    assert.deepEqual(match(`${text}\n`, 'x.md'), [], `a role address or another host was found as the listed domain in "${text.replace(/brightfen/g, 'b…')}"`);
  }
});

test('without --refs the notice says the refs were not read, never "0 read"', () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.md'), 'nothing private\n');
  commitAll(dir, 'a');
  const r = run(['--hashes', HASHES, '--root', dir]);
  assert.equal(r.status, 0, `a clean run was refused: ${r.out}`);
  const notice = noticeOf(r.out) ?? '';
  assert.match(notice, /; refs: not read\b/, `the notice does not say the refs were not read: ${notice}`);
  assert.doesNotMatch(notice, /refs: 0 read/, `the notice reads refs it never read as "0 read": ${notice}`);
});

test('the README says what is read and what is not, and makes no claim the hash list keeps names secret', () => {
  const t = fs.readFileSync(path.join(ROOT, 'leak-check', 'README.md'), 'utf8').replace(/\s+/g, ' ').toLowerCase();
  for (const read of ['file contents', 'file and folder names', 'ref names', 'ref trees']) assert.ok(t.includes(read), `the README does not say it reads ${read}`);
  for (const not of ['commit messages', 'author names and emails', 'tag messages', 'pull request titles and bodies', 'git lfs content']) assert.ok(t.includes(not), `the README does not say it does not read ${not}`);
  assert.match(t, /confirm a name they already guess/, 'the README does not say a guessed name can be confirmed from the hash list');
  assert.doesNotMatch(t, /what a stranger can read/, 'the README still claims it reads what a stranger can read');
  assert.doesNotMatch(t, /keeps? (?:the )?names? (?:secret|private)/i, 'the README claims the list keeps names secret');
});

test('a name a zero-width space or word joiner separates is found split as well as joined', () => {
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  for (const [mark, what] of [['\u200b', 'a zero-width space'], ['\u2060', 'a word joiner']]) {
    const found = match(`Drafted by Odalys${mark}Fenwick.\n`, 'x.md');
    assert.deepEqual(found.map((f) => f.kind), ['people'], `${NOT_REFUSED}: a person's name separated by ${what} was not found: ${JSON.stringify(found)}`);
    assert.deepEqual(match.names(`docs/Odalys${mark}Fenwick.md`).map((f) => f.kind), ['people'], `${NOT_REFUSED}: a file name separated by ${what} was not found`);
    assert.equal(match.hide(`docs/Odalys${mark}Fenwick.md`), 'docs/[hidden]', `a file name separated by ${what} is not hidden in the log`);
  }
  assert.equal(hashes.oneWay('lantern-vault', 'fixture-only-salt'), '64935f3884c00979724167c0108ce3c1090f7e30e1f4f312538cfad1af272636', 'the one-way hash of an ASCII name changed');
});

test('a failed fetch\'s reason is printed with a private name in it hidden', () => {
  const match = scan.matcher(hashes.loadList(HASHES), { roles: ROLES });
  const refs = [{ ref: 'refs/heads/main', state: 'unknown', findings: null, why: 'couldn\'t find remote ref refs/heads/lantern-vault', named: [] }];
  const said = scan.verdict({ files: { read: [{ path: 'a.md', texts: [''] }], unread: [] }, fresh: [], known: [], refs, hide: match.hide }).lines.join('\n');
  assert.match(said, /^could not read refs\/heads\/main: /m, `the run does not name the ref it could not read: ${said}`);
  assertNoPlain(said);
});

test('a known.json entry with "in": "name" accepts a name finding, and a plain entry does not', () => {
  const dir = tmp();
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'docs', 'lantern-vault'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'lantern-vault', 'readme.md'), 'nothing private\n');
  commitAll(dir, 'name');
  const p = 'docs/lantern-vault/readme.md';
  const hash = hashes.oneWay('lantern-vault', 'fixture-only-salt');
  const args = (known) => ['--hashes', HASHES, '--known', writeKnown(tmp(), { 'role-addresses': ROLES, findings: [known] }), '--repository', 'dazzer-io/example', '--root', dir];
  const accepted = run(args({ path: p, kind: 'repositories', hash, in: 'name' }));
  assert.equal(accepted.status, 0, `an entry with "in": "name" did not accept the name finding: ${accepted.out}`);
  assert.match(noticeOf(accepted.out) ?? '', /^files: 1 read, 0 new findings, 1 known;/, `the notice does not count the accepted name finding: ${accepted.out}`);
  const plain = run(args({ path: p, kind: 'repositories', hash }));
  assert.notEqual(plain.status, 0, `${NOT_REFUSED}: a plain entry, meant for file contents, accepted a name finding: ${plain.out}`);
  assertNoPlain(`${accepted.out}${plain.out}`);
});
