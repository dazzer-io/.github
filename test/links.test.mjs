// Every relative link in a tracked Markdown document points at a tracked file or folder, so a
// newcomer reading a public page never meets a dead link. It reads git's own list of tracked
// files (git ls-files), so a file that exists only on one machine does not count.
//
// Read: inline links and images [text](target), reference definitions [name]: target, and HTML
// href="..." and src="..." attributes, outside fenced code blocks and inline code. Skipped: a
// target with a scheme (http:, https:, mailto: and any other) and a pure #anchor. A #fragment or
// ?query is cut before checking. A target is read from the document's own folder; one starting
// with / is read from the repository's top, as GitHub reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILS = 'a relative link points at no tracked file';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  .split('\0').filter(Boolean);

// Strip fenced code blocks and inline code spans; keep line numbers.
function prose(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return '';
    }
    if (m) { fence = m[1]; return ''; }
    return line.replace(/(`+)[\s\S]*?\1/g, '');
  });
}

function targets(text) {
  const found = [];
  prose(text).forEach((line, i) => {
    const push = (raw) => found.push({ line: i + 1, raw: raw.trim() });
    for (const m of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) push(m[1]);
    const def = line.match(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/);
    if (def) push(def[1]);
    for (const m of line.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) push(m[1] ?? m[2]);
  });
  return found;
}

function deadLinks() {
  const tracked = new Set(git('ls-files', '-z'));
  const folders = new Set();
  for (const f of tracked) for (let d = path.posix.dirname(f); d !== '.'; d = path.posix.dirname(d)) folders.add(d);
  const dead = [];
  for (const doc of git('ls-files', '-z', '*.md')) {
    const file = path.join(root, doc);
    if (!fs.existsSync(file)) continue; // deleted in the working tree; git will say so
    for (const { line, raw } of targets(fs.readFileSync(file, 'utf8'))) {
      let target = raw.replace(/^<|>$/g, '');
      if (target === '' || target.startsWith('#')) continue;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('//')) continue;
      target = target.replace(/[#?].*$/, '');
      try { target = decodeURIComponent(target); } catch { /* keep it as written */ }
      const resolved = target.startsWith('/')
        ? path.posix.normalize(target.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(doc), target));
      const clean = resolved.replace(/\/+$/, '');
      const ok = clean === '' || clean === '.' || tracked.has(clean) || folders.has(clean);
      if (!ok) dead.push(`${doc}:${line} -> ${raw}`);
    }
  }
  return dead;
}

test('every relative link in a tracked Markdown document points at a tracked file', () => {
  const dead = deadLinks();
  assert.deepEqual(dead, [], `${FAILS}:\n  ${dead.join('\n  ')}`);
});

test('the reader finds the links it is meant to check', () => {
  const t = targets([
    'See [a](a.md) and ![b](img/b.png "title") and [c](<c d.md>).',
    '[ref]: ./e.md#part',
    '<a href="f.md">f</a>',
    '`[not](code.md)`',
    '```',
    '[not](fenced.md)',
    '```',
  ].join('\n')).map((x) => x.raw);
  assert.deepEqual(t, ['a.md', 'img/b.png', '<c d.md>', './e.md#part', 'f.md'],
    `the link reader misses links, so ${FAILS} could go unseen`);
});
