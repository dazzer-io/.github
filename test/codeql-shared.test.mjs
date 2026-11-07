// The shared CodeQL scan, .github/workflows/codeql.yml: the one code scan every dazzer-io
// repository calls (decisions 118 and 119), in place of a copy of its own. This test pins what it
// scans and what it may hold, so a weakened scan goes red here, and a red line here shows up in
// the change's diff beside the workflow's:
//
//   - it is started only by workflow_call, taking one input, languages, a JSON list as a string;
//   - it declares no secret and reads none (no secrets: key, no secrets. or secrets[ read);
//   - it reads one setting, SCAN_RUNNER_2, as the analysis job's machine and nowhere else:
//     ${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}, so an empty setting keeps it on GitHub's
//     computers (decision 93). A called workflow reads its caller's variables (docs.github.com,
//     Variables reference: "For reusable workflows, the variables from the caller workflow's
//     repository are used."), so the setting resolves as the calling repository sees it;
//   - its two jobs, analyze and upload, line for line where it matters: analyze holds contents:
//     read and actions: read and nothing more, runs one language per matrix entry, read from the
//     input, and runs exactly four steps (a checkout of one commit keeping no credential, CodeQL's
//     init with build-mode none and the security-extended suite, analyze with upload: never and
//     the category /language:<language>, and the results kept as an artifact); upload runs on
//     GitHub's own ubuntu-latest, written as a literal label, is the only job holding
//     security-events: write, checks nothing out, and hands each language's results to code
//     scanning under the same category, so alert history carries on (decision 36 keeps the write
//     off our machines);
//   - every action is pinned by commit, and CodeQL's three actions share one pin, PIN below: the
//     newer of the two the product copies held on 7 Nov 2026 (dazzer v4.39.3; dazzer-app v4.39.1);
//   - no job-level or step-level if: on the analysis, no continue-on-error anywhere, no env:
//     anywhere in the analysis, and no run: step at all.
//
// test/runs-on.test.mjs reads the same file by its general rules (a scan job reading SCAN_RUNNER_2
// holds no write and no secret; a write-token job names a literal GitHub label) and holds it to
// the plain subset of YAML its header lists, so the reader below is a plain one: it reads that
// subset into keys and lists, and refuses a key written twice in any mapping. The kept cases at
// the end plant each refused shape into the real file's text and must be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../.github/workflows/codeql.yml', import.meta.url));
const WHERE = '.github/workflows/codeql.yml';
const SCAN = "${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}";
const LANGUAGES = '${{ fromJSON(inputs.languages) }}';
const LANGUAGE = '${{ matrix.language }}';
const CATEGORY = '/language:${{ matrix.language }}';
const ARTIFACT = 'codeql-sarif-${{ matrix.language }}';
// github/codeql-action v4.39.3, dazzer's pin on 7 Nov 2026, newer than dazzer-app's v4.39.1.
const PIN = '33d7b85da1a04171e211befe2c739303b9a4c066';
const CODEQL = 'github/codeql-action/';

// ---- THE READER: the plain subset into objects and lists ----
const isBlank = (l) => /^\s*(#.*)?$/.test(l);
const indentOf = (l) => l.match(/^ */)[0].length;
const KEY = /^(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1:(?: +(.*))?$/;
const ITEM = /^-( +|$)/;

function scalar(raw) {
  const s = raw.trim();
  if (s.startsWith("'")) return s.match(/^'((?:[^']|'')*)'/)[1].replaceAll("''", "'");
  if (s.startsWith('"')) return s.match(/^"([^"]*)"/)[1];
  if (s.startsWith('{}')) return {};
  if (s.startsWith('[')) return s.slice(1, s.indexOf(']')).split(',').map((x) => scalar(x)).filter((x) => x !== '');
  const k = s.search(/ #/);
  return (k < 0 ? s : s.slice(0, k)).trimEnd();
}

