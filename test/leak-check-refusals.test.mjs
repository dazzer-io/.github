// The leak check's refusals (leak-check/hashes.mjs, leak-check/scan.mjs): a check that passes when
// it read nothing is worse than none. The hash list must exist, hold at least one entry and hold
// one-way hashes only; a file that cannot be opened is named and counted unread and refuses the run,
// and one that is not UTF-8 is read as bytes, never skipped as clean; a ref the fetch could not
// serve is unknown with its name, never zero findings. Every name here is invented, and no test
// touches the network: files and refs are built in a temporary folder or passed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures', 'leak-check');
const SCAN = path.join(here, '..', 'leak-check', 'scan.mjs');
const REFUSAL = /^no one-way hash list\b/;
const NOT_REFUSED = 'a new leak finding was not refused';

// Loaded by hand, so a scanner that is not there yet fails each test in words, not at import.
const load = async (file) => {
  try { return await import(path.join(here, '..', 'leak-check', file)); } catch (e) { return { missing: e.message }; }
};
const hashes = await load('hashes.mjs');
const scan = await load('scan.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leak-check-refusals-'));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const refusalOf = (read) => {
  if (typeof hashes.loadHashes !== 'function') return `(no loadHashes in leak-check/hashes.mjs: ${hashes.missing ?? 'not exported'})`;
  try { read(); return null; } catch (e) { return e.message; }
};
const expectRefusal = (file, what) => {
  const said = refusalOf(() => hashes.loadHashes(file));
  assert.match(said ?? '(accepted)', REFUSAL, `${what} was read as a hash list: the scanner must stop red saying "no one-way hash list", and it said ${said ?? 'nothing (it accepted the list)'}`);
  return said;
};

// ---------- the hash list ----------

test('a hash list file that is not there stops the scanner red', () => {
  const file = path.join(tmp(), 'hashes.json');
  expectRefusal(file, `a missing ${file}`);
});

test('an empty hash list stops the scanner red', () => {
  expectRefusal(path.join(FIXTURES, 'empty-hashes.json'), 'an empty list');
});

test('a hash list that is not JSON, or holds no lists, stops the scanner red', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "repositories": [');
  fs.writeFileSync(path.join(dir, 'shapeless.json'), '{ "repositories": "f3b2" }');
  fs.writeFileSync(path.join(dir, 'array.json'), '[]');
  for (const f of ['broken.json', 'shapeless.json', 'array.json']) expectRefusal(path.join(dir, f), `the unreadable ${f}`);
});

test('a hash list holding a plain name stops the scanner red without repeating the name', () => {
  const said = expectRefusal(path.join(FIXTURES, 'plain-name-hashes.json'), 'a list holding plain names');
  for (const plain of ['willow-depot', 'Ansel Quorrow']) {
    assert.ok(!said.includes(plain), `the refusal repeats the plain name it found, which would publish it: ${said}`);
  }
  assert.match(said, /repositories\[1\]/, `the refusal does not say which entry is not a 64-character hex hash: ${said}`);
  assert.match(said, /people\[0\]/, `the refusal does not say which entry is not a 64-character hex hash: ${said}`);
});

test('a hash that is short or in capitals is not a one-way hash entry', () => {
  const dir = tmp();
  const good = 'a'.repeat(64);
  fs.writeFileSync(path.join(dir, 'short.json'), JSON.stringify({ repositories: [good, 'a'.repeat(63)] }));
  fs.writeFileSync(path.join(dir, 'capitals.json'), JSON.stringify({ people: ['A'.repeat(64)] }));
  expectRefusal(path.join(dir, 'short.json'), 'a list with a 63-character entry');
  expectRefusal(path.join(dir, 'capitals.json'), 'a list with an upper-case entry');
});

