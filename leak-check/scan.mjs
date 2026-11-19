// The leak scanner: it reads every file git tracks and the tip of every branch, tag and pull
// request ref a remote serves, matches the names the one-way hash list holds (hashes.mjs) in file
// contents, in file and folder names and in ref names, refuses a finding in the tracked files or
// their names that known.json does not accept, and records its counts as one notice titled
// "Leak check". Text is normalised before matching (format characters removed, NFKC), so a name
// split by an invisible character or written in fullwidth or decomposed letters is still found. A
// file that is not UTF-8 text (UTF-16, a stray Windows-1252 byte, a NUL) is read as bytes, matched
// in every decoding that could show a name, and named; a file it could not open is named and
// counted unread, and refuses the run; a run that read no file refuses as "read nothing"; a ref the
// fetch could not serve is unknown with its name, never zero findings; and with no one-way hash
// list it stops before reading anything. No output repeats a name it found: a finding is told by
// file, line, kind and the one-way hash it matched, and a path or ref holding a name is printed
// with that segment "[hidden]".
//
// From the command line:
//   node leak-check/scan.mjs --hashes <hashes.json> [--known <known.json>] [--repository <owner/name>]
//                            [--owner <owner>] [--root <folder>] [--refs <remote>] [<file>...]
// With no files named it reads every file git tracks under --root. It exits 1 on a refused hash
// list or known-findings list, on a new finding in the files or their names, on a file it could
// not open, or when it read no file (verdict decides both what it prints and its exit); findings
// on refs, which a change cannot remove, are counted and named but refuse nothing. Without --refs
// the notice says the refs were not read.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KINDS, loadList, normalise, oneWay, spaced } from './hashes.mjs';

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

