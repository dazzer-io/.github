// The shared CodeQL scan, .github/workflows/codeql.yml: the one code scan every dazzer-io
// repository calls (decisions 118 and 119), in place of a copy of its own. This test pins what it
// scans and what it may hold, so a weakened scan goes red here, and a red line here shows up in
// the change's diff beside the workflow's:
//
//   - it is started only by workflow_call, taking one input, languages, a JSON list as a string;
//   - it declares no secret and reads none: no line GitHub reads holds the word secrets, so a
//     secrets: key, a secrets. or secrets[ read and the whole context (toJSON(secrets)) are all
//     refused, a line starting with # inside a | or > block among the lines read, since GitHub
//     evaluates an expression there;
//   - it reads one setting, SCAN_RUNNER_2, as the analysis job's machine and nowhere else:
//     ${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}, so an empty setting keeps it on GitHub's
//     computers (decision 93). A called workflow reads its caller's variables (docs.github.com,
//     Variables reference: "For reusable workflows, the variables from the caller workflow's
//     repository are used."), so the setting resolves as the calling repository sees it;
//   - its top holds exactly name, on, permissions (contents: read) and jobs; each job holds exactly
//     the keys it holds today, each step exactly name, uses and with, and each step's with: exactly
//     its inputs, so a key this test does not name (an env:, defaults:, concurrency:,
//     environment:, if: or continue-on-error:, a download's github-token or run-id) is refused;
//   - its two jobs, analyze and upload, line for line where it matters: analyze holds contents:
//     read and actions: read and nothing more, runs one language per matrix entry, read from the
//     input, and runs exactly four steps (a checkout of one commit keeping no credential, CodeQL's
//     init with build-mode none and the security-extended suite, analyze with upload: never and
//     the category /language:<language>, and the results kept as an artifact); upload runs on
//     GitHub's own ubuntu-latest, written as a literal label, is the only job holding
//     security-events: write (decision 36 keeps the write off our machines), runs only when every
//     language's analysis succeeded (if: needs.analyze.result == 'success'), so a partial scan
//     never passes (decisions 101 and 131), checks nothing out, and hands each language's results
//     to code scanning under the same category;
//   - every action is pinned by commit, and CodeQL's three actions share one pin, PIN below: the
//     newer of the two the product copies held on 7 Nov 2026 (dazzer v4.39.3; dazzer-app v4.39.1).
//
// test/runs-on.test.mjs reads the same file by its general rules (a scan job reading SCAN_RUNNER_2
// holds no write and no secret; a write-token job names a literal GitHub label) and holds it to
// the plain subset of YAML its header lists, so the reader below is a plain one: it reads that
// subset into keys and lists, and refuses a key written twice in any mapping. The kept cases at
// the end plant into the real file's text at least one fault for every refusal judgeShared makes,
// each named for the part it plants into, and each must be refused with that refusal's words.
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
  const original = [...lines];
  // The lines of a | or > block's body, by line number: GitHub evaluates an expression on each,
  // one starting with # included, so they are read as text, never as comments.
  const blockLines = new Set();
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
      while (i < lines.length && (/^ *$/.test(lines[i]) || indentOf(lines[i]) > n)) { blockLines.add(i + 1); body.push(lines[i++].trim()); }
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
  return { top, lines: original, blockLines };
}

// ---- THE RULES ----
const keysOf = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exactly = (o, keys) => same([...keysOf(o)].sort(), [...keys].sort());
const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const actionOf = (step) => String(step?.uses ?? '').split('@')[0];
const refOf = (step) => String(step?.uses ?? '').split('@')[1] ?? '';
// A secret, declared or read, the whole context among them: any line holding the word secrets.
const A_SECRET = /\bsecrets\b/i;
const A_SETTING = /\bvars\b/i;
const MATRIX = { 'fail-fast': 'false', matrix: { language: LANGUAGES } };
const STEP_KEYS = ['name', 'uses', 'with'];
const TOP_KEYS = ['name', 'on', 'permissions', 'jobs'];
const ANALYZE_KEYS = ['name', 'runs-on', 'timeout-minutes', 'permissions', 'strategy', 'steps'];
const UPLOAD_KEYS = ['name', 'needs', 'if', 'runs-on', 'timeout-minutes', 'permissions', 'strategy', 'steps'];
const ALL_SUCCEEDED = "${{ needs.analyze.result == 'success' }}";

