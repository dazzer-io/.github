// Every job of every workflow here names its machine by what it holds and the workflow it sits in,
// never by the job's name:
//
//   - A WRITE TOKEN. A job granted any write by its workflow's `permissions:` or its own (any
//     access other than read or none, or `write-all`), or whose workflow and job write no
//     `permissions:` key at all (the repository's default token, which may be read-write), runs
//     on one of GitHub's standard machines written as a literal label, and reads no CHECKS_,
//     SCAN_ or LOCKED_ setting anywhere in the job or the workflow's top. This holds whatever
//     starts the workflow, pull_request, workflow_call, workflow_run, a push or anything else.
//     That is this repository's own stricter rule, built on decision 36's reason: decision 36 of
//     the checks-on-google job holds pull_request jobs with a write token to GitHub's machines,
//     because on a machine of ours that token is within reach of whatever ran there before it,
//     and that reason does not depend on the trigger. Decision 36 itself still reads only
//     pull_request, and decision 47 (a push-started job elsewhere on the change-check machines)
//     stands; here the rule is wider. A workflow's grant counts even where the job's own
//     permissions would replace it, so the reading errs toward GitHub's machines.
//     engineer-review.yml is such a job (statuses: write).
//   - THE SCANS. Every other job of the two scan workflows reads exactly
//     ${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}, the scan machines (decision 93), and reads no
//     secret, declared or used, in the job or the workflow's top: no line there holds the word
//     secrets, in any case, so a secrets. or secrets[ read, the whole context (toJSON(secrets)),
//     a secrets: key and `secrets: inherit` are all refused, and so is a run script or a comment
//     line inside a | or > block holding the word, since GitHub evaluates an expression on any
//     line of a block, one starting with # included; this errs toward refusal. The two are
//     .github/workflows/security-scan.yml, the file the organisation ruleset
//     security-scan-required runs on every gated repository, and .github/workflows/codeql.yml,
//     the shared CodeQL scan every repository calls (decisions 118 and 119;
//     test/codeql-shared.test.mjs pins what it scans). codeql.yml holds one other job: its final
//     check (decision 135), granted no token at all (permissions: {}), on one of GitHub's
//     standard machines written as a literal label, calling no workflow and reading no CHECKS_,
//     SCAN_ or LOCKED_ setting; a second such job in it is refused. The scan machines hold no
//     change's own code only while the scan runner group admits only the scan workflows
//     (decision 98): a workflow lives in the repository it checks, so a pull request in a
//     repository the group admits can add a workflow of its own naming the scan label, and only
//     the group's workflow list keeps it off. This test cannot see that list.
//   - EVERY OTHER JOB, in any workflow but the two scans, runs on one of GitHub's standard
//     machines written as a literal label and reads no CHECKS_, SCAN_ or LOCKED_ setting anywhere
//     in the job or the workflow's top, whatever it holds (decision 104). The fallback watcher,
//     which sends a job waiting on our machines back to GitHub's, does not read this repository's
//     runs, and CHECKS_RUNNER_2 is visible to every repository, so a job here reading it would sit
//     on the change-check machines with nothing to send it back if they stalled. This changes
//     once the watcher reads .github's runs: such a job may then read
//     ${{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}, as the other repositories' checks do.
// The scan setting empty sends the scan's jobs back to GitHub's computers, which is how the
// fallback watcher keeps the scan from ever waiting on our machines. Decision 98 has r-1.54 write
// that setting visible only to the repositories the watcher reads, so that elsewhere, here among
// them, the scan stays on GitHub's computers; until then nothing here keeps .github's own scan off
// the scan machines once the setting is filled. This test cannot see who the setting is visible to.
// A job that calls a reusable workflow (`uses:` at the job's level) has no machine of its own, so
// its machine line is not read. Wherever it sits, the scans included, it may call only a workflow
// of this folder (`./`), written on the uses: line, judged in its own file by the same rules, which
// take only a literal GitHub label outside the scans. A workflow outside the two scans may not call
// either scan workflow (./.github/workflows/codeql.yml or security-scan.yml), since the called
// scan's analysis reads SCAN_RUNNER_2, and only the scans' own jobs run on the scan machines. A
// workflow in another repository, this one at another commit, or a call written as a | or > block,
// is not read here, and is refused by the rule its calling job is held by: a
// write-token job's, since its jobs could hold that token on machines of ours (decision 36's
// reason); a job's outside the scan, since its jobs could wait on machines of ours that the watcher
// would never send back (decision 104); and a read-only scan job's, since its jobs could put part
// of the scan beside a change's own code (decision 93). A write-token calling job, and every
// calling job outside the scans, is also held to its file's setting rule, its `with:` included; a
// read-only calling job of a scan is held to the scans' secret rule and nothing more, since the
// `./` workflow it calls names its own machines.
//
// GitHub's standard machines are the labels dazzer's check-runner-setting gate takes for them
// (GITHUB_STANDARD_CORES in its scripts/checks/check-test-width-matches-the-machine.mjs):
// ubuntu-latest, ubuntu-24.04 and ubuntu-22.04.
//
// THE READER. This repository has no YAML package and adds none (decision 99), so a workflow is
// read only if it is written in a closed plain subset of YAML, and any line outside it is refused
// with its line number and the plain spelling to use. Before anything else is read:
//   - the file holds no U+2028, U+2029 or byte-order mark, and no control character (C0, DEL or
//     C1, U+0085 among them) but the line feed, a carriage return directly before it, and the tab
//     inside a block's body (a tab elsewhere is refused by shape, below), so a line is exactly what
//     a line feed ends;
//   - every line is one of these shapes, and nothing else:
//       an empty line, or a comment (`# ...` after any spaces);
//       `---` as line 1 only;
//       a key line: spaces, a key, a colon, then nothing, a comment, or a value;
//       a list item: spaces, `- `, then a value, or a key, a colon and nothing, a comment or a
//         value, as a key line has;
//       a line of a block scalar's body;
//     where a key is a plain name matching ^[A-Za-z_][A-Za-z0-9_-]*$, bare or inside matching
//     quotes with no backslash; and a value, after one or more spaces, with an optional
//     ` # comment` after it, is one of:
//       plain: not starting with - ? : (each before a space), , [ ] { } # & * ! | > ' " % @ or
//         a backquote, and holding no `: ` and no closing `:`;
//       single-quoted, closed on its line ('' for a quote inside);
//       double-quoted with no backslash, closed on its line;
//       `{}`;
//       a flow list closed on its line, `[a, 'b', "c"]`, each item plain (none of , [ ] { } # :)
//         or quoted as above;
//       a block scalar header, `|` or `>` with an optional + or -, and no indentation digit;
//   - a block scalar's body is skipped by indentation as YAML does: the lines after its header
//     that are empty or indented at least as far as its first non-empty line, when that line is
//     indented more than the key (or, for `- |`, the dash) the header belongs to; a leading
//     empty line indented further than that first line is refused;
//   - a line indented more than a key or item that holds a value on its own line is refused,
//     since YAML would read it as more of that value;
//   - a tab outside a block scalar's body is refused; and so, by shape, are an anchor (`&a`), an
//     alias (`*a`) and a tag (`!t`) anywhere outside a quoted value or a block scalar's body, an
//     explicit key (`? k`), a merge key (`<<`), a flow mapping other than `{}`, a flow list not
//     closed on its line, a quoted value not closed on its line, an escaped key and a second
//     document.
// Then, inside that subset:
//   - top keys at column zero (a quoted `"on":` is read as on), `jobs:` among them; each job id two
//     spaces in, plain (`  <id>:` with nothing after it but a comment); each job key four spaces
//     in. At the top and at the job-key indent every line is a key, save `---` as line 1 and a
//     `- ` item directly under a key with nothing after it (a `- key: value` item is an item
//     there, never a key), and no key appears twice, in any case, nor a read key (on, jobs,
//     permissions, runs-on, uses) in another case;
//   - a key with nothing after it holds the more-indented lines below it (a list, a mapping);
//   - `on:` as one trigger, a flow list closed on its own line, or the keys or `- ` items of the
//     first indent below it (items at column zero too); the triggers are read only to be named,
//     since no rule turns on them;
//   - `permissions:` as one word (read-all, write-all), `{}`, or `<scope>: <access>` lines at the
//     first indent below it, quotes taken off both; an access is read only when it is exactly read
//     or none, so an empty value and any other word count as a write, as does any other spelling of
//     the whole permissions value; a line below the key that is not such a pair is refused;
//   - a setting is read where a line that is not a whole-line comment holds `vars.CHECKS_`,
//     `vars.SCAN_` or `vars.LOCKED_` (or `vars['...']`, in any case); a setting named by a value
//     worked out as the run goes (`vars[format(...)]`) is not seen;
//   - the expression is compared as written: another spacing, quotes around it, or another
//     fallback is another machine line, and refused;
//   - what it cannot read is refused rather than passed: no workflow file, no `jobs:` at column
//     zero or `jobs:` written on one line, a job id that is not plain, a workflow with no trigger
//     it can read, a line at the top or job-key indent at an odd indent, and a reading that found
//     no job at all.
// It does not run GitHub's own parser; a file another reader takes differently inside this
// subset would not be seen. The kept cases at the end hold each spelling a review found hiding a
// write token, each spelling round 2 planted, each case rounds 4, 5 and 6 added and each the
// shared scan's task (r-3.18) added, with controls that must pass; a refusal above with no kept
// case of its own is held only by its code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
// The scan workflows: the required security scan and the shared CodeQL scan.
const SCAN_WORKFLOWS = ['security-scan.yml', 'codeql.yml'];
const SCAN_NAMES = SCAN_WORKFLOWS.join(' and ');
const isScan = (wf) => SCAN_WORKFLOWS.includes(wf.file);
const CHECKS = "${{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}";
const SCAN = "${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}";
const GITHUB_STANDARD = ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04'];
const READ_ONLY = ['read', 'none'];
const READ_KEYS = ['on', 'jobs', 'permissions', 'runs-on', 'uses'];
const OUR_SETTING = /\bvars\s*(?:\.\s*|\[\s*['"])\s*(CHECKS|SCAN|LOCKED)_\w*/i;
// A secret, read (secrets. or secrets[, or the whole context, toJSON(secrets)) or declared (a
// secrets: key, `secrets: inherit` among them): any line holding the word secrets.
const A_SECRET = /\bsecrets\b/i;

const isComment = (line) => /^\s*(#.*)?$/.test(line);
const indentOf = (line) => line.match(/^ */)[0].length;
const isItem = (line) => /^\s*-(\s|$)/.test(line);

// THE SUBSET.
const NAME = '[A-Za-z_][A-Za-z0-9_-]*';
const KEY_LINE = new RegExp(`^(?:(${NAME})|'(${NAME})'|"(${NAME})"):(?= |$)(.*)$`);
const keyOf = (m) => m[1] ?? m[2] ?? m[3];
const SPELL = {
  key: 'write each key as a plain name of letters, digits, _ and -, bare or in quotes with no backslash, then a colon (permissions: read-all)',
  value: 'write a value plain, in single quotes, or in double quotes with no backslash, closed on its line, and a longer text as a | or > block',
  property: 'write the value out in full where it is used, with no anchor, alias or tag',
  flow: 'write a mapping as key: value lines below its key, and a list closed on its line or as - items below its key',
  block: 'write a block as | or > with at most a + or -, its body indented further than its key',
  break: 'end every line with a line feed alone, or a carriage return directly before it',
  tab: 'indent with spaces',
  document: 'write one document, with --- only as line 1',
  more: 'keep a value on its key\'s line, or write it as a | or > block',
};

// What a value after `key:` or `- ` is: { kind: 'none' | 'scalar' | 'flow' | 'block', text, items }
// or { bad, spell, text } for a value outside the subset.
function valueShape(rest) {
  const s = rest.replace(/^ +/, '');
  if (s === '' || s.startsWith('#')) return { kind: 'none', text: '' };
  const tail = (t) => /^( *| +#.*)$/.test(t);
  const bad = (why, spell = SPELL.value) => ({ bad: why, spell, text: s });
  if (s[0] === '|' || s[0] === '>') {
    return /^[|>][+-]?( *| +#.*)$/.test(s) ? { kind: 'block', text: s[0] } : bad('holds a block scalar header other than | or > with an optional + or -', SPELL.block);
  }
  const quoted = (t) => {
    if (t[0] === "'") {
      const m = t.match(/^'(?:[^']|'')*'/);
      return m ? { text: m[0] } : { bad: 'holds a single-quoted value not closed on its line' };
    }
    const m = t.match(/^"[^"\\]*"/);
    if (m) return { text: m[0] };
    return { bad: /^"[^"]*\\/.test(t) ? 'holds a double-quoted value with a backslash, an escape YAML decodes' : 'holds a double-quoted value not closed on its line' };
  };
  if (s[0] === "'" || s[0] === '"') {
    const q = quoted(s);
    if (q.bad) return bad(q.bad);
    if (!tail(s.slice(q.text.length))) return bad('holds text after a quoted value');
    return { kind: 'scalar', text: q.text };
  }
  if (s.startsWith('{}') && tail(s.slice(2))) return { kind: 'scalar', text: '{}' };
  if (s[0] === '{') return bad('holds a flow mapping', SPELL.flow);
  if (s[0] === '[') {
    const items = [];
    let i = 1;
    for (;;) {
      while (s[i] === ' ') i++;
      if (s[i] === ']' && !items.length) break;
      const at = s.slice(i);
      let item;
      if (at[0] === "'" || at[0] === '"') {
        const q = quoted(at);
        if (q.bad) return bad(`${q.bad}, inside a flow list`, SPELL.flow);
        item = q.text;
      } else {
        item = at.match(/^[^,[\]{}#:]*/)[0].trimEnd();
        if (!item || /^[-?&*!|>'"%@`]/.test(item)) return bad('holds a flow list whose items are not plain or quoted, or that is not closed on its line', SPELL.flow);
      }
      items.push(item);
      i += item.length;
      while (s[i] === ' ') i++;
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ']') break;
      return bad('holds a flow list not closed on its line, or with an item that is not plain or quoted', SPELL.flow);
    }
    if (!tail(s.slice(i + 1))) return bad('holds text after a flow list', SPELL.flow);
    return { kind: 'flow', text: s.slice(0, i + 1), items: items.map(unquote) };
  }
  if (/^[&*!]/.test(s)) return bad(`holds ${{ '&': 'an anchor', '*': 'an alias', '!': 'a tag' }[s[0]]} (${s.split(' ')[0]})`, SPELL.property);
  if (/^([,\]}#%@`]|[-?:]( |$))/.test(s)) return bad(`holds a value starting with the indicator ${s[0]}`);
  const k = s.search(/ #/);
  const text = (k < 0 ? s : s.slice(0, k)).trimEnd();
  if (/:( |$)/.test(text)) return bad('holds a plain value with ": " in it or a closing ":", which YAML reads as a key');
  return { kind: 'scalar', text };
}

// Why a line that is not a key line is not one, in words.
function notAKey(body) {
  if (body.startsWith('&')) return ['starts with an anchor (&), not a key', SPELL.key];
  if (body.startsWith('*')) return ['starts with an alias (*), not a key', SPELL.key];
  if (body.startsWith('!')) return ['starts with a tag (!), not a key', SPELL.key];
  if (/^\?( |$)/.test(body)) return ['is an explicit key (?), not a plain key', SPELL.key];
  if (body.startsWith('<<')) return ['is a merge key (<<), whose keys this reader does not follow', SPELL.key];
  if (/^(---|\.\.\.)( |$)/.test(body)) return ['is a document marker after line 1', SPELL.document];
  if (body.startsWith('%')) return ['is a directive', SPELL.document];
  if (/^["'][^:]*\\/.test(body)) return ['is a quoted key with a backslash, an escape YAML decodes', SPELL.key];
  return ['is neither a plain key line, a - item nor a comment', SPELL.key];
}

// Every line of the file, judged against the subset: refusals naming the line and the spelling.
function shapeRefusals(lines, where, blockLines = new Set()) {
  const out = [];
  const refuse = (n, line, why, spell) =>
    out.push(`Could not find a line this reader reads in ${where}: line ${n} ${why} (${line.trim()}); ${spell}.`);
  let open = null;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const n = i + 1;
    i++;
    if (/^ *$/.test(l)) continue;
    if (l.includes('\t')) { refuse(n, l, 'holds a tab', SPELL.tab); continue; }
    if (/^ *#/.test(l)) continue;
    if (n === 1 && /^---( *| +#.*)$/.test(l)) continue;
    const ind = indentOf(l);
    if (open !== null && ind > open) refuse(n, l, 'is indented under a value written on the line above it, so YAML reads it as more of that value', SPELL.more);
    open = null;
    let body = l.slice(ind);
    let col = ind;
    const item = /^-( |$)/.test(body);
    if (item) {
      const m = body.match(/^- */)[0];
      body = body.slice(m.length);
      col = ind + m.length;
      if (body === '' || body.startsWith('#')) { refuse(n, l, 'is a - item with nothing after it', SPELL.value); continue; }
    }
    const k = body.match(KEY_LINE);
    let v;
    if (k) v = valueShape(k[4]);
    else if (item && !/^["']?[^\s"']*["']?:( |$)/.test(body)) v = valueShape(` ${body}`);
    else {
      const [why, spell] = notAKey(body);
      refuse(n, l, why, spell);
      continue;
    }
    if (v.bad) { refuse(n, l, v.bad, v.spell); continue; }
    const owner = item && !k ? ind : col;
    if (v.kind === 'scalar' || v.kind === 'flow') open = owner;
    if (v.kind !== 'block') continue;
    // The block's body, as YAML finds it: from its first non-empty line's indent.
    let j = i;
    let first = -1;
    while (j < lines.length) {
      if (/^ *$/.test(lines[j])) { j++; continue; }
      first = indentOf(lines[j]);
      break;
    }
    open = owner;
    if (first <= owner) continue;
    for (let e = i; e < j; e++) {
      if (lines[e].length > first) refuse(e + 1, lines[e], 'is an empty line at the head of a block indented further than the block\'s first line', SPELL.block);
    }
    while (j < lines.length && (/^ *$/.test(lines[j]) || indentOf(lines[j]) >= first)) j++;
    for (let e = i; e < j; e++) blockLines.add(e + 1);
    i = j;
  }
  return out;
}

// The reader's text of a value: quoted values keep their quotes, a comment is dropped.
const valueOf = (rest) => valueShape(rest).text;

function unquote(v) {
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

// A block's entries at one indent: { key, value, body, line }, body the deeper lines under it.
// A line that is not a key at that indent (a `- ` item among them), or a deeper line before any
// entry, is an entry with key null, for oddKeys to judge.
function entries(lines, indent, firstLine) {
  const out = [];
  lines.forEach((l, i) => {
    if (isComment(l)) { if (out.length) out.at(-1).body.push(l); return; }
    const ind = indentOf(l);
    if (ind > indent && out.length) { out.at(-1).body.push(l); return; }
    const m = ind === indent ? l.slice(indent).match(KEY_LINE) : null;
    out.push({ key: m ? keyOf(m) : null, raw: l, value: m ? valueOf(m[4]) : '', body: [], line: firstLine + i });
  });
  return out;
}

// Refusals for the entries at the top or job-key indent this reader cannot follow: a line that is
// not a key, unless it is a `- ` item directly under a key with nothing after it, and a key written
// twice, or a read key written in another case.
function oddKeys(list, where, level) {
  const out = [];
  const seen = new Map();
  list.forEach((e, i) => {
    if (e.key !== null) {
      const lower = e.key.toLowerCase();
      if (seen.has(lower)) out.push(`Could not find plain keys ${level} of ${where}: line ${e.line} writes ${e.key} again after line ${seen.get(lower)}, and another reader may keep either; write each key once.`);
      else seen.set(lower, e.line);
      if (READ_KEYS.includes(lower) && e.key !== lower) out.push(`Could not find plain keys ${level} of ${where}: line ${e.line} writes ${e.key}, a key this reader reads only as ${lower}; write it in lower case.`);
      return;
    }
    if (level === 'at the top' && i === 0 && e.raw.trim() === '---') return;
    let k = i - 1;
    while (k >= 0 && list[k].key === null && isItem(list[k].raw)) k--;
    const owner = list[k];
    const underKey = isItem(e.raw) && owner && owner.key !== null && owner.value === '' && !owner.body.some((l) => !isComment(l));
    if (!underKey) out.push(`Could not find plain keys ${level} of ${where}: line ${e.line} reads ${e.raw.trim()}, which is not a key this reader reads there (a stray item or an odd indent); ${SPELL.key}.`);
  });
  return out;
}

// What starts the workflow, read only to be named: { triggers, unread }.
function readTriggers(on) {
  if (!on) return { triggers: [] };
  const body = on.body.filter((l) => !isComment(l));
  const v = on.value;
  if (v.startsWith('{') && v !== '{}') return { triggers: [], unread: `on: is written as a flow mapping (${v}), which this reader does not read` };
  if (v.startsWith('[')) {
    const shape = valueShape(` ${v}`);
    if (shape.kind !== 'flow' || body.length) {
      return { triggers: [], unread: `on: is a flow list this reader does not read (${[v, ...body.map((l) => l.trim())].join(' ')}); it reads one closed on its own line` };
    }
    return { triggers: shape.items.filter(Boolean) };
  }
  if (v && body.length) return { triggers: [], unread: `on: holds ${v} and lines below it, which this reader does not read` };
  if (v) return { triggers: [unquote(v)] };
  if (!body.length) return { triggers: [] };
  const indent = indentOf(body[0]);
  const triggers = [];
  for (const l of body) {
    const ind = indentOf(l);
    if (ind > indent) continue;
    const item = ind === indent ? l.slice(indent).match(/^-\s+(.*)$/) : null;
    if (item) { triggers.push(unquote(valueOf(` ${item[1]}`))); continue; }
    const m = ind === indent ? l.slice(indent).match(KEY_LINE) : null;
    if (!m) return { triggers: [], unread: `on: holds the line ${l.trim()}, which is not a trigger this reader reads at the first indent below it` };
    triggers.push(keyOf(m));
  }
  return { triggers };
}

// What a permissions: key grants: { set, write, how, unread }. Any access other than read or none
// is a write; a line below the key this reader cannot read is refused.
function readGrant(entry, where) {
  if (!entry) return { set: false, write: false };
  const v = unquote(entry.value);
  const body = entry.body.filter((l) => !isComment(l));
  const asWrite = (why) => ({ set: true, write: true, how: `${where} permissions: ${why}, a spelling this reader counts as a write` });
  if (v && body.length) return asWrite(`${entry.value} with lines below it`);
  if (v === '{}') return { set: true, write: false, nothing: true };
  if (v === 'read-all') return { set: true, write: false };
  if (v === 'write-all') return { set: true, write: true, how: `${where} permissions: write-all` };
  if (v !== '') return asWrite(v);
  if (!body.length) return asWrite('with nothing after it or below it');
  const pairs = [];
  const indent = indentOf(body[0]);
  for (const l of body) {
    const ind = indentOf(l);
    if (ind > indent) { pairs.at(-1)[1] = `${pairs.at(-1)[1]} continued below as ${l.trim()}`.trim(); continue; }
    const m = ind === indent ? l.slice(indent).match(KEY_LINE) : null;
    if (!m) return { set: true, write: true, how: `${where} permissions`, unread: `${where} permissions: holds the line ${l.trim()}, which is not a <scope>: <access> line this reader reads at the first indent below it` };
    pairs.push([keyOf(m), unquote(valueOf(m[4]))]);
  }
  const writes = pairs.filter(([, access]) => !READ_ONLY.includes(access)).map(([scope, access]) => `${scope}: ${access || '(empty)'}`);
  return writes.length ? { set: true, write: true, how: `${where} permissions ${writes.join(', ')}` } : { set: true, write: false };
}

// The characters YAML may read as a line break inside a line, the byte-order mark, and every
// other control character but the line feed and the tab (C0, DEL and C1, U+0080 to U+009F).
const ODD_CHARACTER = new RegExp('[\\r\\u2028\\u2029\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFEFF]');
const ODD_NAMES = { 13: 'a carriage return not directly before a line feed', 0x85: 'U+0085 (next line)', 0x2028: 'U+2028 (line separator)', 0x2029: 'U+2029 (paragraph separator)' };
const hex = (code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

// A workflow's text, read: { where, file, triggers, refusals, jobs, topText, workflowGrant }.
function readText(text, file) {
  const where = `.github/workflows/${file}`;
  const refusals = [];
  const raw = text.split('\n');
  raw.forEach((l, i) => {
    const odd = (l.endsWith('\r') ? l.slice(0, -1) : l).match(ODD_CHARACTER);
    if (!odd) return;
    const code = odd[0].charCodeAt(0);
    const what = ODD_NAMES[code] ? `${ODD_NAMES[code]}, which YAML may read as a line break`
      : `the ${code === 0xFEFF ? 'byte-order mark' : 'control character'} ${hex(code)}, which YAML may refuse or read as no character at all`;
    refusals.push(`Could not find a line this reader reads in ${where}: line ${i + 1} holds ${what}; ${SPELL.break}, and no other control character.`);
  });
  if (refusals.length) return { where, file, triggers: [], refusals, jobs: [] };
  const lines = raw.map((l) => l.replace(/\r$/, ''));
  // The lines of a | or > block's body, by line number: GitHub evaluates an expression on each of
  // them, one starting with # included, so they are read as text, never dropped as comments.
  const blockLines = new Set();
  refusals.push(...shapeRefusals(lines, where, blockLines));
  // An entry's lines that GitHub reads: its own line and its body, contiguous from it, less the
  // comments outside a block's body.
  const textOf = (e) => [e.raw, ...e.body].filter((l, k) => !isComment(l) || (l.trim() !== '' && blockLines.has(e.line + k)));
  const top = entries(lines, 0, 1);
  refusals.push(...oddKeys(top, where, 'at the top'));
  const onAt = top.findIndex((e) => e.key === 'on' || e.key === 'true');
  let on = top[onAt];
  if (on && !on.value && !on.body.some((l) => !isComment(l))) {
    const items = [];
    for (let k = onAt + 1; k < top.length && top[k].key === null && isItem(top[k].raw); k++) items.push(top[k].raw, ...top[k].body);
    if (items.length) on = { ...on, body: items };
  }
  const { triggers, unread } = readTriggers(on);
  if (unread) refusals.push(`Could not find the triggers of ${where}: ${unread}`);
  else if (!triggers.length) refusals.push(`Could not find the triggers of ${where}: no on: key this reader reads at column zero`);
  const jobsEntry = top.find((e) => e.key === 'jobs');
  if (!jobsEntry || jobsEntry.value) {
    refusals.push(`Could not find the jobs of ${where}: ${jobsEntry ? 'jobs: is written on one line' : 'no jobs: key at column zero'}, where each job id must sit two spaces in`);
    return { where, file, triggers, refusals, jobs: [] };
  }
  const topText = top.filter((e) => e !== jobsEntry).flatMap(textOf);
  const workflowGrant = readGrant(top.find((e) => e.key === 'permissions'), 'the workflow\'s');
  if (workflowGrant.unread) refusals.push(`Could not find what ${where} grants: ${workflowGrant.unread}`);
  const jobs = [];
  for (const j of entries(jobsEntry.body, 2, jobsEntry.line + 1)) {
    const id = j.raw.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/)?.[1];
    if (!id) {
      refusals.push(`Could not find a plain job id in ${where} on line ${j.line}: it reads ${j.raw.trim()}, where a job is written as two spaces, its id and a colon`);
      continue;
    }
    const keys = entries(j.body, 4, j.line + 1);
    refusals.push(...oddKeys(keys, where, `in job ${id}`));
    const key = (k) => keys.find((e) => e.key === k);
    const grant = readGrant(key('permissions'), `the job's`);
    if (grant.unread) refusals.push(`Could not find what job ${id} of ${where} grants: ${grant.unread}`);
    jobs.push({
      id, line: j.line, runsOn: key('runs-on'), uses: key('uses'), steps: key('steps'), grant,
      text: textOf(j),
    });
  }
  if (!jobs.length && !refusals.length) refusals.push(`Could not find any job in ${where}: a reading of nothing would pass everything`);
  return { where, file, triggers, refusals, jobs, topText, workflowGrant };
}

const readWorkflow = (file) => readText(fs.readFileSync(path.join(DIR, file), 'utf8'), file);

// What a runs-on holds, in words, for a refusal.
function machineOf(runsOn) {
  if (!runsOn) return 'no runs-on';
  const body = runsOn.body.filter((l) => !isComment(l)).map((l) => l.trim());
  if (!runsOn.value && body.length) {
    const shape = body[0].startsWith('-') ? 'a list' : 'a group or labels mapping';
    return `runs-on: ${shape} (${body.join(' ')})`;
  }
  return `runs-on: ${runsOn.value || '(empty)'}`;
}

const STRICTER = 'this repository\'s own stricter rule, built on decision 36\'s reason: on a machine of ours that token is within reach of whatever ran there before it, whatever started the run';
const UNWATCHED = `this repository's rule until the fallback watcher reads .github's runs (decision 104): CHECKS_RUNNER_2 is visible to every repository, and a job here waiting on machines of ours would never be sent back to GitHub's if they stalled`;
const SCANNED = 'the scan\'s rule (decision 93): the scan runs on the scan machines (GitHub\'s while the setting is empty), which hold no change\'s own code only while the scan runner group admits only the scan workflows (decision 98), and a workflow this test does not read could put part of the scan beside a change\'s own code, where the change could quiet it';
const SECRETLESS = 'the scans\' rule: a scan job on the scan machines holds no secret, so nothing on those machines is worth taking, and a caller never hands one to the shared scan';

// The scan files that may hold one final check on GitHub's machines, granted no token (decision 135).
const FINAL_CHECK_FILES = ['codeql.yml'];

function judge(wf) {
  const refusals = [...wf.refusals];
  let finalChecks = 0;
  const started = wf.triggers.length ? `, started by ${wf.triggers.join(', ')}` : '';
  for (const job of wf.jobs) {
    const named = `job ${job.id} of ${wf.where}`;
    const value = job.runsOn && !job.runsOn.body.some((l) => !isComment(l)) ? job.runsOn.value : null;
    const defaultToken = !wf.workflowGrant.set && !job.grant.set;
    const write = defaultToken || wf.workflowGrant.write || job.grant.write;
    // The rule the job is held by, and why, in words for its refusals.
    let why = `runs in ${wf.file}, a scan workflow, with a read-only token`;
    let [whom, rule] = ['every job of the scan', SCANNED];
    if (write) {
      const how = [wf.workflowGrant.how, job.grant.how].filter(Boolean).join(' and ')
        || 'no permissions: key in the workflow or the job, so the repository\'s default token, which may write';
      why = `holds a write token (${how})${started}`;
      [whom, rule] = ['every write-token job', STRICTER];
    } else if (!isScan(wf)) {
      why = `runs outside ${SCAN_NAMES} with a read-only token`;
      [whom, rule] = ['every job outside the scan', UNWATCHED];
    }
    // A job calling a workflow has no machine of its own: wherever it sits, it calls only a workflow
    // of this folder, written on the uses: line, judged in its own file.
    if (job.uses) {
      const onLine = unquote(job.uses.value);
      const block = /^[|>]/.test(onLine);
      const body = job.uses.body.filter((l) => !isComment(l)).map((l) => l.trim()).join(' ');
      const callee = block ? `${body || '(nothing)'} written as a ${onLine} block` : onLine || '(nothing on the uses: line)';
      if (block || !onLine.startsWith('./')) {
        refusals.push(`Could not find a workflow of this repository's own folder (./.github/workflows/...) as the workflow ${named} calls: it calls ${callee}, a workflow in another repository or at another commit, or one not written on the uses: line, which this test does not read, and it ${why}. Holding ${whom} to a ./ workflow, judged in its own file, is ${rule}.`);
      } else if (!isScan(wf) && SCAN_WORKFLOWS.includes(path.posix.basename(onLine))) {
        refusals.push(`Could not find a workflow other than a scan as the workflow ${named} calls: it calls ${onLine}, a scan workflow whose jobs read SCAN_RUNNER_2, from ${wf.file}, outside ${SCAN_NAMES}. Only the scans' own jobs run on the scan machines, by ${SCANNED}.`);
      }
    }
    if (write || !isScan(wf)) {
      // A write-token job anywhere, and every job outside the scan: a literal GitHub label, no
      // CHECKS_, SCAN_ or LOCKED_ setting.
      if (!job.uses && (value === null || !GITHUB_STANDARD.includes(unquote(value)))) {
        refusals.push(`Could not find one of GitHub's standard machines (${GITHUB_STANDARD.join(', ')}) as the machine of ${named}: it ${why} and reads ${machineOf(job.runsOn)}. Holding ${whom} to GitHub's machines is ${rule}.`);
      }
      for (const [lines, part] of [[job.text, 'the job'], [wf.topText, 'the workflow\'s top']]) {
        const hit = lines.map((l) => l.match(OUR_SETTING)).find(Boolean);
        if (hit) refusals.push(`Could not find ${named} free of the organisation's machine settings: it ${why}, and ${part} reads ${hit[0]}, a CHECKS_, SCAN_ or LOCKED_ setting such a job never reads, by ${rule}.`);
      }
      continue;
    }
    // A read-only job of a scan holds no secret, declared or read, whether it names its machine or
    // calls a ./ workflow.
    for (const [lines, part] of [[job.text, 'the job'], [wf.topText, 'the workflow\'s top']]) {
      const hit = lines.find((l) => A_SECRET.test(l));
      if (hit) refusals.push(`Could not find ${named} free of secrets: it ${why}, and ${part} reads ${hit.trim()}. Holding every job of the scans to no secret is ${SECRETLESS}.`);
    }
    // A read-only job of a scan calling a workflow names no machine: the ./ workflow it calls names
    // its own, judged in its own file.
    if (job.uses) continue;
    // The scan file's one final check: no token, a literal GitHub label, no setting (decision 135).
    if (FINAL_CHECK_FILES.includes(wf.file) && job.grant.nothing && value !== null && GITHUB_STANDARD.includes(unquote(value))) {
      finalChecks++;
      if (finalChecks > 1) refusals.push(`Could not find one final check alone in ${wf.where}: ${named} is a second job granted no token on ${unquote(value)}, and the shared scan holds one final check on GitHub's machines (decision 135), every other read-only job on the scan machines.`);
      const hit = [...job.text, ...wf.topText].map((l) => l.match(OUR_SETTING)).find(Boolean);
      if (hit) refusals.push(`Could not find ${named} free of the organisation's machine settings: it is the final check of a scan, on GitHub's machines with no token, and reads ${hit[0]}.`);
      continue;
    }
    if (value !== SCAN) {
      refusals.push(`Could not find ${SCAN} as the machine of ${named}: it reads ${machineOf(job.runsOn)}. Its machine is the scan machines (decision 93), which hold no change's own code only while the scan runner group admits only the scan workflows (decision 98), GitHub's own while the setting is empty.`);
    }
  }
  return refusals;
}

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort()
  : [];

test('the workflow folder holds workflows to read', () => {
  assert.ok(files.length > 0, `Could not find any workflow in .github/workflows/: a reading of nothing would pass everything`);
});

for (const file of files) {
  test(`every job of ${file} names its machine by what it holds`, () => {
    const refusals = judge(readWorkflow(file));
    assert.ok(refusals.length === 0, refusals.join('\n'));
  });
}

// ---- KEPT CASES ----
// Each spelling a review found hiding a write token, each spelling round 2 planted, each case
// round 4 added (a refused line after a block scalar, a C1 control, a job outside the scan reading
// CHECKS_RUNNER_2), each case round 5 added (a job of the scan holding a write or the default
// token, a job outside the scan calling a workflow) and each case round 6 added (a job of the scan
// calling a workflow in another repository, a scan job granting itself a write or write-all, a call
// outside the scan passing nothing in with:) is fed to the reader as text and must be
// refused, naming its line where it says which line; the controls, ordinary spellings, must pass,
// so a reader that refuses everything fails them. The plain layout is a read-only job of
// decide-tests.yml on ubuntu-latest; a case that needs the change-check machines or the scan
// machines says so in its name.
const CR = String.fromCharCode(13);
const STEPS = ['    steps:', '      - name: Run the tests', '        run: node --test test/*.test.mjs'];
function workflow({
  top = ['name: Decide tests'],
  on = ['on:', '  pull_request:', '  merge_group:'],
  permissions = ['permissions:', '  contents: read'],
  job = ['    name: decide-tests'],
  runsOn = 'ubuntu-latest',
  steps = STEPS,
  after = [],
} = {}) {
  return [...top, '', ...on, '', ...permissions, '', 'jobs:', '  decide-tests:', ...job, `    runs-on: ${runsOn}`, ...steps, ...after, ''].join('\n');
}
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
const refusalsOf = (text, file = 'decide-tests.yml') => judge(readText(text, file));

// A case the reader must refuse: `at` names the line its refusal must name, `says` what it says.
function refused(name, text, { at, says, file } = {}) {
  test(`kept case, refused: ${name}`, () => {
    const refusals = refusalsOf(text, file);
    assert.ok(refusals.length > 0, `Could not find any refusal of ${name}: the reader passed it, so the spelling hides what it holds`);
    const line = at ? lineOf(text, at) : 0;
    const hit = refusals.find((r) => (!line || r.includes(`line ${line} `)) && (!says || says.test(r)));
    assert.ok(hit, `Could not find a refusal of ${name}${line ? ` naming line ${line}` : ''}${says ? ` saying ${says}` : ''}: the reader said ${refusals.join(' | ')}`);
  });
}
// A control the reader must pass.
function passes(name, text, file) {
  test(`kept case, passes: ${name}`, () => {
    const refusals = refusalsOf(text, file);
    assert.ok(refusals.length === 0, `Could not find a clean reading of ${name}, an ordinary spelling: ${refusals.join(' | ')}`);
  });
}
const WRITE = /holds a write token/;

// The second review's inputs (A, B, C). A is held twice: on a job key's line, as the review wrote
// it, and on a step's line, deeper than any line the reader reads as a key.
for (const [name, code] of [['A: a carriage return mid-line', 13], ['A: U+0085 mid-line', 0x85], ['A: U+2028 mid-line', 0x2028], ['A: U+2029 mid-line', 0x2029]]) {
  const hide = (line) => `${line}${String.fromCharCode(code)}    permissions: write-all`;
  refused(`${name} on a job key's line, hiding the job's permissions`, workflow({ job: ['    name: decide-tests', hide('    timeout-minutes: 10')] }), { at: 'timeout-minutes', says: /line break/ });
  refused(`${name} on a step's line, hiding the job's permissions`, workflow({ steps: [...STEPS.slice(0, 2), hide(STEPS[2])] }), { at: 'run: node', says: /line break/ });
}
refused('B: an anchored key', workflow({ job: ['    name: decide-tests', '    &k permissions: write-all'] }), { at: '&k permissions', says: /anchor/ });
refused('B: an aliased key', workflow({ job: ['    name: decide-tests', '    env:', '      X: &k permissions', '    *k : write-all'] }), { at: '*k :', says: /alias/ });
refused('B: a tagged key', workflow({ job: ['    name: decide-tests', '    !!str permissions: write-all'] }), { at: '!!str', says: /tag/ });
refused('B: an escaped key', workflow({ job: ['    name: decide-tests', `    "${String.fromCharCode(92)}u0070ermissions": write-all`] }), { at: 'ermissions"', says: /quoted key with a backslash/ });
refused('C: an unclosed quote at the top', workflow({ top: ['name: "Decide tests'], permissions: ['permissions: read-all #"'] }), { at: 'name: "Decide', says: /not closed/ });
refused('C: an unclosed quote at the job-key indent', workflow({ job: ['    name: "decide-tests', '    uses: ./x.yml #"'] }), { at: 'name: "decide', says: /not closed/ });

// Round 2's planted spellings (the second review's finding D).
refused('an anchored access', workflow({ permissions: ['permissions:', '  contents: &w write'] }), { at: '&w write', says: /anchor/ });
refused('an aliased access', workflow({ top: ['name: Decide tests', 'env:', '  X: &w write'], permissions: ['permissions:', '  contents: *w'] }), { at: 'contents: *w', says: /alias/ });
refused('a quoted scope granting a write, on the change-check machines', workflow({ permissions: ['permissions:', '  "statuses": write'], runsOn: CHECKS }), { says: WRITE });
refused('an access on the next line', workflow({ permissions: ['permissions:', '  contents:', '    write'] }), { at: '    write', says: /neither a plain key/ });
refused('a flow mapping holding an alias', workflow({ top: ['name: Decide tests', 'env:', '  X: &w write'], permissions: ['permissions: { contents: *w }'] }), { at: 'permissions: {', says: /flow mapping/ });
refused('a flow mapping holding an anchor', workflow({ permissions: ['permissions: { contents: &w write }'] }), { at: 'permissions: {', says: /flow mapping/ });
refused('an access other than read, none or write, on the change-check machines', workflow({ permissions: ['permissions:', '  statuses: admin'], runsOn: CHECKS }), { says: WRITE });
refused('an explicit key in permissions', workflow({ permissions: ['permissions:', '  ? statuses', '  : write'] }), { at: '? statuses', says: /explicit key/ });
refused('a permissions line at a lesser indent', workflow({ permissions: [], job: ['    name: decide-tests', '    permissions:', '        contents: read', '      statuses: write'] }), { says: /grants/ });
refused('a workflow_call-only write job on the change-check machines', workflow({ on: ['on:', '  workflow_call:'], permissions: ['permissions:', '  statuses: write'], runsOn: CHECKS }), { says: WRITE, file: 'engineer-review.yml' });
passes('a workflow_call-only write job on ubuntu-latest', workflow({ on: ['on:', '  workflow_call:'], permissions: ['permissions:', '  statuses: write'], runsOn: 'ubuntu-latest' }), 'engineer-review.yml');
refused('a workflow_run write job on the change-check machines', workflow({ on: ['on:', '  workflow_run:'], permissions: ['permissions:', '  pull-requests: write'], runsOn: CHECKS }), { says: WRITE });
refused('a push workflow with no permissions on the change-check machines', workflow({ on: ['on: push'], permissions: [], runsOn: CHECKS }), { says: /default token/ });
refused('on: as a flow mapping', workflow({ on: ['on: { pull_request: {} }'] }), { at: 'on: {', says: /flow mapping/ });
refused('on: as a flow list left open', workflow({ on: ['on: [push,', '  pull_request]'] }), { at: 'on: [push', says: /flow list/ });
refused('an explicit key at the job-key indent', workflow({ job: ['    name: decide-tests', '    ? permissions', '    : write-all'] }), { at: '? permissions', says: /explicit key/ });
refused('a merge key at the top', workflow({ top: ['name: Decide tests', 'x-common: &c', '  permissions: write-all', '<<: *c'] }), { at: '<<: *c', says: /merge key/ });
refused('a merge key at the job-key indent', workflow({ top: ['name: Decide tests', 'x-common: &c', '  permissions: write-all'], job: ['    name: decide-tests', '    <<: *c'] }), { at: '    <<: *c', says: /merge key/ });

// Other spellings outside the subset.
refused('a tab', workflow({ job: ['    name: decide-tests', '    timeout-minutes:\t10'] }), { at: 'timeout-minutes', says: /tab/ });
refused('a plain value continued on the line below', workflow({ job: ['    name: decide-tests', '      permissions: write-all'] }), { at: '      permissions', says: /more of that value/ });
refused('a tagged access', workflow({ permissions: ['permissions:', '  contents: !!str read'] }), { at: '!!str read', says: /tag/ });
refused('a block header with an indentation digit', workflow({ job: ['    name: decide-tests', '    env:', '      X: |2', '        text'] }), { at: '|2', says: /block scalar header/ });
refused('a second document', `${workflow()}---\npermissions: write-all\n`, { at: '---', says: /document marker/ });
refused('a key written twice', workflow({ job: ['    name: decide-tests', '    permissions: read-all', '    permissions: write-all'] }), { at: 'write-all', says: /again/ });
refused('a read key in another case', workflow({ job: ['    name: decide-tests', '    Permissions: write-all'] }), { at: 'Permissions', says: /lower case/ });
refused('a key: value item at the job-key indent', workflow({ job: ['    name: decide-tests', '    timeout-minutes: 10', '    - permissions: write-all'] }), { at: '- permissions', says: /stray item/ });

// Round 4. The third review's finding 1: a refused line after a valid block scalar, so where a
// body ends, and that an empty block ends at once, are held. Its input as written, where YAML
// carries the run-name's quote on to the permissions line, so the job has no permissions key and
// the default token; then the same with the block left empty.
const AFTER_BLOCK = ['name: |', '  Decide tests', 'run-name: "Decide tests', 'permissions: read-all #"', 'on:', '  pull_request:', 'jobs:', '  decide-tests:',
  `    runs-on: ${CHECKS}`, '    steps:', '      - run: node --test test/*.test.mjs', ''];
refused('an unclosed quote after a block scalar with a body', AFTER_BLOCK.join('\n'), { at: 'run-name:', says: /not closed/ });
refused('an unclosed quote after an empty block scalar', AFTER_BLOCK.filter((l) => l !== '  Decide tests').join('\n'), { at: 'run-name:', says: /not closed/ });
// Its note 3: a C1 control in a value, the first and the last of U+0080 to U+009F.
for (const code of [0x80, 0x9F]) {
  refused(`a C1 control, ${hex(code)}, in a value`, workflow({ steps: [STEPS[0], `${STEPS[1]}${String.fromCharCode(code)}`, STEPS[2]] }),
    { at: '- name: Run the tests', says: new RegExp(`control character ${hex(code).replace('+', '\\+')}`) });
}
// Decision 104: a job outside the scan reads no CHECKS_ setting, as its machine or anywhere else.
refused('a read-only job outside the scan on the change-check machines', workflow({ runsOn: CHECKS }),
  { says: /outside security-scan\.yml and codeql\.yml with a read-only token and reads runs-on: \$\{\{ vars\.CHECKS_RUNNER_2/ });
refused('a read-only job outside the scan reading CHECKS_RUNNER_2 in a step', workflow({ steps: [...STEPS, '        env:', '          RUNNER: ${{ vars.CHECKS_RUNNER_2 }}'] }),
  { says: /free of the organisation's machine settings: it runs outside security-scan\.yml.*reads vars\.CHECKS_RUNNER_2/ });
passes('a read-only job of the scan on the scan machines', workflow({ runsOn: SCAN }), 'security-scan.yml');

// Round 5. The fourth review's finding 1: security-scan.yml is the one file where the write rule
// changes the outcome, so a job of the scan holding a write or the default token is held there.
// Each pins the machine refusal, not the setting refusal its runs-on line also earns (the fifth
// review's note 3).
refused('a write-token job of the scan on the scan machines', workflow({ permissions: ['permissions:', '  pull-requests: write'], runsOn: SCAN }), { says: /standard machines .*holds a write token/, file: 'security-scan.yml' });
refused('a scan job with the default token on the scan machines', workflow({ permissions: [], runsOn: SCAN }), { says: /standard machines .*default token/, file: 'security-scan.yml' });
// Its finding 2: a job outside the scan calling a workflow calls only one of this folder, and is
// held to its file's setting rule, its with: included. The review's job first, beside the plain one.
const callJob = (uses, ...withLines) => ['  shared:', `    uses: ${uses}`, ...(withLines.length ? ['    with:', ...withLines.map((l) => `      ${l}`)] : [])];
refused('a job outside the scan calling a workflow in another repository', workflow({ after: callJob('dazzer-io/dazzer/.github/workflows/shared-checks.yml@0123456789abcdef0123456789abcdef01234567', `runner: ${CHECKS}`) }),
  { says: /job shared of .*: it calls dazzer-io\/dazzer\/\.github\/workflows\/shared-checks\.yml@[0-9a-f]{40}, a workflow in another repository/ });
refused('a job outside the scan calling a workflow of this folder, passing CHECKS_RUNNER_2 in with:', workflow({ after: callJob('./.github/workflows/shared.yml', `runner: ${CHECKS}`) }),
  { says: /job shared of .* free of the organisation's machine settings: it runs outside security-scan\.yml.*the job reads vars\.CHECKS_RUNNER_2/ });
passes('a job outside the scan calling a workflow of this folder, reading no setting', workflow({ after: callJob('./.github/workflows/shared.yml', 'mode: fast') }));

// Round 6. The fifth review's finding 1 and note 5: every job-level call here names a workflow of
// this folder, in the scan too, refused by the rule its job is held by: a write-token job's
// (decision 36's reason) and a read-only scan job's (decision 93), neither passing anything in with:.
const REMOTE = 'dazzer-io/dazzer/.github/workflows/shared-checks.yml@0123456789abcdef0123456789abcdef01234567';
refused('a write-token job of the scan calling a workflow in another repository', workflow({ runsOn: SCAN, after: ['  publish:', '    permissions:', '      pull-requests: write', `    uses: ${REMOTE}`] }),
  { says: /job publish of .*a workflow in another repository.*every write-token job .*decision 36's reason/, file: 'security-scan.yml' });
refused('a read-only job of the scan calling a workflow in another repository', workflow({ runsOn: SCAN, after: callJob(REMOTE) }),
  { says: /job shared of .*a workflow in another repository.*every job of the scan .*decision 93/, file: 'security-scan.yml' });
// Its finding 2: a write granted by the job alone, and a valid write-all, each on the scan machines.
refused('a scan job granting itself a write on the scan machines', workflow({ job: ['    name: decide-tests', '    permissions:', '      pull-requests: write'], runsOn: SCAN }),
  { says: /standard machines .*holds a write token \(the job's permissions pull-requests: write/, file: 'security-scan.yml' });
refused('a scan job with permissions: write-all on the scan machines', workflow({ job: ['    name: decide-tests', '    permissions: write-all'], runsOn: SCAN }),
  { says: /standard machines .*holds a write token \(the job's permissions: write-all/, file: 'security-scan.yml' });
// Its note 4: the call outside the scan with nothing in with:, so the refusal rests on the call alone.
refused('a job outside the scan calling a workflow in another repository, passing nothing in with:', workflow({ after: callJob(REMOTE) }),
  { says: /job shared of .*: it calls dazzer-io\/dazzer\/\.github\/workflows\/shared-checks\.yml@[0-9a-f]{40}, a workflow in another repository/ });

// The shared scan's task (r-3.18). codeql.yml is a scan workflow: a read-only job there reads the
// scan machines, a write-token job there names a literal GitHub label.
passes('a read-only job of codeql.yml on the scan machines', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN }), 'codeql.yml');
refused('a write-token job of codeql.yml on the scan machines', workflow({ on: ['on:', '  workflow_call:'], job: ['    name: decide-tests', '    permissions:', '      security-events: write'], runsOn: SCAN }),
  { says: /standard machines .*holds a write token \(the job's permissions security-events: write/, file: 'codeql.yml' });
refused('a read-only job of codeql.yml on the change-check machines', workflow({ on: ['on:', '  workflow_call:'], runsOn: CHECKS }),
  { says: /Could not find \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\} as the machine of job decide-tests of \.github\/workflows\/codeql\.yml/, file: 'codeql.yml' });
// A job of either scan reading SCAN_RUNNER_2 holds no secret: read in a step, passed on, or declared.
refused('a scan job reading a secret on the scan machines', workflow({ runsOn: SCAN, steps: [...STEPS, '        env:', '          TOKEN: ${{ secrets.SCAN_TOKEN }}'] }),
  { says: /job decide-tests of \.github\/workflows\/security-scan\.yml free of secrets: it runs in security-scan\.yml, a scan workflow.*TOKEN: \$\{\{ secrets\.SCAN_TOKEN/, file: 'security-scan.yml' });
refused('a shared-scan job reading a secret by index', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, steps: [...STEPS, '        env:', "          TOKEN: ${{ secrets['SCAN_TOKEN'] }}"] }),
  { says: /free of secrets: it runs in codeql\.yml, a scan workflow/, file: 'codeql.yml' });
refused('a shared scan declaring a secret under workflow_call', workflow({ on: ['on:', '  workflow_call:', '    secrets:', '      SCAN_TOKEN:', '        required: false'], runsOn: SCAN }),
  { says: /free of secrets: .*the workflow's top reads secrets:/, file: 'codeql.yml' });
refused('a read-only scan job handing its secrets on to a ./ workflow', workflow({ runsOn: SCAN, after: ['  shared:', '    uses: ./.github/workflows/shared.yml', '    secrets: inherit'] }),
  { says: /job shared of .* free of secrets: .*the job reads secrets: inherit/, file: 'security-scan.yml' });
passes('a scan job handing its own read-only token to a step', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, steps: [...STEPS, '        env:', '          GITHUB_TOKEN: ${{ github.token }}'] }), 'codeql.yml');
// The sixth review of .github 10, note 1: the scan's rule says decision 98's condition, as the
// machine refusal does.
refused('a read-only scan job calling another repository, told decision 98\'s condition', workflow({ runsOn: SCAN, after: callJob(REMOTE) }),
  { says: /every job of the scan .*GitHub's while the setting is empty.*only while the scan runner group admits only the scan workflows \(decision 98\)/, file: 'codeql.yml' });
// Its note 2: the setting half of the write rule, alone: a write-token job of the scan on GitHub's
// machine, reading SCAN_RUNNER_2 in a step, is refused by that half and nothing else.
refused('a write-token job of the scan reading SCAN_RUNNER_2 in a step', workflow({ permissions: ['permissions:', '  pull-requests: write'], steps: [...STEPS, '        env:', '          RUNNER: ${{ vars.SCAN_RUNNER_2 }}'] }),
  { says: /free of the organisation's machine settings: it holds a write token/, file: 'security-scan.yml' });
// Its note 3: a call written as a folded block, which GitHub reads as the same remote reference.
refused('a call written as a folded block', workflow({ after: ['  shared:', '    uses: >-', `      ${REMOTE}`] }),
  { says: /it calls dazzer-io\/dazzer\/\.github\/workflows\/shared-checks\.yml@[0-9a-f]{40} written as a > block, a workflow in another repository/ });

// The shared scan's first review (decision 131), finding 2: the whole secrets context, and a line
// starting with # inside a | or > block, which GitHub evaluates, are read as secrets.
refused('the shared scan handing the whole secrets context to an env at its top', workflow({ top: ['name: CodeQL', 'env:', '  ALL: ${{ toJSON(secrets) }}'], on: ['on:', '  workflow_call:'], runsOn: SCAN }),
  { says: /free of secrets: .*the workflow's top reads ALL: \$\{\{ toJSON\(secrets\) \}\}/, file: 'codeql.yml' });
refused('a secret on a # line inside a | block of a shared-scan step\'s input', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, steps: ['    steps:', '      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9', '        with:', '          compression-level: |', '            # ${{ secrets.SCAN_TOKEN }}'] }),
  { says: /free of secrets: .*the job reads # \$\{\{ secrets\.SCAN_TOKEN \}\}/, file: 'codeql.yml' });
// The same planted into a copy of security-scan.yml itself, read here, the file left unchanged:
// a # line holding a secret at the head of its first run: | block.
const SECURITY_SCAN = fs.existsSync(path.join(DIR, 'security-scan.yml')) ? fs.readFileSync(path.join(DIR, 'security-scan.yml'), 'utf8') : '';
const withSecretInRun = (text) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^ +run: \|$/.test(l));
  if (at < 0 || at + 1 >= lines.length) return text;
  lines.splice(at + 1, 0, `${' '.repeat(indentOf(lines[at + 1]))}# \${{ secrets.SCAN_TOKEN }}`);
  return lines.join('\n');
};
test('kept case, the plant took: a secret on a # line in a run: | block of security-scan.yml', () => {
  assert.ok(SECURITY_SCAN && withSecretInRun(SECURITY_SCAN) !== SECURITY_SCAN, 'Could not find a run: | block in security-scan.yml to plant into: the case below would prove nothing');
});
refused('a secret on a # line in a run: | block of security-scan.yml', withSecretInRun(SECURITY_SCAN),
  { says: /of \.github\/workflows\/security-scan\.yml free of secrets: .*the job reads # \$\{\{ secrets\.SCAN_TOKEN \}\}/, file: 'security-scan.yml' });
// Its note 4: a workflow outside the two scans calls neither, since its jobs read SCAN_RUNNER_2.
refused('a job outside the scans calling the shared CodeQL scan', workflow({ after: callJob('./.github/workflows/codeql.yml', `languages: '["actions"]'`) }),
  { says: /Could not find a workflow other than a scan as the workflow job shared of \.github\/workflows\/decide-tests\.yml calls: it calls \.\/\.github\/workflows\/codeql\.yml/ });
refused('a job outside the scans calling the security scan', workflow({ after: callJob('./.github/workflows/security-scan.yml') }),
  { says: /Could not find a workflow other than a scan .*it calls \.\/\.github\/workflows\/security-scan\.yml/ });
passes('a read-only job of the security scan calling the shared CodeQL scan', workflow({ runsOn: SCAN, after: callJob('./.github/workflows/codeql.yml', `languages: '["actions"]'`) }), 'security-scan.yml');

// The shared scan's second review (decision 133): a secret spelled with a YAML escape in a
// double-quoted value, in each scan file, is refused by the backslash rule.
const ESCAPED_SECRET = `      - name: "Check out \${{ ${String.fromCharCode(92)}x73ecrets.SCAN_TOKEN }}"`;
refused('a secret spelled with an escape in a step name of security-scan.yml', workflow({ runsOn: SCAN, steps: ['    steps:', ESCAPED_SECRET, '        run: node --test test/*.test.mjs'] }),
  { at: 'Check out', says: /holds a double-quoted value with a backslash/, file: 'security-scan.yml' });
refused('a secret spelled with an escape in a step name of codeql.yml', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, steps: ['    steps:', ESCAPED_SECRET, '        run: node --test test/*.test.mjs'] }),
  { at: 'Check out', says: /holds a double-quoted value with a backslash/, file: 'codeql.yml' });

// The shared scan's third review (decision 135): codeql.yml's one final check, granted no token,
// on GitHub's machine; a second such job is refused, and so is one granted a token or reading a
// setting.
const FINAL = ['  complete:', '    needs: [decide-tests]', '    if: ${{ always() }}', '    runs-on: ubuntu-latest', '    permissions: {}', '    steps:', '      - run: exit 0'];
passes('the shared scan\'s one final check on GitHub\'s machine with no token', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, after: FINAL }), 'codeql.yml');
refused('a second final check in the shared scan', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, after: [...FINAL, ...FINAL.map((l) => l.replace('complete:', 'complete-again:'))] }),
  { says: /Could not find one final check alone in \.github\/workflows\/codeql\.yml: job complete-again/, file: 'codeql.yml' });
refused('a final check granted contents: read in the shared scan', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, after: FINAL.map((l) => (l === '    permissions: {}' ? '    permissions: read-all' : l)) }),
  { says: /Could not find \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\} as the machine of job complete/, file: 'codeql.yml' });
refused('a final check reading a setting in the shared scan', workflow({ on: ['on:', '  workflow_call:'], runsOn: SCAN, after: [...FINAL, '        env:', '          RUNNER: ${{ vars.CHECKS_RUNNER_2 }}'] }),
  { says: /job complete of .* free of the organisation's machine settings: it is the final check/, file: 'codeql.yml' });
refused('a final check with no token in the security scan', workflow({ runsOn: SCAN, after: FINAL }),
  { says: /Could not find \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\} as the machine of job complete of \.github\/workflows\/security-scan\.yml/, file: 'security-scan.yml' });

// Controls: ordinary spellings that must pass.
passes('the plain layout', workflow());
passes('lines ended by a carriage return and a line feed', workflow().split('\n').join(`${CR}\n`));
passes('steps written at the job-key indent', workflow({ steps: ['    steps:', '    - name: Run the tests', '      run: node --test test/*.test.mjs'] }));
passes('a leading ---', `---\n${workflow()}`);
passes('permissions: {}', workflow({ permissions: ['permissions: {}'] }));
passes('permissions: read-all', workflow({ permissions: ['permissions: read-all # every scope read'] }));
passes('a one-line trigger list', workflow({ on: ["on: [pull_request, 'merge_group']"] }));
passes('triggers as items at column zero', workflow({ on: ['on:', '- pull_request', '- merge_group'] }));
passes('a block scalar holding colons, quotes, an ampersand and a star', workflow({
  steps: ['    steps:', '      - name: Run the tests', '        run: |', '          echo "a: b" \'c\' && ls *.mjs & wait', `          x: &anchor *alias !tag "${String.fromCharCode(92)}n"`, '', '          # not a comment', '        env:', "          NAME: 'it''s'"],
}));
passes('a folded block scalar with a chomping sign', workflow({ job: ['    name: decide-tests', '    if: >-', '      github.event_name != \'push\' &&', '      *.x: y'] }));
