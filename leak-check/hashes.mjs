// The list of what the leak check looks for, held as one-way hashes only. These repositories are
// public, so the list cannot hold a plain name: each entry is the SHA-256 of the list's salt
// followed by a name, lower-cased and trimmed, written as 64 lower-case hex characters. The salt is
// an optional string beside the lists ("salt"); a list without one hashes the name alone. A list
// that is missing, unreadable, empty or holds any other entry stops the scanner red: a check that
// read nothing must never read as clean. The refusal names the entry by its place
// (repositories[1]), never by what it holds, so a plain name put there by mistake is not repeated
// in a public run's output.
//
// What each list holds: repositories, the names of private repositories; people, full names of
// private people, as words separated by one space; addresses, whole email addresses or the part
// after the @ (a domain), so every address at that domain is a finding unless it is a role address.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const REFUSAL = 'no one-way hash list';
export const KINDS = ['repositories', 'people', 'addresses'];
const HASH = /^[0-9a-f]{64}$/;

// Text as it is matched and hashed: format characters (zero-width joiner and space, soft hyphen,
// direction marks, every Unicode Cf) removed and NFKC applied, so a name split by an invisible
// character or written in fullwidth or decomposed letters reads as the name.
export const normalise = (s) => String(s).replace(/\p{Cf}/gu, '').normalize('NFKC').replace(/\p{Cf}/gu, '');

// The second reading of the same text: each format character turned into a space instead, since a
// zero-width space or word joiner may stand where a space did. Text is matched in both readings;
// a name is hashed only as normalise leaves it, so an ASCII name's hash never changes.
export const spaced = (s) => String(s).replace(/\p{Cf}/gu, ' ').normalize('NFKC').replace(/\p{Cf}/gu, ' ');

// The one-way hash of a name, as the list holds it, with the list's salt if it has one; the name
// is normalised, trimmed and lower-cased first.
export const oneWay = (name, salt = '') => createHash('sha256').update(`${salt}${normalise(name).trim().toLowerCase()}`).digest('hex');

const refuse = (why) => { throw new Error(`${REFUSAL}: ${why}`); };

// Reads the list at `file`: { salt, repositories, people, addresses, all }, each kind a Set of its
// hashes and `all` every hash; throws, saying REFUSAL, otherwise. A refusal never repeats the
// file's path or anything the file holds: it names an entry by its place.
export function loadList(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { refuse(`could not read the hash list (${e.code ?? 'unreadable'})`); }
  let list;
  try { list = JSON.parse(raw); } catch { refuse('the hash list is not JSON'); }
  if (list === null || typeof list !== 'object' || Array.isArray(list)) refuse(`the hash list is not an object holding ${KINDS.join(', ')}`);
  const bad = [];
  const out = { salt: '', all: new Set() };
  for (const kind of KINDS) out[kind] = new Set();
  let lists = 0;
  for (const [at, [kind, entries]] of Object.entries(list).entries()) {
    if (kind === 'salt') {
      if (typeof entries === 'string' && entries.length) out.salt = entries;
      else bad.push('salt is not a string');
      continue;
    }
    if (!KINDS.includes(kind)) { bad.push(`list ${at + 1} is named outside ${KINDS.join(', ')}`); continue; }
    if (!Array.isArray(entries)) { bad.push(`${kind} is not a list`); continue; }
    lists += 1;
    entries.forEach((e, i) => {
      if (typeof e === 'string' && HASH.test(e)) { out[kind].add(e); out.all.add(e); }
      else bad.push(`${kind}[${i}] is not a 64-character hex hash`);
    });
  }
  if (bad.length) refuse(`the hash list: ${bad.join('; ')}`);
  if (!lists) refuse(`the hash list holds none of ${KINDS.join(', ')}`);
  if (!out.all.size) refuse('the hash list holds no hashes');
  return out;
}

// Reads the list at `file` and returns every hash in it as one Set; throws, saying REFUSAL, otherwise.
export const loadHashes = (file) => loadList(file).all;
