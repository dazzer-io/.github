// The leak scanner's reading: what it read, and what it could not. A file it cannot read as text
// is named and counted unread, never clean; a ref the fetch could not serve is unknown with its
// name, never zero findings; and with no one-way hash list (hashes.mjs) it stops before reading
// anything. Matching names against the list is passed in as `match(text)`, returning findings.
//
// From the command line:
//   node leak-check/scan.mjs --hashes <hashes.json> [--root <folder>] <file>...
// exits 1 on a refused hash list or anything unread, and prints what it read and could not.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHashes } from './hashes.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });

// Text of `bytes`, or null when they are not UTF-8 text (a stray byte or a NUL marks a binary file).
export function asText(bytes) {
  if (bytes.includes(0)) return null;
  try { return decoder.decode(bytes); } catch { return null; }
}

// Reads each path under `root`: { read: [{ path, text }], unread: [{ path, why }] }.
export function readFiles(root, paths) {
  const read = [];
  const unread = [];
  for (const p of paths) {
    let bytes;
    try { bytes = readFileSync(path.join(root, p)); } catch (e) { unread.push({ path: p, why: `could not open it (${e.code ?? e.message})` }); continue; }
    const text = asText(bytes);
    if (text === null) unread.push({ path: p, why: 'not text' });
    else read.push({ path: p, text });
  }
  return { read, unread };
}

// Reads each ref through `serve(ref)`, which returns its files as [{ path, text }] or null, or
// throws. A ref it could not serve is { ref, state: 'unknown', findings: null, why }.
export async function readRefs(refs, serve, match) {
  const out = [];
  for (const ref of refs) {
    let files;
    try { files = await serve(ref); } catch (e) { out.push({ ref, state: 'unknown', findings: null, why: e.message || 'the fetch failed' }); continue; }
    if (!Array.isArray(files)) { out.push({ ref, state: 'unknown', findings: null, why: 'the fetch served nothing' }); continue; }
    const findings = files.reduce((n, f) => n + match(f.text, f.path).length, 0);
    out.push({ ref, state: 'read', findings });
  }
  return out;
}

// Whether a run read everything and found nothing, and the lines that say so or say what is missing.
export function verdict({ files, refs }) {
  const unknown = refs.filter((r) => r.state !== 'read');
  const findings = refs.reduce((n, r) => n + (r.state === 'read' ? r.findings : 0), 0);
  const lines = [`files: ${files.read.length} read, ${files.unread.length} unread; refs: ${refs.length - unknown.length} read, ${unknown.length} unknown, ${findings} findings`];
  for (const u of files.unread) lines.push(`could not read ${u.path}: ${u.why}`);
  for (const r of unknown) lines.push(`could not read ${r.ref}: ${r.why}`);
  return { clean: !files.unread.length && !unknown.length && !findings, lines };
}

function main(argv) {
  const args = [...argv];
  let hashesFile = null;
  let root = process.cwd();
  const paths = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--hashes') hashesFile = args.shift();
    else if (a === '--root') root = args.shift();
    else paths.push(a);
  }
  try { loadHashes(hashesFile ?? '(no --hashes given)'); } catch (e) { console.error(e.message); return 1; }
  const v = verdict({ files: readFiles(root, paths), refs: [] });
  for (const l of v.lines) console.log(l);
  return v.clean ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
