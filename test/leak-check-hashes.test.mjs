// The maker of the leak check's one-way hash list (leak-check/make-hashes.mjs): it hashes every
// private and internal repository name of the organisation and the people's names from a file kept
// outside every repository, never a public repository's name, and never prints a plain name. Its
// --check reads the repository list again and fails while one private name has no hash. Every name
// here is invented and the repository listing is stubbed: no test touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneWay, loadHashes } from '../leak-check/hashes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAULT = 'a private repository name has no hash';

// Loaded by hand, so a maker that is not there yet fails each test in words, not at import.
let maker;
try { maker = await import(path.join(here, '..', 'leak-check', 'make-hashes.mjs')); } catch (e) { maker = { missing: e.message }; }

const REPOS = [
  { name: 'Quillfeather-Vault', visibility: 'private' },
  { name: 'marrow-ledger', visibility: 'internal' },
  { name: 'open-lantern', visibility: 'public' },
];
const PEOPLE = ['Orla Venn', 'Tobiah Quance'];
const ADDRESSES = ['orla@example.invalid'];
const PLAIN = [...REPOS.map((r) => r.name), ...PEOPLE, ...ADDRESSES];

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'leak-check-hashes-'));
const namesFile = (dir) => {
  const file = path.join(dir, 'names.json');
  fs.writeFileSync(file, JSON.stringify({ people: PEOPLE, addresses: ADDRESSES }));
  return file;
};

// Runs the maker with a stubbed listing; returns { code, said } where said is all it printed.
async function run(args, repos = REPOS) {
  assert.equal(typeof maker.main, 'function', `leak-check/make-hashes.mjs exports no main: ${maker.missing ?? 'not exported'}; ${FAULT} can never be caught`);
  const lines = [];
  const code = await maker.main(args, {
    listRepositories: async () => repos,
    out: (s) => lines.push(String(s)),
    err: (s) => lines.push(String(s)),
  });
  return { code, said: lines.join('\n') };
}

const noPlainName = (text, where) => {
  for (const name of PLAIN) {
    assert.ok(!text.toLowerCase().includes(name.toLowerCase()), `${where} holds a plain name: it must hold one-way hashes only`);
  }
};

test('the list holds a hash for every private and internal repository and every person, and no plain name', async () => {
  const dir = tmp();
  const out = path.join(dir, 'hashes.json');
  const { code, said } = await run(['--names', namesFile(dir), '--out', out]);
  assert.equal(code, 0, `the maker refused: ${said}`);
  const written = fs.readFileSync(out, 'utf8');
  noPlainName(written, 'the written list');
  noPlainName(said, 'what the maker printed');
  const list = JSON.parse(written);
  for (const r of REPOS.filter((r) => r.visibility !== 'public')) {
    assert.ok(list.repositories.includes(oneWay(r.name)), `${FAULT}: the ${r.visibility} repository is missing from the list`);
  }
  assert.ok(!list.repositories.includes(oneWay('open-lantern')), 'a public repository name was hashed: the list holds private names only');
  for (const p of PEOPLE) assert.ok(list.people.includes(oneWay(p)), 'a person named in the names file has no hash');
  for (const a of ADDRESSES) assert.ok(list.addresses.includes(oneWay(a)), 'an address named in the names file has no hash');
  assert.ok(loadHashes(out).size >= 5, 'the leak check does not accept the list the maker wrote');
});

test('--check passes while every private repository has a hash', async () => {
  const dir = tmp();
  const out = path.join(dir, 'hashes.json');
  await run(['--names', namesFile(dir), '--out', out]);
  const { code, said } = await run(['--check', '--hashes', out]);
  assert.equal(code, 0, `--check failed on a complete list: ${said}`);
});

test('--check fails, naming no name, when a private or internal repository appeared after the list was made', async () => {
  for (const visibility of ['private', 'internal']) {
    const dir = tmp();
    const out = path.join(dir, 'hashes.json');
    await run(['--names', namesFile(dir), '--out', out]);
    const grown = [...REPOS, { name: 'Brindle-Harbour', visibility }];
    const { code, said } = await run(['--check', '--hashes', out], grown);
    assert.notEqual(code, 0, `${FAULT}: --check passed while a new ${visibility} repository had none`);
    assert.match(said, new RegExp(FAULT), `--check failed without saying "${FAULT}": ${said}`);
    assert.ok(!said.includes('Brindle-Harbour'), '--check printed the plain name of the repository it found missing');
  }
});

test('a names file that is not there or not a names list stops the maker red', async () => {
  const dir = tmp();
  const out = path.join(dir, 'hashes.json');
  let r = await run(['--names', path.join(dir, 'absent.json'), '--out', out]);
  assert.notEqual(r.code, 0, 'the maker wrote a list without the names file');
  assert.ok(!fs.existsSync(out), 'the maker wrote a list without the names file');
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify(['Orla Venn']));
  r = await run(['--names', bad, '--out', out]);
  assert.notEqual(r.code, 0, 'the maker accepted a names file that is not { people, addresses }');
  noPlainName(r.said, 'the refusal');
});

test('a names file inside a repository is refused: the names are kept outside every repository', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.git'));
  const r = await run(['--names', namesFile(dir), '--out', path.join(dir, 'hashes.json')]);
  assert.notEqual(r.code, 0, 'the maker read a names file kept inside a repository');
});

test('an empty repository listing is refused, never read as no private names', async () => {
  const dir = tmp();
  const r = await run(['--names', namesFile(dir), '--out', path.join(dir, 'hashes.json')], []);
  assert.notEqual(r.code, 0, 'the maker wrote a list from an empty repository listing');
});
