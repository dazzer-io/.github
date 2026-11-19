// The leak scanner: it reads every file git tracks and the tip of every branch, tag and pull
// request ref a remote serves, matches the names the one-way hash list holds (hashes.mjs), refuses
// a finding in the tracked files that known.json does not accept, and records its counts as one
// notice titled "Leak check". A file that is not UTF-8 text (UTF-16, a stray Windows-1252 byte,
// a NUL) is read as bytes, matched in every decoding that could show a name, and named; a file it
// could not open is named and counted unread, and refuses the run; a ref the fetch could not serve is unknown with its name, never zero findings; and with no
// one-way hash list it stops before reading anything. No output repeats a name it found: a finding
// is told by file, line, kind and the one-way hash it matched.
//
// From the command line:
//   node leak-check/scan.mjs --hashes <hashes.json> [--known <known.json>] [--repository <owner/name>]
//                            [--owner <owner>] [--root <folder>] [--refs <remote>] [<file>...]
// With no files named it reads every file git tracks under --root. It exits 1 on a refused hash
// list or known-findings list, on a new finding in the files, or on a file it could not open
// (verdict decides both what it prints and its exit); findings on refs, which a change cannot remove, are counted and named but refuse nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KINDS, loadList, oneWay } from './hashes.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const LOSSY = ['utf-8', 'utf-16le', 'utf-16be'].map((e) => new TextDecoder(e));
const HASH = /^[0-9a-f]{64}$/;
export const KNOWN_REFUSAL = 'no known-findings list';
export const WHAT = { repositories: 'a private repository name', people: 'a private person\'s name', addresses: 'a private address' };

// The texts to match in `bytes`: { texts, bytes }. UTF-8 text with no NUL is one text; anything
// else (UTF-16 with or without a byte-order mark, a stray Windows-1252 byte, a NUL, an image) is
// read as bytes, in every decoding that could show a name: UTF-8 with bad bytes replaced, Latin-1,
// and UTF-16 both ways. A binary holding no name matches in none of them and passes.
export function decodings(bytes) {
  if (!bytes.includes(0)) {
    try { return { texts: [decoder.decode(bytes)], bytes: false }; } catch { /* read as bytes below */ }
  }
  const latin1 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('latin1');
  return { texts: [...LOSSY.map((d) => d.decode(bytes)), latin1], bytes: true };
}

