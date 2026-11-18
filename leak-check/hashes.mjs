// The list of what the leak check looks for, held as one-way hashes only. These repositories are
// public, so the list cannot hold a plain name: each entry is the SHA-256 of a name, lower-cased and
// trimmed, written as 64 lower-case hex characters. A list that is missing, unreadable, empty or holds
// any other entry stops the scanner red: a check that read nothing must never read as clean. The
// refusal names the entry by its place (repositories[1]), never by what it holds, so a plain name
// put there by mistake is not repeated in a public run's output.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const REFUSAL = 'no one-way hash list';
export const KINDS = ['repositories', 'people', 'addresses'];
const HASH = /^[0-9a-f]{64}$/;

// The one-way hash of a name, as the list holds it.
export const oneWay = (name) => createHash('sha256').update(String(name).trim().toLowerCase()).digest('hex');

const refuse = (why) => { throw new Error(`${REFUSAL}: ${why}`); };

// Reads the list at `file` and returns every hash in it as one Set; throws, saying REFUSAL, otherwise.
export function loadHashes(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { refuse(`could not read ${file} (${e.code ?? e.message})`); }
  let list;
  try { list = JSON.parse(raw); } catch { refuse(`${file} is not JSON`); }
  if (list === null || typeof list !== 'object' || Array.isArray(list)) refuse(`${file} is not an object holding ${KINDS.join(', ')}`);
  const bad = [];
  const all = new Set();
  let lists = 0;
  for (const [kind, entries] of Object.entries(list)) {
    if (!KINDS.includes(kind)) { bad.push(`${kind} is not one of ${KINDS.join(', ')}`); continue; }
    if (!Array.isArray(entries)) { bad.push(`${kind} is not a list`); continue; }
    lists += 1;
    entries.forEach((e, i) => {
      if (typeof e === 'string' && HASH.test(e)) all.add(e);
      else bad.push(`${kind}[${i}] is not a 64-character hex hash`);
    });
  }
  if (bad.length) refuse(`${file}: ${bad.join('; ')}`);
  if (!lists) refuse(`${file} holds none of ${KINDS.join(', ')}`);
  if (!all.size) refuse(`${file} holds no hashes`);
  return all;
}
