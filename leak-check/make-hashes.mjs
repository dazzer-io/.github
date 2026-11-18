// Makes the leak check's one-way hash list (read by hashes.mjs). It reads the organisation's private
// and internal repository names live with the caller's own GitHub sign-in (gh), and the people's names
// and addresses from a names file whose path is given, kept outside every repository. It writes only
// hashes, made by hashes.mjs's oneWay so the scanner matches them, sorted so the order tells nothing,
// and it never prints a plain name: what it says is counts and places only.
//
//   node leak-check/make-hashes.mjs --names <names.json> --out <hashes.json> [--org <org>]
//   node leak-check/make-hashes.mjs --check --hashes <hashes.json> [--org <org>]
//
// The names file is JSON: { "people": ["..."], "addresses": ["..."] }.
// --check reads the repository list again and exits 1, saying "a private repository name has no hash",
// while any private or internal repository's name is missing from the list.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneWay, loadHashes } from './hashes.mjs';

export const MISSING = 'a private repository name has no hash';
const ORG = 'dazzer-io';

// The organisation's repositories as [{ name, visibility }], read with the caller's gh sign-in.
export async function ghRepositories(org) {
  const raw = execFileSync('gh', ['api', '--paginate', `orgs/${org}/repos?type=all&per_page=100`, '--jq', '.[] | {name, visibility}'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Private and internal names only: a public repository's name is no secret.
export const privateNames = (repos) => repos.filter((r) => r.visibility === 'private' || r.visibility === 'internal').map((r) => r.name);

// The folder holding `file` sits inside a repository when it or a folder above holds .git.
function insideRepository(file) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

function readNames(file) {
  if (insideRepository(file)) throw new Error(`the names file ${file} sits inside a repository: keep it outside every repository`);
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`could not read the names file ${file} (${e.code ?? e.message})`); }
  let names;
  try { names = JSON.parse(raw); } catch { throw new Error(`the names file ${file} is not JSON`); }
  if (names === null || typeof names !== 'object' || Array.isArray(names)) throw new Error(`the names file ${file} is not an object holding people, addresses`);
  const out = {};
  for (const kind of ['people', 'addresses']) {
    const list = names[kind] ?? [];
    if (!Array.isArray(list)) throw new Error(`${kind} in the names file is not a list`);
    list.forEach((n, i) => { if (typeof n !== 'string' || !n.trim()) throw new Error(`${kind}[${i}] in the names file is not a name`); });
    out[kind] = list;
  }
  if (!out.people.length) throw new Error(`the names file ${file} holds no people`);
  return out;
}

const hashed = (names) => [...new Set(names.map(oneWay))].sort();

async function privateRepositories(listRepositories, org) {
  const repos = await listRepositories(org);
  if (!Array.isArray(repos) || !repos.length) throw new Error(`the repository listing of ${org} came back empty: nothing was read, so nothing can be hashed`);
  const names = privateNames(repos);
  if (!names.length) throw new Error(`the repository listing of ${org} holds no private or internal repository: the sign-in may not see them`);
  return names;
}

export async function main(argv, { listRepositories = ghRepositories, out = console.log, err = console.error } = {}) {
  const args = [...argv];
  let names = null, outFile = null, hashesFile = null, check = false, org = ORG;
  while (args.length) {
    const a = args.shift();
    if (a === '--names') names = args.shift();
    else if (a === '--out') outFile = args.shift();
    else if (a === '--hashes') hashesFile = args.shift();
    else if (a === '--org') org = args.shift();
    else if (a === '--check') check = true;
    else { err(`unknown argument ${a}`); return 2; }
  }
  try {
    if (check) {
      if (!hashesFile) { err('--check needs --hashes <hashes.json>'); return 2; }
      const have = loadHashes(hashesFile);
      const repos = await privateRepositories(listRepositories, org);
      const missing = repos.filter((n) => !have.has(oneWay(n))).length;
      if (missing) { err(`${MISSING}: ${missing} of ${repos.length} private or internal repositories of ${org}; make the list again`); return 1; }
      out(`every one of ${repos.length} private or internal repositories of ${org} has a hash`);
      return 0;
    }
    if (!names || !outFile) { err('give --names <names.json> and --out <hashes.json>, or --check --hashes <hashes.json>'); return 2; }
    const people = readNames(names);
    const repos = await privateRepositories(listRepositories, org);
    const list = { repositories: hashed(repos), people: hashed(people.people), addresses: hashed(people.addresses) };
    writeFileSync(outFile, `${JSON.stringify(list, null, 2)}\n`);
    loadHashes(outFile);
    out(`wrote ${outFile}: ${list.repositories.length} repositories, ${list.people.length} people, ${list.addresses.length} addresses, as one-way hashes`);
    return 0;
  } catch (e) {
    err(e.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
