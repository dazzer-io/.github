// The leak check's refusals (leak-check/hashes.mjs, leak-check/scan.mjs): a check that passes when
// it read nothing is worse than none. The hash list must exist, hold at least one entry and hold
// one-way hashes only; a file that is not text is named and counted unread, never clean; a ref the
// fetch could not serve is unknown with its name, never zero findings. Every name here is invented,
// and no test touches the network: files and refs are built in a temporary folder or passed in.
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

// Loaded by hand, so a scanner that is not there yet fails each test in words, not at import.
const load = async (file) => {
  try { return await import(path.join(here, '..', 'leak-check', file)); } catch (e) { return { missing: e.message }; }
};
const hashes = await load('hashes.mjs');
const scan = await load('scan.mjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leak-check-refusals-'));
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

test('a file that is not text is named and counted unread, never clean', () => {
  assert.equal(typeof scan.readFiles, 'function', `leak-check/scan.mjs has no readFiles: ${scan.missing ?? 'not exported'}`);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'a plain note\n');
  fs.writeFileSync(path.join(dir, 'logo.bin'), Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]));
  const got = scan.readFiles(dir, ['notes.md', 'logo.bin', 'gone.md']);
  assert.deepEqual(got.read.map((f) => f.path), ['notes.md'], `the files read as text are ${JSON.stringify(got.read.map((f) => f.path))}`);
  assert.deepEqual(got.unread.map((f) => f.path).sort(), ['gone.md', 'logo.bin'], `the files counted unread are ${JSON.stringify(got.unread)}`);
  for (const u of got.unread) assert.ok(u.why, `${u.path} was counted unread without saying why`);
  const verdict = scan.verdict({ files: got, refs: [] });
  assert.equal(verdict.clean, false, 'two files nobody read were called clean');
  assert.match(verdict.lines.join('\n'), /logo\.bin/, `the run does not name the file it could not read: ${verdict.lines.join('\n')}`);
  assert.match(verdict.lines.join('\n'), /2 unread/, `the run does not count the unread files: ${verdict.lines.join('\n')}`);
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
  const verdict = scan.verdict({ files: { read: [], unread: [] }, refs });
  assert.equal(verdict.clean, false, 'two refs nobody read were called clean');
  const said = verdict.lines.join('\n');
  for (const name of ['refs/pull/7/head', 'refs/tags/v0.1']) assert.ok(said.includes(name), `the run does not name the unknown ref ${name}: ${said}`);
  assert.match(said, /2 unknown/, `the run does not count the unknown refs: ${said}`);
});

test('a run that read every file and every ref, finding nothing, is clean', () => {
  assert.equal(typeof scan.verdict, 'function', `leak-check/scan.mjs has no verdict: ${scan.missing ?? 'not exported'}`);
  const verdict = scan.verdict({
    files: { read: [{ path: 'notes.md', text: 'x' }], unread: [] },
    refs: [{ ref: 'refs/heads/main', state: 'read', findings: 0 }],
  });
  assert.equal(verdict.clean, true, `a run that read everything was not clean: ${verdict.lines.join('\n')}`);
});