// The findings in every text of one file, each once.
export function matchTexts(match, texts, filePath) {
  const found = new Map();
  for (const text of texts) for (const f of match(text, filePath)) found.set(`${f.line}:${f.kind}:${f.hash}`, f);
  return [...found.values()].sort((a, b) => a.line - b.line || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

// Reads each path under `root`: { read: [{ path, texts, bytes }], unread: [{ path, why }] }; only a
// file it could not open is unread.
export function readFiles(root, paths) {
  const read = [];
  const unread = [];
  for (const p of paths) {
    let bytes;
    try { bytes = readFileSync(path.join(root, p)); } catch (e) { unread.push({ path: p, why: `could not open it (${e.code ?? e.message})` }); continue; }
    read.push({ path: p, ...decodings(bytes) });
  }
  return { read, unread };
}

// ---------- matching ----------

const lineStarts = (text) => {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
};
const lineAt = (starts, index) => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; }
  return lo + 1;
};
const MAX_PARTS = 8;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A matcher over the loaded list (hashes.loadList): match(text, path) gives the findings in text as
// [{ path, line, kind, hash }], one per line, kind and hash. A private repository is matched as
// <owner>/<name>, or alone when its name holds a hyphen (so a name that is also a word is matched
// only beside its owner); a person as two or three words in a row, in any case and across a line
// break; an address whole or by its domain, unless it is one of the role addresses.
export function matcher(list, { roles = [], owner = 'dazzer-io' } = {}) {
  const salt = list.salt ?? '';
  const roleSet = new Set(roles.map((r) => r.trim().toLowerCase()));
  const hashOf = new Map();
  const hash = (s) => { let h = hashOf.get(s); if (h === undefined) { h = oneWay(s, salt); hashOf.set(s, h); } return h; };
  const ownerAt = new RegExp(`(?<![\\w.-])${escape(owner)}/([A-Za-z0-9._-]+)`, 'gi');
  return (text, filePath) => {
    const starts = lineStarts(text);
    const found = new Map();
    const add = (kind, h, index) => {
      if (!list[kind]?.has(h)) return;
      const line = lineAt(starts, index);
      const key = `${line}:${kind}:${h}`;
      if (!found.has(key)) found.set(key, { path: filePath, line, kind, hash: h });
    };
    if (list.repositories?.size) {
      for (const m of text.matchAll(ownerAt)) add('repositories', hash(m[1].replace(/\.git$/i, '').replace(/\.+$/, '')), m.index);
      for (const m of text.matchAll(/[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+/g)) {
        const parts = m[0].split('-');
        for (let i = 0; i < parts.length - 1; i += 1) {
          for (let j = i + 2; j <= Math.min(parts.length, i + MAX_PARTS); j += 1) add('repositories', hash(parts.slice(i, j).join('-')), m.index);
        }
      }
    }
    if (list.people?.size) {
      const words = [...text.matchAll(/\p{L}[\p{L}\p{M}'’-]*/gu)].map((m) => ({ word: m[0].replace(/['’]s$/i, '').replace(/[-'’]+$/, ''), index: m.index }));
      for (let i = 0; i < words.length - 1; i += 1) {
        add('people', hash(`${words[i].word} ${words[i + 1].word}`), words[i].index);
        if (i + 2 < words.length) add('people', hash(`${words[i].word} ${words[i + 1].word} ${words[i + 2].word}`), words[i].index);
      }
    }
    if (list.addresses?.size) {
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
        const address = m[0].toLowerCase();
        if (roleSet.has(address)) continue;
        const whole = hash(address);
        add('addresses', list.addresses.has(whole) ? whole : hash(address.slice(address.indexOf('@') + 1)), m.index);
      }
    }
    return [...found.values()].sort((a, b) => a.line - b.line || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  };
}

// ---------- what is already known ----------

// Reads known.json: { roles, findings } where roles are the role addresses that are never findings
// and findings the accepted ones, each { repository?, path, kind, hash }. Throws, saying
// KNOWN_REFUSAL and naming a bad entry by place, otherwise.
export function loadKnown(file) {
  const refuse = (why) => { throw new Error(`${KNOWN_REFUSAL}: ${why}`); };
  let known;
  try { known = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { refuse(`could not read ${file} as JSON (${e.code ?? 'not JSON'})`); }
  if (known === null || typeof known !== 'object' || Array.isArray(known)) refuse(`${file} is not an object holding findings`);
  const bad = [];
  const roles = known['role-addresses'] ?? [];
  if (!Array.isArray(roles)) bad.push('role-addresses is not a list');
  else roles.forEach((r, i) => { if (typeof r !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(r)) bad.push(`role-addresses[${i}] is not an address`); });
  const findings = known.findings ?? [];
  if (!Array.isArray(findings)) bad.push('findings is not a list');
  else findings.forEach((f, i) => {
    if (f === null || typeof f !== 'object') { bad.push(`findings[${i}] is not an object`); return; }
    if (typeof f.path !== 'string' || !f.path) bad.push(`findings[${i}] names no path`);
    if (!KINDS.includes(f.kind)) bad.push(`findings[${i}] names no kind of ${KINDS.join(', ')}`);
    if (typeof f.hash !== 'string' || !HASH.test(f.hash)) bad.push(`findings[${i}] holds no 64-character hex hash`);
    if (f.repository !== undefined && typeof f.repository !== 'string') bad.push(`findings[${i}] names no repository`);
  });
  if (bad.length) refuse(`${file}: ${bad.join('; ')}`);
  return { roles: Array.isArray(roles) ? roles : [], findings };
}

// Splits findings into { fresh, known }: a finding is known when an entry of known.json names its
// path, kind and hash, and either names this repository or none.
export function classify(findings, known, repository) {
  const accepted = new Set(known.findings.filter((k) => k.repository === undefined || k.repository === repository).map((k) => `${k.path}\n${k.kind}\n${k.hash}`));
  const fresh = [];
  const old = [];
  for (const f of findings) (accepted.has(`${f.path}\n${f.kind}\n${f.hash}`) ? old : fresh).push(f);
  return { fresh, known: old };
}

// ---------- refs ----------

// Reads each ref through `serve(ref)`, which returns its files as [{ path, texts | text, blob? }] or null,
// or throws. A read ref is { ref, state: 'read', findings, found }; a ref it could not serve is
// { ref, state: 'unknown', findings: null, why }. Files with the same blob id are matched once.
export async function readRefs(refs, serve, match) {
  const out = [];
  const byBlob = new Map();
  for (const ref of refs) {
    let files;
    try { files = await serve(ref); } catch (e) { out.push({ ref, state: 'unknown', findings: null, why: e.message || 'the fetch failed' }); continue; }
    if (!Array.isArray(files)) { out.push({ ref, state: 'unknown', findings: null, why: 'the fetch served nothing' }); continue; }
    const found = [];
    for (const f of files) {
      let hits = f.blob ? byBlob.get(f.blob) : undefined;
      if (!hits) {
        hits = matchTexts(match, f.texts ?? [f.text], f.path).map(({ line, kind, hash }) => ({ line, kind, hash }));
        if (f.blob) byBlob.set(f.blob, hits);
      }
      for (const h of hits) found.push({ path: f.path, ...h });
    }
    out.push({ ref, state: 'read', findings: found.length, found });
  }
  return out;
}

const git = (root, args, input) => {
  // Text answers are read as UTF-8; a blob batch (asked with input) stays bytes.
  const r = spawnSync('git', args, { cwd: root, input, ...(input === undefined ? { encoding: 'utf8' } : {}), maxBuffer: 1 << 30 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(String(r.stderr).trim().split('\n').pop() || `git ${args[0]} failed`);
  return r.stdout;
};
const SERVED = /^refs\/(?:heads|tags|pull)\//;
const LOCAL = 'refs/leak-check/';

// The refs `remote` serves, fetched at their tips under refs/leak-check/: { refs, serve } for
// readRefs. Throws when the remote cannot be listed. A ref the fetch did not bring is unknown.
export function remoteRefs(root, remote) {
  const refs = git(root, ['ls-remote', remote]).split('\n').map((l) => l.split('\t')[1]).filter((r) => r && SERVED.test(r) && !r.endsWith('^{}'));
  let fetchError = null;
  if (refs.length) {
    try {
      git(root, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--depth=1', remote,
        `+refs/heads/*:${LOCAL}heads/*`, `+refs/tags/*:${LOCAL}tags/*`, `+refs/pull/*:${LOCAL}pull/*`]);
    } catch (e) { fetchError = e.message; }
  }
  const texts = new Map();
  const serve = (ref) => {
    if (fetchError) throw new Error(`the fetch failed: ${fetchError}`);
    let tree;
    try { tree = git(root, ['ls-tree', '-r', '-z', `${LOCAL}${ref.slice('refs/'.length)}^{tree}`]); } catch { throw new Error('the fetch did not bring it'); }
    const blobs = tree.split('\0').filter(Boolean).map((e) => {
      const [meta, p] = e.split('\t');
      const [, type, blob] = meta.split(' ');
      return { type, blob, path: p };
    }).filter((e) => e.type === 'blob');
    const wanted = [...new Set(blobs.map((b) => b.blob).filter((b) => !texts.has(b)))];
    if (wanted.length) {
      const out = git(root, ['cat-file', '--batch'], `${wanted.join('\n')}\n`);
      let at = 0;
      while (at < out.length) {
        const nl = out.indexOf(10, at);
        const [blob, , size] = out.subarray(at, nl).toString().split(' ');
        const n = Number(size);
        texts.set(blob, decodings(out.subarray(nl + 1, nl + 1 + n)).texts);
        at = nl + 1 + n + 1;
      }
    }
    return blobs.map((b) => ({ path: b.path, blob: b.blob, texts: texts.get(b.blob) }));
  };
  return { refs, serve };
}

// ---------- the reading ----------

// The one notice a run records: its counts, and what it could not read when there is any.
// refs is null when the remote could not be listed at all.
export function notice({ files, fresh, known, refs }) {
  const head = `files: ${files.read.length} read, ${fresh.length} new findings, ${known.length} known`;
  if (refs === null) return `${head}; refs: unknown, the remote could not be listed; not read: ${files.unread.length} files`;
  const read = refs.filter((r) => r.state === 'read');
  const onPulls = read.filter((r) => r.ref.startsWith('refs/pull/')).reduce((n, r) => n + r.findings, 0);
  const onBranches = read.filter((r) => !r.ref.startsWith('refs/pull/')).reduce((n, r) => n + r.findings, 0);
  const unknown = refs.length - read.length;
  const tail = files.unread.length || unknown ? `; not read: ${files.unread.length} files, ${unknown} refs` : '';
  return `${head}; refs: ${read.length} read, ${onBranches} findings on branches and tags, ${onPulls} on pull request refs${tail}`;
}

// A workflow command's property or message, escaped as GitHub reads them.
const data = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = (s) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const said = (f) => `${WHAT[f.kind]} (one-way hash ${f.hash})`;

// What a run prints and exits with: { code, lines }. main prints these lines and returns this code,
// and nothing else decides it. A new finding in the files, or a file it could not open, exits 1;
// findings on refs and refs it could not read are named and counted but refuse nothing. Every path
// and ref is escaped as a workflow command's message, so a name holding a line break cannot start
// a command of its own in the log.
export function verdict({ files, fresh, known, refs }) {
  const lines = [];
  for (const f of fresh) lines.push(`::error file=${prop(f.path)},line=${f.line},title=Leak finding::${data(`${said(f)}, not in known.json`)}`);
  for (const f of known) lines.push(`known: ${data(f.path)}:${f.line} ${said(f)}`);
  for (const f of files.read) if (f.bytes) lines.push(`read as bytes: ${data(f.path)} (not UTF-8 text; matched as UTF-8, Latin-1 and UTF-16)`);
  for (const u of files.unread) lines.push(`could not read ${data(u.path)}: ${data(u.why)}`);
  for (const r of refs ?? []) {
    if (r.state !== 'read') { lines.push(`could not read ${data(r.ref)}: ${data(r.why)}`); continue; }
    for (const f of r.found) lines.push(`${data(r.ref)}: ${data(f.path)}:${f.line} ${said(f)}`);
  }
  lines.push(`::notice title=Leak check::${data(notice({ files, fresh, known, refs }))}`);
  return { code: fresh.length || files.unread.length ? 1 : 0, lines };
}

async function main(argv) {
  const args = [...argv];
  const opt = { root: process.cwd(), owner: 'dazzer-io', repository: '' };
  const paths = [];
  while (args.length) {
    const a = args.shift();
    if (['--hashes', '--known', '--repository', '--owner', '--root', '--refs'].includes(a)) opt[a.slice(2)] = args.shift();
    else paths.push(a);
  }
  let list;
  let known = { roles: [], findings: [] };
  try {
    list = loadList(opt.hashes ?? '(no --hashes given)');
    if (opt.known !== undefined) known = loadKnown(opt.known);
  } catch (e) { console.error(data(e.message)); return 1; }

  let tracked = paths;
  if (!tracked.length) {
    try { tracked = git(opt.root, ['ls-files', '-z']).split('\0').filter(Boolean); } catch (e) { console.error(data(`could not list the files git tracks under ${opt.root}: ${e.message}`)); return 1; }
  }
  const match = matcher(list, { roles: known.roles, owner: opt.owner });
  const files = readFiles(opt.root, tracked);
  const split = classify(files.read.flatMap((f) => matchTexts(match, f.texts, f.path)), known, opt.repository);

  let refs = [];
  if (opt.refs !== undefined) {
    try {
      const remote = remoteRefs(opt.root, opt.refs);
      refs = await readRefs(remote.refs, remote.serve, match);
    } catch (e) {
      console.log(`::warning title=Leak check not read::${data(`could not read the refs of ${opt.refs}: ${e.message}`)}`);
      console.log(data(`could not read the refs of ${opt.refs}: ${e.message}`));
      refs = null;
    }
  }

  const { code, lines } = verdict({ files, fresh: split.fresh, known: split.known, refs });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