function parse(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  let i = 0;
  const skip = () => { while (i < lines.length && isBlank(lines[i])) i++; };
  const fail = (why) => { throw new Error(`Could not find a reading of ${WHERE}: line ${i + 1} ${why}`); };

  function node(minIndent) {
    skip();
    if (i >= lines.length) return null;
    const n = indentOf(lines[i]);
    if (n < minIndent) return null;
    return ITEM.test(lines[i].slice(n)) ? list(n) : map(n);
  }
  function valueAfter(rest, n) {
    const v = (rest ?? '').trim();
    if (v === '' || v.startsWith('#')) {
      skip();
      if (i >= lines.length) return null;
      const next = indentOf(lines[i]);
      if (next > n || (next === n && ITEM.test(lines[i].slice(n)))) return node(next);
      return null;
    }
    if (/^[|>][+-]?( *| +#.*)$/.test(v)) {
      const body = [];
      while (i < lines.length && (/^ *$/.test(lines[i]) || indentOf(lines[i]) > n)) body.push(lines[i++].trim());
      return body.join('\n').trim();
    }
    return scalar(v);
  }
  function map(n) {
    const out = {};
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (indentOf(l) !== n || ITEM.test(l.slice(n))) break;
      const m = l.slice(n).match(KEY);
      if (!m) fail(`reads ${l.trim()}, which is not a key line`);
      if (Object.hasOwn(out, m[2])) fail(`writes ${m[2]} a second time in one mapping`);
      i++;
      out[m[2]] = valueAfter(m[3], n);
    }
    return out;
  }
  function list(n) {
    const out = [];
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (indentOf(l) !== n || !ITEM.test(l.slice(n))) break;
      const dash = l.slice(n).match(ITEM)[0].length;
      const body = l.slice(n + dash);
      if (KEY.test(body)) {
        lines[i] = ' '.repeat(n + dash) + body;
        out.push(map(n + dash));
      } else {
        i++;
        out.push(scalar(body));
      }
    }
    return out;
  }
  const top = map(0);
  skip();
  if (i < lines.length) fail(`reads ${lines[i].trim()}, which no key above holds`);
  return { top, lines };
}