// Text is matched in two readings (hashes.mjs): normalise, format characters removed, and spaced,
// format characters turned into spaces; both apply NFKC.
export { normalise, spaced };

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
const HOST = /(?<![A-Za-z0-9._%+@-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?![A-Za-z0-9@-]|\.[A-Za-z0-9])/g;
// A host and each parent domain of it holding at least one dot: cdn.eu.example.org, eu.example.org, example.org.
const parents = (host) => { const l = host.split('.'); return l.slice(0, -1).map((_, i) => l.slice(i).join('.')); };

// A matcher over the loaded list (hashes.loadList): match(text, path) gives the findings in text as
// [{ path, line, kind, hash }], one per line, kind and hash. A private repository is matched as
// <owner>/<name>, or alone when its name holds a hyphen (so a name that is also a word is matched
// only beside its owner); a person as two or three words in a row, in any case and across a line
// break; an address whole or by its domain, unless it is one of the role addresses, and a listed
// domain wherever it stands as a hostname (in a URL, bare, or as a subdomain's parent).
// match.names(path) gives the findings in a path's file and folder names, or a ref's name: the
// whole path and each of its segments, a segment also with its - _ . read as spaces, as
// [{ path, line: 0, kind, hash, in: 'name' }].
// match.hide(path) gives the path to print: each segment a private name touches is "[hidden]".
export function matcher(list, { roles = [], owner = 'dazzer-io' } = {}) {
  const salt = list.salt ?? '';
  const roleSet = new Set(roles.map((r) => r.trim().toLowerCase()));
  const hashOf = new Map();
  const hash = (s) => { let h = hashOf.get(s); if (h === undefined) { h = oneWay(s, salt); hashOf.set(s, h); } return h; };
  const ownerAt = new RegExp(`(?<![\\w.-])${escape(owner)}/([A-Za-z0-9._-]+)`, 'gi');
  // Every hit in normalised text, as { kind, hash, start, end }.
  const hits = (text) => {
    const out = [];
    const add = (kind, h, start, end) => { if (list[kind]?.has(h)) out.push({ kind, hash: h, start, end }); };
    if (list.repositories?.size) {
      for (const m of text.matchAll(ownerAt)) add('repositories', hash(m[1].replace(/\.git$/i, '').replace(/\.+$/, '')), m.index, m.index + m[0].length);
      for (const m of text.matchAll(/[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+/g)) {
        const parts = m[0].split('-');
        let from = m.index;
        for (let i = 0; i < parts.length - 1; i += 1) {
          for (let j = i + 2; j <= Math.min(parts.length, i + MAX_PARTS); j += 1) {
            const name = parts.slice(i, j).join('-');
            add('repositories', hash(name), from, from + name.length);
          }
          from += parts[i].length + 1;
        }
      }
    }
    if (list.people?.size) {
      const words = [...text.matchAll(/\p{L}[\p{L}\p{M}'’-]*/gu)].map((m) => ({ word: m[0].replace(/['’]s$/i, '').replace(/[-'’]+$/, ''), index: m.index, end: m.index + m[0].length }));
      for (let i = 0; i < words.length - 1; i += 1) {
        add('people', hash(`${words[i].word} ${words[i + 1].word}`), words[i].index, words[i + 1].end);
        if (i + 2 < words.length) add('people', hash(`${words[i].word} ${words[i + 1].word} ${words[i + 2].word}`), words[i].index, words[i + 2].end);
      }
    }
    if (list.addresses?.size) {
      const byDomain = (host, start, end) => {
        const h = parents(host.toLowerCase()).map(hash).find((x) => list.addresses.has(x));
        if (h) add('addresses', h, start, end);
      };
      for (const m of text.matchAll(EMAIL)) {
        const address = m[0].toLowerCase();
        if (roleSet.has(address)) continue;
        const whole = hash(address);
        if (list.addresses.has(whole)) add('addresses', whole, m.index, m.index + m[0].length);
        else byDomain(m[1], m.index, m.index + m[0].length);
      }
      for (const m of text.matchAll(HOST)) byDomain(m[0], m.index, m.index + m[0].length);
    }
    return out;
  };
  const match = (raw, filePath) => {
    const found = new Map();
    for (const text of new Set([normalise(raw), spaced(raw)])) {
      const starts = lineStarts(text);
      for (const h of hits(text)) {
        const line = lineAt(starts, h.start);
        const key = `${line}:${h.kind}:${h.hash}`;
        if (!found.has(key)) found.set(key, { path: filePath, line, kind: h.kind, hash: h.hash });
      }
    }
    return [...found.values()].sort((a, b) => a.line - b.line || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  };
  // The hits in a path and in each of its segments, with each segment they touch.
  const readingHits = (text) => {
    const segs = [];
    let at = 0;
    for (const seg of text.split('/')) { segs.push({ seg, start: at, end: at + seg.length }); at += seg.length + 1; }
    // Each segment is read as written and with its - _ . read as spaces, so Jo-Doe.md is Jo Doe.
    const inSeg = (s, seg) => hits(seg).map((h) => ({ ...h, start: h.start + s.start, end: h.end + s.start }));
    const all = [...hits(text), ...segs.flatMap((s) => [...inSeg(s, s.seg), ...inSeg(s, s.seg.replace(/[-_.]/g, ' '))])];
    return { segs, all };
  };
  // Both readings of a path: every hit, the segments as normalise leaves them, and the index of
  // each segment a hit touches in either reading (both readings hold the same segments).
  const pathHits = (p) => {
    const readings = [...new Set([normalise(p), spaced(p)])].map(readingHits);
    const touched = new Set();
    for (const r of readings) r.segs.forEach((s, i) => { if (r.all.some((h) => h.start < s.end && h.end > s.start)) touched.add(i); });
    return { segs: readings[0].segs, all: readings.flatMap((r) => r.all), touched };
  };
  match.names = (p) => {
    const found = new Map();
    for (const h of pathHits(p).all) if (!found.has(`${h.kind}:${h.hash}`)) found.set(`${h.kind}:${h.hash}`, { path: p, line: 0, kind: h.kind, hash: h.hash, in: 'name' });
    return [...found.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  };
  match.hide = (p) => {
    const { segs, touched } = pathHits(p);
    if (!touched.size) return p;
    return segs.map((s, i) => (touched.has(i) ? '[hidden]' : s.seg)).join('/');
  };
  return match;
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
    if (f.in !== undefined && f.in !== 'name') bad.push(`findings[${i}] is in something other than "name"`);
  });
  if (bad.length) refuse(`${file}: ${bad.join('; ')}`);
  return { roles: Array.isArray(roles) ? roles : [], findings };
}

// Splits findings into { fresh, known }: a finding is known when an entry of known.json names its
// path, kind and hash, and either names this repository or none. A finding in a file or folder
// name is accepted only by an entry saying "in": "name".
export function classify(findings, known, repository) {
  const accepted = new Set(known.findings.filter((k) => k.repository === undefined || k.repository === repository).map((k) => `${k.path}\n${k.kind}\n${k.hash}\n${k.in ?? ''}`));
  const fresh = [];
  const old = [];
  for (const f of findings) (accepted.has(`${f.path}\n${f.kind}\n${f.hash}\n${f.in ?? ''}`) ? old : fresh).push(f);
  return { fresh, known: old };
}

// ---------- refs ----------

// Reads each ref through `serve(ref)`, which returns its files as [{ path, texts | text, blob? }] or null,
// or throws. A read ref is { ref, state: 'read', findings, found }; a ref it could not serve is
// { ref, state: 'unknown', findings: null, why, named }, and so is a ref holding a file with no text
// (a missing object), never read clean. Files with the same blob id are matched once.
// The ref's own name is matched (a finding { path: null, in: 'ref name' }), and so is every file
// and folder name in its tree (in: 'name').
export async function readRefs(refs, serve, match) {
  const out = [];
  const byBlob = new Map();
  for (const ref of refs) {
    const named = (match.names?.(ref) ?? []).map(({ kind, hash }) => ({ path: null, line: 0, kind, hash, in: 'ref name' }));
    let files;
    try { files = await serve(ref); } catch (e) { out.push({ ref, state: 'unknown', findings: null, why: e.message || 'the fetch failed', named }); continue; }
    if (!Array.isArray(files)) { out.push({ ref, state: 'unknown', findings: null, why: 'the fetch served nothing', named }); continue; }
    const blind = files.filter((f) => !Array.isArray(f.texts) && typeof f.text !== 'string').length;
    if (blind) { out.push({ ref, state: 'unknown', findings: null, why: `${blind} of its ${files.length} files gave no text to read`, named }); continue; }
    const found = [...named];
    const paths = new Set();
    for (const f of files) {
      let hits = f.blob ? byBlob.get(f.blob) : undefined;
      if (!hits) {
        hits = matchTexts(match, f.texts ?? [f.text], f.path).map(({ line, kind, hash }) => ({ line, kind, hash }));
        if (f.blob) byBlob.set(f.blob, hits);
      }
      for (const h of hits) found.push({ path: f.path, ...h });
      paths.add(f.path);
    }
    for (const p of paths) found.push(...(match.names?.(p) ?? []));
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

// Reads the reply of git cat-file --batch: a Map of each object id to its texts (decodings), or
// null for an object git answered "missing" or with no size it could read; reading goes on past it.
export function readBatch(out) {
  const texts = new Map();
  let at = 0;
  while (at < out.length) {
    let nl = out.indexOf(10, at);
    if (nl === -1) nl = out.length;
    const [blob, type, size] = out.subarray(at, nl).toString().split(' ');
    const n = Number(size);
    if (type === 'missing' || !Number.isInteger(n) || n < 0 || nl + 1 + n > out.length) { if (blob) texts.set(blob, null); at = nl + 1; continue; }
    texts.set(blob, decodings(out.subarray(nl + 1, nl + 1 + n)).texts);
    at = nl + 1 + n + 1;
  }
  return texts;
}

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
    if (wanted.length) for (const [blob, t] of readBatch(git(root, ['cat-file', '--batch'], `${wanted.join('\n')}\n`))) texts.set(blob, t);
    return blobs.map((b) => ({ path: b.path, blob: b.blob, texts: texts.get(b.blob) ?? null }));
  };
  return { refs, serve };
}

// ---------- the reading ----------

// The one notice a run records: its counts, and what it could not read when there is any.
// refs is null when the remote could not be listed at all, and undefined when no remote was named.
export function notice({ files, fresh, known, refs }) {
  const head = files.read.length
    ? `files: ${files.read.length} read, ${fresh.length} new findings, ${known.length} known`
    : `files: read nothing, ${fresh.length} new findings, ${known.length} known`;
  if (refs === undefined) return `${head}; refs: not read, no remote was named${files.unread.length ? `; not read: ${files.unread.length} files` : ''}`;
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
// and nothing else decides it. A new finding in the files or their names, a file it could not
// open, or a run that read no file at all exits 1; findings on refs and refs it could not read are
// named and counted but refuse nothing. Every path and ref is printed through hide, so a private
// name in it is not repeated, and escaped as a workflow command's message, so a name holding a line
// break cannot start a command of its own in the log.
export function verdict({ files, fresh, known, refs, hide = (p) => p }) {
  const lines = [];
  const where = (f) => (f.in === 'name' ? `${data(hide(f.path))} (file or folder name)` : `${data(hide(f.path))}:${f.line}`);
  for (const f of fresh) {
    const shown = hide(f.path);
    const at = f.in === 'name' || shown !== f.path ? '' : `file=${prop(f.path)},line=${f.line},`;
    const what = f.in === 'name' ? `${shown}: ${said(f)} in its file or folder name` : shown !== f.path ? `${shown}:${f.line}: ${said(f)}` : said(f);
    lines.push(`::error ${at}title=Leak finding::${data(`${what}, not in known.json`)}`);
  }
  for (const f of known) lines.push(`known: ${where(f)} ${said(f)}`);
  for (const f of files.read) if (f.bytes) lines.push(`read as bytes: ${data(hide(f.path))} (not UTF-8 text; matched as UTF-8, Latin-1 and UTF-16)`);
  for (const u of files.unread) lines.push(`could not read ${data(hide(u.path))}: ${data(hide(u.why))}`);
  if (!files.read.length) lines.push('read nothing: no tracked file was read, so this run cannot say the files are clean');
  for (const r of refs ?? []) {
    const ref = data(hide(r.ref));
    if (r.state !== 'read') {
      for (const f of r.named ?? []) lines.push(`${ref}: ref name ${said(f)}`);
      lines.push(`could not read ${ref}: ${data(hide(r.why))}`);
      continue;
    }
    for (const f of r.found) lines.push(`${ref}: ${f.in === 'ref name' ? 'ref name' : where(f)} ${said(f)}`);
  }
  lines.push(`::notice title=Leak check::${data(notice({ files, fresh, known, refs }))}`);
  return { code: fresh.length || files.unread.length || !files.read.length ? 1 : 0, lines };
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
    try { tracked = git(opt.root, ['ls-files', '-z']).split('\0').filter(Boolean); } catch { console.error('could not list the files git tracks under the folder --root names (git ls-files failed)'); return 1; }
  }
  const match = matcher(list, { roles: known.roles, owner: opt.owner });
  const files = readFiles(opt.root, tracked);
  const findings = [
    ...files.read.flatMap((f) => matchTexts(match, f.texts, f.path)),
    ...tracked.flatMap((p) => match.names(p)),
  ];
  const split = classify(findings, known, opt.repository);

  let refs;
  if (opt.refs !== undefined) {
    try {
      const remote = remoteRefs(opt.root, opt.refs);
      refs = await readRefs(remote.refs, remote.serve, match);
    } catch (e) {
      console.log(`::warning title=Leak check not read::${data(`could not read the refs of ${opt.refs}: ${match.hide(e.message)}`)}`);
      console.log(data(`could not read the refs of ${opt.refs}: ${match.hide(e.message)}`));
      refs = null;
    }
  }

  const { code, lines } = verdict({ files, fresh: split.fresh, known: split.known, refs, hide: match.hide });
  for (const line of lines) console.log(line);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