function judgeShared(text) {
  const refusals = [];
  const no = (what, why) => refusals.push(`Could not find ${what} in the shared scan ${WHERE}: ${why}.`);
  let read;
  try { read = parse(text); } catch (e) { return [e.message]; }
  const { top, lines, blockLines } = read;

  // No secret, declared or read; one setting, SCAN_RUNNER_2, on the analysis job's machine line.
  // A block's body is read whole, its # lines included.
  const live = lines.map((l, n) => [l, n + 1]).filter(([l, n]) => !isBlank(l) || (l.trim() !== '' && blockLines.has(n)));
  for (const [l, n] of live) {
    if (A_SECRET.test(l)) no('a scan free of secrets', `line ${n} reads ${l.trim()}, and the shared scan declares no secret and reads none, so a caller never hands one to it`);
  }
  for (const [l, n] of live.filter(([l]) => A_SETTING.test(l))) {
    if (l.trim() !== `runs-on: ${SCAN}`) no('SCAN_RUNNER_2 as the only setting it reads', `line ${n} reads ${l.trim()}, and the shared scan reads no setting but SCAN_RUNNER_2, written ${SCAN} as the analysis job's machine`);
  }

  // The top, whole.
  if (!exactly(top, TOP_KEYS)) no(`the workflow's top holding exactly ${TOP_KEYS.join(', ')}`, `it holds ${show(keysOf(top))}, and a key at the top (an env:, defaults: or concurrency:) reaches every job`);
  const on = top.on ?? top.true;
  if (!same(keysOf(on), ['workflow_call'])) {
    no('workflow_call as the only trigger', `it is started by ${show(on)}, and the shared scan runs only when a repository calls it, so its own repository's changes never start it and a change can never run its own copy`);
  }
  const call = on?.workflow_call;
  if (!same(keysOf(call), ['inputs'])) no('workflow_call holding inputs alone', `workflow_call holds ${show(call)}, and the scan takes no secret and gives no output`);
  if (!same(keysOf(call?.inputs), ['languages'])) no('languages as its one input', `its inputs are ${show(call?.inputs)}`);
  const input = call?.inputs?.languages;
  if (!exactly(input, ['description', 'required', 'type']) || input?.type !== 'string' || input?.required !== 'true') {
    no('languages as a required string input, holding description, required and type alone', `languages reads ${show(input)}, and a caller must name its languages, a JSON list in a string`);
  }
  if (!same(top.permissions, { contents: 'read' })) no('contents: read as the workflow\'s token', `the workflow grants ${show(top.permissions)}`);
  if (!exactly(top.jobs, ['analyze', 'upload'])) {
    no('the two jobs analyze and upload', `its jobs are ${show(keysOf(top.jobs))}`);
    return refusals;
  }
  const stepsOf = (job, name, want) => {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    if (!same(steps.map(actionOf), want)) no(`the ${name}'s steps, exactly ${want.join(', ')}`, `its steps use ${show(steps.map(actionOf))}`);
    for (const st of steps) {
      if (!exactly(st, STEP_KEYS)) no(`step ${actionOf(st)} of the ${name} holding exactly ${STEP_KEYS.join(', ')}`, `it holds ${show(keysOf(st))}, and a step's if:, env:, run: or continue-on-error: changes what the scan does`);
    }
    return steps;
  };

  // The analysis: one language per entry, read-only, on the scan machines, four steps.
  const a = top.jobs.analyze;
  if (!exactly(a, ANALYZE_KEYS)) no(`the analysis job holding exactly ${ANALYZE_KEYS.join(', ')}`, `it holds ${show(keysOf(a))}, and a key it does not name (an if:, an environment:, an env:) changes when or how it scans`);
  if (a['runs-on'] !== SCAN) no(`${SCAN} as the analysis job's machine`, `it reads ${show(a['runs-on'])}, and the scan machines hold the analysis (decision 93), GitHub's while the setting is empty`);
  if (!same(a.permissions, { contents: 'read', actions: 'read' })) no('a read-only token on the analysis job, contents: read and actions: read alone', `it grants ${show(a.permissions)}, and a write token on a machine of ours sits within reach of whatever ran there before it (decision 36), so the analysis uploads nothing`);
  if (!same(a.strategy, MATRIX)) no(`one analysis per language, the strategy exactly fail-fast: false and the matrix ${LANGUAGES}`, `its strategy reads ${show(a.strategy)}`);
  const want = ['actions/checkout', `${CODEQL}init`, `${CODEQL}analyze`, 'actions/upload-artifact'];
  const steps = stepsOf(a, 'analysis', want);
  const [checkout, init, analyze, keep] = steps;
  if (!same(checkout?.with, { 'fetch-depth': '1', 'persist-credentials': 'false' })) no('a checkout of one commit keeping no credential (fetch-depth: 1, persist-credentials: false, and nothing else)', `the checkout takes ${show(checkout?.with)}`);
  if (!same(init?.with, { languages: LANGUAGE, 'build-mode': 'none', queries: 'security-extended' })) no('init with the language, build-mode none and the security-extended suite, and nothing else', `init takes ${show(init?.with)}`);
  const aw = analyze?.with ?? {};
  if (aw.category !== CATEGORY || aw.upload !== 'never' || aw['upload-database'] !== 'false' || !aw['post-processed-sarif-path'] || !exactly(aw, ['category', 'upload', 'upload-database', 'output', 'post-processed-sarif-path'])) {
    no(`the analyze step with the category ${CATEGORY}, upload: never, upload-database: false and its two outputs, and nothing else`, `analyze takes ${show(analyze?.with)}`);
  }
  const kw = keep?.with ?? {};
  if (kw.name !== ARTIFACT || kw.path !== aw['post-processed-sarif-path'] || kw['if-no-files-found'] !== 'error' || !/^[1-9][0-9]*$/.test(kw['retention-days'] ?? '') || !exactly(kw, ['name', 'path', 'if-no-files-found', 'retention-days'])) {
    no(`the results kept as the artifact ${ARTIFACT}, from analyze's post-processed results, refusing an empty one, kept some days, and nothing else`, `upload-artifact takes ${show(keep?.with)}`);
  }

  // The upload: GitHub's machine, the only write, every language or none.
  const u = top.jobs.upload;
  if (!exactly(u, UPLOAD_KEYS)) no(`the upload job holding exactly ${UPLOAD_KEYS.join(', ')}`, `it holds ${show(keysOf(u))}`);
  if (u['runs-on'] !== 'ubuntu-latest') no('ubuntu-latest, written as a literal label, as the upload job\'s machine', `it reads ${show(u['runs-on'])}, and the one job holding security-events: write stays on GitHub's computers (decision 36)`);
  if (!same(u.permissions, { contents: 'read', actions: 'read', 'security-events': 'write' })) no('contents: read, actions: read and security-events: write as the upload job\'s token, and nothing else', `it grants ${show(u.permissions)}`);
  if (u.needs !== 'analyze') no('the upload waiting on the analysis', `its needs: reads ${show(u.needs)}`);
  if (u.if !== ALL_SUCCEEDED) no(`the upload running only when every language's analysis succeeded (if: ${ALL_SUCCEEDED})`, `its if: reads ${show(u.if)}, and a partial scan never passes (decisions 101 and 131): a failed or cancelled analysis uploads nothing and the run is red`);
  if (!same(u.strategy, MATRIX)) no(`one upload per language, the strategy exactly fail-fast: false and the matrix ${LANGUAGES}`, `its strategy reads ${show(u.strategy)}`);
  const usteps = stepsOf(u, 'upload', ['actions/download-artifact', `${CODEQL}upload-sarif`]);
  const [fetch, upload] = usteps;
  if (fetch?.with?.name !== ARTIFACT || !fetch?.with?.path || !exactly(fetch?.with, ['name', 'path'])) no(`the artifact ${ARTIFACT} of this run fetched by name and path alone, so a missing one fails the upload`, `download-artifact takes ${show(fetch?.with)}`);
  if (!same(upload?.with, { sarif_file: fetch?.with?.path, category: CATEGORY })) no(`upload-sarif sending the fetched results under the category ${CATEGORY}, and nothing else`, `upload-sarif takes ${show(upload?.with)}`);

  // Every action by commit; CodeQL's three by one pin.
  for (const st of [...steps, ...usteps]) {
    if (!/^[0-9a-f]{40}$/.test(refOf(st))) no(`a commit as the ref of ${actionOf(st)}`, `it is used at ${show(st?.uses)}`);
  }
  const codeqlRefs = [...steps, ...usteps].filter((st) => actionOf(st).startsWith(CODEQL)).map(refOf);
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
const ATOP = (lines) => (t) => t.replace('\npermissions:\n', `\n${lines.join('\n')}\n\npermissions:\n`);
const SECRET = '${{ secrets.SCAN_TOKEN }}';
// Into the step whose uses: line starts with `action`, after its `with:` line, the given lines.
const intoWith = (action, add) => (t) => {
  const all = t.split('\n');
  const at = all.findIndex((l) => l.trim().startsWith(`uses: ${action}@`));
  if (at < 0 || all[at + 1]?.trim() !== 'with:') return t;
  all.splice(at + 2, 0, ...add);
  return all.join('\n');
};
const inJob = (job, from, to) => (t) => replaceInJob(t, job, from, to);

// The top: exactly name, on, permissions and jobs.
plant('an env: at the top', ATOP(['env:', '  CODEQL_ACTION_EXTRA_OPTIONS: "{}"']), /the workflow's top holding exactly name, on, permissions, jobs/);
plant('defaults: at the top', ATOP(['defaults:', '  run:', '    shell: bash']), /the workflow's top holding exactly/);
plant('concurrency: at the top', ATOP(['concurrency:', '  group: codeql', '  cancel-in-progress: true']), /the workflow's top holding exactly/);
plant('a write at the top', (t) => t.replace('\npermissions:\n  contents: read\n', '\npermissions: write-all\n'), /contents: read as the workflow's token/);
plant('a third job', (t) => `${t.trimEnd()}\n\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n`, /the two jobs analyze and upload/);
// A trigger other than workflow_call, and workflow_call's shape.
plant('a pull_request trigger beside workflow_call', (t) => t.replace('on:\n  workflow_call:\n', 'on:\n  pull_request:\n  workflow_call:\n'), /workflow_call as the only trigger/);
plant('push in place of workflow_call', (t) => replaceTopKey(t, 'on', ['on:', '  push:']), /workflow_call as the only trigger/);
plant('an output declared under workflow_call', (t) => t.replace('  workflow_call:\n', '  workflow_call:\n    outputs: {}\n'), /workflow_call holding inputs alone/);
plant('a second input', (t) => t.replace('        type: string\n', '        type: string\n      ref:\n        type: string\n'), /languages as its one input/);
plant('the languages input not required', (t) => t.replace('        required: true\n', '        required: false\n'), /languages as a required string input/);
plant('the languages input with a default', (t) => t.replace('        type: string\n', '        type: string\n        default: "[]"\n'), /languages as a required string input/);
// A secret, read, declared or read whole, on any line GitHub reads.
plant('a secret read by the checkout', (t) => t.replace(KEEP_NO_CREDENTIAL, `${KEEP_NO_CREDENTIAL}          token: ${SECRET}\n`), /free of secrets in the shared scan \S+: line \d+ reads token: \$\{\{ secrets\.SCAN_TOKEN/);
plant('a secret declared under workflow_call', (t) => t.replace('  workflow_call:\n', '  workflow_call:\n    secrets:\n      SCAN_TOKEN:\n        required: false\n'), /free of secrets in the shared scan \S+: line \d+ reads secrets:/);
plant('the whole secrets context in an env at the top', ATOP(['env:', '  ALL: ${{ toJSON(secrets) }}']), /free of secrets in the shared scan \S+: line \d+ reads ALL: \$\{\{ toJSON\(secrets\) \}\}/);
plant('a secret on a # line inside a | block of upload-artifact\'s input', intoWith('actions/upload-artifact', ['          compression-level: |', `            # ${SECRET}`]), /free of secrets in the shared scan \S+: line \d+ reads # \$\{\{ secrets\.SCAN_TOKEN \}\}/);
// A setting other than SCAN_RUNNER_2.
plant('the analysis on the change-check machines', (t) => t.replace(`runs-on: ${SCAN}`, "runs-on: ${{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}"), /SCAN_RUNNER_2 as the only setting it reads in the shared scan \S+: line \d+ reads runs-on: \$\{\{ vars\.CHECKS_RUNNER_2/);
plant('another setting read in a step', (t) => t.replace(KEEP_NO_CREDENTIAL, `${KEEP_NO_CREDENTIAL}          ref: \${{ vars.SCAN_REF }}\n`), /SCAN_RUNNER_2 as the only setting it reads in the shared scan \S+: line \d+ reads ref: \$\{\{ vars\.SCAN_REF/);
// The analysis job.
plant('a write on the analysis job', (t) => t.replace(ANALYZE_GRANT, `${ANALYZE_GRANT}      security-events: write\n`), /read-only token on the analysis job/);
plant('write-all on the analysis job', (t) => t.replace(ANALYZE_GRANT, '    permissions: write-all\n'), /read-only token on the analysis job/);
plant('a skipped analysis (if: on the analysis job)', (t) => t.replace(ANALYZE_GRANT, `${ANALYZE_GRANT}    if: false\n`), /the analysis job holding exactly name, runs-on/);
plant('environment: on the analysis job', (t) => t.replace(ANALYZE_GRANT, `${ANALYZE_GRANT}    environment: scan\n`), /the analysis job holding exactly name, runs-on/);
plant('the analysis on a literal GitHub label', inJob('analyze', `    runs-on: ${SCAN}`, '    runs-on: ubuntu-latest'), /\$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\} as the analysis job's machine/);
plant('fail-fast on the analysis', inJob('analyze', '      fail-fast: false', '      fail-fast: true'), /one analysis per language, the strategy exactly/);
plant('a fifth step on the analysis', ((t) => t.replace('          retention-days: 7\n', '          retention-days: 7\n\n      - name: Extra\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n')), /the analysis's steps, exactly actions\/checkout/);
plant('env: on a step of the analysis', (t) => t.replace('      - name: Initialize CodeQL\n', '      - name: Initialize CodeQL\n        env:\n          CODEQL_EXTRACTOR_JAVASCRIPT_OPTION_SKIP_TYPES: "true"\n'), /step github\/codeql-action\/init of the analysis holding exactly name, uses, with/);
plant('a checkout keeping its credential', (t) => t.replace(KEEP_NO_CREDENTIAL, '          persist-credentials: true\n'), /a checkout of one commit keeping no credential/);
plant('a narrower query suite', (t) => t.replace('queries: security-extended', 'queries: security-and-quality-lite'), /security-extended suite/);
plant('an init config file', intoWith(`${CODEQL}init`, ['          config-file: ./.github/codeql.yml']), /security-extended suite, and nothing else/);
plant('the analyze step uploading on its own', (t) => t.replace('          upload: never\n', '          upload: always\n'), /the analyze step with the category/);
plant('another category on the analyze step', (t) => t.replace(`          category: ${CATEGORY}\n          upload: never`, `          category: /scan:\${{ matrix.language }}\n          upload: never`), /the analyze step with the category \/language:/);
plant('an empty artifact allowed', (t) => t.replace('          if-no-files-found: error\n', '          if-no-files-found: warn\n'), /the results kept as the artifact/);
plant('another input on upload-artifact', intoWith('actions/upload-artifact', ['          overwrite: true']), /the results kept as the artifact .*and nothing else/);
// The upload job.
plant('the upload on the scan machines', inJob('upload', '    runs-on: ubuntu-latest', `    runs-on: ${SCAN}`), /ubuntu-latest, written as a literal label, as the upload job's machine/);
plant('the upload only on a push', inJob('upload', `    if: ${ALL_SUCCEEDED}`, "    if: github.event_name == 'push'"), /the upload running only when every language's analysis succeeded/);
plant('the upload on a partial result', inJob('upload', `    if: ${ALL_SUCCEEDED}`, '    if: ${{ !cancelled() }}'), /the upload running only when every language's analysis succeeded/);
plant('continue-on-error on the upload job', inJob('upload', '    needs: analyze', '    needs: analyze\n    continue-on-error: true'), /the upload job holding exactly name, needs, if/);
plant('the upload without security-events: write', inJob('upload', '      security-events: write', '      security-events: read'), /security-events: write as the upload job's token/);
plant('the upload not waiting on the analysis', inJob('upload', '    needs: analyze', '    needs: []'), /the upload waiting on the analysis/);
plant('fail-fast on the upload', inJob('upload', '      fail-fast: false', '      fail-fast: true'), /one upload per language, the strategy exactly/);
plant('another matrix on the upload', (t) => { const all = t.split('\n'); const u = all.indexOf('  upload:'); const k = all.findIndex((l, n) => n > u && l === `        language: ${LANGUAGES}`); if (k < 0) return t; all[k] = '        language: [actions]'; return all.join('\n'); }, /one upload per language, the strategy exactly/);
plant('a checkout on the upload', (t) => t.replace('      - name: Fetch this language\'s results\n', '      - name: Check out\n        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n\n      - name: Fetch this language\'s results\n'), /the upload's steps, exactly actions\/download-artifact/);
plant('if: on the upload-sarif step', (t) => t.replace('      - name: Upload the results under the language\'s category\n', '      - name: Upload the results under the language\'s category\n        if: github.event_name == \'push\'\n'), /step github\/codeql-action\/upload-sarif of the upload holding exactly/);
plant('another artifact fetched', (t) => t.replace(`        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2\n        with:\n          name: ${ARTIFACT}\n`, '        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2\n        with:\n          name: codeql-sarif-actions\n'), /the artifact codeql-sarif-\$\{\{ matrix\.language \}\} of this run fetched by name and path alone/);
plant('an older run\'s artifact fetched', intoWith('actions/download-artifact', ['          github-token: ${{ github.token }}', '          run-id: 1']), /fetched by name and path alone/);
plant('another category on upload-sarif', (t) => t.replace(`          sarif_file: \${{ runner.temp }}/codeql-sarif\n          category: ${CATEGORY}`, '          sarif_file: ${{ runner.temp }}/codeql-sarif\n          category: /scan:${{ matrix.language }}'), /upload-sarif sending the fetched results under the category/);
plant('upload-sarif sending another file', (t) => t.replace('          sarif_file: ${{ runner.temp }}/codeql-sarif\n', '          sarif_file: results.sarif\n'), /upload-sarif sending the fetched results/);
// Pins.
plant('an action by tag', (t) => t.replace('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7'), /a commit as the ref of actions\/checkout/);
plant('an older CodeQL pin on one action', (t) => t.replace(`${CODEQL}init@${PIN}`, `${CODEQL}init@9b3254085494b55a0f7c4c2b3d2d52cc712ce370`), /one pin, 33d7b85/);
// The reader.
plant('a key written twice', (t) => t.replace('          upload: never\n', '          upload: never\n          upload: always\n'), /a second time in one mapping/);