// ---- THE RULES ----
const keysOf = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const actionOf = (step) => String(step?.uses ?? '').split('@')[0];
const refOf = (step) => String(step?.uses ?? '').split('@')[1] ?? '';
// A secret, declared or read; the word inside a name (Secret detection) is not one.
const A_SECRET = /\bsecrets\s*(?:\.|\[)|^\s*(?:-\s+)?['"]?secrets['"]?\s*:/i;
const A_SETTING = /\bvars\b/i;

function judgeShared(text) {
  const refusals = [];
  const no = (what, why) => refusals.push(`Could not find ${what} in the shared scan ${WHERE}: ${why}.`);
  let read;
  try { read = parse(text); } catch (e) { return [e.message]; }
  const { top, lines } = read;

  // No secret, declared or read; one setting, SCAN_RUNNER_2, on the analysis job's machine line.
  const live = lines.map((l, n) => [l, n + 1]).filter(([l]) => !isBlank(l));
  for (const [l, n] of live) {
    if (A_SECRET.test(l)) no('a scan free of secrets', `line ${n} reads ${l.trim()}, and the shared scan declares no secret and reads none, so a caller never hands one to it`);
  }
  const settings = live.filter(([l]) => A_SETTING.test(l));
  for (const [l, n] of settings) {
    if (l.trim() !== `runs-on: ${SCAN}`) no('SCAN_RUNNER_2 as the only setting it reads', `line ${n} reads ${l.trim()}, and the shared scan reads no setting but SCAN_RUNNER_2, written ${SCAN} as the analysis job's machine`);
  }

  // Started by workflow_call alone, taking the languages as a JSON list.
  const on = top.on ?? top.true;
  if (!same(keysOf(on), ['workflow_call'])) {
    no('workflow_call as the only trigger', `it is started by ${show(on)}, and the shared scan runs only when a repository calls it, so its own repository's changes never start it and a change can never run its own copy`);
  }
  const call = on?.workflow_call;
  if (!same(keysOf(call), ['inputs'])) no('workflow_call holding inputs alone', `workflow_call holds ${show(call)}, and the scan takes no secret and gives no output`);
  if (!same(keysOf(call?.inputs), ['languages'])) no('languages as its one input', `its inputs are ${show(call?.inputs)}`);
  const input = call?.inputs?.languages;
  if (input?.type !== 'string' || input?.required !== 'true') no('languages as a required string input', `languages reads ${show(input)}, and a caller must name its languages, a JSON list in a string`);

  if (!same(top.permissions, { contents: 'read' })) no('contents: read as the workflow\'s token', `the workflow grants ${show(top.permissions)}`);
  if (!same(keysOf(top.jobs), ['analyze', 'upload'])) {
    no('the two jobs analyze and upload', `its jobs are ${show(keysOf(top.jobs))}`);
    return refusals;
  }

  // The analysis: one language per entry, read-only, on the scan machines, four steps.
  const a = top.jobs.analyze;
  if (a['runs-on'] !== SCAN) no(`${SCAN} as the analysis job's machine`, `it reads ${show(a['runs-on'])}, and the scan machines hold the analysis (decision 93), GitHub's while the setting is empty`);
  if (!same(a.permissions, { contents: 'read', actions: 'read' })) no('a read-only token on the analysis job, contents: read and actions: read alone', `it grants ${show(a.permissions)}, and a write token on a machine of ours sits within reach of whatever ran there before it (decision 36), so the analysis uploads nothing`);
  for (const k of ['if', 'continue-on-error', 'env', 'uses', 'secrets', 'container', 'services']) {
    if (k in a) no(`the analysis job without ${k}:`, `it writes ${k}: ${show(a[k])}`);
  }
  if (a.strategy?.matrix?.language !== LANGUAGES || !same(keysOf(a.strategy?.matrix), ['language'])) no(`one analysis per language, the matrix ${LANGUAGES}`, `its matrix reads ${show(a.strategy?.matrix)}`);
  if (a.strategy?.['fail-fast'] !== 'false') no('fail-fast: false on the analysis', 'one language failing must not cancel the others');
  const steps = Array.isArray(a.steps) ? a.steps : [];
  const want = ['actions/checkout', `${CODEQL}init`, `${CODEQL}analyze`, 'actions/upload-artifact'];
  if (!same(steps.map(actionOf), want)) no(`the analysis's four steps (${want.join(', ')})`, `its steps use ${show(steps.map(actionOf))}`);
  for (const s of steps) {
    for (const k of ['if', 'continue-on-error', 'env', 'run']) if (k in s) no(`step ${actionOf(s)} without ${k}:`, `it writes ${k}: ${show(s[k])}`);
  }
  const [checkout, init, analyze, keep] = steps;
  if (!same(checkout?.with, { 'fetch-depth': '1', 'persist-credentials': 'false' })) no('a checkout of one commit keeping no credential (fetch-depth: 1, persist-credentials: false, and nothing else)', `the checkout takes ${show(checkout?.with)}`);
  if (!same(init?.with, { languages: LANGUAGE, 'build-mode': 'none', queries: 'security-extended' })) no('init with the language, build-mode none and the security-extended suite, and nothing else', `init takes ${show(init?.with)}`);
  const aw = analyze?.with ?? {};
  if (aw.category !== CATEGORY || aw.upload !== 'never' || aw['upload-database'] !== 'false' || !aw['post-processed-sarif-path'] || !same(keysOf(aw), ['category', 'upload', 'upload-database', 'output', 'post-processed-sarif-path'])) {
    no(`analyze with the category ${CATEGORY}, upload: never, upload-database: false and its two outputs`, `analyze takes ${show(analyze?.with)}`);
  }
  const kw = keep?.with ?? {};
  if (kw.name !== ARTIFACT || kw.path !== aw['post-processed-sarif-path'] || kw['if-no-files-found'] !== 'error' || !/^[1-9][0-9]*$/.test(kw['retention-days'] ?? '')) {
    no(`the results kept as the artifact ${ARTIFACT}, from analyze's post-processed results, refusing an empty one`, `upload-artifact takes ${show(keep?.with)}`);
  }

  // The upload: GitHub's machine, the only write, each language under its category.
  const u = top.jobs.upload;
  if (u['runs-on'] !== 'ubuntu-latest') no('ubuntu-latest, written as a literal label, as the upload job\'s machine', `it reads ${show(u['runs-on'])}, and the one job holding security-events: write stays on GitHub's computers (decision 36)`);
  if (!same(u.permissions, { contents: 'read', actions: 'read', 'security-events': 'write' })) no('contents: read, actions: read and security-events: write as the upload job\'s token', `it grants ${show(u.permissions)}`);
  if (u.needs !== 'analyze') no('the upload waiting on the analysis', `its needs: reads ${show(u.needs)}`);
  for (const k of ['continue-on-error', 'env', 'uses', 'secrets', 'container', 'services']) {
    if (k in u) no(`the upload job without ${k}:`, `it writes ${k}: ${show(u[k])}`);
  }
  if (u.strategy?.matrix?.language !== LANGUAGES || !same(keysOf(u.strategy?.matrix), ['language'])) no(`one upload per language, the matrix ${LANGUAGES}`, `its matrix reads ${show(u.strategy?.matrix)}`);
  const usteps = Array.isArray(u.steps) ? u.steps : [];
  const uwant = ['actions/download-artifact', `${CODEQL}upload-sarif`];
  if (!same(usteps.map(actionOf), uwant)) no(`the upload's two steps (${uwant.join(', ')}), checking nothing out`, `its steps use ${show(usteps.map(actionOf))}`);
  for (const s of usteps) {
    for (const k of ['if', 'continue-on-error', 'env', 'run']) if (k in s) no(`step ${actionOf(s)} without ${k}:`, `it writes ${k}: ${show(s[k])}`);
  }
  const [fetch, upload] = usteps;
  if (fetch?.with?.name !== ARTIFACT || !fetch?.with?.path) no(`the artifact ${ARTIFACT} fetched by name, so a missing one fails the upload`, `download-artifact takes ${show(fetch?.with)}`);
  if (!same(upload?.with, { sarif_file: fetch?.with?.path, category: CATEGORY })) no(`each language's results uploaded from the fetched path under the category ${CATEGORY}`, `upload-sarif takes ${show(upload?.with)}`);

  // Every action by commit; CodeQL's three by one pin.
  for (const s of [...steps, ...usteps]) {
    if (!/^[0-9a-f]{40}$/.test(refOf(s))) no(`a commit as the ref of ${actionOf(s)}`, `it is used at ${show(s?.uses)}`);
  }
  const codeqlRefs = [...steps, ...usteps].filter((s) => actionOf(s).startsWith(CODEQL)).map(refOf);
  if (!codeqlRefs.length || codeqlRefs.some((r) => r !== PIN)) no(`one pin, ${PIN} (v4.39.3), for CodeQL's actions`, `they are used at ${show(codeqlRefs)}`);
  return refusals;
}

function readFile() {
  assert.ok(fs.existsSync(FILE), `Could not find the shared scan ${WHERE}: every repository calls it in place of a CodeQL copy of its own (decision 118)`);
  return fs.readFileSync(FILE, 'utf8');
}

test('the shared CodeQL scan scans what it says and holds no more than it needs', () => {
  const refusals = judgeShared(readFile());
  assert.ok(refusals.length === 0, refusals.join('\n'));
});

// ---- KEPT CASES: each plant into the real file must be refused ----
function plant(name, change, says) {
  test(`kept case, refused: ${name}`, () => {
    const real = readFile();
    const text = change(real);
    assert.ok(text !== real, `Could not find the place to plant ${name} in ${WHERE}: the plant changed nothing, so this case would prove nothing`);
    const refusals = judgeShared(text);
    assert.ok(refusals.length > 0, `Could not find any refusal of ${name}: the shared scan passed with it`);
    assert.ok(refusals.some((r) => says.test(r)), `Could not find a refusal of ${name} saying ${says}: the reader said ${refusals.join(' | ')}`);
  });
}
// Plants read the text line by line, never by a pattern over the joined text.
// A top key's block, from its line to the next empty or column-zero line, replaced whole.
function replaceTopKey(t, key, lines) {
  const all = t.split('\n');
  const start = all.indexOf(`${key}:`);
  if (start < 0) return t;
  let end = start + 1;
  while (end < all.length && all[end] !== '' && all[end].startsWith(' ')) end++;
  return [...all.slice(0, start), ...lines, ...all.slice(end)].join('\n');
}
// The first line equal to `from` inside job `job` (its id line to the next line at two spaces or
// less, empty lines inside it), replaced by `to`.
function replaceInJob(t, job, from, to) {
  const all = t.split('\n');
  const start = all.indexOf(`  ${job}:`);
  if (start < 0) return t;
  for (let k = start + 1; k < all.length; k++) {
    if (all[k].trim() !== '' && !all[k].startsWith('    ')) break;
    if (all[k] === from) { all[k] = to; return all.join('\n'); }
  }
  return t;
}
const ANALYZE_GRANT = '    permissions:\n      contents: read\n      actions: read\n';
const KEEP_NO_CREDENTIAL = '          persist-credentials: false\n';

// A write on the analysis job.
plant('a write on the analysis job', (t) => t.replace(ANALYZE_GRANT, `${ANALYZE_GRANT}      security-events: write\n`), /read-only token on the analysis job/);
plant('write-all on the analysis job', (t) => t.replace(ANALYZE_GRANT, '    permissions: write-all\n'), /read-only token on the analysis job/);
// A secret, read or declared.
plant('a secret read by the checkout', (t) => t.replace(KEEP_NO_CREDENTIAL, `${KEEP_NO_CREDENTIAL}          token: \${{ secrets.SCAN_TOKEN }}\n`), /free of secrets in the shared scan \S+: line \d+ reads token: \$\{\{ secrets\.SCAN_TOKEN/);
plant('a secret declared under workflow_call', (t) => t.replace('  workflow_call:\n', '  workflow_call:\n    secrets:\n      SCAN_TOKEN:\n        required: false\n'), /free of secrets in the shared scan \S+: line \d+ reads secrets:/);
// A setting other than SCAN_RUNNER_2.
plant('the analysis on the change-check machines', (t) => t.replace(`runs-on: ${SCAN}`, "runs-on: ${{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}"), /SCAN_RUNNER_2 as the only setting it reads in the shared scan \S+: line \d+ reads runs-on: \$\{\{ vars\.CHECKS_RUNNER_2/);
plant('another setting read in a step', (t) => t.replace(KEEP_NO_CREDENTIAL, `${KEEP_NO_CREDENTIAL}          ref: \${{ vars.SCAN_REF }}\n`), /SCAN_RUNNER_2 as the only setting it reads in the shared scan \S+: line \d+ reads ref: \$\{\{ vars\.SCAN_REF/);
// A trigger other than workflow_call.
plant('a pull_request trigger beside workflow_call', (t) => t.replace('on:\n  workflow_call:\n', 'on:\n  pull_request:\n  workflow_call:\n'), /workflow_call as the only trigger/);
plant('push in place of workflow_call', (t) => replaceTopKey(t, 'on', ['on:', '  push:']), /workflow_call as the only trigger/);
// What is scanned and where the write sits.
plant('the upload on the scan machines', (t) => replaceInJob(t, 'upload', '    runs-on: ubuntu-latest', `    runs-on: ${SCAN}`), /ubuntu-latest, written as a literal label, as the upload job's machine/);
plant('analyze uploading on its own', (t) => t.replace('          upload: never\n', '          upload: always\n'), /upload: never/);
plant('a narrower query suite', (t) => t.replace('queries: security-extended', 'queries: security-and-quality-lite'), /security-extended suite/);
plant('a skipped analysis', (t) => t.replace(ANALYZE_GRANT, `${ANALYZE_GRANT}    if: false\n`), /analysis job without if:/);
plant('another category on upload', (t) => t.replace(`          category: ${CATEGORY}\n          upload: never`, `          category: /scan:\${{ matrix.language }}\n          upload: never`), /category \/language:/);
plant('an older CodeQL pin on one action', (t) => t.replace(`${CODEQL}init@${PIN}`, `${CODEQL}init@9b3254085494b55a0f7c4c2b3d2d52cc712ce370`), /one pin, 33d7b85/);
plant('a key written twice', (t) => t.replace('          upload: never\n', '          upload: never\n          upload: always\n'), /a second time in one mapping/);