test('a list of one-way hashes is read, and a name hashes to one of its entries', () => {
  const dir = tmp();
  const file = path.join(dir, 'hashes.json');
  const entry = typeof hashes.oneWay === 'function' ? hashes.oneWay('Orchard-Ledger ') : null;
  assert.match(entry ?? '', /^[0-9a-f]{64}$/, `oneWay did not give a 64-character hex hash: ${entry ?? hashes.missing}`);
  fs.writeFileSync(file, JSON.stringify({ repositories: [entry], people: ['b'.repeat(64)] }));
  const said = refusalOf(() => hashes.loadHashes(file));
  assert.equal(said, null, `a list of one-way hashes was refused: ${said}`);
  const list = hashes.loadHashes(file);
  assert.equal(list.size, 2, `the list holds 2 hashes and was read as ${list.size}`);
  assert.ok(list.has(hashes.oneWay('orchard-ledger')), 'a name in the list was not found in it');
});

test('the scanner run from the command line stops red on an empty hash list, before reading anything', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'nothing private here\n');
  const r = spawnSync(process.execPath, [SCAN, '--hashes', path.join(FIXTURES, 'empty-hashes.json'), '--root', dir, 'notes.md'], { encoding: 'utf8' });
  const said = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 0, `the scanner passed on an empty list, which must stop it saying "no one-way hash list": ${said}`);
  assert.match(said, /no one-way hash list/, `the scanner stopped without saying "no one-way hash list": ${said}`);
  assert.doesNotMatch(said, /files: \d+ read/, `the scanner read files with no one-way hash list to read them against: ${said}`);
});

// ---------- files it cannot read ----------

// These run the scanner itself, so its exit is what is judged, not a helper it might not call.
const runScan = (dir, files) => {
  const r = spawnSync(process.execPath, [SCAN, '--hashes', path.join(FIXTURES, 'hashes.json'), '--root', dir, ...files], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const noticeOf = (out) => (out.match(/^::notice title=Leak check::(.*)$/m) ?? [])[1] ?? '';

test('a file the scanner could not open is named and counted unread, and the run is never clean', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'a plain note\n');
  const r = runScan(dir, ['notes.md', 'gone.md']);
  assert.notEqual(r.status, 0, `a run that could not open gone.md passed: ${r.out}`);
  assert.match(r.out, /^could not read gone\.md: could not open it/m, `the run does not name the file it could not open: ${r.out}`);
  assert.match(noticeOf(r.out), /^files: 1 read, .*; not read: 1 files$/, `the notice does not count the file it could not open: ${r.out}`);
});

test('a file that is not UTF-8 is read as bytes and named, never skipped as clean', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'a plain note\n');
  fs.writeFileSync(path.join(dir, 'logo.bin'), Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]));
  const r = runScan(dir, ['notes.md', 'logo.bin']);
  assert.equal(r.status, 0, `a binary holding no name was refused: ${r.out}`);
  assert.match(r.out, /^read as bytes: logo\.bin /m, `the run does not name the file it read as bytes: ${r.out}`);
  assert.match(noticeOf(r.out), /^files: 2 read, 0 new findings, 0 known/, `the notice does not count the binary as read: ${r.out}`);
  fs.writeFileSync(path.join(dir, 'logo.bin'), Buffer.concat([Buffer.from([0xff, 0x00]), Buffer.from(' lantern-vault '), Buffer.from([0x00])]));
  const named = runScan(dir, ['notes.md', 'logo.bin']);
  assert.notEqual(named.status, 0, `a private name in a binary file passed: ${named.out}`);
  assert.ok(!named.out.includes('lantern-vault'), `the run repeats the private name it found: ${named.out}`);
});

// ---------- refs it could not fetch ----------

test('a ref the fetch could not serve is unknown with its name, never zero findings', async () => {
  assert.equal(typeof scan.readRefs, 'function', `leak-check/scan.mjs has no readRefs: ${scan.missing ?? 'not exported'}`);
  const serve = async (ref) => {
    if (ref === 'refs/pull/7/head') throw new Error('couldn\'t find remote ref refs/pull/7/head');
    if (ref === 'refs/tags/v0.1') return null;
    return [{ path: 'README.md', text: 'hello\n' }];
  };
  const refs = await scan.readRefs(['refs/heads/main', 'refs/pull/7/head', 'refs/tags/v0.1'], serve, () => []);
  const byName = Object.fromEntries(refs.map((r) => [r.ref, r]));
  assert.equal(byName['refs/heads/main']?.state, 'read', `a served ref was not read: ${JSON.stringify(byName['refs/heads/main'])}`);
  assert.equal(byName['refs/heads/main']?.findings, 0, 'a served ref with nothing in it was not zero findings');
  for (const name of ['refs/pull/7/head', 'refs/tags/v0.1']) {
    const r = byName[name];
    assert.equal(r?.state, 'unknown', `the ref ${name} the fetch could not serve was read as ${JSON.stringify(r)}`);
    assert.equal(r.findings, null, `the ref ${name} the fetch could not serve was given ${r.findings} findings`);
    assert.ok(r.why, `the unknown ref ${name} does not say why`);
  }
  // verdict is what the scanner's main prints and exits with; refs a change cannot fix refuse
  // nothing, but each unknown one is named and counted, never read as zero findings.
  assert.equal(typeof scan.verdict, 'function', `leak-check/scan.mjs has no verdict: ${scan.missing ?? 'not exported'}`);
  const verdict = scan.verdict({ files: { read: [], unread: [] }, fresh: [], known: [], refs });
  const said = verdict.lines.join('\n');
  for (const name of ['refs/pull/7/head', 'refs/tags/v0.1']) assert.match(said, new RegExp(`^could not read ${escapeRegExp(name)}: `, 'm'), `the run does not name the unknown ref ${name}: ${said}`);
  assert.match(said, /; not read: 0 files, 2 refs$/m, `the run does not count the unknown refs: ${said}`);
});

test('a run that read every file and every ref, finding nothing, exits clean', () => {
  assert.equal(typeof scan.verdict, 'function', `leak-check/scan.mjs has no verdict: ${scan.missing ?? 'not exported'}`);
  const verdict = scan.verdict({
    files: { read: [{ path: 'notes.md', texts: ['x'] }], unread: [] },
    fresh: [],
    known: [],
    refs: [{ ref: 'refs/heads/main', state: 'read', findings: 0, found: [] }],
  });
  assert.equal(verdict.code, 0, `a run that read everything did not exit clean: ${verdict.lines.join('\n')}`);
});

test('a run that read no tracked file stops red saying it read nothing, never "0 read" and clean', () => {
  const dir = tmp();
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q');
  const r = spawnSync(process.execPath, [SCAN, '--hashes', path.join(FIXTURES, 'hashes.json'), '--root', dir], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 0, `a run that read no file passed: ${out}`);
  assert.match(out, /read nothing/, `the run does not say it read nothing: ${out}`);
  assert.doesNotMatch(noticeOf(out), /files: 0 read/, `the notice counts "0 read" as a reading: ${out}`);
  assert.equal(typeof scan.verdict, 'function', `leak-check/scan.mjs has no verdict: ${scan.missing ?? 'not exported'}`);
  assert.notEqual(scan.verdict({ files: { read: [], unread: [] }, fresh: [], known: [], refs: [] }).code, 0, 'verdict passes a run that read no file');
});

test('a missing object in git\'s blob batch is read as no text, and the blobs after it are still read', () => {
  assert.equal(typeof scan.readBatch, 'function', `${NOT_REFUSED}: leak-check/scan.mjs has no readBatch: ${scan.missing ?? 'not exported'}`);
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const c = 'c'.repeat(40);
  const out = Buffer.from(`${a} blob 3\none\n${b} missing\n${c} blob 4\nfour\n`);
  const texts = scan.readBatch(out);
  assert.deepEqual(texts.get(a), ['one'], `the blob before the missing one was read as ${JSON.stringify(texts.get(a))}`);
  assert.equal(texts.get(b), null, `${NOT_REFUSED}: the missing object was read as ${JSON.stringify(texts.get(b))}`);
  assert.deepEqual(texts.get(c), ['four'], `${NOT_REFUSED}: the blob after the missing one was read as ${JSON.stringify(texts.get(c))}`);
});

test('a ref holding a file with no text is unknown, never read clean', async () => {
  assert.equal(typeof scan.readRefs, 'function', `leak-check/scan.mjs has no readRefs: ${scan.missing ?? 'not exported'}`);
  const serve = async (ref) => (ref === 'refs/heads/gap'
    ? [{ path: 'a.md', blob: 'a'.repeat(40), texts: ['fine\n'] }, { path: 'b.md', blob: 'b'.repeat(40), texts: null }]
    : [{ path: 'a.md', blob: 'a'.repeat(40), texts: ['fine\n'] }]);
  const refs = await scan.readRefs(['refs/heads/main', 'refs/heads/gap'], serve, () => []);
  const gap = refs.find((r) => r.ref === 'refs/heads/gap');
  assert.equal(gap?.state, 'unknown', `${NOT_REFUSED}: a ref holding a file with no text was read as ${JSON.stringify(gap)}`);
  assert.equal(gap.findings, null, `a ref holding a file with no text was given ${gap.findings} findings`);
  assert.equal(refs.find((r) => r.ref === 'refs/heads/main')?.state, 'read', 'a whole ref was not read');
  const said = scan.verdict({ files: { read: [{ path: 'x', texts: [''] }], unread: [] }, fresh: [], known: [], refs }).lines.join('\n');
  assert.match(said, /^could not read refs\/heads\/gap: /m, `the run does not name the ref with a file it could not read: ${said}`);
});

test('a folder git cannot list is refused without printing its path or git\'s message', () => {
  const root = path.join(tmp(), 'lantern-vault');
  const r = spawnSync(process.execPath, [SCAN, '--hashes', path.join(FIXTURES, 'hashes.json'), '--root', root], { encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 0, `a folder git could not list passed: ${out}`);
  assert.match(out, /could not list the files git tracks/, `the run does not say it could not list the files: ${out}`);
  assert.ok(!out.includes('lantern-vault'), `${NOT_REFUSED}: the run prints the folder's path, which holds a private name: ${out}`);
});

// ---------- what it prints ----------

test('a private name in the --hashes, --known, --root or --refs argument, or as a list key, never reaches the output', () => {
  const PRIVATE = ['lantern-vault', 'quill', 'Odalys'];
  const base = path.join(tmp(), 'lantern-vault');
  fs.mkdirSync(base);
  const good = path.join(FIXTURES, 'hashes.json');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'a.md'), 'nothing private\n');
  spawnSync('git', ['add', '-A'], { cwd: repo });
  spawnSync('git', ['-c', 'user.name=f', '-c', 'user.email=f@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'a'], { cwd: repo });
  fs.writeFileSync(path.join(base, 'broken.json'), '{');
  fs.writeFileSync(path.join(base, 'keyed.json'), JSON.stringify({ 'Odalys-notes': ['a'.repeat(64)] }));
  fs.writeFileSync(path.join(base, 'known.json'), JSON.stringify({ findings: [] }));
  const cases = [
    ['a --hashes file that is not there', ['--hashes', path.join(base, 'hashes.json'), '--root', repo]],
    ['a --hashes file that is not JSON', ['--hashes', path.join(base, 'broken.json'), '--root', repo]],
    ['a --hashes list keyed by a name', ['--hashes', path.join(base, 'keyed.json'), '--root', repo]],
    ['a --known file that is not there', ['--hashes', good, '--known', path.join(base, 'gone.json'), '--root', repo]],
    ['a --known file that is not JSON', ['--hashes', good, '--known', path.join(base, 'broken.json'), '--root', repo]],
    ['a --refs remote that is not there', ['--hashes', good, '--known', path.join(base, 'known.json'), '--root', repo, '--refs', path.join(base, 'quill-origin')]],
    ['a --refs remote named by owner and name', ['--hashes', good, '--root', repo, '--refs', 'https://invalid.invalid/dazzer-io/quill']],
    ['a --root folder git cannot list', ['--hashes', good, '--root', path.join(base, 'gone')]],
  ];
  for (const [what, args] of cases) {
    const r = spawnSync(process.execPath, [SCAN, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file' } });
    const out = `${r.stdout}${r.stderr}`;
    assert.ok(out.trim().length > 0, `${what}: the run printed nothing`);
    for (const p of PRIVATE) assert.ok(!out.includes(p), `${NOT_REFUSED}: ${what} put a private name (${p}) in the output: ${out}`);
  }
});
