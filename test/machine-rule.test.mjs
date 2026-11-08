// Proves machine-rule/judge.mjs, the organisation's one machine rule (decision 121), and its three
// lists, kept.json, secrets.json and strict.json. It replaces this repository's runs-on test and
// ports the kept cases of the four copies the rule replaces, each section naming the copy it ports:
//   - dazzer's gate, scripts/checks/check-runner-setting.mjs and its test, at 58797b699;
//   - dazzer-app's verdict test, test/verdict.test.ts (holdsMoreThanTheCode), at 4b236f2e;
//   - this repository's runs-on test, at dca1d18, the test file this one replaces;
//   - runners' bin/check-repos-read-setting.mjs, its test and test/scan.test.mjs's gate S6, at 789b335.
// Every case is fed to the judge as text, under a made-up workflow name, and a fake GitHub is
// reached only through the call handed to the readings: nothing here reaches the network. Every
// failure starts "Could not find", so a run with the rule missing, or any planted fault, reads red
// in those words; a table of cases fails once with every case that missed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let J = null;
let missing = null;
try {
  J = await import('../machine-rule/judge.mjs');
} catch (e) {
  missing = e;
}
const need = () => assert.ok(J, `Could not find machine-rule/judge.mjs, the one machine rule: ${missing?.message ?? 'it did not load'}`);
const lists = () => J.readLists();

// Fixtures write @{{ for ${{, so a template literal never reads them as its own.
const wf = (text) => text.replace(/@\{\{/g, '${{');
const NO_GITHUB = async () => { throw new Error('this case may not reach GitHub'); };

async function judgeOf(files, ctx = {}) {
  const fileList = Object.entries(files).map(([name, text]) => ({ path: `.github/workflows/${name}`, text: wf(text) }));
  return J.judgeFiles({ repository: 'dazzer-io/dazzer', visibility: 'private', ...lists(), compare: NO_GITHUB, ...ctx, files: fileList });
}
const said = (r) => r.lines.join('\n') || '(nothing refused)';

// Every case of a test is tried, and the test fails once with each case that missed.
async function everyCase(body) {
  const misses = [];
  await body(async (f) => {
    try {
      return await f();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      misses.push(e.message.slice(0, 900));
      return null;
    }
  });
  assert.ok(!misses.length, misses.join('\n'));
}
// Every refusal case seen passing, so the last test can run each one again in the other shapes a
// job takes (decision 184).
const RECORDED = [];
// A refusal of <file> (and <job>) whose words match says, on the line holding at when given.
async function mustRefuse(name, files, ctx, { file, job, says, at }) {
  const r = await judgeOf(files, ctx);
  const text = wf(files[file] ?? '');
  const line = at ? text.split('\n').findIndex((l) => l.includes(wf(at))) + 1 : 0;
  const hit = r.lines.find((l) => l.startsWith(`.github/workflows/${file}:${line || ''}`) && (job === undefined || l.includes(` jobs.${job}: `)) && (!says || says.test(l)));
  assert.ok(hit, `Could not find a refusal of ${name}${job ? ` (jobs.${job})` : ''}${line ? ` on line ${line}` : ''}${says ? ` saying ${says}` : ''}: the rule said\n${said(r)}`);
  RECORDED.push({ name, files, ctx: ctx ?? {}, file, job, says, lines: r.lines });
  return r;
}
async function mustPass(name, files, ctx = {}, { file, job } = {}) {
  const r = await judgeOf(files, ctx);
  const hits = r.lines.filter((l) => (!file || l.startsWith(`.github/workflows/${file}:`)) && (!job || l.includes(` jobs.${job}: `)));
  assert.ok(!hits.length, `Could not find a clean reading of ${name}: the rule said\n${hits.join('\n')}`);
  return r;
}

const STEPS = '    steps:\n      - run: echo made-up\n';
const CHECKS2 = "@{{ vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}";
const LOCKED2 = "@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_2 || 'ubuntu-latest' }}";
const SCAN = "@{{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}";
const job = (id, runsOn, extra = '', steps = STEPS) => `  ${id}:\n    runs-on: ${runsOn}\n${extra}${steps}`;
const workflow = (on, top, ...jobs) => `name: made up\non:${on.startsWith('\n') ? on : ` ${on}`}\n${top}jobs:\n${jobs.join('')}`;
// A push of main alone: a workflow that signs in on it is no tag's (a push with no filter is).
const PUSH = '\n  push:\n    branches: [main]';
const READ = 'permissions:\n  contents: read\n';
const check = (extra = '', steps = STEPS) => workflow('pull_request', READ, job('check', CHECKS2, extra, steps));
const DAZZER = { repository: 'dazzer-io/dazzer', visibility: 'private' };
const APP = { repository: 'dazzer-io/dazzer-app', visibility: 'private' };
const QUIET = { repository: 'dazzer-io/made-up-tools', visibility: 'private' };
const PUBLIC = { repository: 'dazzer-io/made-up-plugin', visibility: 'public' };
const SHARED = { repository: 'dazzer-io/.github', visibility: 'public', shared: true };
// The path of the test file this one replaces, built from its parts so that no line here holds it:
// a case below refuses every file of this repository that still names it (decision 178).
const OLD_TEST = ['test/runs-on', 'test', 'mjs'].join('.');

test('the rule loads, and reads the shared workflows it admits calls into from this repository', () => {
  need();
  for (const name of ['judgeFiles', 'readWorkflow', 'checkKept', 'checkSecrets', 'checkStrict', 'readCalls', 'readings', 'main']) {
    assert.equal(typeof J[name], 'function', `Could not find ${name} exported by machine-rule/judge.mjs`);
  }
});

// ================================================================ reading (dazzer's gate, decision 42; runs-on test rounds 1-6)
test('a spelling another parser could read another way is refused, naming its line (dazzer gate; runs-on test)', async () => {
  need();
  const hide = (code) => check(`    timeout-minutes: 10${String.fromCharCode(code)}    permissions: write-all\n`);
  const cases = [
    ['an anchor', `name: made up\non: pull_request\n${READ}env: &shared\n  K: made-up\njobs:\n${job('check', CHECKS2)}`, /YAML anchor, '&shared'/, 'env: &shared'],
    ['an alias', `name: made up\non: pull_request\n${READ}env: &shared\n  K: made-up\nrun-name: *shared\njobs:\n${job('check', CHECKS2)}`, /YAML alias, '\*shared'/, 'run-name: *shared'],
    ['a tag', check('    env:\n      K: !!str made-up\n'), /YAML tag, '!!str'/, '!!str'],
    ['an explicit key', check('    env:\n      ? K\n      : made-up\n'), /explicit key, '\? K'/, '? K'],
    ['a directive', `%YAML 1.2\n---\n${check()}`, /YAML directive, '%YAML 1\.2'/, '%YAML'],
    ['a merge key', check('    <<:\n      timeout-minutes: 5\n'), /merge key, '<<'/, '<<:'],
    ['a duplicate key, the machine written twice', check('    runs-on: ubuntu-latest\n'), /DUPLICATE_KEY/],
    ['a key written twice in another letter case', `Name: made up\n${check()}`, /writes the key name at the top again in another letter case/],
    ['a key GitHub reads, in another letter case', check('    Permissions: write-all\n'), /a key GitHub reads as permissions, in another letter case/, 'Permissions'],
    ['a second document', `${check()}---\npermissions: write-all\n`, /MULTIPLE_DOCS/],
    ['a step written as a flow', check('', '    steps:\n      - { run: echo made-up }\n'), /writes a step as a flow/, '- { run'],
    ['steps: written as a flow', check('', '    steps: [{ run: echo made-up }]\n'), /writes steps: as a flow/, 'steps: ['],
    ['an entry of another block list written as a flow', check('    strategy:\n      matrix:\n        include:\n          - { part: one }\n'), /entry of the block list under include: as a flow/, '- { part'],
    ['a carriage return mid-line, hiding the job\'s permissions', hide(13), /carriage return not followed by a line feed/, 'timeout-minutes'],
    ['U+0085 mid-line', hide(0x85), /next-line character \(U\+0085\)/, 'timeout-minutes'],
    ['U+2028 mid-line', hide(0x2028), /line separator \(U\+2028\)/, 'timeout-minutes'],
    ['U+2029 mid-line', hide(0x2029), /paragraph separator \(U\+2029\)/, 'timeout-minutes'],
    ['a byte order mark opening a line', check(`${String.fromCharCode(0xfeff)}    timeout-minutes: 5\n`), /byte order mark \(U\+FEFF\) at the start of a line/, 'timeout-minutes'],
    ['a byte order mark inside a line', check(`    timeout-minutes: 5${String.fromCharCode(0xfeff)}\n`), /byte order mark \(U\+FEFF\) inside a line/, 'timeout-minutes'],
    ['a C1 control, U+0080, in a value', check('', `    steps:\n      - name: made${String.fromCharCode(0x80)}-up\n        run: echo made-up\n`), /control character U\+0080/, '- name'],
    ['a C1 control, U+009F, in a value', check('', `    steps:\n      - name: made${String.fromCharCode(0x9f)}-up\n        run: echo made-up\n`), /control character U\+009F/, '- name'],
    ['an expression never closed', check('    env:\n      K: @{{ toJSON(secrets)\n'), /opens \$\{\{ with no closing \}\}/, 'K: @{{'],
    ['a backslash inside ${{ }} as YAML keeps it', check("    env:\n      K: '@{{ vars.LOCKED_RUNNER\\_8 }}'\n"), /holds a \\ inside \$\{\{ \}\}/, 'K: '],
    ['a backslash written by an escape a double-quoted value decodes', check('    env:\n      K: "@{{ vars.LOCKED_RUNNER\\u005F8 }}"\n'), /holds a \\ inside \$\{\{ \}\}/, 'K: '],
    ['an escaped key', check('    "\\u0070ermissions": write-all\n'), /quoted key with a backslash/, 'ermissions"'],
    ['the jobs key written as a flow', `name: made up\non: pull_request\n${READ}jobs: { check: { runs-on: ubuntu-latest } }\n`, /not jobs: at column zero/],
    ['a quoted job id', `name: made up\non: pull_request\n${READ}jobs:\n  "check":\n    runs-on: ${CHECKS2}\n${STEPS}`, /is not a plain job id/, '"check"'],
    ['a spaced job id', `name: made up\non: pull_request\n${READ}jobs:\n  check :\n    runs-on: ${CHECKS2}\n${STEPS}`, /is not a plain job id/, 'check :'],
    ['a job id four spaces in', `name: made up\non: pull_request\n${READ}jobs:\n    check:\n      runs-on: ${CHECKS2}\n      steps:\n        - run: echo made-up\n`, /is not a plain job id/, '    check:'],
    ['on: listing its triggers four spaces in', `name: made up\non:\n    pull_request:\n${READ}jobs:\n${job('check', CHECKS2)}`, /lists its triggers 4 spaces in, not two/, 'on:'],
    ['a key at column zero after the jobs', `${check()}env:\n  K: made-up\n`, /reads it on lines/],
    ['an on: written below the jobs', `name: made up\n${READ}jobs:\n${job('check', CHECKS2)}on:\n  pull_request:\n`, /holds no job pull_request|reads it on lines/],
    ['a job with no id', `name: made up\non: pull_request\n${READ}jobs:\n  "":\n    runs-on: ubuntu-latest\n${STEPS}`, /with no id/],
    ['a file holding no job it can read', 'name: made up\non: pull_request\n', /holds no job this rule can read/],
  ];
  await everyCase(async (c) => {
    for (const [name, text, says, at] of cases) await c(() => mustRefuse(name, { 'made-up.yml': text }, DAZZER, { file: 'made-up.yml', says, at }));
  });
});

test('ordinary spellings read clean: CRLF, a leading byte order mark or ---, block scalars, comments, steps at the job-key indent (dazzer gate; runs-on test controls)', async () => {
  need();
  const cases = [
    ['the plain layout', check()],
    ['lines ended by a carriage return and a line feed', check().split('\n').join('\r\n')],
    ['a byte order mark opening the file', `${String.fromCharCode(0xfeff)}${check()}`],
    ['a leading ---', `---\n${check()}`],
    ['steps written at the job-key indent', check('', '    steps:\n    - run: echo made-up\n')],
    ['a block scalar holding colons, quotes, an ampersand, a star and a tag', check('', `    steps:\n      - run: |\n          echo "a: b" 'c' && ls *.mjs & wait\n          x: &anchor *alias !tag "${String.fromCharCode(92)}n"\n`)],
    ['a folded if: read whole', check("    if: >-\n      github.event_name != 'push' &&\n      github.actor != 'x'\n")],
    ['a real YAML comment naming ${{ secrets.* }}', check('    # reads @{{ toJSON(secrets) }} nowhere\n')],
    ['secrets as a property and as a word in a string', check("    if: steps.a.outputs.secrets != 'secrets'\n    env:\n      K: @{{ inputs.secrets }}\n")],
    ['a setting written in quotes', workflow('pull_request', READ, job('check', `"${CHECKS2}"`))],
    ['on: in its list and flow spellings', workflow('[pull_request, merge_group]', READ, job('check', CHECKS2))],
  ];
  await everyCase(async (c) => {
    for (const [name, text] of cases) await c(() => mustPass(name, { 'made-up.yml': text }, DAZZER));
  });
});

// ================================================================ the route reader (runners' reader)
test('a runs-on reaches a declared setting on every route, a quoted label only as the final || fallback (runners reader)', async () => {
  need();
  const refused = [
    ['a list of labels', '[self-hosted, linux]', /lists labels/],
    ['a block list of labels', '\n      - self-hosted\n      - linux', /lists labels/],
    ['a group mapping', '\n      group: made-up-group\n      labels: [made-up-label]', /runner group or labels/],
    ['text outside the expression', 'prefix-@{{ vars.CHECKS_RUNNER_2 }}', /names text outside its expression/],
    ['another variable', "@{{ vars.CI_RUNNER || 'ubuntu-latest' }}", /vars\.CI_RUNNER, which is no CHECKS_RUNNER/],
    ['an undeclared setting', "@{{ vars.CHECKS_RUNNER_4 || 'ubuntu-latest' }}", /reads CHECKS_RUNNER_4, which the organisation does not declare/],
    ['a literal route before the setting on a push', "@{{ github.event_name == 'push' && 'ubuntu-latest' || vars.CHECKS_RUNNER_8 }}", /names "ubuntu-latest" literally on a route of its own/],
    ['a literal first', "@{{ 'ubuntu-latest' || vars.CHECKS_RUNNER_8 }}", /literally on a route of its own/],
    ['a literal in the middle', "@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-latest' || vars.CHECKS_RUNNER_2 }}", /literally on a route of its own/],
    ['a setting gating a literal', "@{{ vars.CHECKS_RUNNER_8 && 'ubuntu-latest' }}", /literally on a route of its own/],
    ['a literal alone', "@{{ 'ubuntu-latest' }}", /literally on a route of its own/],
    ['a JSON literal', `@{{ fromJSON('["self-hosted"]') || vars.CHECKS_RUNNER_8 }}`, /literally on a route of its own/],
    ['another context', "@{{ github.event.inputs.machine || vars.CHECKS_RUNNER_8 || 'ubuntu-latest' }}", /github\.event\.inputs\.machine, which is no/],
    ['an expression it cannot parse', "@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-latest }}", /cannot read|opens \$\{\{/],
    ['a setting with no fallback (dazzer gate)', '@{{ vars.CHECKS_RUNNER_2 }}', /with no fallback after \|\|/],
    ['a setting whose number is not its fallback\'s cores (dazzer gate)', "@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-latest' }}", /a 8-core machine, but its fallback 'ubuntu-latest' has 2 cores/],
    ['GitHub\'s standard machine behind any number but two (dazzer gate)', "@{{ vars.CHECKS_RUNNER_16 || 'ubuntu-24.04' }}", /16-core machine, but its fallback 'ubuntu-24\.04' has 2 cores/],
    ['a fallback that is no GitHub machine (dazzer gate)', "@{{ vars.CHECKS_RUNNER_2 || 'made-up-machine' }}", /is not GitHub's machine/],
    ['a fallback to the scan set\'s label (dazzer gate)', "@{{ vars.CHECKS_RUNNER_2 || 'dazzer-scan-2-core' }}", /is not GitHub's machine/],
    ['one of our own labels written literally', 'dazzer-checks-2-core', /names one of our own machines literally/],
  ];
  const passed = [
    ['a setting with GitHub\'s machine of its width', "@{{ vars.CHECKS_RUNNER_16 || 'ubuntu-16-core' }}"],
    ['the setting then its fallback', "@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-8-core' }}"],
    ['the index spelling', "@{{ vars['CHECKS_RUNNER_2'] || 'ubuntu-latest' }}"],
  ];
  await everyCase(async (c) => {
    for (const [name, runsOn, says] of refused) await c(() => mustRefuse(name, { 'made-up.yml': workflow('pull_request', READ, job('check', runsOn)) }, DAZZER, { file: 'made-up.yml', job: 'check', says }));
    for (const [name, runsOn] of passed) await c(() => mustPass(name, { 'made-up.yml': workflow('pull_request', READ, job('check', runsOn)) }, DAZZER));
    await c(() => mustRefuse('a job with no runs-on (dazzer gate; runners)', { 'made-up.yml': workflow('pull_request', READ, `  check:\n${STEPS}`) }, DAZZER, { file: 'made-up.yml', job: 'check', says: /names no machine/ }));
  });
});

test('through a plan job\'s outputs and a matrix the route reaches the setting, and a literal reached through them is refused (runners reader)', async () => {
  need();
  const text = `name: made up
on: pull_request
${READ}jobs:
  planner:
    runs-on: ${CHECKS2}
    outputs:
      pick: @{{ steps.p.outputs.pick }}
      rows: @{{ steps.p.outputs.rows }}
    steps:
      - id: p
        env:
          SMALL: @{{ vars.CHECKS_RUNNER_2 }}
        run: echo made-up
  through-plan:
    needs: planner
    runs-on: @{{ needs.planner.outputs.pick || 'ubuntu-latest' }}
${STEPS}  matrix-from-plan:
    needs: planner
    runs-on: @{{ matrix.runs_on || 'ubuntu-latest' }}
    strategy:
      matrix:
        include: @{{ fromJSON(needs.planner.outputs.rows) }}
${STEPS}  matrix-of-settings:
    runs-on: @{{ matrix.machine || 'ubuntu-latest' }}
    strategy:
      matrix:
        machine:
          - "@{{ vars.CHECKS_RUNNER_2 }}"
${STEPS}  bare-plan:
    runs-on: ubuntu-latest
    outputs:
      pick: made-up
${STEPS}  through-bare-plan:
    needs: bare-plan
    runs-on: @{{ needs.bare-plan.outputs.pick || 'ubuntu-latest' }}
${STEPS}  matrix-literal:
    runs-on: @{{ matrix.machine || 'ubuntu-latest' }}
    strategy:
      matrix:
        include:
          - machine: "@{{ vars.CHECKS_RUNNER_2 }}"
          - machine: ubuntu-latest
${STEPS}  matrix-unset:
    runs-on: @{{ matrix.machine || 'ubuntu-latest' }}
    strategy:
      matrix:
        part: [a, b]
${STEPS}  matrix-no-fallback:
    runs-on: @{{ matrix.machine }}
    strategy:
      matrix:
        machine:
          - "@{{ vars.CHECKS_RUNNER_2 }}"
${STEPS}`;
  await everyCase(async (c) => {
    for (const id of ['planner', 'through-plan', 'matrix-from-plan', 'matrix-of-settings']) await c(() => mustPass(`job ${id}`, { 'routes.yml': text }, DAZZER, { file: 'routes.yml', job: id }));
    await c(() => mustRefuse('a plan job reading no setting', { 'routes.yml': text }, DAZZER, { file: 'routes.yml', job: 'through-bare-plan', says: /job bare-plan reads no CHECKS_RUNNER/ }));
    await c(() => mustRefuse('a matrix row naming a label', { 'routes.yml': text }, DAZZER, { file: 'routes.yml', job: 'matrix-literal', says: /matrix\.machine takes "ubuntu-latest" literally/ }));
    await c(() => mustRefuse('a matrix key no row sets', { 'routes.yml': text }, DAZZER, { file: 'routes.yml', job: 'matrix-unset', says: /which no matrix row sets/ }));
    await c(() => mustRefuse('a matrix setting with no fallback anywhere (runners passed it; the plan holds the fallback, decision 15)', { 'routes.yml': text }, DAZZER, { file: 'routes.yml', job: 'matrix-no-fallback', says: /no fallback/ }));
  });
});

test('a reusable workflow\'s inputs: a workflow started by hand, or called by none, gets its machine typed by hand (runners reader)', async () => {
  need();
  const callee = (on) => `on:\n${on}jobs:\n  reused:\n    runs-on: @{{ inputs.machine }}\n${STEPS}`;
  await everyCase(async (c) => {
    await c(() => mustRefuse('a workflow also started by hand', { 'by-hand.yml': callee('  workflow_call:\n    inputs:\n      machine:\n        type: string\n  workflow_dispatch:\n') }, DAZZER, { file: 'by-hand.yml', job: 'reused', says: /gets it typed by hand or empty|not started by pull_request/ }));
    await c(() => mustRefuse('a reusable workflow no workflow calls', { 'orphan.yml': callee('  workflow_call:\n    inputs:\n      machine:\n        type: string\n') }, DAZZER, { file: 'orphan.yml', job: 'reused', says: /no workflow read calls \.github\/workflows\/orphan\.yml/ }));
  });
});

// ================================================================ a workflow that signs in (dazzer gate, decisions 9, 23, 40)
test('a workflow that signs in reads no CHECKS_ or SCAN_ setting, and each job reads the locked setting held to main (dazzer gate)', async () => {
  need();
  const signing = (on, top, ...jobs) => workflow(on, top, ...jobs);
  const ID = 'permissions:\n  contents: read\n  id-token: write\n';
  const refused = [
    ['a job granting id-token: write reading CHECKS_ in its runs-on', signing(PUSH, READ, job('deploy', CHECKS2, '    permissions:\n      id-token: write\n')), /signs in .*reads CHECKS_RUNNER_2/],
    ['a CHECKS_ read in the env of a workflow granting id-token: write at its top', signing(PUSH, ID, job('deploy', LOCKED2, '    env:\n      K: @{{ vars.CHECKS_RUNNER_2 }}\n')), /signs in .*reads CHECKS_RUNNER_2/],
    ['a job naming an environment reading CHECKS_', signing(PUSH, READ, job('deploy', CHECKS2, '    environment: production\n')), /signs in .*reads CHECKS_RUNNER_2/],
    ['every job of a pull-request workflow one job of which signs in', signing('pull_request', READ, job('deploy', LOCKED2, '    environment: production\n'), job('check', CHECKS2)), /signs in .*reads CHECKS_RUNNER_2/],
    ['a literal label, saying what to write', signing(PUSH, ID, job('deploy', 'ubuntu-latest')), /names its machine literally, 'ubuntu-latest'.*vars\.LOCKED_RUNNER_2 \|\| 'ubuntu-latest'/],
    ['the locked setting read without the main ref condition', signing(PUSH, ID, job('deploy', "@{{ vars.LOCKED_RUNNER_2 || 'ubuntu-latest' }}")), /without the ref condition held to main/],
    ['the locked setting held to a ref that is not main', signing(PUSH, ID, job('deploy', "@{{ github.ref == 'refs/heads/dev' && vars.LOCKED_RUNNER_2 || 'ubuntu-latest' }}")), /without the ref condition held to main/],
    ['the locked setting held to a version tag', signing(PUSH, ID, job('deploy', "@{{ startsWith(github.ref, 'refs/tags/v') && vars.LOCKED_RUNNER_2 || 'ubuntu-latest' }}")), /without the ref condition held to main/],
    ['the locked setting read in the job\'s env', signing(PUSH, ID, job('deploy', LOCKED2, '    env:\n      K: @{{ vars.LOCKED_RUNNER_8 }}\n')), /outside its runs-on/],
    ['the locked setting read in the workflow\'s env', `name: made up\non:${PUSH}\n${ID}env:\n  K: @{{ vars.LOCKED_RUNNER_8 }}\njobs:\n${job('deploy', LOCKED2)}`, /outside its runs-on/],
    ['a locked setting whose number is not its fallback\'s cores', signing(PUSH, ID, job('deploy', "@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_8 || 'ubuntu-latest' }}")), /8-core machine, but its fallback 'ubuntu-latest' has 2 cores/],
    ['a locked setting falling back to a label of ours', signing(PUSH, ID, job('deploy', "@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_8 || 'dazzer-locked-8-core' }}")), /is not GitHub's machine/],
    ['a job with no runs-on', signing(PUSH, ID, `  deploy:\n${STEPS}`), /names no machine/],
    ['a job calling a reusable workflow', signing(PUSH, ID, '  deploy:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@main\n    permissions:\n      statuses: write\n'), /signs in and calls a reusable workflow/],
    ['a job reading CHECKS_RUNNER_8 in its runs-on', signing(PUSH, ID, job('deploy', "@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-8-core' }}")), /signs in .*reads CHECKS_RUNNER_8/],
    ['a SCAN_ read in a job of a workflow that signs in', signing(PUSH, ID, job('deploy', LOCKED2, '    env:\n      K: @{{ vars.SCAN_RUNNER_2 }}\n')), /a scan setting/],
    ['a workflow that signs in on pull_request_target', signing('pull_request_target', ID, job('deploy', LOCKED2)), /runs on pull_request_target, where github\.ref is the default branch/],
    ['a workflow that signs in on workflow_run', signing('workflow_run', ID, job('deploy', LOCKED2)), /runs on workflow_run, where github\.ref is the default branch/],
  ];
  const tags = [
    ['a push of version tags', 'on:\n  push:\n    tags: [v*]\n', 'a push of tags v*'],
    ['a push with no filter', 'on:\n  push:\n', 'a push with no branches: or tags: filter'],
    ['a push filtered by paths alone', 'on:\n  push:\n    paths: [src/**]\n', 'filtered by paths alone'],
    ['a push ignoring some tags', 'on:\n  push:\n    tags-ignore: [nightly]\n', 'tags-ignore does not name'],
    ['release', 'on:\n  release:\n    types: [published]\n', 'release'],
    ['create', 'on:\n  create:\n', 'create'],
    ['deployment', 'on:\n  deployment:\n', 'deployment'],
    ['deployment_status', 'on:\n  deployment_status:\n', 'deployment_status'],
    ['registry_package', 'on:\n  registry_package:\n    types: [published]\n', 'registry_package'],
  ];
  await everyCase(async (c) => {
    for (const [name, text, says] of refused) await c(() => mustRefuse(name, { 'deploy.yml': text }, DAZZER, { file: 'deploy.yml', says }));
    for (const [shape, on, words] of tags) await c(() => mustRefuse(`a workflow that signs in started by ${shape}`, { 'deploy.yml': `name: made up\n${on}${ID}jobs:\n${job('deploy', LOCKED2)}` }, DAZZER, { file: 'deploy.yml', job: 'deploy', says: new RegExp(`that a tag starts \\([^)]*${words.replace(/[.*]/g, (m) => `\\${m}`)}`) }));
    await c(() => mustPass('every job of a workflow that signs in on the locked setting, the one that signs in to nothing among them', { 'deploy.yml': signing(`${PUSH}\n  workflow_dispatch:`, READ, job('deploy', LOCKED2, '    environment: production\n'), job('notify', LOCKED2)) }, DAZZER));
    await c(() => mustPass('a workflow that signs in on a push of branches alone, in a block', { 'deploy.yml': `name: made up\non:\n  push:\n    branches: [main]\n${ID}jobs:\n${job('deploy', LOCKED2)}` }, DAZZER));
    await c(() => mustPass('a workflow that signs in on a push of branches alone, in a flow', { 'deploy.yml': `name: made up\non: { push: { branches: [main] } }\n${ID}jobs:\n${job('deploy', LOCKED2)}` }, DAZZER));
    await c(() => mustPass('LOCKED_UNTIL and CHECKS_DIR in a job of a workflow that signs in, names that are no setting', { 'deploy.yml': signing(PUSH, ID, job('deploy', LOCKED2, '    env:\n      A: @{{ vars.LOCKED_UNTIL }}\n      B: @{{ vars.CHECKS_DIR }}\n')) }, DAZZER));
    await c(() => mustPass('a 16-core locked width? no: an 8-core locked setting with its own width', { 'deploy.yml': signing(PUSH, ID, job('deploy', "@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_8 || 'ubuntu-8-core' }}")) }, DAZZER));
  });
});

test('a job of a workflow that does not sign in reads no LOCKED_ setting, whatever its kind (dazzer gate)', async () => {
  need();
  const cases = [
    ['a change check', check('    env:\n      K: @{{ vars.LOCKED_RUNNER_2 }}\n')],
    ['a change check reading the locked setting in the bracket spelling', check("    env:\n      K: @{{ vars['LOCKED_RUNNER_8'] }}\n")],
    ['a change check reading it in its runs-on', workflow('pull_request', READ, job('check', LOCKED2))],
    ['a write-token job', workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', 'ubuntu-latest', '    env:\n      K: @{{ vars.LOCKED_RUNNER_2 }}\n'))],
  ];
  await everyCase(async (c) => {
    for (const [name, text] of cases) await c(() => mustRefuse(name, { 'made-up.yml': text }, DAZZER, { file: 'made-up.yml', says: /does not sign in, and it reads LOCKED_RUNNER/ }));
    await c(() => mustRefuse('a setup job reading the locked setting, though kept on GitHub', { 'setup-apply.yml': workflow('push', 'permissions:\n  id-token: write\n', job('changes', 'ubuntu-latest', '    env:\n      K: @{{ vars.LOCKED_RUNNER_2 }}\n'), job('apply', 'ubuntu-latest')) }, DAZZER, { file: 'setup-apply.yml', job: 'changes', says: /effect stay\) and reads LOCKED_RUNNER_2/ }));
  });
});

// ================================================================ write tokens (dazzer gate, decision 36; runs-on test)
test('a job holding a write token on a pull request stays on GitHub\'s standard machine and reads no setting (dazzer gate; runs-on test)', async () => {
  need();
  const cases = [
    ['pull-requests: write in a block, reading the setting', workflow('pull_request', 'permissions:\n  contents: read\n  pull-requests: write\n', job('label', CHECKS2))],
    ['a write in a flow', workflow('pull_request', 'permissions: { pull-requests: write }\n', job('label', CHECKS2))],
    ['contents: write at the workflow\'s top', workflow('pull_request', 'permissions:\n  contents: write\n', job('label', CHECKS2))],
    ['the job\'s own write', workflow('pull_request', READ, job('label', CHECKS2, '    permissions:\n      issues: write\n'))],
    ['an access other than read, none or write, which counts as a write', workflow('pull_request', 'permissions:\n  statuses: admin\n', job('label', CHECKS2))],
    ['no permissions: key at all, the repository\'s default token', workflow('pull_request', '', job('label', CHECKS2))],
  ];
  await everyCase(async (c) => {
    for (const [name, text] of cases) await c(() => mustRefuse(name, { 'made-up.yml': text }, QUIET, { file: 'made-up.yml', job: 'label', says: /holds .*(write|default token)/ }));
    await c(() => mustRefuse('a write-token job on a larger GitHub machine written literally', { 'made-up.yml': workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', 'ubuntu-8-core')) }, QUIET, { file: 'made-up.yml', job: 'label', says: /not one of GitHub's standard machines/ }));
    await c(() => mustRefuse('a write-all workflow, which holds the sign-in too', { 'made-up.yml': workflow('pull_request', 'permissions: write-all\n', job('label', CHECKS2)) }, DAZZER, { file: 'made-up.yml', job: 'label', says: /signs in .*reads CHECKS_RUNNER_2/ }));
    await c(() => mustPass('a write-token job on a literal standard label in a repository that reads no setting', { 'made-up.yml': workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', 'ubuntu-latest')) }, QUIET));
    await c(() => mustPass('a read-only flow grant reading the setting', { 'made-up.yml': workflow('pull_request', 'permissions: { contents: read }\n', job('check', CHECKS2)) }, DAZZER));
  });
});

test('in dazzer-io/.github a write-token job stays on GitHub\'s standard machine whatever starts it (runs-on test, its stricter rule)', async () => {
  need();
  const cases = [
    ['a workflow_call-only write job on the change-check machines', workflow('workflow_call', 'permissions:\n  statuses: write\n', job('decide-tests', CHECKS2))],
    ['a workflow_run write job on the change-check machines', workflow('workflow_run', 'permissions:\n  pull-requests: write\n', job('decide-tests', CHECKS2))],
    ['a push workflow with no permissions on the change-check machines', workflow('push', '', job('decide-tests', CHECKS2))],
  ];
  await everyCase(async (c) => {
    for (const [name, text] of cases) await c(() => mustRefuse(name, { 'decide-tests.yml': text }, SHARED, { file: 'decide-tests.yml', job: 'decide-tests', says: /holds .*(write|default token)|public repository/ }));
    await c(() => mustPass('a workflow_call-only write job on ubuntu-latest', { 'decide-tests.yml': workflow('workflow_call', 'permissions:\n  statuses: write\n', job('decide-tests', 'ubuntu-latest')) }, SHARED));
  });
});

// ================================================================ secrets (dazzer gate's CHANGE_CHECK_SECRETS, now secrets.json)
test('a change check reads only the secrets machine-rule/secrets.json names for its repository (dazzer gate)', async () => {
  need();
  const refused = [
    ['a secret off the list by dot', '    env:\n      K: @{{ secrets.HARBOR_KEY }}\n', /reads secrets\.HARBOR_KEY, which machine-rule\/secrets\.json does not name/],
    ['a secret off the list by bracket', "    env:\n      K: @{{ secrets['HARBOR_KEY'] }}\n", /reads secrets\.HARBOR_KEY/],
    ['a secret off the list in any case', '    env:\n      K: @{{ Secrets.harbor_key }}\n', /reads secrets\.HARBOR_KEY/],
    ['the whole secrets context', '    env:\n      K: @{{ toJSON(secrets) }}\n', /the whole secrets context/],
    ['the whole secrets context in any case', '    env:\n      K: @{{ toJSON(SECRETS) }}\n', /the whole secrets context/],
    ['the whole secrets context by the object filter', '    env:\n      K: @{{ secrets.* }}\n', /the whole secrets context/],
    ['the whole secrets context in a bare if:', '    if: contains(toJSON(secrets), \'x\')\n', /the whole secrets context/],
    ['the whole secrets context in an expression holding a }', "    env:\n      K: @{{ toJSON(secrets) || '}' }}\n", /the whole secrets context/],
    ['a secret looked up by a computed name', '    env:\n      K: @{{ secrets[format(\'{0}\', inputs.name)] }}\n', /looks a secret up by a name worked out as it runs/],
    ['a secret looked up by an input', '    env:\n      K: @{{ secrets[inputs.name] }}\n', /looks a secret up by a name worked out as it runs/],
  ];
  await everyCase(async (c) => {
    for (const [name, extra, says] of refused) await c(() => mustRefuse(name, { 'made-up.yml': check(extra) }, DAZZER, { file: 'made-up.yml', job: 'check', says }));
    await c(() => mustRefuse('a secret off the list in the workflow\'s top', { 'made-up.yml': `name: made up\non: pull_request\n${READ}env:\n  K: @{{ secrets.HARBOR_KEY }}\njobs:\n${job('check', CHECKS2)}` }, DAZZER, { file: 'made-up.yml', job: 'check', says: /reads secrets\.HARBOR_KEY/ }));
    await c(() => mustPass('GITHUB_TOKEN and a listed secret', { 'made-up.yml': check('    env:\n      A: @{{ secrets.GITHUB_TOKEN }}\n      B: @{{ secrets.TURBO_TOKEN }}\n') }, DAZZER));
    await c(() => mustRefuse('a listed secret of dazzer read in a repository with no entry, which holds none', { 'made-up.yml': check('    env:\n      B: @{{ secrets.TURBO_TOKEN }}\n') }, { repository: 'dazzer-io/brain-builder', visibility: 'private' }, { file: 'made-up.yml', job: 'check', says: /reads secrets\.TURBO_TOKEN, which machine-rule\/secrets\.json does not name for dazzer-io\/brain-builder \(it names none\)/ }));
  });
});

// ================================================================ unclassified workflows and the kept list
test('in a repository reading a CHECKS_ or LOCKED_ setting, a workflow that neither signs in nor runs on pull_request is refused unless kept.json names each job (dazzer gate\'s unclassified)', async () => {
  need();
  const nightly = workflow('schedule', READ, job('sweep', 'ubuntu-latest'));
  const pushed = workflow('push', 'permissions:\n  contents: write\n', job('tag', CHECKS2));
  const keptBy = (entry) => ({ ...lists(), kept: { about: 'made up', entries: [{ reason: 'made up', decision: 1, source: 'made up', ...entry }] } });
  await everyCase(async (c) => {
    await c(() => mustRefuse('a nightly job on ubuntu-latest', { 'sweep.yml': nightly, 'ci.yml': check() }, DAZZER, { file: 'sweep.yml', job: 'sweep', says: /is not started by pull_request .*kept\.json names no entry/ }));
    await c(() => mustPass('the same named stay', { 'sweep.yml': nightly, 'ci.yml': check() }, { ...DAZZER, ...keptBy({ repository: 'dazzer-io/dazzer', workflow: 'sweep.yml', jobs: ['sweep'], effect: 'stay' }) }));
    await c(() => mustRefuse('a push-started job on the change-check machines', { 'release.yml': pushed }, DAZZER, { file: 'release.yml', job: 'tag', says: /not started by pull_request/ }));
    await c(() => mustPass('the same kept with the effect checks, naming its write', { 'release.yml': pushed }, { ...DAZZER, ...keptBy({ repository: 'dazzer-io/dazzer', workflow: 'release.yml', job: 'tag', name: 'tag', effect: 'checks', writes: ['contents'] }) }));
    await c(() => mustRefuse('the same kept checks, naming another write', { 'release.yml': pushed }, { ...DAZZER, ...keptBy({ repository: 'dazzer-io/dazzer', workflow: 'release.yml', job: 'tag', name: 'tag', effect: 'checks', writes: ['issues'] }) }, { file: 'release.yml', job: 'tag', says: /holds no write unless its kept\.json entry has the effect checks and names that write/ }));
    await c(() => mustPass('a nightly job in a private repository that reads no setting, with no entry (decision 16)', { 'sweep.yml': nightly }, QUIET));
    await c(() => mustRefuse('the same, read as moving by --moving', { 'sweep.yml': nightly }, { ...QUIET, moving: true }, { file: 'sweep.yml', job: 'sweep', says: /is not started by pull_request .*kept\.json names no entry/ }));
  });
});

test('in a repository reading a CHECKS_ or LOCKED_ setting, a job on a literal GitHub label is refused unless kept.json names it; one that reads none needs nothing (decisions 15, 16, 121)', async () => {
  need();
  const files = { 'ci.yml': workflow('pull_request', READ, job('check', CHECKS2), job('report', 'ubuntu-latest')) };
  await everyCase(async (c) => {
    await c(() => mustRefuse('a literal-label job beside a change check', files, DAZZER, { file: 'ci.yml', job: 'report', says: /names the literal label 'ubuntu-latest' in dazzer-io\/dazzer, a private repository whose workflows read a CHECKS_ or LOCKED_ setting, and kept\.json names no entry/ }));
    await c(() => mustPass('a literal-label job in a private repository that reads no setting', { 'ci.yml': workflow('pull_request', READ, job('report', 'ubuntu-latest')) }, QUIET));
    await c(() => mustPass('a larger GitHub machine written literally there', { 'ci.yml': workflow('pull_request', READ, job('report', 'ubuntu-8-core')) }, QUIET));
    await c(() => mustRefuse('a label neither GitHub\'s nor a setting there', { 'ci.yml': workflow('pull_request', READ, job('report', 'self-hosted')) }, QUIET, { file: 'ci.yml', job: 'report', says: /neither GitHub's machine/ }));
  });
});

test('kept.json\'s entries: a whole-file entry lists every job, a job entry carries the name GitHub shows, a stay job reads no setting as its machine', async () => {
  need();
  const keptBy = (...entries) => ({ ...DAZZER, ...lists(), kept: { about: 'made up', entries: entries.map((e) => ({ repository: 'dazzer-io/dazzer', reason: 'made up', decision: 1, source: 'made up', ...e })) } });
  const nightly = (...jobs) => ({ 'ci.yml': check(), 'nightly.yml': workflow('schedule', READ, ...jobs) });
  await everyCase(async (c) => {
    await c(() => mustRefuse('a job beside those a whole-file entry lists', nightly(job('sweep', 'ubuntu-latest'), job('added', 'ubuntu-latest')), keptBy({ workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' }), { file: 'nightly.yml', job: 'added', says: /is not among the jobs kept\.json's whole-file entry/ }));
    await c(() => mustRefuse('a job entry whose shown name its workflow does not give', nightly(job('sweep', 'ubuntu-latest', '    name: Daily sweep\n')), keptBy({ workflow: 'nightly.yml', job: 'sweep', name: 'Nightly sweep', effect: 'stay' }), { file: 'nightly.yml', job: 'sweep', says: /GitHub shows this job as "Daily sweep"/ }));
    await c(() => mustRefuse('a stay job entry whose name: holds an expression but as one trailing parenthetical', nightly(job('sweep', 'ubuntu-latest', '    name: Sweep @{{ matrix.part }} now\n    strategy:\n      matrix:\n        part: [a]\n')), keptBy({ workflow: 'nightly.yml', job: 'sweep', name: 'Sweep', effect: 'stay' }), { file: 'nightly.yml', job: 'sweep', says: /holds an expression other than one trailing parenthetical/ }));
    await c(() => mustPass('a stay job entry whose name: ends in one parenthetical expression', nightly(job('sweep', 'ubuntu-latest', '    name: Sweep (@{{ matrix.part }})\n    strategy:\n      matrix:\n        part: [a]\n')), keptBy({ workflow: 'nightly.yml', job: 'sweep', name: 'Sweep', effect: 'stay' })));
    await c(() => mustPass('a job entry carrying the id of a job with no name:', nightly(job('sweep', 'ubuntu-latest')), keptBy({ workflow: 'nightly.yml', job: 'sweep', name: 'sweep', effect: 'stay' })));
    await c(() => mustRefuse('a stay job off GitHub\'s standard labels', nightly(job('sweep', 'ubuntu-8-core')), keptBy({ workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' }), { file: 'nightly.yml', job: 'sweep', says: /effect stay\) and runs on "ubuntu-8-core"/ }));
    await c(() => mustRefuse('a stay job reading CHECKS_RUNNER_2 in its own env', nightly(job('sweep', 'ubuntu-latest', '    env:\n      M: @{{ vars.CHECKS_RUNNER_2 }}\n')), keptBy({ workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' }), { file: 'nightly.yml', job: 'sweep', says: /beyond a step's env/ }));
    await c(() => mustRefuse('a stay job reading CHECKS_RUNNER_2 in a step\'s run', nightly(job('sweep', 'ubuntu-latest', '', '    steps:\n      - run: echo @{{ vars.CHECKS_RUNNER_2 }}\n')), keptBy({ workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' }), { file: 'nightly.yml', job: 'sweep', says: /beyond a step's env/ }));
    await c(() => mustPass('a stay plan job handing CHECKS_RUNNER_2 on in a step\'s env (decision 34)', nightly(job('sweep', 'ubuntu-latest', '', '    steps:\n      - env:\n          M: @{{ vars.CHECKS_RUNNER_2 }}\n        run: echo made-up\n')), keptBy({ workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' })));
    const r = await c(() => mustPass('an entry naming a job its file does not hold yet', nightly(job('sweep', 'ubuntu-latest')), keptBy({ workflow: 'nightly.yml', jobs: ['sweep', 'later'], effect: 'stay' })));
    if (r) await c(() => assert.ok(r.notes.some((n) => n.includes('later')), `Could not find the entry naming a job not yet there said as a note: ${JSON.stringify(r.notes)}`));
  });
});

test('kept.json\'s own check refuses an entry with no effect or an unknown one, a canary entry elsewhere, and an entry with no reason or decision', async () => {
  need();
  const base = { repository: 'dazzer-io/dazzer', workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay', reason: 'made up', decision: 1, source: 'made up' };
  const cases = [
    ['no effect', { ...base, effect: undefined }, /has no effect/],
    ['an unknown effect', { ...base, effect: 'both' }, /an unknown one/],
    ['a canary entry naming another file', { ...base, repository: 'dazzer-io/runners', workflow: 'check.yml', effect: 'canary' }, /only dazzer-io\/runners's .*canary\.yml may take/],
    ['a canary entry naming another repository', { ...base, workflow: 'canary.yml', effect: 'canary' }, /only dazzer-io\/runners's/],
    ['a whole-file entry with the effect checks', { ...base, effect: 'checks' }, /a whole-file entry is for a file whose every job stays/],
    ['writes on a stay entry', { repository: 'dazzer-io/dazzer', workflow: 'x.yml', job: 'a', name: 'a', effect: 'stay', writes: ['contents'], reason: 'r', decision: 1, source: 's' }, /only a checks entry names writes/],
    ['a stay entry carrying an expression for its name', { repository: 'dazzer-io/dazzer', workflow: 'x.yml', job: 'a', name: 'a @{{ matrix.x }}', effect: 'stay', reason: 'r', decision: 1, source: 's' }, /a stay entry carries the name GitHub shows, a fixed string/],
    ['no reason', { ...base, reason: '' }, /gives no reason/],
    ['no whole-number decision', { ...base, decision: 'nine' }, /names no whole-number decision/],
    ['no repository of the organisation', { ...base, repository: 'someone/dazzer' }, /names no dazzer-io repository/],
  ];
  await everyCase(async (c) => {
    for (const [name, entry, says] of cases) {
      const fixed = JSON.parse(wf(JSON.stringify(entry)));
      const problems = J.checkKept({ about: 'made up', entries: [fixed] });
      await c(() => assert.ok(problems.some((p) => says.test(p)), `Could not find kept.json's check refusing ${name}: ${JSON.stringify(problems)}`));
    }
    const twice = J.checkKept({ about: 'made up', entries: [base, base] });
    await c(() => assert.ok(twice.some((p) => /twice/.test(p)), `Could not find a job named twice refused: ${JSON.stringify(twice)}`));
  });
});

test('kept.json names the 19 jobs of runners\' allowed list, each stay on its decision, and the jobs every copy keeps on GitHub today', () => {
  need();
  const { kept } = lists();
  assert.deepEqual(J.checkKept(kept), [], 'Could not find kept.json passing its own check');
  const keeps = (repo, file, id) => kept.entries.find((e) => e.repository === `dazzer-io/${repo}` && e.workflow === file && (e.job === id || (Array.isArray(e.jobs) && e.jobs.includes(id))));
  const allowed = [
    ['dazzer', 'setup-apply.yml', 'changes', 9], ['dazzer', 'setup-apply.yml', 'apply', 9],
    ['dazzer', 'setup-judge.yml', 'fork', 9], ['dazzer', 'setup-judge.yml', 'changes', 9], ['dazzer', 'setup-judge.yml', 'code', 9], ['dazzer', 'setup-judge.yml', 'plan', 9], ['dazzer', 'setup-judge.yml', 'setup-judge', 9],
    ['dazzer', 'switch-over-rehearsal.yml', 'rehearse', 9], ['dazzer', 'deploy-held-rerun.yml', 'rerun-held-deploy', 9],
    ['dazzer', 'dependabot-auto-merge.yml', 'auto-merge', 34], ['dazzer-app', 'dependabot-auto-merge.yml', 'auto-merge', 34],
    ['dazzer-app', 'ci.yml', 'plan', 34], ['dazzer-app', 'ci.yml', 'gate', 34], ['dazzer-app', 'ci.yml', 'record', 34],
    ['dazzer-app', 'split-trial.yml', 'plan', 34], ['dazzer-app', 'split-trial.yml', 'record', 34],
    ['scheduler', 'tick.yml', 'tick', 22], ['scheduler', 'tick.yml', 'runner-watcher', 22], ['scheduler', 'soc2-readiness.yml', 'reading', 26],
  ];
  const others = [
    ['dazzer', 'release.yml', 'publish', 'stay', 40], ['dazzer', 'pr-automation.yml', 'label', 'stay', 36],
    ...['contract-watch.yml:watch', 'promote-production.yml:start', 'promote-production.yml:promote', 'sweep.yml:sweep'].map((s) => ['dazzer-app', ...s.split(':'), 'stay', 190]),
    ['brain-builder', 'release.yml', 'tag', 'checks', 47], ['scheduler', 'tick.yml', 'runner-readings', 'stay', 22],
    ['runners', 'apply.yml', 'apply', 'stay', 9], ['runners', 'image.yml', 'build', 'stay', 9], ['runners', 'image.yml', 'push', 'stay', 9],
    ['runners', 'canary.yml', 'canary', 'canary', 50], ['runners', 'canary.yml', 'scan', 'canary', 50],
    ['.github', 'codeql.yml', 'upload', 'stay', 36], ['.github', 'codeql.yml', 'complete', 'stay', 93], ['.github', 'engineer-review.yml', 'engineer-review', 'stay', 36], ['.github', 'machine-rule.yml', 'machine-rule', 'stay', 104],
  ];
  const misses = [];
  for (const [repo, file, id, decision] of allowed) {
    const e = keeps(repo, file, id);
    if (!e || e.effect !== 'stay' || e.decision !== decision) misses.push(`Could not find dazzer-io/${repo} ${file} ${id} named stay on decision ${decision}: ${JSON.stringify(e ?? null)}`);
  }
  for (const [repo, file, id, effect, decision] of others) {
    const e = keeps(repo, file, id);
    if (!e || e.effect !== effect || e.decision !== decision) misses.push(`Could not find dazzer-io/${repo} ${file} ${id} named ${effect} on decision ${decision}: ${JSON.stringify(e ?? null)}`);
  }
  const tag = keeps('brain-builder', 'release.yml', 'tag');
  if (!tag || JSON.stringify(tag.writes) !== JSON.stringify(['contents']) || tag.name !== 'Tag the released version') misses.push(`Could not find brain-builder's tag job kept checks naming contents and the name GitHub shows: ${JSON.stringify(tag ?? null)}`);
  // dazzer-app's four production workflows that sign in and that no pull request or deployment
  // starts go to the locked machines; the three that stay say why (decision 190).
  const app = (file) => kept.entries.filter((e) => e.repository === 'dazzer-io/dazzer-app' && e.workflow === file);
  for (const file of ['release-check.yml', 'canary-drill.yml', 'scorecard.yml', 'lane-times.yml']) {
    if (app(file).length) misses.push(`Could not find dazzer-app's ${file} let go from kept.json to the locked machines (decision 190): ${JSON.stringify(app(file))}`);
  }
  const stays = [['sweep.yml', [/signs in to nothing/, /decision 9\b/]], ['contract-watch.yml', [/signs in to nothing/, /decision 9\b/]], ['promote-production.yml', [/deployment_status/, /the deployed commit's own file decides its runs-on/]]];
  for (const [file, says] of stays) {
    const reasons = app(file).map((e) => e.reason);
    if (reasons.length !== 1 || !says.every((s) => s.test(reasons[0])) || /until the locked machines take it/.test(reasons[0])) misses.push(`Could not find dazzer-app's ${file} kept once, its reason saying why it stays (${says.join(', ')}) rather than waiting on the locked machines (decision 190): ${JSON.stringify(reasons)}`);
  }
  assert.ok(!misses.length, misses.join('\n'));
});

test('the canary effect: runners\' canary.yml alone, by hand, reading only the code, on our own sets named literally', async () => {
  need();
  const RUNNERS = { repository: 'dazzer-io/runners', visibility: 'private' };
  const canary = (on = 'workflow_dispatch', top = READ, extra = '', values = '[dazzer-checks-2-core, dazzer-checks-8-core]') => workflow(on, top, `  canary:\n    name: canary on @{{ matrix.set }}\n    runs-on: @{{ matrix.set }}\n    strategy:\n      matrix:\n        set: ${values}\n${extra}${STEPS}`, job('scan', 'dazzer-scan-2-core'));
  const keptBy = { ...RUNNERS, ...lists(), kept: { about: 'made up', entries: [{ repository: 'dazzer-io/runners', workflow: 'canary.yml', jobs: ['canary', 'scan'], effect: 'canary', reason: 'r', decision: 50, source: 's' }] } };
  await everyCase(async (c) => {
    await c(() => mustPass('the canary as it stands', { 'canary.yml': canary() }, keptBy));
    await c(() => mustRefuse('a canary started on a push', { 'canary.yml': canary('push') }, keptBy, { file: 'canary.yml', job: 'canary', says: /not by workflow_dispatch alone/ }));
    await c(() => mustRefuse('a canary under a wider grant', { 'canary.yml': canary('workflow_dispatch', 'permissions:\n  contents: write\n') }, keptBy, { file: 'canary.yml', job: 'canary', says: /not exactly contents: read/ }));
    await c(() => mustRefuse('a canary job asking for a permission', { 'canary.yml': canary('workflow_dispatch', READ, '    permissions:\n      contents: read\n') }, keptBy, { file: 'canary.yml', job: 'canary', says: /asks for a permission of its own/ }));
    await c(() => mustRefuse('a canary job reading a secret', { 'canary.yml': canary('workflow_dispatch', READ, '    env:\n      K: @{{ secrets.MADE_UP }}\n') }, keptBy, { file: 'canary.yml', job: 'canary', says: /reads a secret/ }));
    await c(() => mustRefuse('a canary matrix naming GitHub\'s machine', { 'canary.yml': canary('workflow_dispatch', READ, '', '[dazzer-checks-2-core, ubuntu-latest]') }, keptBy, { file: 'canary.yml', job: 'canary', says: /takes "ubuntu-latest", not one of our own sets/ }));
    await c(() => mustRefuse('our set named literally anywhere but the canary', { 'check.yml': canary() }, RUNNERS, { file: 'check.yml', job: 'scan', says: /names one of our own machines literally/ }));
  });
});

// ================================================================ the scan reads (runners' reader after r-1.61, decisions 98, 119, 160)
test('a SCAN_RUNNER_<N> read is refused wherever it hides outside the shared scans, by every spelling the reader reads (runners reader)', async () => {
  need();
  const text = `name: made up
on: pull_request
${READ}jobs:
  index-direct:
    runs-on: @{{ vars['SCAN_RUNNER_2'] || 'ubuntu-latest' }}
${STEPS}  index-matrix:
    runs-on: @{{ matrix.machine || 'ubuntu-latest' }}
    strategy:
      matrix:
        include:
          - machine: "@{{ vars['SCAN_RUNNER_2'] }}"
${STEPS}  in-a-condition:
    if: vars.SCAN_RUNNER_2 != ''
    runs-on: ${CHECKS2}
${STEPS}  other-case:
    runs-on: ${CHECKS2}
    env:
      M: "@{{ vars.scan_runner_2 }}"
${STEPS}  scan-plan:
    runs-on: ${CHECKS2}
    outputs:
      pick: "@{{ vars.SCAN_RUNNER_2 }}"
${STEPS}  through-scan-plan:
    needs: scan-plan
    runs-on: @{{ needs.scan-plan.outputs.pick || 'ubuntu-latest' }}
${STEPS}  indexed-scan:
    runs-on: ${CHECKS2}
    env:
      FIRST: "@{{ vars.SCAN_RUNNER_2[0] }}"
${STEPS}  computed:
    runs-on: ${CHECKS2}
    env:
      ANY: "@{{ vars[format('SCAN_RUNNER_{0}', 2)] }}"
${STEPS}  whole:
    runs-on: ${CHECKS2}
    env:
      ALL: "@{{ toJSON(vars) }}"
${STEPS}  unparsed:
    runs-on: ${CHECKS2}
    env:
      A: "@{{ vars.scan_runner_2 == 'x }}"
${STEPS}  checks-plan:
    runs-on: @{{ vars['CHECKS_RUNNER_2'] || 'ubuntu-latest' }}
    outputs:
      pick: "@{{ vars['CHECKS_RUNNER_8'] }}"
${STEPS}  through-checks-plan:
    needs: checks-plan
    runs-on: @{{ needs.checks-plan.outputs.pick || 'ubuntu-latest' }}
${STEPS}  indexed-checks:
    runs-on: ${CHECKS2}
    env:
      FIRST: "@{{ fromJSON(vars.CHECKS_RUNNER_8)[0] }}"
${STEPS}`;
  await everyCase(async (c) => {
    for (const id of ['index-direct', 'index-matrix', 'in-a-condition', 'other-case', 'scan-plan', 'through-scan-plan', 'indexed-scan']) await c(() => mustRefuse(`job ${id}`, { 'spellings.yml': text }, DAZZER, { file: 'spellings.yml', job: id, says: /a scan setting/ }));
    for (const id of ['computed', 'whole']) await c(() => mustRefuse(`job ${id}`, { 'spellings.yml': text }, DAZZER, { file: 'spellings.yml', job: id, says: /\(vars read whole or by a computed name\)/ }));
    await c(() => mustRefuse('an expression it cannot parse naming a scan setting', { 'spellings.yml': text }, DAZZER, { file: 'spellings.yml', job: 'unparsed', says: /SCAN_RUNNER_2, a scan setting|opens \$\{\{|a quoted text never closes/ }));
    for (const id of ['checks-plan', 'through-checks-plan', 'indexed-checks']) await c(() => mustPass(`job ${id}`, { 'spellings.yml': text }, DAZZER, { file: 'spellings.yml', job: id }));
    await c(() => mustRefuse('a workflow\'s top env reading a scan setting', { 'top.yml': `name: made up\non: pull_request\n${READ}env:\n  M: "@{{ vars.SCAN_RUNNER_8 }}"\njobs:\n${job('a', CHECKS2)}` }, DAZZER, { file: 'top.yml', says: /the workflow's top .*reads SCAN_RUNNER_8/ }));
    await c(() => mustRefuse('a reusable workflow whose input default reads a scan setting', { 'reused.yml': `on:\n  workflow_call:\n    inputs:\n      machine:\n        type: string\n        default: "@{{ vars.SCAN_RUNNER_2 }}"\njobs:\n  defaulted:\n    runs-on: @{{ inputs.machine }}\n${STEPS}` }, DAZZER, { file: 'reused.yml', says: /a scan setting/ }));
  });
  const reads = J.settingReadsIn({ env: '${{ vars.CHECKS_RUNNER_8[0] }}' });
  assert.deepEqual([reads.settings, reads.scans], [['CHECKS_RUNNER_8'], []], `Could not find vars.CHECKS_RUNNER_8[0] read as CHECKS_RUNNER_8 and no scan read: ${JSON.stringify(reads)}`);
  const plain = J.settingReadsIn({ env: { A: "${{ vars.CHECKS_RUNNER_2 == 'x }}" } }).scans;
  assert.deepEqual(plain, [], `Could not find an unparsable expression naming CHECKS_RUNNER_2 alone read as no scan read: ${JSON.stringify(plain)}`);
});

test('in dazzer-io/.github only the two shared scans read a scan setting; another of its workflows may not (runners reader; runs-on test)', async () => {
  need();
  const scan = `on: workflow_call\n${READ}jobs:\n  semgrep:\n    runs-on: ${SCAN}\n${STEPS}`;
  await everyCase(async (c) => {
    await c(() => mustPass('security-scan.yml and codeql.yml reading SCAN_RUNNER_2', { 'security-scan.yml': scan, 'codeql.yml': scan }, SHARED));
    await c(() => mustRefuse('another workflow of .github reading SCAN_RUNNER_2', { 'made-up.yml': scan }, SHARED, { file: 'made-up.yml', job: 'semgrep', says: /a scan setting/ }));
    await c(() => mustRefuse('a copy not read as the shared repository', { 'security-scan.yml': scan }, { ...SHARED, shared: false }, { file: 'security-scan.yml', job: 'semgrep', says: /a scan setting/ }));
  });
});

// ================================================================ the shared scans' jobs (runs-on test, decisions 93, 98, 135)
test('the shared scans\' jobs: the scan machines exactly, no secret, no git credential kept, one final check, write jobs on GitHub\'s machine (runs-on test)', async () => {
  need();
  const scanJob = (runsOn = SCAN, extra = '', steps = STEPS) => `  semgrep:\n    runs-on: ${runsOn}\n${extra}${steps}`;
  const file = (top, ...jobs) => `name: made up\non:\n  pull_request:\n  merge_group:\n${top}jobs:\n${jobs.join('')}`;
  const FINAL = '  complete:\n    name: CodeQL complete\n    needs: [semgrep]\n    if: @{{ always() }}\n    runs-on: ubuntu-latest\n    permissions: {}\n    steps:\n      - run: exit 0\n';
  const codeql = (...jobs) => `name: made up\non:\n  workflow_call:\n${READ}jobs:\n${jobs.join('')}`;
  const refused = [
    ['a read-only scan job on the change-check machines', 'security-scan.yml', file(READ, scanJob(CHECKS2)), /not \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\}|public repository/],
    ['a read-only scan job on another spelling of the scan machines', 'security-scan.yml', file(READ, scanJob("@{{ vars.SCAN_RUNNER_2 || 'ubuntu-24.04' }}")), /not \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\}/],
    ['a write-token job of the scan on the scan machines', 'security-scan.yml', file('permissions:\n  pull-requests: write\n', scanJob()), /holds a write token .*not one of GitHub's standard machines/],
    ['a scan job with the default token on the scan machines', 'security-scan.yml', file('', scanJob()), /default token.*not one of GitHub's standard machines/],
    ['a scan job granting itself a write on the scan machines', 'security-scan.yml', file(READ, scanJob(SCAN, '    permissions:\n      pull-requests: write\n')), /holds a write token \(pull-requests: write\)/],
    ['a scan job with permissions: write-all on the scan machines', 'security-scan.yml', file(READ, scanJob(SCAN, '    permissions: write-all\n')), /holds a write token \(write-all\)|is a job of a workflow that signs in/],
    ['a scan job reading a secret', 'security-scan.yml', file(READ, scanJob(SCAN, '    env:\n      TOKEN: @{{ secrets.SCAN_TOKEN }}\n')), /the job reads TOKEN: \$\{\{ secrets\.SCAN_TOKEN \}\}|a scan job holds no secret/],
    ['a shared-scan job reading a secret by index', 'codeql.yml', codeql(scanJob(SCAN, "    env:\n      TOKEN: @{{ secrets['SCAN_TOKEN'] }}\n")), /a scan job holds no secret/],
    ['a shared scan declaring a secret under workflow_call', 'codeql.yml', `name: made up\non:\n  workflow_call:\n    secrets:\n      SCAN_TOKEN:\n        required: false\n${READ}jobs:\n${scanJob()}`, /the workflow's top reads secrets:/],
    ['the whole secrets context in the top env', 'codeql.yml', `name: made up\non:\n  workflow_call:\n${READ}env:\n  ALL: @{{ toJSON(secrets) }}\njobs:\n${scanJob()}`, /the workflow's top reads/],
    ['a secret on a # line inside a | block of a step\'s input', 'codeql.yml', codeql(scanJob(SCAN, '', '    steps:\n      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9\n        with:\n          compression-level: |\n            # @{{ secrets.SCAN_TOKEN }}\n')), /a scan job holds no secret/],
    ['a secret spelled with an escape in a step name', 'security-scan.yml', file(READ, scanJob(SCAN, '', '    steps:\n      - name: "Check out @{{ \\x73ecrets.SCAN_TOKEN }}"\n        run: echo made-up\n')), /holds a \\ inside|a scan job holds no secret/],
    ['a write-token job of the scan reading SCAN_RUNNER_2 in a step', 'security-scan.yml', file('permissions:\n  pull-requests: write\n', scanJob('ubuntu-latest', '    env:\n      RUNNER: @{{ vars.SCAN_RUNNER_2 }}\n')), /holds a write token .*reads SCAN_RUNNER_2/],
    ['a scan job checking out with its credential kept', 'security-scan.yml', file(READ, scanJob(SCAN, '', '    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n')), /checks out without persist-credentials: false/],
    ['a second final check in the shared scan', 'codeql.yml', codeql(scanJob(), FINAL, FINAL.replace('complete:', 'complete-again:')), /a second job of codeql\.yml granted no token/],
    ['a final check granted read-all', 'codeql.yml', codeql(scanJob(), FINAL.replace('permissions: {}', 'permissions: read-all')), /not \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\}/],
    ['a final check reading a setting', 'codeql.yml', codeql(scanJob(), `${FINAL}        env:\n          RUNNER: @{{ vars.CHECKS_RUNNER_2 }}\n`), /reads CHECKS_RUNNER_2/],
    ['a final check with no token in the security scan', 'security-scan.yml', file(READ, scanJob(), FINAL), /not \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\}/],
    ['a final check on a larger GitHub machine', 'codeql.yml', codeql(scanJob(), FINAL.replace('runs-on: ubuntu-latest', 'runs-on: ubuntu-8-core')), /is the final check of the shared scan codeql\.yml, granted no token, and runs on .ubuntu-8-core./],
    ['a job kept.json keeps checking out with its credential kept', 'codeql.yml', codeql(scanJob(), '  upload:\n    name: Upload CodeQL results\n    runs-on: ubuntu-latest\n    permissions:\n      security-events: write\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n'), /jobs\.upload: is a job of the shared scan codeql\.yml and checks out without persist-credentials: false/],
  ];
  await everyCase(async (c) => {
    for (const [name, f, text, says] of refused) await c(() => mustRefuse(name, { [f]: text }, SHARED, { file: f, says }));
    await c(() => mustPass('a read-only job of the scan on the scan machines', { 'security-scan.yml': file(READ, scanJob()) }, SHARED));
    await c(() => mustPass('the shared scan\'s one final check on GitHub\'s machine with no token', { 'codeql.yml': codeql(scanJob(), FINAL) }, SHARED));
    await c(() => mustPass('a scan job handing its own read-only token to a step', { 'codeql.yml': codeql(scanJob(SCAN, '', '    steps:\n      - env:\n          GITHUB_TOKEN: @{{ github.token }}\n        run: echo made-up\n')) }, SHARED));
  });
});

test('the plant took: a secret on a # line in a run: | block of this repository\'s security-scan.yml is refused', async () => {
  need();
  const text = readFileSync(join(ROOT, '.github/workflows/security-scan.yml'), 'utf8');
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^ +run: \|$/.test(l));
  assert.ok(at > 0 && at + 1 < lines.length, 'Could not find a run: | block in security-scan.yml to plant into: the case would prove nothing');
  lines.splice(at + 1, 0, `${' '.repeat(/^ */.exec(lines[at + 1])[0].length)}# \${{ secrets.SCAN_TOKEN }}`);
  const r = await J.judgeFiles({ ...SHARED, ...lists(), files: [{ path: '.github/workflows/security-scan.yml', text: lines.join('\n') }] });
  assert.ok(r.lines.some((l) => /security-scan\.yml:\d+ jobs\.[\w-]+: .*a scan job holds no secret/.test(l)), `Could not find the planted secret refused in security-scan.yml: ${said(r)}`);
});

// ================================================================ public repositories (decision 104)
test('in a public repository every job but the shared scans\' names a literal GitHub standard label and reads no setting (runs-on test, decision 104)', async () => {
  need();
  await everyCase(async (c) => {
    await c(() => mustRefuse('a job on the change-check machines', { 'gates.yml': workflow('pull_request', READ, job('gates', CHECKS2)) }, PUBLIC, { file: 'gates.yml', job: 'gates', says: /a public repository/ }));
    await c(() => mustRefuse('a job reading CHECKS_RUNNER_2 in a step', { 'gates.yml': workflow('pull_request', READ, job('gates', 'ubuntu-latest', '    env:\n      RUNNER: @{{ vars.CHECKS_RUNNER_2 }}\n')) }, PUBLIC, { file: 'gates.yml', job: 'gates', says: /a public repository, and reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('a job on a larger GitHub machine', { 'gates.yml': workflow('pull_request', READ, job('gates', 'ubuntu-8-core')) }, PUBLIC, { file: 'gates.yml', job: 'gates', says: /not one of GitHub's standard machines/ }));
    await c(() => mustPass('a job on ubuntu-latest', { 'gates.yml': workflow('pull_request', READ, job('gates', 'ubuntu-latest')) }, PUBLIC));
  });
});

// ================================================================ calls (decision 171; dazzer gate's judgeCall; runs-on test; runners reader)
test('a call is admitted only into dazzer-io/.github\'s shared workflows at main, holding uses, permissions and with alone, each half of each condition red alone (decision 171)', async () => {
  need();
  const CALL = ['  codeql:', '    uses: dazzer-io/.github/.github/workflows/codeql.yml@main', '    permissions:', '      contents: read', '      actions: read', '      security-events: write', '    with:', `      languages: '["actions", "javascript-typescript"]'`];
  const calling = (lines, on = '[pull_request, push]') => ({ 'codeql.yml': `name: CodeQL\non: ${on}\n${READ}jobs:\n${lines.join('\n')}\n`, 'ci.yml': check() });
  const swap = (from, to) => CALL.map((l) => (l === from ? to : l));
  const refused = [
    ...['strategy:\n      matrix:\n        x: [a]', 'if: true', 'needs: [other]', 'concurrency: made-up', 'name: Scan', 'secrets: inherit', 'env:\n      A: b', 'timeout-minutes: 5'].map((k) => [`the key ${k.split(':')[0]}`, [...CALL, `    ${k}`], new RegExp(`writes ${k.split(':')[0]}: in a call of the shared workflow codeql\\.yml`)]),
    ['no permissions of its own', CALL.filter((l) => !/permissions:|contents|actions|security-events/.test(l)), /with no permissions: of its own/],
    ['permissions: read-all', [...CALL.filter((l) => !/permissions:|contents|actions|security-events/.test(l)), '    permissions: read-all'], /not a map of scopes/],
    ['contents: write, above its level', swap('      contents: read', '      contents: write'), /granting contents: write, more than/],
    ['actions: write, above its level', swap('      actions: read', '      actions: write'), /granting actions: write, more than/],
    ['pull-requests: read, a scope its jobs never use', [...CALL.slice(0, 6), '      pull-requests: read', ...CALL.slice(6)], /granting pull-requests: read, more than/],
    ['an input it does not declare', [...CALL, '      tools: latest'], /handing it tools under with:, an input it does not declare/],
    ['a CHECKS_ setting read in its with:', swap(`      languages: '["actions", "javascript-typescript"]'`, "      languages: '@{{ vars.CHECKS_RUNNER_2 }}'"), /reads CHECKS_RUNNER_2, a CHECKS_ setting/],
    ['a SCAN_ setting read in its with:', swap(`      languages: '["actions", "javascript-typescript"]'`, "      languages: '@{{ vars.SCAN_RUNNER_2 }}'"), /reads SCAN_RUNNER_2, a SCAN_ setting/],
    ['a LOCKED_ setting read in its with:', swap(`      languages: '["actions", "javascript-typescript"]'`, "      languages: '@{{ vars.LOCKED_RUNNER_2 }}'"), /reads LOCKED_RUNNER_2, a LOCKED_ setting/],
    ...['CHECKS', 'LOCKED', 'SCAN'].map((kind) => [`an if: reading a ${kind}_ setting`, [...CALL, `    if: vars.${kind}_RUNNER_2 != ''`], new RegExp(`reads ${kind}_RUNNER_2, a ${kind}_ setting`)]),
    ['the vars context read whole in its with:', swap(`      languages: '["actions", "javascript-typescript"]'`, "      languages: '@{{ toJSON(vars) }}'"), /reads \(vars read whole or by a computed name\)/],
    ['vars read by a computed name in its with:', swap(`      languages: '["actions", "javascript-typescript"]'`, "      languages: \"@{{ vars[format('CHECKS_RUNNER_{0}', 2)] }}\""), /reads \(vars read whole or by a computed name\)/],
    ['the vars context read whole in an if:', [...CALL, "    if: toJSON(vars) != ''"], /reads \(vars read whole or by a computed name\)/],
    ['the owner in another letter case', swap(CALL[1], '    uses: Dazzer-IO/.github/.github/workflows/codeql.yml@main'), /spelled in another letter case/],
    ['the path in another letter case', swap(CALL[1], '    uses: dazzer-io/.github/.github/workflows/CodeQL.yml@main'), /spelled in another letter case/],
    ['the shared scan at a tag', swap(CALL[1], '    uses: dazzer-io/.github/.github/workflows/codeql.yml@v1'), /calls the shared scan \.github\/workflows\/codeql\.yml at v1, not at main/],
    ['the shared scan at a commit', swap(CALL[1], '    uses: dazzer-io/.github/.github/workflows/codeql.yml@0123456789abcdef0123456789abcdef01234567'), /at 0123456789abcdef0123456789abcdef01234567, not at main/],
    ['the shared scan at a branch', swap(CALL[1], '    uses: dazzer-io/.github/.github/workflows/security-scan.yml@made-up-branch'), /calls the shared scan \.github\/workflows\/security-scan\.yml at made-up-branch, not at main/],
    ['another workflow of dazzer-io/.github', swap(CALL[1], '    uses: dazzer-io/.github/.github/workflows/made-up.yml@main'), /a workflow outside dazzer-io\/\.github's shared workflows/],
    ['another organisation\'s .github', swap(CALL[1], '    uses: made-up-org/.github/.github/workflows/codeql.yml@main'), /a workflow outside dazzer-io\/\.github's shared workflows/],
    ['another repository of the organisation', swap(CALL[1], '    uses: dazzer-io/scheduler/.github/workflows/made-up.yml@main'), /a workflow outside dazzer-io\/\.github's shared workflows/],
    ['a workflow of its own repository', swap(CALL[1], '    uses: ./.github/workflows/made-up.yml'), /a workflow of its own repository/],
  ];
  await everyCase(async (c) => {
    await c(() => mustPass('dazzer\'s own call of the shared scan', calling(CALL), DAZZER));
    await c(() => mustPass('the call at refs/heads/main', calling(swap(CALL[1], '    uses: dazzer-io/.github/.github/workflows/codeql.yml@refs/heads/main')), DAZZER));
    await c(() => mustPass('dazzer-app\'s call, outside its stricter class', calling(CALL, '[pull_request, push, schedule]'), APP));
    for (const [name, lines, says] of refused) await c(() => mustRefuse(name, calling(lines), DAZZER, { file: 'codeql.yml', says }));
    await c(() => mustRefuse('the call under another job id', calling(['  scan:', ...CALL.slice(1)]), DAZZER, { file: 'codeql.yml', job: 'scan', says: /GitHub shows its check as 'scan \/ CodeQL complete', not 'codeql \/ CodeQL complete'/ }));
  });
});

test('engineer-review.yml alone may be called at a commit, and only one GitHub\'s compare of main...<commit> reads behind or identical (engineer-review/decide.mjs confirmOnMain)', async () => {
  need();
  const SHA = 'a'.repeat(40);
  const files = (uses, extra = '') => ({ 'engineer-review.yml': `name: Engineer review\non: [pull_request, pull_request_review]\npermissions:\n  statuses: write\n  pull-requests: read\njobs:\n  engineer-review:\n    uses: ${uses}\n    permissions:\n      statuses: write\n      pull-requests: read\n${extra}`, 'ci.yml': check() });
  const asked = [];
  const compareAs = (status) => async (q) => { asked.push(q); return status; };
  await everyCase(async (c) => {
    for (const status of ['behind', 'identical']) await c(() => mustPass(`a commit compare reads ${status}`, files(`dazzer-io/.github/.github/workflows/engineer-review.yml@${SHA}`), { ...DAZZER, compare: compareAs(status) }));
    await c(() => assert.ok(asked.some((q) => q.base === 'main' && q.head === SHA && q.owner === 'dazzer-io' && q.repo === '.github'), `Could not find the compare asked as main...${SHA} of dazzer-io/.github: ${JSON.stringify(asked)}`));
    for (const status of ['ahead', 'diverged']) await c(() => mustRefuse(`a commit compare reads ${status}`, files(`dazzer-io/.github/.github/workflows/engineer-review.yml@${SHA}`), { ...DAZZER, compare: compareAs(status) }, { file: 'engineer-review.yml', says: new RegExp(`reads as ${status}, not behind or identical`) }));
    await c(() => mustRefuse('engineer-review.yml at a branch', files('dazzer-io/.github/.github/workflows/engineer-review.yml@made-up-branch'), DAZZER, { file: 'engineer-review.yml', says: /at made-up-branch, another ref/ }));
    await c(async () => {
      let thrown = null;
      try { await judgeOf(files(`dazzer-io/.github/.github/workflows/engineer-review.yml@${SHA}`), { ...DAZZER, compare: async () => { throw new Error('GitHub answered 502'); } }); } catch (e) { thrown = e; }
      assert.ok(thrown instanceof J.Unread, `Could not find a compare GitHub did not answer read as unread, never as a pass or a refusal: ${thrown?.message ?? 'it passed'}`);
    });
    await c(() => mustRefuse('a call of engineer-review.yml under an if: with no permissions of its own, the shape the caller template held before decision 178', { 'engineer-review.yml': `name: Engineer review\non: [pull_request]\npermissions:\n  statuses: write\n  pull-requests: read\njobs:\n  engineer-review:\n    if: github.event_name != 'issue_comment' || github.event.issue.pull_request\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@${SHA}\n`, 'ci.yml': check() }, { ...DAZZER, compare: compareAs('behind') }, { file: 'engineer-review.yml', says: /writes if: in a call/ }));
  });
});

// engineer-review/caller.yml is the shape a repository copies to call engineer review
// (engineer-review/README.md, "Adopting it"), so it passes the rule in every class of repository
// that may copy it (decision 178). It is filled as `node engineer-review/decide.mjs caller` fills
// it, by renderCaller, at a commit GitHub's compare reads as on main, as callerFor confirms. In a
// repository strict.json names, a call asks a grant only as codeql.yml's job codeql (dazzer-app's
// verdict test, verdict.test.ts:1248, 1258), so there the caller's own grant is refused (decision
// 184): this case passed it there until then, the one fault it pinned.
test('engineer-review/caller.yml, filled as decide.mjs caller fills it, passes the rule in every class of repository that copies it but the strict one, which refuses its grant (decisions 178, 184)', async () => {
  need();
  const { renderCaller, CALLER_USES } = await import('../engineer-review/decide.mjs');
  const template = readFileSync(join(ROOT, 'engineer-review/caller.yml'), 'utf8');
  const SHA = 'c'.repeat(40);
  const caller = renderCaller(template, { owner: 'dazzer-io', repo: '.github', commit: SHA });
  assert.ok(template.includes(CALLER_USES) && caller.includes(`    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@${SHA}\n`), `Could not find caller.yml's one uses: line filled with dazzer-io/.github at ${SHA}:\n${caller}`);
  const classes = [
    ['dazzer, a private repository whose workflows read a CHECKS_ setting', DAZZER, { 'ci.yml': check() }],
    ['a private repository that reads no setting', QUIET, {}],
    ['a public repository', PUBLIC, {}],
  ];
  await everyCase(async (c) => {
    for (const [name, ctx, beside] of classes) {
      const asked = [];
      const compare = async (q) => { asked.push(q); return 'behind'; };
      const r = await c(() => mustPass(`caller.yml copied into ${name}`, { 'engineer-review.yml': caller, ...beside }, { ...ctx, compare }));
      if (r) await c(() => assert.ok(asked.some((q) => q.base === 'main' && q.head === SHA), `Could not find the caller's pin asked of GitHub's compare as main...${SHA} in ${name}: ${JSON.stringify(asked)}`));
    }
    await c(() => mustRefuse('caller.yml copied into dazzer-app, the repository strict.json names', { 'engineer-review.yml': caller, 'ci.yml': check() }, { ...APP, compare: async () => 'behind' }, { file: 'engineer-review.yml', job: 'engineer-review', says: /is a call in a repository strict\.json names, and asks for a permission of its own/ }));
  });
});

test('in dazzer-io/.github a workflow outside the two scans calls neither scan (runs-on test)', async () => {
  need();
  const call = (uses) => `name: made up\non: pull_request\n${READ}jobs:\n  shared:\n    uses: ${uses}\n    permissions:\n      contents: read\n`;
  await everyCase(async (c) => {
    await c(() => mustRefuse('a ./ call of the shared CodeQL scan', { 'decide-tests.yml': call('./.github/workflows/codeql.yml') }, SHARED, { file: 'decide-tests.yml', says: /a workflow of its own repository/ }));
    await c(() => mustRefuse('a call of the security scan at main from outside the scans', { 'decide-tests.yml': call('dazzer-io/.github/.github/workflows/security-scan.yml@main') }, SHARED, { file: 'decide-tests.yml', says: /outside the two scans/ }));
  });
});

// A call, and a job a checks entry keeps, meet every class rule any job meets, the workflow's top
// included: what it reads, holds, signs in for and where it runs (decision 184). Each case here is
// one the round before it passed.
test('a call and a job a checks entry keeps are held to every class rule any job meets, the workflow\'s top included (decision 184)', async () => {
  need();
  const GRANT = '    permissions:\n      contents: read\n      actions: read\n      security-events: write\n';
  const scan = (top = READ, { id = 'codeql', grant = GRANT, uses = 'dazzer-io/.github/.github/workflows/codeql.yml@main', withText = `    with:\n      languages: '["actions"]'\n` } = {}) => `name: CodeQL\non: [pull_request, push]\n${top}jobs:\n  ${id}:\n    uses: ${uses}\n${grant}${withText}`;
  const topEnv = (name) => `${READ}env:\n  R: @{{ vars.${name} }}\n`;
  const review = (top) => `name: made up\non: pull_request\n${top}jobs:\n  review:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@main\n    permissions:\n      statuses: write\n      pull-requests: read\n`;
  const securityScan = { uses: 'dazzer-io/.github/.github/workflows/security-scan.yml@main', grant: '    permissions:\n      contents: read\n', withText: '' };
  const keptAs = (ctx, file, id, writes) => ({ ...ctx, ...lists(), kept: { about: 'made up', entries: [{ repository: ctx.repository, workflow: file, job: id, name: id, effect: 'checks', ...(writes ? { writes } : {}), reason: 'made up', decision: 1, source: 'made up' }] } });
  const beside = { 'ci.yml': check() };
  await everyCase(async (c) => {
    // Finding 1 (a): a setting read at the top of a calling workflow.
    await c(() => mustRefuse('a call of the shared scan under a top-level env reading CHECKS_RUNNER_2, holding a write token', { 'codeql.yml': scan(topEnv('CHECKS_RUNNER_2')), ...beside }, DAZZER, { file: 'codeql.yml', job: 'codeql', says: /holds a write token \(security-events: write\) and reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('the same call, the read refused as the call\'s own', { 'codeql.yml': scan(topEnv('CHECKS_RUNNER_2')), ...beside }, DAZZER, { file: 'codeql.yml', job: 'codeql', says: /calls codeql\.yml and reads CHECKS_RUNNER_2, a CHECKS_ setting/ }));
    await c(() => mustRefuse('a call of the shared scan under a top-level env reading LOCKED_RUNNER_2', { 'codeql.yml': scan(topEnv('LOCKED_RUNNER_2')), ...beside }, DAZZER, { file: 'codeql.yml', job: 'codeql', says: /does not sign in, and it reads LOCKED_RUNNER_2/ }));
    await c(() => mustRefuse('a call in dazzer-io/.github under a top-level env reading CHECKS_RUNNER_2', { 'made-up.yml': review(topEnv('CHECKS_RUNNER_2')) }, SHARED, { file: 'made-up.yml', job: 'review', says: /holds a write token \(statuses: write\) and reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('a call in dazzer-io/.github under a top-level env reading LOCKED_RUNNER_2', { 'made-up.yml': review(topEnv('LOCKED_RUNNER_2')) }, SHARED, { file: 'made-up.yml', job: 'review', says: /does not sign in, and it reads LOCKED_RUNNER_2/ }));
    await c(() => mustRefuse('a read-only call in a public repository under a top-level env reading CHECKS_RUNNER_2', { 'codeql.yml': scan(topEnv('CHECKS_RUNNER_2'), { grant: '    permissions:\n      contents: read\n' }) }, PUBLIC, { file: 'codeql.yml', job: 'codeql', says: /a public repository, and reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('a call reading LOCKED_RUNNER_2 in a public repository, in its with:', { 'codeql.yml': scan(READ, { grant: '    permissions:\n      contents: read\n', withText: "    with:\n      languages: '@{{ vars.LOCKED_RUNNER_2 }}'\n" }) }, PUBLIC, { file: 'codeql.yml', job: 'codeql', says: /a public repository, and reads LOCKED_RUNNER_2/ }));
    await c(() => mustRefuse('a call in a workflow that signs in, under a top-level env reading CHECKS_RUNNER_2', { 'codeql.yml': scan(`${topEnv('CHECKS_RUNNER_2')}`.replace('contents: read\n', 'contents: read\n  id-token: write\n')), ...beside }, DAZZER, { file: 'codeql.yml', job: 'codeql', says: /a workflow that signs in .*and it reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('a call in a workflow that signs in and a tag starts', { 'codeql.yml': `name: made up\non:\n  push:\n    tags: [v*]\npermissions:\n  contents: read\n  id-token: write\njobs:\n  codeql:\n    uses: dazzer-io/.github/.github/workflows/codeql.yml@main\n${GRANT}` }, DAZZER, { file: 'codeql.yml', job: 'codeql', says: /that a tag starts/ }));
    // Finding 1 (b): a call of a file that declares no workflow_call.
    await c(() => mustRefuse('a call of security-scan.yml from dazzer', { 'scan.yml': scan(READ, { id: 'scan', ...securityScan }), ...beside }, DAZZER, { file: 'scan.yml', job: 'scan', says: /calls security-scan\.yml, which declares no workflow_call/ }));
    await c(() => mustRefuse('a call of security-scan.yml from dazzer-app', { 'codeql.yml': scan(READ, securityScan), ...beside }, APP, { file: 'codeql.yml', job: 'codeql', says: /calls security-scan\.yml, which declares no workflow_call/ }));
    // Finding 1 (c): in a repository strict.json names, a call asks a grant only as codeql.yml's job codeql.
    await c(() => mustRefuse('dazzer-app\'s call of the shared scan from another file', { 'scan.yml': scan(), ...beside }, APP, { file: 'scan.yml', job: 'codeql', says: /is a call in a repository strict\.json names, and asks for a permission of its own/ }));
    await c(() => mustRefuse('dazzer-app\'s codeql.yml calling another shared workflow as its job codeql', { 'codeql.yml': scan(READ, { uses: 'dazzer-io/.github/.github/workflows/engineer-review.yml@main', grant: '    permissions:\n      statuses: write\n', withText: '' }), ...beside }, APP, { file: 'codeql.yml', job: 'codeql', says: /asks for a permission of its own/ }));
    await c(() => mustPass('dazzer-app\'s own call, codeql.yml\'s job codeql', { 'codeql.yml': scan(), ...beside }, APP));
    // Finding 2: a checks entry admits writes only as decision 47 decided, a push-started job of a private repository.
    const labelling = (on, top) => ({ 'label.yml': workflow(on, top, job('label', CHECKS2)), ...beside });
    await c(() => mustRefuse('a pull-request job holding pull-requests: write on CHECKS_RUNNER_2, kept by a checks entry naming the write', labelling('pull_request', 'permissions:\n  pull-requests: write\n'), keptAs(DAZZER, 'label.yml', 'label', ['pull-requests']), { file: 'label.yml', job: 'label', says: /holds a write token \(pull-requests: write\) in a workflow a pull-request event starts/ }));
    await c(() => mustRefuse('a job on CHECKS_RUNNER_2 kept by a checks entry in a public repository', labelling('pull_request', READ), keptAs(PUBLIC, 'label.yml', 'label'), { file: 'label.yml', job: 'label', says: /a public repository, and reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('a job on CHECKS_RUNNER_2 kept by a checks entry in dazzer-io/.github', labelling('pull_request', READ), keptAs(SHARED, 'label.yml', 'label'), { file: 'label.yml', job: 'label', says: /a public repository, and reads CHECKS_RUNNER_2/ }));
    await c(() => mustRefuse('a push-started write job on CHECKS_RUNNER_2 kept by a checks entry naming the write, in dazzer-io/.github', labelling('push', 'permissions:\n  contents: write\n'), keptAs(SHARED, 'label.yml', 'label', ['contents']), { file: 'label.yml', job: 'label', says: /holds a write token \(contents: write\) in a workflow of dazzer-io\/\.github, whatever starts it/ }));
    await c(() => mustPass('brain-builder\'s shape: a push-started job of a private repository on CHECKS_RUNNER_2 holding contents: write, kept by a checks entry naming it (decision 47)', labelling('push', 'permissions:\n  contents: write\n'), keptAs(DAZZER, 'label.yml', 'label', ['contents'])));
  });
});

// ================================================================ dazzer-app's stricter class (strict.json; verdict.test.ts holdsMoreThanTheCode)
test('in a repository on strict.json, a job off a literal GitHub label holds no more than the code (dazzer-app verdict test)', async () => {
  need();
  const OFF = "@{{ needs.plan.outputs.machine || 'ubuntu-latest' }}";
  const CHECKOUT = '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          persist-credentials: false\n';
  const ci = (extra = '', steps = `    steps:\n${CHECKOUT}`, top = READ) => `name: CI\non: pull_request\n${top}jobs:\n  plan:\n    runs-on: ubuntu-latest\n    outputs:\n      machine: @{{ steps.p.outputs.machine }}\n    steps:\n      - id: p\n        env:\n          M: @{{ vars.CHECKS_RUNNER_2 }}\n        run: echo made-up\n  quick:\n    needs: plan\n    runs-on: ${OFF}\n${extra}${steps}`;
  const keptPlan = { ...APP, ...lists(), kept: { about: 'made up', entries: [{ repository: 'dazzer-io/dazzer-app', workflow: 'ci.yml', job: 'plan', name: 'plan', effect: 'stay', reason: 'r', decision: 34, source: 's' }] } };
  const refused = [
    ['a secret named in an expression', ci('    env:\n      K: @{{ secrets.MADE_UP }}\n'), /names a secret/],
    ['the word secrets on a plain line', ci('', `    steps:\n${CHECKOUT}      - run: echo secrets\n`), /names a secret/],
    ['a secret in an expression on a comment line', ci('    # @{{ secrets.MADE_UP }}\n'), /names a secret/],
    ['github.token handed on', ci('    env:\n      T: @{{ github.token }}\n'), /hands on the workflow's token/],
    ['toJSON(github)', ci('    env:\n      T: @{{ toJSON(github) }}\n'), /hands on the workflow's token/],
    ["github['token']", ci("    env:\n      T: @{{ github['token'] }}\n"), /hands on the workflow's token/],
    ['the github.* filter', ci('    env:\n      T: @{{ github.* }}\n'), /hands on the workflow's token/],
    ['a permission of its own', ci('    permissions:\n      contents: read\n'), /asks for a permission of its own/],
    ['a checkout keeping its credential', ci('', '    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n'), /keeps a git credential/],
    ['a checkout with persist-credentials: true', ci('', '    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          persist-credentials: true\n'), /keeps a git credential/],
    ['no top-level permissions', ci('', undefined, ''), /grants its token more than reading the code: no top-level permissions written/],
    ['top-level read-all', ci('', undefined, 'permissions: read-all\n'), /grants its token more than reading the code/],
    ['top-level contents and actions read', ci('', undefined, 'permissions:\n  contents: read\n  actions: read\n'), /grants its token more than reading the code/],
    ['a top-level env naming a secret', ci('', undefined, `${READ}env:\n  K: @{{ secrets.MADE_UP }}\n`), /top-level env names a secret/],
    ['a top-level env handing on the token', ci('', undefined, `${READ}env:\n  T: @{{ github.token }}\n`), /top-level env hands on the token/],
  ];
  await everyCase(async (c) => {
    await c(() => mustPass('the plain shape: a plan on ubuntu-latest, quick on its output, reading only the code', { 'ci.yml': ci() }, keptPlan));
    for (const [name, text, says] of refused) await c(() => mustRefuse(name, { 'ci.yml': text }, keptPlan, { file: 'ci.yml', says }));
    await c(() => mustPass('github.event_name, a plain property of the context', { 'ci.yml': ci('    if: github.event_name == \'pull_request\'\n') }, keptPlan));
    await c(() => mustPass('the same checkout without persist-credentials in dazzer, which strict.json does not name', { 'ci.yml': check('', '    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n') }, DAZZER));
  });
});

// The locked shape dazzer-app's production jobs read (decision 190, the shape r-3.8 teaches the
// app's own holdsMoreThanTheCode): the locked setting held to main, falling back to the literal
// ubuntu-latest, on a workflow no pull-request event starts. It is exempt from the stricter class
// as the literal ubuntu-latest is, and every class rule still judges the job.
test('in a repository on strict.json, the locked setting held to main falling back to ubuntu-latest, on a workflow no pull request starts, is exempt from the stricter class, and every class rule still judges it (decision 190)', async () => {
  need();
  const locked = (n, fallback = 'ubuntu-latest') => `@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_${n} || '${fallback}' }}`;
  const SCHEDULED = "\n  schedule:\n    - cron: '23 */2 * * *'\n  workflow_dispatch:";
  const PUSHED = `${PUSH}\n  workflow_dispatch:\n  schedule:\n    - cron: '23 */2 * * *'`;
  const TOP = 'permissions:\n  contents: read\n  actions: read\n';
  // A job as release-check's act is: in the release environment, granted a write of its own,
  // reading a secret, handing on the token, and checking out with its credential kept. The
  // stricter class refuses each of these off the literal ubuntu-latest.
  const ACT = '    environment: release\n    permissions:\n      contents: read\n      issues: write\n    env:\n      K: @{{ secrets.MADE_UP_TOKEN }}\n      T: @{{ github.token }}\n';
  // A job as sweep's is: no environment and no id-token: write, so its workflow signs in to nothing.
  const SWEEP = '    permissions:\n      contents: read\n      issues: write\n    env:\n      T: @{{ github.token }}\n';
  const STEPS_KEPT = '    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n      - run: echo made-up\n';
  const release = (runsOn, on = SCHEDULED, extra = ACT, top = TOP) => ({ 'made-up-release.yml': workflow(on, top, job('act', runsOn, extra, STEPS_KEPT)) });
  const STRICT = /a repository strict\.json names/;
  const exempt = (name, r) => {
    const held = r.lines.filter((l) => STRICT.test(l));
    assert.ok(!held.length, `Could not find ${name} exempt from the stricter class: the rule said\n${held.join('\n')}`);
  };
  const held = /in a repository strict\.json names, and names a secret/;
  await everyCase(async (c) => {
    // Admitted: nothing refused, its environment, write, secret, token and checkout all as they are.
    await c(() => mustPass('the locked shape on a workflow a schedule and a person start', release(locked(2)), APP));
    await c(() => mustPass('the locked shape on a workflow a push of main, a person and a schedule start, as release-check is', release(locked(2), PUSHED), APP));
    // Any LOCKED_RUNNER_<N> is exempt from the stricter class; the signs-in class still judges its width and its name.
    await c(async () => exempt('the locked shape reading LOCKED_RUNNER_8', await mustRefuse('LOCKED_RUNNER_8 falling back to ubuntu-latest', release(locked(8)), APP, { file: 'made-up-release.yml', job: 'act', says: /reads LOCKED_RUNNER_8, a 8-core machine, but its fallback 'ubuntu-latest' has 2 cores/ })));
    await c(async () => exempt('the locked shape reading LOCKED_RUNNER_4', await mustRefuse('LOCKED_RUNNER_4, which the organisation does not declare, falling back to ubuntu-latest', release(locked(4)), APP, { file: 'made-up-release.yml', job: 'act', says: /reads LOCKED_RUNNER_4, which the organisation does not declare/ })));
    // Every class rule still judges it: decision 9's LOCKED_ class, and the tag rule a deployment meets.
    await c(async () => exempt('the locked shape on a workflow that signs in to nothing', await mustRefuse('the locked shape on a scheduled workflow that signs in to nothing, as sweep is', release(locked(2), SCHEDULED, SWEEP), APP, { file: 'made-up-release.yml', job: 'act', says: /is a job of a workflow that does not sign in, and it reads LOCKED_RUNNER_2/ })));
    await c(async () => exempt('the locked shape on a workflow deployment_status starts', await mustRefuse('the locked shape on a workflow deployment_status starts, as promote-production is', release(locked(2), '\n  deployment_status:\n  workflow_dispatch:'), APP, { file: 'made-up-release.yml', job: 'act', says: /signs in and that a tag starts \(deployment_status\)/ })));
    // Still held to no more than the code.
    await c(() => mustRefuse('the locked shape on a workflow pull_request starts', release(locked(2), '\n  pull_request:\n  workflow_dispatch:'), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('the locked shape on a workflow pull_request_target starts', release(locked(2), '\n  pull_request_target:\n  workflow_dispatch:'), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('the locked shape on a workflow a merge queue starts, a pull-request event too', release(locked(2), '\n  merge_group:\n  workflow_dispatch:'), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('the locked setting read without the main guard', release("@{{ vars.LOCKED_RUNNER_2 || 'ubuntu-latest' }}"), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('a CHECKS_ setting read', release(CHECKS2), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('a CHECKS_ setting read behind the main guard', release("@{{ github.ref == 'refs/heads/main' && vars.CHECKS_RUNNER_2 || 'ubuntu-latest' }}"), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('the locked shape falling back to ubuntu-24.04', release(locked(2, 'ubuntu-24.04')), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('the locked shape falling back to ubuntu-8-core', release(locked(8, 'ubuntu-8-core')), APP, { file: 'made-up-release.yml', job: 'act', says: held }));
    await c(() => mustRefuse('the workflow holding the locked shape on a pull request, its top granting more than the code', release(locked(2), '\n  pull_request:\n  workflow_dispatch:'), APP, { file: 'made-up-release.yml', says: /a repository strict\.json names, and grants its token more than reading the code/ }));
    // dazzer, which strict.json does not name, reads the same job as it did.
    await c(() => mustPass('the locked shape in dazzer, which strict.json does not name', release(locked(2)), DAZZER));
  });
});

// ================================================================ the lists
test('secrets.json and strict.json pass their own checks and carry what the copies held: dazzer\'s CHANGE_CHECK_SECRETS, dazzer-app strict', () => {
  need();
  const { secrets, strict } = lists();
  assert.deepEqual(J.checkSecrets(secrets), [], 'Could not find secrets.json passing its own check');
  assert.deepEqual(J.checkStrict(strict), [], 'Could not find strict.json passing its own check');
  assert.deepEqual(secrets.repositories['dazzer-io/dazzer']?.names, ['TURBO_TOKEN', 'TURBO_TEAM', 'TURBO_REMOTE_CACHE_SIGNATURE_KEY', 'GCP_PROJECT_ID', 'DAZZER_AGENT_SPEC_TOKEN', 'DASHBOARD_CONTRACT_READ_TOKEN'], 'Could not find dazzer\'s CHANGE_CHECK_SECRETS moved into secrets.json as they stand');
  assert.deepEqual(strict.repositories.map((e) => e.repository), ['dazzer-io/dazzer-app'], 'Could not find strict.json naming dazzer-app alone');
  const bad = J.checkSecrets({ about: 'x', repositories: { 'dazzer-io/dazzer': { names: ['GITHUB_TOKEN', 'lower'], reason: '', decision: 0, source: '' } } });
  for (const words of ['GITHUB_TOKEN', 'capitals', 'no reason', 'no whole-number decision']) assert.ok(bad.some((p) => p.includes(words)), `Could not find secrets.json's check refusing ${words}: ${JSON.stringify(bad)}`);
  assert.deepEqual([...J.DECLARED_SETTINGS], ['CHECKS_RUNNER_2', 'CHECKS_RUNNER_8', 'CHECKS_RUNNER_16', 'LOCKED_RUNNER_2', 'LOCKED_RUNNER_8', 'SCAN_RUNNER_2'], 'Could not find the declared settings as runners\' org/settings.json names them at 789b335');
});

// ================================================================ this repository's own folder
test('the judge reads this repository\'s own workflow folder clean, and refuses a literal-label job planted in any shared workflow that kept.json does not name (r-1.58)', async () => {
  need();
  const files = J.readFolder(ROOT);
  assert.ok(files && files.length >= 5, `Could not find this repository's workflows to read: ${JSON.stringify(files?.map((f) => f.path))}`);
  const r = await J.judgeFiles({ ...SHARED, ...lists(), files });
  assert.deepEqual(r.lines, [], `Could not find this repository's own folder read clean:\n${said(r)}`);
  await everyCase(async (c) => {
    for (const name of ['codeql.yml', 'security-scan.yml', 'engineer-review.yml', 'machine-rule.yml']) {
      const planted = files.map((f) => (f.path.endsWith(`/${name}`) ? { ...f, text: `${f.text.trimEnd()}\n  made-up-report:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - run: echo made-up\n` } : f));
      const p = await J.judgeFiles({ ...SHARED, ...lists(), files: planted });
      await c(() => assert.ok(p.lines.some((l) => l.includes(`${name}:`) && l.includes('jobs.made-up-report:') && l.includes('kept.json names no stay entry')), `Could not find a literal-label job planted in ${name} refused for having no kept.json entry:\n${said(p)}`));
    }
  });
});

test('machine-rule.yml runs the judge, then a pinned actionlint, on the change\'s folder, read-only, on GitHub\'s machine, with no secret', () => {
  need();
  const text = readFileSync(join(ROOT, '.github/workflows/machine-rule.yml'), 'utf8');
  const wfRead = J.readWorkflow(text);
  assert.deepEqual(wfRead.misread, [], `Could not find machine-rule.yml read with no refused spelling: ${JSON.stringify(wfRead.misread)}`);
  const js = wfRead.js;
  const jobs = Object.entries(js.jobs);
  const [, only] = jobs[0];
  const steps = only.steps;
  const runs = steps.map((s) => s.run ?? '').join('\n');
  const checks = [
    [JSON.stringify(Object.keys(js.on)) === JSON.stringify(['pull_request', 'merge_group']), 'its triggers pull_request and merge_group alone'],
    [JSON.stringify(js.permissions) === JSON.stringify({ contents: 'read' }), 'its token reading the code alone'],
    [jobs.length === 1 && only['runs-on'] === 'ubuntu-latest' && !('permissions' in only), 'one job on the literal ubuntu-latest'],
    [!/secrets/i.test(text), 'no secret anywhere in it'],
    [steps.filter((s) => /^actions\/checkout@[0-9a-f]{40}$/.test(String(s.uses).split(' ')[0])).length === 2 && steps.filter((s) => s.uses?.startsWith('actions/checkout@')).every((s) => s.with?.['persist-credentials'] === false), 'two checkouts pinned by commit, each with persist-credentials: false'],
    [steps.some((s) => s.uses?.startsWith('actions/checkout@') && s.with?.repository === '${{ steps.source.outputs.repo }}' && s.with?.ref === '${{ steps.source.outputs.sha }}' && s.with?.path === '.machine-rule') && text.includes('${{ job.workflow_repository }}') && text.includes('${{ job.workflow_sha }}'), 'the rule checked out of job.workflow_repository at job.workflow_sha'],
    [text.includes('${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha }}') && steps.some((s) => s.uses?.startsWith('actions/checkout@') && s.with?.path === '.change' && !('repository' in (s.with ?? {}))), 'the change checked out of the triggering repository at its head commit'],
    [runs.includes('npm ci --ignore-scripts'), 'the YAML reader installed with npm ci --ignore-scripts'],
    [runs.includes('node .machine-rule/machine-rule/judge.mjs --repository "$REPOSITORY" --visibility "$VISIBILITY" .change'), 'the judge run over the change'],
    [steps.some((s) => s.env?.ACTIONLINT_VERSION === '1.7.12' && /^[0-9a-f]{64}$/.test(s.env?.ACTIONLINT_SHA256 ?? '')) && runs.includes('sha256sum -c -') && runs.includes('-shellcheck= -pyflakes='), 'actionlint 1.7.12 checked by its SHA-256, shellcheck and pyflakes off'],
    [runs.indexOf('judge.mjs') < runs.indexOf('actionlint'), 'the judge before actionlint'],
  ];
  const misses = checks.filter(([ok]) => !ok).map(([, what]) => `Could not find machine-rule.yml holding ${what}`);
  assert.ok(!misses.length, misses.join('\n'));
});

test('the YAML reader is the yaml package, pinned at exactly 2.9.1 and installed before the tests; no hand-written reader is kept', () => {
  need();
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const misses = [];
  if (pkg.dependencies?.yaml !== '2.9.1') misses.push(`Could not find package.json pinning yaml at exactly 2.9.1: ${JSON.stringify(pkg.dependencies)}`);
  if (lock.packages?.['node_modules/yaml']?.version !== '2.9.1' || !/^sha512-/.test(lock.packages?.['node_modules/yaml']?.integrity ?? '')) misses.push('Could not find package-lock.json pinning yaml 2.9.1 with its integrity');
  if (Object.keys(lock.packages ?? {}).filter((k) => k.startsWith('node_modules/')).length !== 1) misses.push(`Could not find yaml the lock's one package: ${Object.keys(lock.packages ?? {})}`);
  const code = readFileSync(join(ROOT, 'machine-rule/judge.mjs'), 'utf8');
  if (!/from 'yaml';/.test(code) || /class YamlReader|function parseYaml/.test(code)) misses.push('Could not find machine-rule/judge.mjs reading workflows through the yaml package alone, with no hand-written reader');
  const decide = readFileSync(join(ROOT, '.github/workflows/decide-tests.yml'), 'utf8');
  const install = decide.indexOf('run: npm ci --ignore-scripts');
  if (install === -1 || install > decide.indexOf('run: node --test test/*.test.mjs')) misses.push('Could not find decide-tests.yml installing the package with npm ci --ignore-scripts before the tests');
  if (existsSync(join(ROOT, OLD_TEST))) misses.push(`Could not find ${OLD_TEST} gone: this file replaces it`);
  assert.ok(!misses.length, misses.join('\n'));
});

// ================================================================ the files this change made stale (decision 178)
test('the files this change made stale say what is true after it: no file names the deleted test, codeql.yml\'s header counts its three jobs, node_modules/ is ignored (decision 178)', () => {
  need();
  const misses = [];
  // The deleted file's name as a grep for it reads it, the same text in any folder.
  const name = OLD_TEST.slice('test/'.length, -'.mjs'.length);
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch (e) {
    misses.push(`Could not find the files git tracks in this copy, so whether any names ${OLD_TEST} is unread: ${e.message}`);
  }
  if (!tracked.includes('machine-rule/judge.mjs')) misses.push(`Could not find machine-rule/judge.mjs among the files git tracks here, so the list read is not this repository's: ${tracked.length} files`);
  for (const f of tracked) {
    const at = join(ROOT, f);
    if (!existsSync(at) || !statSync(at).isFile()) continue;
    readFileSync(at, 'utf8').split('\n').forEach((l, i) => {
      if (l.includes(name)) misses.push(`Could not find ${f}:${i + 1} free of ${OLD_TEST}, which this change deletes: '${l.trim()}'. Name what holds those jobs today, machine-rule/judge.mjs and its test test/machine-rule.test.mjs.`);
    });
  }
  // codeql.yml's header gives its jobs' count in words and names them, as the file holds them.
  const codeql = readFileSync(join(ROOT, '.github/workflows/codeql.yml'), 'utf8');
  const ids = J.readWorkflow(codeql).jobs.map((j) => j.id);
  const header = [];
  for (const l of codeql.split('\n')) {
    if (l.trim() !== '' && !l.startsWith('#')) break;
    header.push(l.replace(/^# ?/, ''));
  }
  const words = header.join(' ').replace(/\s+/g, ' ');
  const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const counts = [...words.matchAll(/\b(?:split in (\w+)|(both|one|two|three|four|five|six|seven|eight|nine|ten) jobs)\b/gi)].map((m) => [m[0], (m[1] ?? m[2]).toLowerCase()]);
  const wrong = counts.filter(([, w]) => (w === 'both' ? 2 : NUMBERS.indexOf(w)) !== ids.length);
  const listed = `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
  if (JSON.stringify(ids) !== JSON.stringify(['analyze', 'upload', 'complete'])) misses.push(`Could not find codeql.yml's three jobs, analyze, upload and complete, as read: ${ids.join(', ')}`);
  if (!counts.length || wrong.length) misses.push(`Could not find codeql.yml's header counting its jobs as the file holds them, ${NUMBERS[ids.length]}: ${counts.length ? `it says ${counts.map(([p]) => `'${p}'`).join(', ')}` : 'it gives no count'}`);
  if (!words.includes(listed)) misses.push(`Could not find codeql.yml's header naming its jobs as '${listed}'`);
  // npm ci's install is no file of this repository.
  const ignore = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()) : null;
  if (!ignore?.includes('node_modules/')) misses.push(`Could not find a .gitignore at this repository's root holding node_modules/, so the package npm ci installs stays out of every copy: ${ignore === null ? 'there is no .gitignore' : JSON.stringify(ignore)}`);
  assert.ok(!misses.length, misses.join('\n'));
});

// ================================================================ the command (runners reader's origin rule; decision 164)
const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
function copyOf(files) {
  const dir = temp('machine-rule-copy-');
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, '.github', 'workflows', name), wf(text));
  return dir;
}
async function run(argv, opts = {}) {
  const out = [];
  const err = [];
  const code = await J.main(argv, { gitRemote: () => { throw new Error('no git here'); }, compare: NO_GITHUB, ...opts, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, all: [...out, ...err].join('\n'), err: err.join('\n') };
}

test('the command: exit 0 clean, 1 refused, 2 unread, and a folder with no workflows said as nothing to judge, never as clean', async () => {
  need();
  const scanCopy = copyOf({ 'security-scan.yml': `on: pull_request\n${READ}jobs:\n  semgrep:\n    runs-on: ${SCAN}\n${STEPS}` });
  await everyCase(async (c) => {
    const clean = await run(['--repository', 'dazzer-io/dazzer', '--visibility', 'private', copyOf({ 'ci.yml': check() })]);
    await c(() => assert.equal(clean.code, 0, `Could not find exit 0 for a clean copy: ${clean.all}`));
    const refused = await run(['--repository', 'dazzer-io/dazzer', '--visibility', 'private', copyOf({ 'ci.yml': workflow('pull_request', READ, job('check', 'dazzer-checks-2-core')) })]);
    await c(() => assert.ok(refused.code === 1 && /\.github\/workflows\/ci\.yml:\d+ jobs\.check: /.test(refused.all), `Could not find exit 1 naming file, line and job: ${refused.all}`));
    const empty = temp('machine-rule-empty-');
    const none = await run(['--repository', 'dazzer-io/dazzer', '--visibility', 'private', empty]);
    await c(() => assert.ok(none.code === 0 && /NOTHING TO JUDGE/.test(none.all) && !/nothing refused/.test(none.all), `Could not find a folder with no workflows said as nothing to judge: ${none.all}`));
    const usage = await run(['--repository', 'dazzer-io/dazzer', empty]);
    await c(() => assert.equal(usage.code, 2, `Could not find exit 2 for a run naming no visibility: ${usage.all}`));
    for (const origin of ['https://github.com/dazzer-io/.github.git', 'https://github.com/dazzer-io/.github', 'git@github.com:dazzer-io/.github.git', 'ssh://git@github.com/dazzer-io/.github.git']) {
      const ours = await run(['--repository', 'dazzer-io/.github', '--visibility', 'public', scanCopy], { gitRemote: () => origin });
      await c(() => assert.equal(ours.code, 0, `Could not find the organisation's own .github, its origin ${origin}, passing its shared scan: ${ours.all}`));
    }
    const cases = [
      ['no origin it can read', () => { throw new Error('no git here'); }],
      ['an origin naming dazzer-io/dazzer', () => 'git@github.com:dazzer-io/dazzer.git'],
      ['an origin naming another owner\'s .github', () => 'git@github.com:made-up-org/.github.git'],
      ['an origin naming the organisation in another case', () => 'https://github.com/Dazzer-IO/.github.git'],
      ['an origin on another host', () => 'https://gitlab.example.com/dazzer-io/.github.git'],
      ['an origin that is a local path', () => '/srv/made-up-mirror/dazzer-io/.github.git'],
    ];
    for (const [why, gitRemote] of cases) {
      const r = await run(['--repository', 'dazzer-io/.github', '--visibility', 'public', scanCopy], { gitRemote });
      await c(() => assert.ok(r.code === 2 && /is read as dazzer-io\/\.github only when its origin can be read and names exactly dazzer-io\/\.github/.test(r.err), `Could not find a copy read as .github with ${why} refused, exit 2: exit ${r.code}\n${r.all}`));
    }
    const token = await run(['--repository', 'dazzer-io/.github', '--visibility', 'public', scanCopy], { gitRemote: () => 'https://x-access-token:made-up-token-123@gitlab.example.com/dazzer-io/.github.git' });
    await c(() => assert.ok(token.code === 2 && token.err.includes('; it has an origin on gitlab.example.com, so whether its shared scans may read a scan setting is unknown.') && !token.err.includes('made-up-token-123') && !token.err.includes('x-access-token'), `Could not find the refusal naming the origin's host alone, never its token (decision 164): ${token.err}`));
    const foreign = await run(['--repository', 'made-up-org/.github', '--visibility', 'public', scanCopy]);
    await c(() => assert.ok(foreign.code === 1 && /a scan setting/.test(foreign.all), `Could not find another owner's .github read as no shared repository, its scan refused: ${foreign.all}`));
    const broken = temp('machine-rule-lists-');
    for (const n of ['secrets.json', 'strict.json']) writeFileSync(join(broken, n), readFileSync(join(ROOT, 'machine-rule', n)));
    writeFileSync(join(broken, 'kept.json'), JSON.stringify({ about: 'x', entries: [{ repository: 'dazzer-io/dazzer', workflow: 'x.yml', jobs: ['a'], reason: 'r', decision: 1, source: 's' }] }));
    const unreadLists = await run(['--repository', 'dazzer-io/dazzer', '--visibility', 'private', copyOf({ 'ci.yml': check() })], { listsDir: broken });
    await c(() => assert.ok(unreadLists.code === 2 && /has no effect/.test(unreadLists.err), `Could not find a list failing its check leaving the rule unread, exit 2: ${unreadLists.all}`));
  });
});

// ================================================================ no bare host checked as a substring (decision 179)
// GitHub's code scanner reads .includes, .indexOf, .startsWith or .endsWith on a text shaped like a bare
// host name as a weak URL check (js/incomplete-url-substring-sanitization), and main's code-scanning
// rule refuses a merge while one stands; a test names a host by the words around it instead.
test('no JavaScript file git tracks here checks a bare host name as a substring, which GitHub\'s code scanner reads as a weak URL check (decision 179)', () => {
  const misses = [];
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch (e) {
    misses.push(`Could not find the files git tracks in this copy, so whether any checks a bare host name as a substring is unread: ${e.message}`);
  }
  const code = tracked.filter((f) => /\.[cm]?[jt]sx?$/.test(f));
  if (!code.includes('machine-rule/judge.mjs')) misses.push(`Could not find machine-rule/judge.mjs among the JavaScript files git tracks here, so the list read is not this repository's: ${code.length} files`);
  // A quoted text of two or more dot-separated parts of letters, digits and hyphens that is no file's name.
  const CALL = /\.(?:includes|indexOf|startsWith|endsWith)\(\s*(['"`])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\1/g;
  const FILE = /\.(?:json|ya?ml|[cm]?[jt]sx?|md|txt|toml)$/i;
  for (const f of code) {
    const at = join(ROOT, f);
    if (!existsSync(at) || !statSync(at).isFile()) continue;
    readFileSync(at, 'utf8').split('\n').forEach((l, i) => {
      for (const m of l.matchAll(CALL)) if (!FILE.test(m[2])) misses.push(`Could not find ${f}:${i + 1} free of a bare host name checked as a substring, ${m[0]}, which GitHub's code scanner reads as a weak URL check: assert the words around the host instead.`);
    });
  }
  assert.ok(!misses.length, misses.join('\n'));
});

// ================================================================ the readings (runners' scan test gate S6 and readCalls, decision 160)
// A fake GitHub: repositories, each with its default branch and files by ref; listings, raw files,
// branches and the organisation's repository list, each answered as the contents API answers.
function fakeGitHub({ repos = {}, called = {}, missingBranch = [], extraOrgRepos = [] } = {}) {
  const calls = [];
  const all = { ...called };
  for (const [name, r] of Object.entries(repos)) all[name] = { ...(all[name] ?? {}), [r.branch ?? 'main']: r.files };
  const call = async (path) => {
    calls.push(path);
    const u = new URL(`https://api.github.com${path}`);
    const ref = u.searchParams.get('ref');
    let m;
    if ((m = /^\/orgs\/dazzer-io\/repos$/.exec(u.pathname))) {
      const list = [...Object.entries(repos).map(([name, r]) => ({ name, private: r.visibility !== 'public', archived: r.archived === true })), ...extraOrgRepos];
      return { status: 200, text: JSON.stringify(u.searchParams.get('page') === '1' ? list : []) };
    }
    if ((m = /^\/repos\/dazzer-io\/([^/]+)$/.exec(u.pathname))) {
      const r = repos[m[1]];
      return r ? { status: 200, text: JSON.stringify({ default_branch: r.branch ?? 'main', visibility: r.visibility ?? 'private', private: r.visibility !== 'public' }) } : { status: 404, text: '{}' };
    }
    if ((m = /^\/repos\/dazzer-io\/([^/]+)\/branches\/(.+)$/.exec(u.pathname))) return { status: missingBranch.includes(m[1]) ? 404 : 200, text: '{}' };
    if ((m = /^\/repos\/dazzer-io\/([^/]+)\/contents\/\.github\/workflows$/.exec(u.pathname))) {
      if (missingBranch.includes(m[1])) return { status: 404, text: '{}' };
      const files = all[m[1]]?.[ref];
      if (files === null || files === undefined) return { status: 404, text: '{}' };
      return { status: 200, text: JSON.stringify(Object.keys(files).map((name) => ({ name, type: 'file' }))) };
    }
    if ((m = /^\/repos\/dazzer-io\/([^/]+)\/contents\/\.github\/workflows\/(.+)$/.exec(u.pathname))) {
      const text = all[m[1]]?.[ref]?.[decodeURIComponent(m[2])];
      return text === undefined ? { status: 404, text: '' } : { status: 200, text: wf(text) };
    }
    if ((m = /^\/repos\/dazzer-io\/([^/]+)\/contents\/(.+)$/.exec(u.pathname))) return { status: 404, text: '' };
    return { status: 404, text: '{}' };
  };
  return { call, calls };
}
const CLEAN = check();
const cleanRepos = () => ({ 'dazzer-app': { files: { 'ci.yml': CLEAN } }, scheduler: { files: { 'tests.yml': CLEAN } } });
async function readingsOf(gh, opts = {}) {
  return J.readings({ call: gh.call, lists: lists(), compare: NO_GITHUB, ...opts });
}
const mentions = (r, words) => [...r.lines, ...r.unread].some((l) => l.includes(words));

test('the readings: every private, non-archived repository read at its default branch and judged, the gate S6 cases each refusing it (runners scan test S6)', async () => {
  need();
  const cases = [
    [{ 'codeql.yml': "on: pull_request\npermissions:\n  contents: read\njobs:\n  analyse:\n    runs-on: @{{ vars['SCAN_RUNNER_2'] || 'ubuntu-latest' }}\n" + STEPS }, 'REFUSED dazzer-io/dazzer on main .github/workflows/codeql.yml', 'the index spelling vars[\'SCAN_RUNNER_2\']'],
    [{ 'reused.yml': 'on:\n  workflow_call:\n    inputs:\n      machine:\n        type: string\n        default: "@{{ vars.SCAN_RUNNER_2 }}"\njobs:\n  reused:\n    runs-on: @{{ inputs.machine }}\n' + STEPS, 'ci.yml': 'on: pull_request\njobs:\n  call:\n    uses: ./.github/workflows/reused.yml\n' }, '.github/workflows/reused.yml', 'a workflow_call input whose default reads SCAN_RUNNER_2'],
    [{ 'ci.yml': `on: pull_request\n${READ}jobs:\n  plan:\n    runs-on: ${CHECKS2}\n    outputs:\n      pick: "@{{ vars.SCAN_RUNNER_2 }}"\n${STEPS}  through-plan:\n    needs: plan\n    runs-on: @{{ needs.plan.outputs.pick || 'ubuntu-latest' }}\n${STEPS}` }, 'ci.yml:', 'a job\'s outputs reaching SCAN_RUNNER_2'],
    [{ 'ci.yml': `on: pull_request\n${READ}jobs:\n  matrix-row:\n    runs-on: @{{ matrix.machine || 'ubuntu-latest' }}\n    strategy:\n      matrix:\n        include:\n          - machine: "@{{ vars['SCAN_RUNNER_2'] }}"\n${STEPS}` }, 'jobs.matrix-row:', 'a matrix row reaching SCAN_RUNNER_2'],
    [{ 'security.yml': 'on: pull_request\njobs:\n  scan:\n    uses: dazzer-io/.github/.github/workflows/security-scan.yml@made-up-branch\n' }, 'security-scan.yml at made-up-branch', 'a call into the shared security scan at a branch'],
    [{ 'security.yml': 'on: pull_request\njobs:\n  scan:\n    uses: dazzer-io/.github/.github/workflows/codeql.yml@0123456789abcdef0123456789abcdef01234567\n' }, 'codeql.yml at 0123456789abcdef0123456789abcdef01234567', 'a call into the shared CodeQL scan at a commit'],
  ];
  await everyCase(async (c) => {
    for (const [files, words, why] of cases) {
      const r = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files } } }));
      await c(() => assert.ok(r.refused > 0 && mentions(r, words), `Could not find the readings refusing ${why} in dazzer, naming ${words}:\n${[...r.lines, ...r.unread].join('\n')}`));
    }
    const clean = await readingsOf(fakeGitHub({ repos: cleanRepos() }));
    await c(() => assert.ok(clean.refused === 0 && !clean.unread.length, `Could not find clean repositories read with no refusal:\n${[...clean.lines, ...clean.unread].join('\n')}`));
    const trunk = fakeGitHub({ repos: { ...cleanRepos(), dazzer: { branch: 'trunk', files: { 'codeql.yml': `on: pull_request\n${READ}jobs:\n  analyse:\n    runs-on: ${SCAN}\n${STEPS}` } } } });
    const onTrunk = await readingsOf(trunk);
    await c(() => assert.ok(mentions(onTrunk, 'REFUSED dazzer-io/dazzer on trunk') && trunk.calls.includes('/repos/dazzer-io/dazzer/contents/.github/workflows?ref=trunk'), `Could not find dazzer read at its default branch trunk:\n${onTrunk.lines.join('\n')}\n${trunk.calls.join('\n')}`));
    const missing = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { branch: 'trunk', files: { 'ci.yml': CLEAN } } }, missingBranch: ['dazzer'] }));
    await c(() => assert.ok(missing.unread.some((l) => l.includes('dazzer-io/dazzer') && l.includes('no branch trunk')), `Could not find a missing default branch read as unread: ${JSON.stringify(missing.unread)}`));
    const odd = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files: { 'ci.yml': CLEAN, 'odd.yml': 'on: push\nname: made up\n' } } } }));
    await c(() => assert.ok(mentions(odd, 'odd.yml:1 holds no job this rule can read'), `Could not find a file with no jobs mapping refused: ${odd.lines.join('\n')}`));
    const none = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files: null } } }));
    await c(() => assert.ok(none.refused === 0 && mentions(none, 'NOTHING TO JUDGE dazzer-io/dazzer'), `Could not find a repository with no workflow folder said as nothing to judge, not a refusal: ${none.lines.join('\n')}`));
    const skipped = fakeGitHub({ repos: { ...cleanRepos(), 'made-up-archive': { archived: true, files: { 'x.yml': 'jobs: [unclosed\n' } }, 'made-up-public': { visibility: 'public', files: { 'x.yml': 'jobs: [unclosed\n' } } } });
    const skip = await readingsOf(skipped);
    await c(() => assert.ok(!mentions(skip, 'made-up-archive') && !mentions(skip, 'made-up-public') && !skipped.calls.some((p) => p.includes('made-up-archive/contents')), `Could not find archived and public repositories left unread: ${skip.lines.join('\n')}`));
  });
});

test('the readings follow every call at the ref it names, up to GitHub\'s ten levels, and refuse a call they cannot read (runners readCalls, scan test S6)', async () => {
  need();
  const reads = 'on: workflow_call\njobs:\n  inner:\n    runs-on: @{{ vars.SCAN_RUNNER_2 || \'ubuntu-latest\' }}\n' + STEPS;
  const plain = 'on: workflow_call\njobs:\n  inner:\n    runs-on: ubuntu-latest\n' + STEPS;
  const calling = (uses) => ({ 'ci.yml': CLEAN, 'calls.yml': `on: pull_request\njobs:\n  hand-off:\n    uses: ${uses}\n` });
  const PINNED = 'f'.repeat(40);
  const cases = [
    [calling('made-up-org/made-up-tools/.github/workflows/helper.yml@main'), {}, 'calls made-up-org/made-up-tools/.github/workflows/helper.yml@main, of an owner other than dazzer-io', 'a call to an owner other than dazzer-io'],
    [calling('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': reads } } }, 'dazzer-io/made-up-tools .github/workflows/helper.yml inner at main reads SCAN_RUNNER_2', 'a call into a repository the setting does not reach'],
    [calling(`dazzer-io/made-up-tools/.github/workflows/outer.yml@${PINNED}`), { 'made-up-tools': { [PINNED]: { 'outer.yml': 'on: workflow_call\njobs:\n  outer:\n    uses: $/.github/workflows/inner.yml\n', 'inner.yml': reads } } }, `dazzer-io/made-up-tools .github/workflows/inner.yml inner at ${PINNED}`, 'a called workflow whose own call reads SCAN_RUNNER_2'],
    [calling('dazzer-io/made-up-tools/.github/workflows/outer.yml@v1'), { 'made-up-tools': { v1: { 'outer.yml': 'on: workflow_call\njobs:\n  outer:\n    uses: dazzer-io/dazzer/.github/workflows/deep.yml@made-up-branch\n' } }, dazzer: { 'made-up-branch': { 'deep.yml': reads } } }, 'dazzer-io/dazzer .github/workflows/deep.yml inner at made-up-branch', 'a call two hands deep into dazzer at another branch'],
    [calling('dazzer-io/made-up-tools/.github/workflows/gone.yml@main'), {}, 'calls dazzer-io/made-up-tools/.github/workflows/gone.yml@main, which is unread', 'a call GitHub does not answer at its ref'],
    [calling('dazzer-io/made-up-tools/.github/workflows/outer.yml@main'), { 'made-up-tools': { main: { 'outer.yml': 'on: workflow_call\njobs:\n  outer:\n    uses: ./.github/workflows/inner.yml\n', 'inner.yml': plain } } }, 'a ./ call inside a workflow called from dazzer-io/dazzer', 'a ./ call inside a called workflow'],
    [calling('dazzer-io/made-up-tools/made-up/place.yml@main'), {}, 'a file outside .github/workflows', 'a call to a file outside .github/workflows'],
    [{ 'ci.yml': CLEAN, 'security.yml': 'on: pull_request\njobs:\n  scan:\n    uses: dazzer-io/.github/.github/workflows/security-scan.yml@main\n' }, { '.github': { main: { 'security-scan.yml': 'on: workflow_call\njobs:\n  scan:\n    uses: $/.github/workflows/helper.yml\n', 'helper.yml': reads } } }, 'dazzer-io/.github .github/workflows/helper.yml inner at main reads SCAN_RUNNER_2', 'the shared scan calling a workflow that reads SCAN_RUNNER_2'],
    [{ 'ci.yml': CLEAN, 'engineer-review.yml': `on: pull_request\njobs:\n  review:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@${PINNED}\n` }, { '.github': { [PINNED]: { 'engineer-review.yml': 'on: workflow_call\njobs:\n  review:\n    uses: $/.github/workflows/security-scan.yml\n', 'security-scan.yml': reads } } }, `dazzer-io/.github .github/workflows/security-scan.yml inner at ${PINNED}`, 'the shared scan\'s path reached at a commit through a self call'],
    [calling('dazzer-io/made-up-tools/.github/workflows/level-2.yml@v1'), { 'made-up-tools': { v1: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`level-${k + 2}.yml`, `on: workflow_call\njobs:\n  deeper:\n    uses: $/.github/workflows/level-${k + 3}.yml\n`])) } }, 'GitHub connects at most 10 levels of workflows', 'a chain of calls eleven levels deep'],
  ];
  await everyCase(async (c) => {
    for (const [files, called, words, why] of cases) {
      const r = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files } }, called }));
      await c(() => assert.ok(mentions(r, words), `Could not find the readings refusing ${why}, naming ${words}:\n${[...r.lines, ...r.unread].join('\n')}`));
    }
    const fine = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files: calling('dazzer-io/made-up-tools/.github/workflows/helper.yml@main') } }, called: { 'made-up-tools': { main: { 'helper.yml': plain } } } }));
    await c(() => assert.ok(!fine.lines.some((l) => l.includes('made-up-tools .github/workflows/helper.yml')), `Could not find a called workflow reading no scan setting left without a scan refusal of its own:\n${fine.lines.join('\n')}`));
  });
});

test('the readings: --class production lists only refusals in workflows that sign in, --only reads just those named, --moving reads a repository as moving', async () => {
  need();
  const deploy = `name: made up\non: push\npermissions:\n  id-token: write\njobs:\n${job('deploy', 'ubuntu-latest')}`;
  const quiet = { 'made-up-tools': { files: { 'ci.yml': workflow('pull_request', READ, job('report', 'ubuntu-latest')) } } };
  await everyCase(async (c) => {
    const gh = () => fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files: { 'ci.yml': workflow('pull_request', READ, job('check', 'dazzer-checks-2-core')), 'deploy.yml': deploy } }, ...quiet } });
    const all = await readingsOf(gh());
    const prod = await readingsOf(gh(), { production: true });
    await c(() => assert.ok(mentions(all, 'ci.yml') && mentions(all, 'deploy.yml'), `Could not find both refusals in the full readings: ${all.lines.join('\n')}`));
    await c(() => assert.ok(!mentions(prod, 'ci.yml') && mentions(prod, 'deploy.yml'), `Could not find --class production listing the signing workflow's refusal alone: ${prod.lines.join('\n')}`));
    const only = gh();
    const just = await readingsOf(only, { only: ['scheduler'] });
    await c(() => assert.ok(!mentions(just, 'dazzer-io/dazzer') && !only.calls.some((p) => p.startsWith('/repos/dazzer-io/dazzer/')), `Could not find --only reading scheduler alone: ${only.calls.join('\n')}`));
    const still = await readingsOf(gh(), { only: ['made-up-tools'] });
    const moved = await readingsOf(gh(), { only: ['made-up-tools'], moving: ['made-up-tools'] });
    await c(() => assert.ok(still.refused === 0 && moved.refused > 0 && mentions(moved, 'jobs.report:'), `Could not find --moving reading made-up-tools' literal job as needing an entry: ${still.lines.join('\n')} | ${moved.lines.join('\n')}`));
  });
});

// ================================================================ parity with the four old copies (decision 181)
// Every refusal each old copy makes, one case per branch, each naming the old file and line. A
// refusal the rule carries is a case it refuses. One it drops on purpose is a case it admits, and
// that case holds only while machine-rule/README.md's Left out names it with its decision: a dropped
// refusal with no such line is a fault, never a Left out line written to excuse it. The copies, as
// read for this change:
//   dazzer's gate, scripts/checks/check-runner-setting.mjs at 58797b699 (the file as a221466 left it);
//   dazzer-app's verdict test, test/verdict.test.ts at 4b236f2e;
//   this repository's runs-on test at dca1d18, its path held in OLD_TEST;
//   runners' bin/check-repos-read-setting.mjs and bin/switch-on.mjs (gate S6) at 789b335.
// A spelling is read the same way in every repository, so the reading rows feed a change check of
// dazzer (or of dazzer-app, for its own reader) whichever copy refused the spelling.
// Each bullet of Left out: its head, naming the decision, and each spelling or refusal it drops,
// one line under it. A case cites the bullet by words of its head and the line by its words.
const LEFT_OUT = (() => {
  const md = readFileSync(join(ROOT, 'machine-rule/README.md'), 'utf8');
  const from = md.indexOf('\n## Left out');
  if (from === -1) return [];
  const to = md.indexOf('\n## ', from + 1);
  const plain = (x) => x.replace(/\s+/g, ' ').trim();
  return md.slice(from, to === -1 ? undefined : to).split(/\n- /).slice(1).map((b) => {
    const [head, ...lines] = b.split(/\n {2}- /);
    return { head: plain(head), spellings: lines.map(plain) };
  });
})();
// Every Left out line a case cited, so the last test finds a line no case cites.
const CITED = new Set();
const leftOutNames = (words, decision, spelling) => {
  const decided = new RegExp(`\\bdecisions? (?:\\d+, )*(?:\\d+ and )?${decision}\\b`);
  const bullet = LEFT_OUT.find((b) => b.head.includes(words) && decided.test(b.head));
  if (!bullet || !bullet.spellings.includes(spelling)) return false;
  CITED.add(`${bullet.head}\n${spelling}`);
  return true;
};
const R = (says, job, file) => ({ says, job, file });
const L = (left, decision, spelling) => ({ left, decision, spelling });
const keptIn = (ctx, ...entries) => ({ ...ctx, ...lists(), kept: { about: 'made up', entries: entries.map((e) => ({ repository: ctx.repository, reason: 'made up', decision: 1, source: 'made up', ...e })) } });
async function parity(copy, rows) {
  need();
  await everyCase(async (c) => {
    for (const [at, what, text, expect, ctx = DAZZER] of rows) {
      const name = `${what} (${copy}:${at})`;
      if (typeof expect === 'function') { await c(() => expect(name)); continue; }
      const files = typeof text === 'string' ? { 'made-up.yml': text } : text;
      if (expect.left) {
        await c(() => mustPass(name, files, ctx));
        await c(() => assert.ok(leftOutNames(expect.left, expect.decision, expect.spelling), `Could not find machine-rule/README.md's Left out naming '${expect.spelling}' under its bullet on ${expect.left} by decision ${expect.decision}, so admitting ${name} is a dropped refusal`));
      } else await c(() => mustRefuse(name, files, ctx, { file: expect.file ?? Object.keys(files)[0], job: expect.job, says: expect.says }));
    }
  });
}
// The spellings the old readers refused, each a change check of dazzer but for where it hides.
const SP = {
  duplicate: check('    runs-on: ubuntu-latest\n'),
  secondDoc: `${check()}---\npermissions: write-all\n`,
  anchor: `name: made up\non: pull_request\n${READ}env: &shared\n  K: made-up\njobs:\n${job('check', CHECKS2)}`,
  alias: `name: made up\non: pull_request\n${READ}env: &shared\n  K: made-up\nrun-name: *shared\njobs:\n${job('check', CHECKS2)}`,
  tag: check('    env:\n      K: !!str made-up\n'),
  explicitKey: check('    env:\n      ? K\n      : made-up\n'),
  directive: `%YAML 1.2\n---\n${check()}`,
  mergeKey: check('    <<:\n      timeout-minutes: 5\n'),
  flowStep: check('', '    steps:\n      - { run: echo made-up }\n'),
  flowEntry: check('    strategy:\n      matrix:\n        include:\n          - { part: one }\n'),
  stepsFlow: check('', '    steps: [{ run: echo made-up }]\n'),
  backslashExpr: check("    env:\n      K: '@{{ vars.LOCKED_RUNNER\\_8 }}'\n"),
  unclosedExpr: check('    env:\n      K: @{{ toJSON(secrets)\n'),
  bomLine: check(`${String.fromCharCode(0xfeff)}    timeout-minutes: 5\n`),
  bomInLine: check(`    timeout-minutes: 5${String.fromCharCode(0xfeff)}\n`),
  bomFirst: `${String.fromCharCode(0xfeff)}${check()}`,
  carriageReturn: check(`    timeout-minutes: 10${String.fromCharCode(13)}    permissions: write-all\n`),
  control: check('', `    steps:\n      - name: made${String.fromCharCode(0x80)}-up\n        run: echo made-up\n`),
  quotedId: `name: made up\non: pull_request\n${READ}jobs:\n  "check":\n    runs-on: ${CHECKS2}\n${STEPS}`,
  deepId: `name: made up\non: pull_request\n${READ}jobs:\n    check:\n      runs-on: ${CHECKS2}\n      steps:\n        - run: echo made-up\n`,
  keyAfterJobs: `${check()}env:\n  K: made-up\n`,
  onBelowJobs: `name: made up\n${READ}jobs:\n${job('check', CHECKS2)}on:\n  pull_request:\n`,
  onDeep: `name: made up\non:\n    pull_request:\n${READ}jobs:\n${job('check', CHECKS2)}`,
  noId: `name: made up\non: pull_request\n${READ}jobs:\n  "":\n    runs-on: ubuntu-latest\n${STEPS}`,
  jobsFlow: `name: made up\non: pull_request\n${READ}jobs: { check: { runs-on: ubuntu-latest } }\n`,
  noJobs: 'name: made up\non: pull_request\n',
  emptyJobs: `name: made up\non: pull_request\n${READ}jobs:\n`,
  notMapping: `name: made up\non: pull_request\n${READ}jobs:\n  check: made-up\n`,
  tabIndent: check('\ttimeout-minutes: 5\n'),
  tabBetween: check('    timeout-minutes:\t10\n'),
  runOn: check('    name: made\n      up\n'),
  emptyItem: check('', '    steps:\n      -\n      - run: echo made-up\n'),
  dqBackslash: check('', '    steps:\n      - run: "echo \\t"\n'),
  doubledQuote: check('', "    steps:\n      - run: 'it''s made up'\n"),
  quotedKey: `name: made up\non: pull_request\n${READ}jobs:\n  check:\n    "runs-on": ${CHECKS2}\n${STEPS}`,
  spacedKey: `name: made up\non: pull_request\n${READ}jobs:\n  check:\n    runs-on : ${CHECKS2}\n${STEPS}`,
  keyNotPlain: check('    made up: x\n'),
  leadingDashes: `---\n${check()}`,
  docEnd: `${check()}...\n`,
  indentedKey: ` name: made up\non: pull_request\n${READ}jobs:\n${job('check', CHECKS2)}`,
  blockDigit: check('    env:\n      A: |2\n        made-up\n'),
  blockBad: check('    env:\n      A: |x\n        made-up\n'),
  flowMapOn: `name: made up\non: { pull_request: {} }\n${READ}jobs:\n${job('check', CHECKS2)}`,
  flowMapPermissions: workflow('pull_request', 'permissions: { contents: read }\n', job('check', CHECKS2)),
  flowListOpen: `name: made up\non: [pull_request,\n  merge_group]\n${READ}jobs:\n${job('check', CHECKS2)}`,
  flowNested: check('    strategy:\n      matrix: { part: [a, b] }\n'),
  quotedTopKey: `"name": made up\non: pull_request\n${READ}jobs:\n${job('check', CHECKS2)}`,
  unclosedQuote: check('    env:\n      K: "made-up\n'),
  unclosedSingle: check("    env:\n      K: 'made-up\n"),
  unclosedFlow: check('    env: { K: made-up\n'),
  neither: check('    just text\n'),
  topNotKey: `name: made up\non: pull_request\n${READ}just text\njobs:\n${job('check', CHECKS2)}`,
  textAfterQuote: check("    env:\n      A: 'x' y\n"),
  textAfterFlow: check('    env:\n      A: [x] y\n'),
  valueAt: check('    env:\n      A: @x\n'),
  valueBacktick: check('    env:\n      A: `x\n'),
  valuePercent: check('    env:\n      A: %x\n'),
  plainColon: check('    env:\n      A: a: b\n'),
  unknownEscape: check('    env:\n      A: "\\q"\n'),
  badEscape: check('    env:\n      A: "\\x4"\n'),
  pipeInFlow: check('    env:\n      A: [a, |b]\n'),
  dupFlow: check('    env: { A: x, A: y }\n'),
  flowAfterQuote: check('    env:\n      A: ["a" b]\n'),
  flowMapAfterQuote: check('    env: { A: "x" y }\n'),
  unexpectedIndent: check('    env:\n      A: x\n        B: y\n'),
  docMidFile: check('---\n'),
  textAfterDoc: `${check()}...\nname: again\n`,
  valueOnDashes: `--- made up\n${check()}`,
  emptyLineBlock: check('', '    steps:\n      - run: |\n            \n          echo made-up\n'),
  onItemsAndKey: `name: made up\non:\n  - pull_request\n  push:\n${READ}jobs:\n${job('check', CHECKS2)}`,
  onValueAndLines: `name: made up\non: push\n  pull_request:\n${READ}jobs:\n${job('check', CHECKS2)}`,
  keyValueItem: check('    timeout-minutes: 10\n    - permissions: write-all\n'),
  lesserIndentPerm: workflow('pull_request', '', job('check', CHECKS2, '    permissions:\n        contents: read\n      statuses: write\n')),
  keyTwiceCase: `Name: made up\n${check()}`,
  keyOtherCase: check('    Permissions: write-all\n'),
  escapedKey: check('    "\\u0070ermissions": write-all\n'),
  jobsOtherCase: `name: made up\non: pull_request\n${READ}Jobs:\n${job('check', CHECKS2)}`,
  repeatedJob: `name: made up\non: pull_request\n${READ}jobs:\n${job('check', CHECKS2)}${job('check', CHECKS2)}`,
};
// The one admitted call of the shared scan, its uses line, its grant, its with: and any key after.
const CODEQL_USES = 'dazzer-io/.github/.github/workflows/codeql.yml@main';
const codeqlCall = ({ uses = CODEQL_USES, grant = '      contents: read\n      actions: read\n      security-events: write\n', languages = `'["actions", "javascript-typescript"]'`, extra = '', id = 'codeql' } = {}) => `  ${id}:\n    uses: ${uses}\n${grant === null ? '' : `    permissions:\n${grant}`}    with:\n      languages: ${languages}\n${extra}`;
// A caller of the shared scan beside a change check, so the repository reads a CHECKS_ setting.
const calling = (call, on = '[pull_request, push]', top = READ, beside = { 'ci.yml': check() }) => ({ 'codeql.yml': `name: CodeQL\non: ${on}\n${top}jobs:\n${call}`, ...beside });
const PIN = 'b'.repeat(40);
const reviewCall = `name: Engineer review\non: [pull_request, pull_request_review]\npermissions:\n  contents: read\njobs:\n  engineer-review:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@${PIN}\n    permissions:\n      statuses: write\n      pull-requests: read\n`;
const behind = async () => 'behind';
const handsOn = (languages) => calling(codeqlCall({ languages }));
// The readings of dazzer holding files, and the workflows its calls reach.
const readingsSay = (files, called, words) => async (name) => {
  const r = await readingsOf(fakeGitHub({ repos: { ...cleanRepos(), dazzer: { files } }, called }));
  assert.ok(r.refused > 0 && mentions(r, words), `Could not find the readings refusing ${name}, naming ${words}:\n${[...r.lines, ...r.unread].join('\n')}`);
};
const keptSays = (entries, says) => async (name) => {
  const problems = J.checkKept({ about: 'made up', entries: JSON.parse(wf(JSON.stringify(entries))) });
  assert.ok(problems.some((p) => says.test(p)), `Could not find kept.json's check refusing ${name} saying ${says}: ${JSON.stringify(problems)}`);
};

test('parity: every refusal of dazzer\'s gate is carried, or named in Left out by its decision (check-runner-setting.mjs at 58797b699)', async () => {
  const ID = 'permissions:\n  contents: read\n  id-token: write\n';
  const signing = (...jobs) => workflow(PUSH, ID, ...jobs);
  const stepEnv = '    steps:\n      - env:\n          K: @{{ vars.CHECKS_RUNNER_2 }}\n        run: echo made-up\n';
  const keep = (...entries) => keptIn(DAZZER, ...entries);
  const runsOn = (value) => workflow('pull_request', READ, job('check', value));
  await parity('check-runner-setting.mjs', [
    // Reading (readWorkflow and its parts, decision 42).
    [741, 'a parse error, a key written twice', SP.duplicate, R(/DUPLICATE_KEY/)],
    [741, 'a parse warning, a second document', SP.secondDoc, R(/MULTIPLE_DOCS/)],
    [763, 'an anchor', SP.anchor, R(/YAML anchor/)],
    [768, 'an alias', SP.alias, R(/YAML alias/)],
    [773, 'a tag', SP.tag, R(/YAML tag/)],
    [782, 'an explicit key', SP.explicitKey, R(/explicit key/)],
    [787, 'a directive', SP.directive, R(/YAML directive/)],
    [812, 'a step written as a flow', SP.flowStep, R(/writes a step as a flow/)],
    [813, 'an entry of another block list written as a flow', SP.flowEntry, R(/entry of the block list under include: as a flow/)],
    [823, 'steps: written as a flow', SP.stepsFlow, R(/writes steps: as a flow/)],
    [854, 'a backslash inside an expression', SP.backslashExpr, R(/holds a \\ inside/)],
    [862, 'an expression never closed', SP.unclosedExpr, R(/opens \$\{\{ with no closing/)],
    [1023, 'a byte order mark opening a line', SP.bomLine, R(/byte order mark \(U\+FEFF\) at the start of a line/)],
    [1023, 'a byte order mark inside a line', SP.bomInLine, R(/byte order mark \(U\+FEFF\) inside a line/)],
    [1031, 'a carriage return mid-line', SP.carriageReturn, R(/carriage return not followed by a line feed/)],
    ['1084, 1696', 'a quoted job id, which the line reader does not find', SP.quotedId, R(/is not a plain job id/)],
    [1089, 'a key at column zero after the jobs, read into the last job', SP.keyAfterJobs, R(/reads it on lines/)],
    [1096, 'an on: below the jobs, read as a job by the line reader', SP.onBelowJobs, R(/holds no job pull_request|reads it on lines/)],
    [1116, 'on: listing its triggers four spaces in', SP.onDeep, R(/lists its triggers 4 spaces in/)],
    [1163, 'a job with no id', SP.noId, R(/with no id/)],
    [1199, 'the jobs key written as a flow', SP.jobsFlow, R(/not jobs: at column zero/)],
    [1690, 'a file with no jobs key', SP.noJobs, R(/holds no job this rule can read/)],
    [1696, 'a job id four spaces in', SP.deepId, R(/is not a plain job id/)],
    [1667, 'a tree with no workflow folder', null, async (name) => {
      const r = await J.judgeFiles({ ...DAZZER, ...lists(), files: [] });
      assert.ok(r.nothing === true && !r.lines.length && leftOutNames('tree-level refusals', 142, 'a tree with no workflow folder'), `Could not find ${name} said as nothing to judge, never as clean, with Left out naming 'a tree with no workflow folder' under dazzer's tree-level refusals by decision 142: ${JSON.stringify(r)}`);
    }],
    [1706, 'a tree holding no change-check job', { 'deploy.yml': signing(job('deploy', LOCKED2)) }, L('tree-level refusals', 142, 'a tree holding no change-check job')],
    [1710, 'a tree holding no production job', { 'ci.yml': check() }, L('tree-level refusals', 142, 'a tree holding no production job')],
    // What kind each job is (kindOf, 1259-1273; unclassifiedWhy, 1461-1464).
    [1461, 'a workflow that signs in on pull_request_target', workflow('pull_request_target', ID, job('deploy', LOCKED2)), R(/runs on pull_request_target, where github\.ref is the default branch/)],
    [1461, 'a workflow that signs in on workflow_run', workflow('workflow_run', ID, job('deploy', LOCKED2)), R(/runs on workflow_run, where github\.ref is the default branch/)],
    [1463, 'a workflow that signs in started by a tag', `name: made up\non:\n  push:\n    tags: [v*]\n${ID}jobs:\n${job('deploy', LOCKED2)}`, R(/that a tag starts/)],
    [1464, 'a workflow that neither signs in nor runs on pull_request', { 'sweep.yml': workflow('schedule', READ, job('sweep', 'ubuntu-latest')), 'ci.yml': check() }, R(/is not started by pull_request/, 'sweep')],
    ['1272, 1464', 'a call of the shared scan from a workflow only push starts', calling(codeqlCall(), 'push'), R(/is not started by pull_request/, 'codeql')],
    ['1272, 1464', 'a call of the shared scan from a workflow only schedule starts', calling(codeqlCall(), 'schedule'), R(/is not started by pull_request/, 'codeql')],
    ['1267, 1630', 'a call of the shared scan on pull_request_target', calling(codeqlCall(), 'pull_request_target'), R(/on pull_request_target/, 'codeql')],
    // Each job (judgeJob, 1545-1646).
    [1571, 'a job of a workflow that signs in reading a CHECKS_ setting', signing(job('deploy', LOCKED2, '    env:\n      K: @{{ vars.CHECKS_RUNNER_2 }}\n')), R(/signs in .*reads CHECKS_RUNNER_2/)],
    [1571, 'a setup job kept on GitHub reading a CHECKS_ setting in its own env', { 'setup-apply.yml': signing(job('apply', 'ubuntu-latest', '    env:\n      K: @{{ vars.CHECKS_RUNNER_2 }}\n')) }, R(/beyond a step's env/, 'apply'), keep({ workflow: 'setup-apply.yml', jobs: ['apply'], effect: 'stay' })],
    [1571, 'a setup job kept on GitHub handing a CHECKS_ setting on in a step\'s env, its workflow signing in', { 'setup-apply.yml': signing(job('apply', 'ubuntu-latest', '', stepEnv)) }, R(/in a workflow that signs in/, 'apply'), keep({ workflow: 'setup-apply.yml', jobs: ['apply'], effect: 'stay' })],
    [1571, 'a kept job handing a CHECKS_ setting on in a step\'s env, its workflow holding a write token', { 'label.yml': workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', 'ubuntu-latest', '', stepEnv)), 'ci.yml': check() }, R(/in a workflow that holds a write token/, 'label'), keep({ workflow: 'label.yml', jobs: ['label'], effect: 'stay' })],
    [1571, 'a write-token job reading a CHECKS_ setting', workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', 'ubuntu-latest', '    env:\n      K: @{{ vars.CHECKS_RUNNER_2 }}\n')), R(/holds a write token \(pull-requests: write\) and reads CHECKS_RUNNER_2/)],
    [1579, 'a change check reading a SCAN_ setting', check('    env:\n      K: @{{ vars.SCAN_RUNNER_2 }}\n'), R(/a scan setting/)],
    [1593, 'a job of a workflow that signs in reading a SCAN_ setting', signing(job('deploy', LOCKED2, '    env:\n      K: @{{ vars.SCAN_RUNNER_2 }}\n')), R(/a scan setting/)],
    [1610, 'a change check reading a LOCKED_ setting', check('    env:\n      K: @{{ vars.LOCKED_RUNNER_2 }}\n'), R(/does not sign in, and it reads LOCKED_RUNNER_2/)],
    [1610, 'a call of the shared scan reading a LOCKED_ setting', calling(codeqlCall({ languages: "'@{{ vars.LOCKED_RUNNER_2 }}'" })), R(/a LOCKED_ setting/, 'codeql')],
    ['1546, 1571', 'a call of the shared scan under a top-level env reading a CHECKS_ setting', calling(codeqlCall(), '[pull_request, push]', `${READ}env:\n  R: @{{ vars.CHECKS_RUNNER_2 }}\n`), R(/holds a write token \(security-events: write\) and reads CHECKS_RUNNER_2/, 'codeql')],
    ['1546, 1610', 'a call of the shared scan under a top-level env reading a LOCKED_ setting', calling(codeqlCall(), '[pull_request, push]', `${READ}env:\n  R: @{{ vars.LOCKED_RUNNER_2 }}\n`), R(/does not sign in, and it reads LOCKED_RUNNER_2/, 'codeql')],
    [1367, 'a call of security-scan.yml, which declares no workflow_call', { 'scan.yml': workflow('pull_request', READ, '  scan:\n    uses: dazzer-io/.github/.github/workflows/security-scan.yml@main\n    permissions:\n      contents: read\n'), 'ci.yml': check() }, R(/which declares no workflow_call/, 'scan')],
    [1630, 'a pull-request job holding a write token on a CHECKS_ setting, kept by a checks entry naming the write', { 'label.yml': workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', CHECKS2)), 'ci.yml': check() }, R(/holds a write token \(pull-requests: write\) in a workflow a pull-request event starts/, 'label'), keep({ workflow: 'label.yml', job: 'label', name: 'label', effect: 'checks', writes: ['pull-requests'] })],
    [1618, 'a job of a workflow that signs in reading the locked setting outside its runs-on', signing(job('deploy', LOCKED2, '    env:\n      K: @{{ vars.LOCKED_RUNNER_8 }}\n')), R(/outside its runs-on/)],
    [1311, 'a call in a workflow that signs in', signing('  deploy:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@main\n    permissions:\n      statuses: write\n'), R(/signs in and calls a reusable workflow/)],
    [1318, 'a job of a workflow that signs in with no runs-on', signing(`  deploy:\n${STEPS}`), R(/names no machine/)],
    [496, 'a locked setting falling back to no GitHub machine', signing(job('deploy', "@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_8 || 'dazzer-locked-8-core' }}")), R(/is not GitHub's machine/)],
    [1341, 'a job of a workflow that signs in naming its machine literally', signing(job('deploy', 'ubuntu-latest')), R(/names its machine literally/)],
    [1343, 'the locked setting read without the main ref', signing(job('deploy', "@{{ vars.LOCKED_RUNNER_2 || 'ubuntu-latest' }}")), R(/without the ref condition held to main/)],
    [1346, 'a runs-on that is no locked setting', signing(job('deploy', "@{{ vars.CI_RUNNER || 'ubuntu-latest' }}")), R(/is not the locked setting held to main/)],
    [1355, 'a locked setting of another width than its fallback', signing(job('deploy', "@{{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_8 || 'ubuntu-latest' }}")), R(/8-core machine, but its fallback 'ubuntu-latest' has 2 cores/)],
    [1630, 'a write-token job on a larger GitHub machine', workflow('pull_request', 'permissions:\n  pull-requests: write\n', job('label', 'ubuntu-8-core')), R(/not one of GitHub's standard machines/)],
    [1637, 'a kept job off GitHub\'s standard labels', { 'nightly.yml': workflow('schedule', READ, job('sweep', 'ubuntu-8-core')), 'ci.yml': check() }, R(/effect stay\) and runs on "ubuntu-8-core"/, 'sweep'), keep({ workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' })],
    // The call of the shared scan (judgeCall, 1409-1449).
    [1427, 'the shared scan called at a tag', calling(codeqlCall({ uses: 'dazzer-io/.github/.github/workflows/codeql.yml@v1' })), R(/at v1, not at main/)],
    [1427, 'the shared scan called at refs/heads/main', calling(codeqlCall({ uses: 'dazzer-io/.github/.github/workflows/codeql.yml@refs/heads/main' })), L('narrower call admissions', 171, 'a call at `refs/heads/main`, which dazzer\'s gate and dazzer-app\'s verdict test refused')],
    [1367, 'a call of engineer-review.yml, which the gate read as a change check calling a workflow', { 'review.yml': reviewCall, 'ci.yml': check() }, L('narrower call admissions', 171, 'a call of `engineer-review.yml` outside a repository strict.json names, which dazzer\'s gate read as a change check calling a workflow'), { ...DAZZER, compare: behind }],
    [1431, 'the call under another job id', calling(codeqlCall({ id: 'scan' })), R(/GitHub shows its check as 'scan \/ CodeQL complete'/)],
    [1431, 'the call given a name:', calling(codeqlCall({ extra: '    name: Scan\n' })), R(/writes name:/)],
    [1435, 'the call writing secrets: inherit', calling(codeqlCall({ extra: '    secrets: inherit\n' })), R(/writes secrets:/)],
    [1435, 'the call writing env:', calling(codeqlCall({ extra: '    env:\n      A: made-up\n' })), R(/writes env:/)],
    [1439, 'the call handing an input beside languages', calling(codeqlCall({ extra: '      tools: latest\n' })), R(/handing it tools under with:, an input it does not declare/)],
    [1443, 'the call granting more than the scan uses', calling(codeqlCall({ grant: '      contents: write\n      actions: read\n      security-events: write\n' })), R(/granting contents: write, more than/)],
    [1443, 'the call with no grant of its own', calling(codeqlCall({ grant: null })), R(/with no permissions: of its own/)],
    // The secrets of a change check (judgeSecrets, 1519-1538).
    [1525, 'a change check reading a secret off the list', check('    env:\n      K: @{{ secrets.HARBOR_KEY }}\n'), R(/which machine-rule\/secrets\.json does not name/)],
    [1530, 'a change check reading the whole secrets context', check('    env:\n      K: @{{ toJSON(secrets) }}\n'), R(/the whole secrets context/)],
    [1535, 'a change check looking a secret up by a computed name', check('    env:\n      K: @{{ secrets[inputs.name] }}\n'), R(/looks a secret up by a name worked out as it runs/)],
    // The machine of a change check (judgeChecks, 1361-1402).
    [1367, 'a change check calling a workflow of its own repository', workflow('pull_request', READ, '  shared:\n    uses: ./.github/workflows/made-up.yml\n'), R(/a workflow of its own repository/)],
    [1372, 'a change check with no runs-on', workflow('pull_request', READ, `  check:\n${STEPS}`), R(/names no machine/)],
    [496, 'a change check falling back to no GitHub machine', runsOn("@{{ vars.CHECKS_RUNNER_2 || 'made-up-machine' }}"), R(/is not GitHub's machine/)],
    [1388, 'a job on a literal label beside a change check', { 'ci.yml': workflow('pull_request', READ, job('check', CHECKS2), job('report', 'ubuntu-latest')) }, R(/names the literal label 'ubuntu-latest'/, 'report')],
    [1389, 'a change check reading a variable that is no setting', runsOn("@{{ vars.CI_RUNNER || 'ubuntu-latest' }}"), R(/vars\.CI_RUNNER, which is no CHECKS_RUNNER/)],
    [1399, 'a change check of another width than its fallback', runsOn("@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-latest' }}"), R(/8-core machine, but its fallback 'ubuntu-latest' has 2 cores/)],
  ]);
});

test('parity: every refusal of dazzer-app\'s verdict test is carried, or named in Left out by its decision (verdict.test.ts at 4b236f2e)', async () => {
  const OFF = "@{{ needs.plan.outputs.machine || 'ubuntu-latest' }}";
  const CHECKOUT = '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:\n          persist-credentials: false\n';
  const ci = (extra = '', steps = `    steps:\n${CHECKOUT}`, top = READ) => `name: CI\non: pull_request\n${top}jobs:\n  plan:\n    runs-on: ubuntu-latest\n    outputs:\n      machine: @{{ steps.p.outputs.machine }}\n    steps:\n      - id: p\n        env:\n          M: @{{ vars.CHECKS_RUNNER_2 }}\n        run: echo made-up\n  quick:\n    needs: plan\n    runs-on: ${OFF}\n${extra}${steps}`;
  const PLAN = { workflow: 'ci.yml', job: 'plan', name: 'plan', effect: 'stay', decision: 34 };
  const app = keptIn(APP, PLAN);
  const appCall = (opts, top = READ) => calling(codeqlCall(opts), '[pull_request, push, schedule]', top, { 'ci.yml': ci() });
  const sweep = (runsOn, extra) => ({ 'nightly.yml': workflow('schedule', READ, job('sweep', runsOn, extra)), 'ci.yml': ci() });
  const keptSweep = keptIn(APP, PLAN, { workflow: 'nightly.yml', jobs: ['sweep'], effect: 'stay' });
  await parity('verdict.test.ts', [
    // The one call of the shared scan (SHARED_SCAN_JOB, 1213; holdsMoreThanTheCode, 1251).
    [1251, 'the call of the shared scan with languages other than the pin\'s', appCall({ languages: `'["actions"]'` }), L('line-for-line pin', 153, 'languages other than the pin\'s'), app],
    [1251, 'the call of the shared scan granting less than the pin', appCall({ grant: '      contents: read\n      security-events: write\n' }), L('line-for-line pin', 153, 'a grant less than the pin\'s'), app],
    [1251, 'the call of the shared scan at refs/heads/main', appCall({ uses: 'dazzer-io/.github/.github/workflows/codeql.yml@refs/heads/main' }), L('narrower call admissions', 171, 'a call at `refs/heads/main`, which dazzer\'s gate and dazzer-app\'s verdict test refused'), app],
    // A job off the literal ubuntu-latest (1253).
    ['1253, 1256', 'a kept job on ubuntu-24.04 handing on the workflow\'s token', sweep('ubuntu-24.04', '    env:\n      T: @{{ github.token }}\n'), R(/hands on the workflow's token/, 'sweep'), keptSweep],
    ['1253, 1255', 'a kept job on a quoted ubuntu-latest naming a secret', sweep('"ubuntu-latest"', '    env:\n      K: @{{ secrets.MADE_UP }}\n'), L('reads alike', 42, 'a quoted `ubuntu-latest`'), keptSweep],
    [1255, 'a job naming a secret in an expression', ci('    env:\n      K: @{{ secrets.MADE_UP }}\n'), R(/names a secret/), app],
    [1255, 'a job naming the word secrets on a plain line', ci('', `    steps:\n${CHECKOUT}      - run: echo secrets\n`), R(/names a secret/), app],
    [1255, 'a job naming a secret in an expression on a comment line', ci('    # @{{ secrets.MADE_UP }}\n'), R(/names a secret/), app],
    [1255, 'a call handing the shared scan a secret under with:', appCall({ languages: '"@{{ secrets.NPM_TOKEN }}"' }), R(/hands it secrets\.NPM_TOKEN under with:/, 'codeql'), app],
    [1255, 'a call handing the shared scan secrets.GITHUB_TOKEN under with:', appCall({ languages: '"@{{ secrets.GITHUB_TOKEN }}"' }), R(/hands it secrets\.GITHUB_TOKEN under with:, the workflow's token/, 'codeql'), app],
    [1255, 'a call handing the shared scan the whole secrets context under with:', appCall({ languages: '"@{{ toJSON(secrets) }}"' }), R(/the whole secrets context under with:/, 'codeql'), app],
    [1255, 'a call handing the shared scan a secret looked up by a computed name under with:', appCall({ languages: '"@{{ secrets[inputs.name] }}"' }), R(/a secret looked up by a name worked out as it runs under with:/, 'codeql'), app],
    [1256, 'a job handing on github.token', ci('    env:\n      T: @{{ github.token }}\n'), R(/hands on the workflow's token/), app],
    [1256, 'a job handing on toJSON(github)', ci('    env:\n      T: @{{ toJSON(github) }}\n'), R(/hands on the workflow's token/), app],
    [1256, "a job handing on github['token']", ci("    env:\n      T: @{{ github['token'] }}\n"), R(/hands on the workflow's token/), app],
    [1256, 'a job handing on the github.* filter', ci('    env:\n      T: @{{ github.* }}\n'), R(/hands on the workflow's token/), app],
    [1256, 'a call handing the shared scan github.token under with:', appCall({ languages: '"@{{ github.token }}"' }), R(/hands on the workflow's token under with:/, 'codeql'), app],
    [1256, 'a call handing the shared scan toJSON(github) under with:', appCall({ languages: '"@{{ toJSON(github) }}"' }), R(/hands on the workflow's token under with:/, 'codeql'), app],
    [1256, 'a call handing the shared scan env.GITHUB_TOKEN under with:', appCall({ languages: '"@{{ env.GITHUB_TOKEN }}"' }), R(/a GITHUB_TOKEN spelling/, 'codeql'), app],
    [1258, 'a job asking for a permission of its own', ci('    permissions:\n      contents: read\n'), R(/asks for a permission of its own/), app],
    ['1248, 1258, 1673', 'the call of the shared scan from another file', { 'scan.yml': `name: Scan\non: [pull_request, push]\n${READ}jobs:\n${codeqlCall()}`, 'ci.yml': ci() }, R(/is a call in a repository strict\.json names, and asks for a permission of its own/, 'codeql', 'scan.yml'), app],
    ['1251, 1661', 'a call of security-scan.yml at main', { 'codeql.yml': `name: CodeQL\non: [pull_request, push]\n${READ}jobs:\n  codeql:\n    uses: dazzer-io/.github/.github/workflows/security-scan.yml@main\n`, 'ci.yml': ci() }, R(/which declares no workflow_call/, 'codeql', 'codeql.yml'), app],
    ['1248, 1258', 'a call of engineer-review.yml asking for its own grant, outside codeql.yml\'s job codeql', { 'review.yml': reviewCall, 'ci.yml': ci() }, R(/asks for a permission of its own/, 'engineer-review', 'review.yml'), { ...app, compare: behind }],
    [1267, 'a job checking out with its credential kept', ci('', '    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n'), R(/keeps a git credential/), app],
    [1278, 'a workflow holding such a job with no top-level permissions', ci('', undefined, ''), R(/no top-level permissions written/), app],
    [1278, 'a workflow holding such a job under read-all', ci('', undefined, 'permissions: read-all\n'), R(/grants its token more than reading the code/), app],
    [1278, 'a workflow holding the call of the shared scan under read-all', appCall({}, 'permissions: read-all\n'), R(/grants its token more than reading the code/), app],
    [1294, 'a top-level env naming a secret', ci('', undefined, `${READ}env:\n  K: @{{ secrets.MADE_UP }}\n`), R(/top-level env names a secret/), app],
    [1297, 'a top-level env handing on the token', ci('', undefined, `${READ}env:\n  T: @{{ github.token }}\n`), R(/top-level env hands on the token/), app],
    // The closed plain subset its reader read (readSubset, 1042-1167; every refused line counted, 1298).
    [701, 'an anchor', SP.anchor, R(/YAML anchor/), APP],
    [703, 'an alias', SP.alias, R(/YAML alias/), APP],
    [706, 'a tag', SP.tag, R(/YAML tag/), APP],
    [826, 'a quoted value not closed on its line', SP.unclosedQuote, R(/Missing closing "quote/), APP],
    [854, 'a flow collection not closed on its line', SP.unclosedFlow, R(/Flow map in block collection must be sufficiently indented and end with a \}/), APP],
    [863, 'a flow collection holding a collection', SP.flowNested, L('reads alike', 42, 'a flow collection inside another'), APP],
    [1016, 'a line neither a plain key, a - item nor a comment', SP.neither, R(/MULTILINE_IMPLICIT_KEY, 'Implicit keys need to be on a single line'/), APP],
    [1123, 'a line indented under a value', SP.runOn, L('reads alike', 42, 'a plain value continued on a line indented under it'), APP],
    [1095, 'a line broken other than by a line feed', SP.carriageReturn, R(/carriage return/), APP],
    [1095, 'a control character', SP.control, R(/control character U\+0080/), APP],
    [1095, 'a byte order mark opening the file', SP.bomFirst, L('reads alike', 42, 'a byte order mark opening the file'), APP],
    [1148, 'a tab in the indent', SP.tabIndent, R(/TAB_AS_INDENT/), APP],
    [1148, 'a tab between a key and its value', SP.tabBetween, L('reads alike', 42, 'a tab between a key and its value'), APP],
    [1110, 'a line at the top that is no key', SP.topNotKey, R(/MULTILINE_IMPLICIT_KEY, 'Implicit keys need to be on a single line'/), APP],
    [1110, 'a quoted top-level key', SP.quotedTopKey, L('reads alike', 42, 'a quoted top-level key'), APP],
    [1108, 'jobs spelled in another case', SP.jobsOtherCase, R(/in another letter case|holds no job/), APP],
    [1117, 'a job id that is not plain', SP.quotedId, R(/is not a plain job id/), APP],
    [1120, 'a line under jobs before any job id', SP.deepId, R(/is not a plain job id/), APP],
    [1114, 'a workflow started away from column 0', SP.indentedKey, R(/UNEXPECTED_TOKEN, 'Unexpected scalar at node end'/), APP],
    [1136, 'a top-level key written twice in another case', SP.keyTwiceCase, R(/in another letter case/), APP],
    [1140, 'a job id written twice', SP.repeatedJob, R(/DUPLICATE_KEY/), APP],
    [1144, 'a job key written twice', SP.duplicate, R(/DUPLICATE_KEY/), APP],
    [832, 'a doubled quote', SP.doubledQuote, L('reads alike', 42, 'a doubled quote'), APP],
    [842, 'a double-quoted value holding a backslash', SP.dqBackslash, L('reads alike', 42, 'a double-quoted value holding a backslash'), APP],
    [903, 'a block header with an indentation digit', SP.blockDigit, L('reads alike', 42, 'a block header with an indentation digit'), APP],
    [913, 'text after a quoted value', SP.textAfterQuote, R(/UNEXPECTED_TOKEN, 'Unexpected scalar at node end'/), APP],
    [922, 'text after a flow collection', SP.textAfterFlow, R(/UNEXPECTED_TOKEN, 'Unexpected scalar at node end'/), APP],
    [936, 'a value starting with an indicator', SP.valueAt, R(/Plain value cannot start with reserved character @/), APP],
    [940, 'a plain value holding ": "', SP.plainColon, R(/Nested mappings are not allowed in compact mappings/), APP],
    [953, 'an explicit key', SP.explicitKey, R(/explicit key/), APP],
    [959, 'an explicit key given its value', SP.explicitKey, R(/explicit key/), APP],
    [965, 'a merge key', SP.mergeKey, R(/merge key/), APP],
    [970, 'a document marker opening the file', SP.leadingDashes, L('reads alike', 42, 'a leading `---`'), APP],
    [970, 'a document end marker closing the file', SP.docEnd, L('reads alike', 42, 'a closing `...`'), APP],
    [972, 'a directive', SP.directive, R(/YAML directive/), APP],
    [976, 'a quoted key', SP.quotedKey, L('reads alike', 42, 'a quoted key'), APP],
    [985, 'a space before a key\'s colon', SP.spacedKey, L('reads alike', 42, 'a space before a key\'s colon'), APP],
    [991, 'a key that is not a plain name', SP.keyNotPlain, L('reads alike', 42, 'a key that is not a plain name'), APP],
    [1008, 'a - item with nothing after it', SP.emptyItem, L('reads alike', 42, 'an empty `-` item'), APP],
  ]);
});

test('parity: every refusal of this repository\'s runs-on test is carried, or named in Left out by its decision (at dca1d18)', async () => {
  const scanJob = (runsOn = SCAN, extra = '', steps = STEPS) => `  semgrep:\n    runs-on: ${runsOn}\n${extra}${steps}`;
  const scanFile = (top, ...jobs) => `name: made up\non:\n  pull_request:\n  merge_group:\n${top}jobs:\n${jobs.join('')}`;
  const FINAL = '  complete:\n    name: CodeQL complete\n    needs: [semgrep]\n    if: @{{ always() }}\n    runs-on: ubuntu-latest\n    permissions: {}\n    steps:\n      - run: exit 0\n';
  const codeql = (...jobs) => `name: made up\non:\n  workflow_call:\n${READ}jobs:\n${jobs.join('')}`;
  const outside = (runsOn, extra = '') => workflow('pull_request', READ, job('decide-tests', runsOn, extra));
  const shared = (callText) => workflow('pull_request', READ, callText);
  await parity(OLD_TEST, [
    // Its judge (judge, 503-571), in dazzer-io/.github.
    [532, 'a call of a workflow in another repository', shared('  shared:\n    uses: dazzer-io/dazzer/.github/workflows/made-up.yml@main\n    permissions:\n      contents: read\n'), R(/a workflow outside dazzer-io\/\.github's shared workflows/), SHARED],
    [532, 'a call written as a block', shared('  shared:\n    uses: >-\n      dazzer-io/dazzer/.github/workflows/made-up.yml@main\n    permissions:\n      contents: read\n'), R(/a workflow outside dazzer-io\/\.github's shared workflows/), SHARED],
    [532, 'a call of engineer-review.yml at main from another workflow here', shared('  review:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@main\n    permissions:\n      statuses: write\n      pull-requests: read\n'), L('narrower call admissions', 171, 'a call of `engineer-review.yml` from another workflow of dazzer-io/.github, which the runs-on test refused'), SHARED],
    [534, 'a call of the security scan from outside the scans', shared('  shared:\n    uses: dazzer-io/.github/.github/workflows/security-scan.yml@main\n    permissions:\n      contents: read\n'), R(/outside the two scans/), SHARED],
    [541, 'a write-token job off GitHub\'s standard labels', workflow('workflow_call', 'permissions:\n  statuses: write\n', job('decide-tests', CHECKS2)), R(/holds a write token/), SHARED],
    [541, 'a read-only job outside the scans off GitHub\'s standard labels', outside(CHECKS2), R(/a public repository/), SHARED],
    [545, 'a job outside the scans reading CHECKS_RUNNER_2 in its env', outside('ubuntu-latest', '    env:\n      M: @{{ vars.CHECKS_RUNNER_2 }}\n'), R(/reads CHECKS_RUNNER_2/), SHARED],
    ['543, 545', 'a call outside the scans whose workflow\'s top reads CHECKS_RUNNER_2', `name: made up\non: pull_request\n${READ}env:\n  M: @{{ vars.CHECKS_RUNNER_2 }}\njobs:\n  review:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@main\n    permissions:\n      statuses: write\n      pull-requests: read\n`, R(/holds a write token \(statuses: write\) and reads CHECKS_RUNNER_2/, 'review'), SHARED],
    [541, 'a job outside the scans on CHECKS_RUNNER_2, kept by a checks entry', outside(CHECKS2), R(/a public repository/, 'decide-tests'), keptIn(SHARED, { workflow: 'made-up.yml', job: 'decide-tests', name: 'decide-tests', effect: 'checks' })],
    [545, 'a job outside the scans reading vars.CHECKS_DIR, a name in a setting family\'s spelling', outside('ubuntu-latest', '    env:\n      D: @{{ vars.CHECKS_DIR }}\n'), R(/reads vars\.CHECKS_DIR/), SHARED],
    [545, 'a write-token job whose workflow\'s top reads vars.LOCKED_UNTIL', `name: made up\non: workflow_call\npermissions:\n  statuses: write\nenv:\n  U: @{{ vars.LOCKED_UNTIL }}\njobs:\n${job('decide-tests', 'ubuntu-latest')}`, R(/reads vars\.LOCKED_UNTIL/), SHARED],
    [553, 'a read-only scan job reading a secret', { 'security-scan.yml': scanFile(READ, scanJob(SCAN, '    env:\n      TOKEN: @{{ secrets.SCAN_TOKEN }}\n')) }, R(/a scan job holds no secret/), SHARED],
    [553, 'a scan whose top declares a secret', { 'codeql.yml': `name: made up\non:\n  workflow_call:\n    secrets:\n      SCAN_TOKEN:\n        required: false\n${READ}jobs:\n${scanJob()}` }, R(/the workflow's top reads secrets:/), SHARED],
    [561, 'a second final check', { 'codeql.yml': codeql(scanJob(), FINAL, FINAL.replace('complete:', 'complete-again:')) }, R(/a second job of codeql\.yml granted no token/), SHARED],
    [563, 'a final check reading a setting', { 'codeql.yml': codeql(scanJob(), `${FINAL}        env:\n          RUNNER: @{{ vars.CHECKS_RUNNER_2 }}\n`) }, R(/reads CHECKS_RUNNER_2/), SHARED],
    [563, 'a final check reading vars.SCAN_DIR, a name in a setting family\'s spelling', { 'codeql.yml': codeql(scanJob(), `${FINAL}        env:\n          D: @{{ vars.SCAN_DIR }}\n`) }, R(/reads vars\.SCAN_DIR/), SHARED],
    [567, 'a read-only scan job not on the scan setting exactly', { 'security-scan.yml': scanFile(READ, scanJob("@{{ vars.SCAN_RUNNER_2 || 'ubuntu-24.04' }}")) }, R(/not \$\{\{ vars\.SCAN_RUNNER_2 \|\| 'ubuntu-latest' \}\}/), SHARED],
    // Its reader, a closed plain subset (decision 99).
    [430, 'a carriage return mid-line', SP.carriageReturn, R(/carriage return/)],
    [430, 'a control character', SP.control, R(/control character U\+0080/)],
    [430, 'a byte order mark opening the file', SP.bomFirst, L('reads alike', 42, 'a byte order mark opening the file')],
    [261, 'a tab in the indent', SP.tabIndent, R(/TAB_AS_INDENT/)],
    [261, 'a tab between a key and its value', SP.tabBetween, L('reads alike', 42, 'a tab between a key and its value')],
    [265, 'a line indented under a value', SP.runOn, L('reads alike', 42, 'a plain value continued on a line indented under it')],
    [274, 'an empty - item', SP.emptyItem, L('reads alike', 42, 'an empty `-` item')],
    [238, 'a key line starting with an anchor', SP.anchor, R(/YAML anchor/)],
    [239, 'a key line starting with an alias', SP.alias, R(/YAML alias/)],
    [240, 'a key line starting with a tag', SP.tag, R(/YAML tag/)],
    [241, 'an explicit key', SP.explicitKey, R(/explicit key/)],
    [242, 'a merge key', SP.mergeKey, R(/merge key/)],
    [243, 'a document marker after line 1', SP.docMidFile, R(/MULTIPLE_DOCS/)],
    [244, 'a directive', SP.directive, R(/YAML directive/)],
    [245, 'a quoted key holding a backslash', SP.escapedKey, R(/quoted key with a backslash/)],
    [246, 'a line neither a key, an item nor a comment', SP.topNotKey, R(/MULTILINE_IMPLICIT_KEY, 'Implicit keys need to be on a single line'/)],
    [183, 'a block header with an indentation digit', SP.blockDigit, L('reads alike', 42, 'a block header with an indentation digit')],
    [188, 'a single-quoted value not closed on its line', SP.unclosedSingle, R(/Missing closing 'quote/)],
    [192, 'a double-quoted value holding a backslash', SP.dqBackslash, L('reads alike', 42, 'a double-quoted value holding a backslash')],
    [197, 'text after a quoted value', SP.textAfterQuote, R(/UNEXPECTED_TOKEN, 'Unexpected scalar at node end'/)],
    [201, 'a flow mapping', SP.flowMapPermissions, L('reads alike', 42, 'a flow mapping, `on:` and `permissions:` included')],
    [216, 'a flow list holding an item that is not plain', SP.pipeInFlow, R(/Plain value cannot start with block scalar indicator \|/)],
    [223, 'a flow list not closed on its line', SP.flowListOpen, L('reads alike', 42, 'a flow list over lines, `on:` included')],
    [225, 'text after a flow list', SP.textAfterFlow, R(/UNEXPECTED_TOKEN, 'Unexpected scalar at node end'/)],
    [228, 'a value holding an anchor, an alias or a tag', SP.tag, R(/YAML tag/)],
    [229, 'a value starting with an indicator', SP.valueBacktick, R(/Plain value cannot start with reserved character `/)],
    [232, 'a plain value holding ": "', SP.plainColon, R(/Nested mappings are not allowed in compact mappings/)],
    [300, 'a more-indented empty line opening a block', SP.emptyLineBlock, R(/more-indented leading empty lines must use an explicit indentation indicator/)],
    [342, 'a key written twice in another case', SP.keyTwiceCase, R(/in another letter case/)],
    [344, 'a key it reads written in another case', SP.keyOtherCase, R(/in another letter case/)],
    [352, 'a stray item where a key goes', SP.keyValueItem, R(/A block sequence may not be used as an implicit map key/)],
    [362, 'on: written as a flow mapping', SP.flowMapOn, L('reads alike', 42, 'a flow mapping, `on:` and `permissions:` included')],
    [366, 'on: written as a flow list over two lines', SP.flowListOpen, L('reads alike', 42, 'a flow list over lines, `on:` included')],
    [370, 'on: holding a value and lines below it', SP.onValueAndLines, R(/Nested mappings are not allowed in compact mappings/)],
    [381, 'a line under on: that is no trigger', SP.onItemsAndKey, R(/All mapping items must start at the same column/)],
    [452, 'a workflow with no on: key, in a private repository that reads no setting', `name: made up\n${READ}jobs:\n${job('report', 'ubuntu-latest')}`, R(/names no trigger/), QUIET],
    [452, 'a workflow with an empty on:, in a public repository', `name: made up\non:\n${READ}jobs:\n${job('report', 'ubuntu-latest')}`, R(/names no trigger/), PUBLIC],
    [452, 'a workflow with no on: key, in dazzer-io/.github', `name: made up\n${READ}jobs:\n${job('report', 'ubuntu-latest')}`, R(/names no trigger/), SHARED],
    [452, 'a workflow with no on: key, in dazzer', `name: made up\n${READ}jobs:\n${job('check', CHECKS2)}`, R(/names no trigger/)],
    [455, 'jobs: written on one line', SP.jobsFlow, R(/not jobs: at column zero|holds no job/)],
    [455, 'no jobs: key', SP.noJobs, R(/holds no job this rule can read/)],
    ['406, 472', 'a job\'s permissions: with a line below it at another indent', SP.lesserIndentPerm, R(/All mapping items must start at the same column/)],
    ['406, 460', 'a permissions: written as a list at the workflow\'s top, counted as a write', workflow('pull_request', 'permissions:\n  - contents\n', job('decide-tests', 'ubuntu-latest')), L('reads alike', 42, '`permissions:` written as a list, which they counted as a write'), SHARED],
    [465, 'a job id that is not plain', SP.quotedId, R(/is not a plain job id/)],
    [478, 'a jobs: key holding no job', SP.emptyJobs, R(/holds no job this rule can read/)],
  ]);
});

test('parity: every refusal of runners\' reader and its gate S6 is carried, or named in Left out by its decision (check-repos-read-setting.mjs, switch-on.mjs at 789b335)', async () => {
  const runsOn = (value, extra = '') => workflow('pull_request', READ, job('check', value, extra));
  const callee = (on, inputs = '      machine:\n        type: string\n') => `on:\n${on}${on.includes('workflow_call') ? `    inputs:\n${inputs}` : ''}jobs:\n  reused:\n    runs-on: @{{ inputs.machine }}\n${STEPS}`;
  const callerOf = (withText = '') => workflow('pull_request', READ, `  hand-off:\n    uses: ./.github/workflows/reused.yml\n${withText}`);
  const plan = (outputs, planOn = CHECKS2) => workflow('pull_request', READ, `  plan:\n    runs-on: ${planOn}\n    outputs:\n      pick: ${outputs}\n${STEPS}`, `  through:\n    needs: plan\n    runs-on: @{{ needs.plan.outputs.pick || 'ubuntu-latest' }}\n${STEPS}`);
  const matrixOf = (matrix, value = "@{{ matrix.machine || 'ubuntu-latest' }}") => runsOn(value, matrix === null ? '' : `    strategy:\n      matrix:\n${matrix}`);
  // A machine handed through eight reusable workflows, each passing its input to the next, in a
  // repository that reads no setting, where a reusable workflow's machine is read route by route.
  const hands = { 'top.yml': workflow('pull_request', READ, '  go:\n    uses: ./.github/workflows/level-1.yml\n    with:\n      machine: made-up\n') };
  for (let k = 1; k <= 7; k += 1) hands[`level-${k}.yml`] = `on:\n  workflow_call:\n    inputs:\n      machine:\n        type: string\njobs:\n  go:\n    uses: ./.github/workflows/level-${k + 1}.yml\n    with:\n      machine: @{{ inputs.machine }}\n`;
  hands['level-8.yml'] = `on:\n  workflow_call:\n    inputs:\n      machine:\n        type: string\njobs:\n  reused:\n    runs-on: @{{ inputs.machine }}\n${STEPS}`;
  const calls = (uses) => ({ 'ci.yml': CLEAN, 'calls.yml': `on: pull_request\njobs:\n  hand-off:\n    uses: ${uses}\n` });
  const reads = 'on: workflow_call\njobs:\n  inner:\n    runs-on: @{{ vars.SCAN_RUNNER_2 || \'ubuntu-latest\' }}\n' + STEPS;
  const reviewAt = (body) => ({ files: { 'ci.yml': CLEAN, 'review.yml': `on: pull_request\njobs:\n  review:\n    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@${PIN}\n` }, called: { '.github': { [PIN]: { 'engineer-review.yml': body } } } });
  const nested = (uses) => reviewAt(`on: workflow_call\njobs:\n  review:\n    uses: ${uses}\n`);
  const f3 = nested('dazzer-io/.github/.github/workflows/codeql.yml@made-up-branch');
  const f3Case = nested('Dazzer-IO/.github/.github/workflows/codeql.yml@main');
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const entry = (e) => [{ repository: 'dazzer-io/dazzer', workflow: 'x.yml', jobs: ['a'], effect: 'stay', reason: 'made up', decision: 1, source: 'made up', ...e }];
  await parity('check-repos-read-setting.mjs', [
    // Each job (Judge.job, 910-930).
    [911, 'a job that is not a mapping', SP.notMapping, R(/is not a mapping/)],
    [913, 'a job reading a SCAN_ setting', check('    env:\n      K: @{{ vars.SCAN_RUNNER_2 }}\n'), R(/a scan setting/)],
    [913, 'a workflow\'s top env reading a SCAN_ setting', `name: made up\non: pull_request\n${READ}env:\n  M: "@{{ vars.SCAN_RUNNER_8 }}"\njobs:\n${job('a', CHECKS2)}`, R(/the workflow's top .*reads SCAN_RUNNER_8/)],
    [917, 'a local call of a file the repository does not hold', workflow('pull_request', READ, '  c:\n    uses: ./.github/workflows/gone.yml\n'), R(/a workflow of its own repository/)],
    [923, 'a call of the shared scan in another letter case', calling(codeqlCall({ uses: 'Dazzer-IO/.github/.github/workflows/codeql.yml@main' })), R(/spelled in another letter case/)],
    [924, 'a call of the shared scan at a branch', calling(codeqlCall({ uses: 'dazzer-io/.github/.github/workflows/codeql.yml@made-up-branch' })), R(/at made-up-branch, not at main/)],
    [926, 'a call of a workflow outside its five repositories', calling('  c:\n    uses: made-up-org/made-up/.github/workflows/made-up.yml@main\n'), R(/a workflow outside dazzer-io\/\.github's shared workflows/)],
    [926, 'a call of engineer-review.yml, outside its five repositories', { 'review.yml': reviewCall, 'ci.yml': check() }, L('narrower call admissions', 171, 'a call from a repository outside runners\' five, which runners\' reader refused'), { ...DAZZER, compare: behind }],
    [928, 'a job with no runs-on', workflow('pull_request', READ, `  check:\n${STEPS}`), R(/names no machine/)],
    // A job's machine (runsOn, expression, routesOf, leaf, matrix, input; 932-1080).
    [935, 'a literal label in dazzer, whose workflows read a setting', { 'ci.yml': workflow('pull_request', READ, job('check', CHECKS2), job('report', 'ubuntu-latest')) }, R(/names the literal label 'ubuntu-latest'/, 'report')],
    [935, 'a literal label in a private repository whose workflows read no setting', workflow('pull_request', READ, job('report', 'ubuntu-latest')), L('allowed list', 16, 'a literal-label job of a private repository that reads no setting, named by no entry'), QUIET],
    [936, 'text outside the expression', runsOn('prefix-@{{ vars.CHECKS_RUNNER_2 }}'), R(/names text outside its expression/)],
    [939, 'a list of labels', runsOn('[self-hosted, linux]'), R(/lists labels/)],
    [940, 'a runner group', runsOn('\n      group: made-up-group'), R(/runner group or labels/)],
    [941, 'a number', runsOn('5'), R(/names no machine this rule can read/)],
    [945, 'a machine handed through more hands than it reads', hands, R(/too many hands/, undefined, 'level-8.yml'), QUIET],
    [951, 'an expression it cannot parse', runsOn("@{{ vars.CHECKS_RUNNER_8 || 'ubuntu-latest }}"), R(/cannot read|opens \$\{\{/)],
    [965, 'a literal on a route of its own', runsOn("@{{ 'ubuntu-latest' || vars.CHECKS_RUNNER_8 }}"), R(/literally on a route of its own/)],
    [969, 'an expression that reaches no setting', runsOn("@{{ fromJSON() || 'ubuntu-latest' }}"), R(/reads no CHECKS_RUNNER_<N>/)],
    [981, 'a route that gives a number', runsOn("@{{ vars.CHECKS_RUNNER_2 || 2 }}"), R(/reads CHECKS_RUNNER_2 with no fallback after \|\|/)],
    [983, 'a route that gives a comparison', runsOn("@{{ vars.CHECKS_RUNNER_2 == 'x' || 'ubuntu-latest' }}"), R(/comparison/)],
    [987, 'a route through another function', runsOn("@{{ toJSON(vars.CHECKS_RUNNER_2) || 'ubuntu-latest' }}"), R(/its expression gives toJSON\(\), which is no machine setting/)],
    [1003, 'vars read whole', runsOn("@{{ toJSON(vars) || 'ubuntu-latest' }}"), R(/vars read whole or by a computed name/)],
    [1007, 'a setting the organisation does not declare', runsOn("@{{ vars.CHECKS_RUNNER_4 || 'ubuntu-latest' }}"), R(/which the organisation does not declare/)],
    [1011, 'the outputs of a job the workflow lacks', runsOn("@{{ needs.gone.outputs.pick || 'ubuntu-latest' }}"), R(/no job gone|has no job/)],
    [1014, 'the outputs of a job reading a scan setting', plan('"@{{ vars.SCAN_RUNNER_2 }}"'), R(/a scan setting/, 'through')],
    [1016, 'the outputs of a job reading no setting', plan('made-up', 'ubuntu-latest'), R(/job plan reads no CHECKS_RUNNER/, 'through')],
    [1020, 'another context', runsOn("@{{ github.event.inputs.machine || vars.CHECKS_RUNNER_8 || 'ubuntu-latest' }}"), R(/github\.event\.inputs\.machine, which is no/)],
    [1025, 'a matrix value of a job with no matrix', matrixOf(null), R(/has no matrix/)],
    [1034, 'a matrix it cannot read', matrixOf('        - made-up\n'), R(/the matrix is not one it can read/)],
    [1035, 'a matrix key no row sets', matrixOf('        part: [a, b]\n'), R(/which no matrix row sets/)],
    [1038, 'a matrix row naming a label', matrixOf('        machine: [ubuntu-latest]\n'), R(/takes "ubuntu-latest" literally/)],
    [1042, 'a matrix row holding text outside its expression', matrixOf('        machine: ["x-@{{ vars.CHECKS_RUNNER_2 }}"]\n'), R(/outside its expression/)],
    [1053, 'an input of a workflow that is not reusable', runsOn("@{{ inputs.machine || 'ubuntu-latest' }}"), R(/not a reusable workflow|typed by hand/)],
    [1055, 'an input of a workflow also started by hand', { 'reused.yml': callee('  workflow_call:\n  workflow_dispatch:\n') }, R(/typed by hand or empty/)],
    [1057, 'an input of a workflow no workflow calls', { 'reused.yml': callee('  workflow_call:\n') }, R(/no workflow read calls/)],
    [1061, 'an input whose default reads a scan setting', { 'reused.yml': callee('  workflow_call:\n', '      machine:\n        type: string\n        default: "@{{ vars.SCAN_RUNNER_2 }}"\n') }, R(/a scan setting/)],
    [1068, 'a caller passing nothing to an input with no default', { 'reused.yml': callee('  workflow_call:\n'), 'calls.yml': callerOf() }, R(/passes no machine, and the input has no default/)],
    [1071, 'a caller passing nothing to an input whose default is no setting', { 'reused.yml': callee('  workflow_call:\n', '      machine:\n        type: string\n        default: ubuntu-latest\n'), 'calls.yml': callerOf() }, R(/passes no machine, and its default/)],
    [1076, 'a caller passing a literal label', { 'reused.yml': callee('  workflow_call:\n'), 'calls.yml': callerOf('    with:\n      machine: ubuntu-latest\n') }, R(/passes machine:/)],
    // The calls, read at their own ref (readCalls, 1206-1282).
    [1228, 'a call naming no workflow', null, readingsSay({ 'ci.yml': CLEAN, 'calls.yml': 'on: pull_request\njobs:\n  hand-off:\n    uses: [made-up]\n' }, {}, 'which names no workflow')],
    [1234, 'a call into its own repository at a ref', null, readingsSay(calls('./.github/workflows/ci.yml@main'), {}, 'which GitHub takes with no @<ref>')],
    [1238, 'a call into its own repository of a file it does not hold', null, readingsSay(calls('./.github/workflows/gone.yml'), {}, 'which dazzer-io/dazzer does not hold on main')],
    [1241, 'a ./ call inside a called workflow', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/outer.yml@main'), { 'made-up-tools': { main: { 'outer.yml': 'on: workflow_call\njobs:\n  outer:\n    uses: ./.github/workflows/inner.yml\n', 'inner.yml': CLEAN } } }, 'a ./ call inside a workflow called from dazzer-io/dazzer')],
    [1246, 'a call that is no <owner>/<repo>/<path>@<ref>', null, readingsSay(calls('made-up'), {}, 'which is no <owner>/<repo>/<path>@<ref>')],
    [1247, 'a call to another owner', null, readingsSay(calls('made-up-org/made-up-tools/.github/workflows/helper.yml@main'), {}, 'of an owner other than dazzer-io')],
    [1252, 'a call to a file outside .github/workflows', null, readingsSay(calls('dazzer-io/made-up-tools/made-up/place.yml@main'), {}, 'a file outside .github/workflows')],
    [1253, 'a chain of calls eleven levels deep', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/level-2.yml@v1'), { 'made-up-tools': { v1: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`level-${k + 2}.yml`, `on: workflow_call\njobs:\n  deeper:\n    uses: $/.github/workflows/level-${k + 3}.yml\n`])) } }, 'GitHub connects at most 10 levels of workflows')],
    [1256, 'a call of a file a repository read does not hold on its branch', null, readingsSay(calls('dazzer-io/scheduler/.github/workflows/gone.yml@main'), {}, 'which dazzer-io/scheduler does not hold on main')],
    [1270, 'a call GitHub does not answer at its ref', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/gone.yml@main'), {}, 'which is unread')],
    // The scan reads of every file a call reaches (scanReadsOf, 738-759; switch-on.mjs S6, 583-640).
    [747, 'a called workflow whose top env reads a scan setting', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': `on: workflow_call\nenv:\n  M: "@{{ vars.SCAN_RUNNER_2 }}"\njobs:\n  inner:\n    runs-on: ubuntu-latest\n${STEPS}` } } }, "helper.yml (the workflow's top) at main reads SCAN_RUNNER_2")],
    [749, 'a called workflow whose input default reads a scan setting', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': `on:\n  workflow_call:\n    inputs:\n      machine:\n        type: string\n        default: "@{{ vars.SCAN_RUNNER_2 }}"\njobs:\n  inner:\n    runs-on: ubuntu-latest\n${STEPS}` } } }, "helper.yml (the workflow's top) at main reads SCAN_RUNNER_2")],
    [752, 'a called workflow\'s job reading a scan setting', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': reads } } }, 'helper.yml inner at main reads SCAN_RUNNER_2')],
    [754, 'a workflow a call reaches calling the shared scan at a branch', null, readingsSay(f3.files, f3.called, `dazzer-io/.github .github/workflows/engineer-review.yml review at ${PIN} calls the shared scan .github/workflows/codeql.yml at made-up-branch, not at main`)],
    [754, 'a workflow a call reaches calling the shared scan in another letter case', null, readingsSay(f3Case.files, f3Case.called, `dazzer-io/.github .github/workflows/engineer-review.yml review at ${PIN} calls the shared scan .github/workflows/codeql.yml as Dazzer-IO/.github/.github/workflows/codeql.yml@main`)],
    [754, 'a workflow two calls deep calling the shared scan at a commit', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/outer.yml@v1'), { 'made-up-tools': { v1: { 'outer.yml': 'on: workflow_call\njobs:\n  outer:\n    uses: $/.github/workflows/inner.yml\n', 'inner.yml': `on: workflow_call\njobs:\n  inner:\n    uses: dazzer-io/.github/.github/workflows/codeql.yml@${SHA}\n` } } }, `dazzer-io/made-up-tools .github/workflows/inner.yml inner at v1 calls the shared scan .github/workflows/codeql.yml at ${SHA}, not at main`)],
    ['730', 'a called workflow with no jobs mapping', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': 'on: workflow_call\nname: made up\n' } } }, 'helper.yml at main could not be read: it has no jobs mapping')],
    ['728; switch-on.mjs:638', 'a called workflow holding a spelling no reader may read plainly', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': `on: workflow_call\nenv: &shared\n  K: made-up\njobs:\n  inner:\n    runs-on: ubuntu-latest\n${STEPS}` } } }, "helper.yml at main, in dazzer-io/dazzer's run, holds a spelling this rule refuses")],
    ['switch-on.mjs:631', 'a called workflow whose job hands a scan setting on through its outputs', null, readingsSay(calls('dazzer-io/made-up-tools/.github/workflows/helper.yml@main'), { 'made-up-tools': { main: { 'helper.yml': `on: workflow_call\njobs:\n  plan:\n    runs-on: ubuntu-latest\n    outputs:\n      pick: "@{{ vars.SCAN_RUNNER_2 }}"\n${STEPS}` } } }, 'helper.yml plan at main reads SCAN_RUNNER_2')],
    // Its allowed list (checkAllowed, 568-604), now kept.json.
    [582, 'an unknown key in an entry', null, keptSays(entry({ allowed: true }), /holds the key allowed/)],
    [573, 'an entry with no reason', null, keptSays(entry({ reason: '' }), /gives no reason/)],
    [574, 'an entry with no whole-number decision', null, keptSays(entry({ decision: 'nine' }), /names no whole-number decision/)],
    [575, 'an entry with no source', null, keptSays(entry({ source: '' }), /names no source/)],
    [583, 'an entry outside its five repositories', null, async (name) => {
      const problems = J.checkKept({ about: 'made up', entries: entry({ repository: 'dazzer-io/made-up-tools' }) });
      assert.ok(!problems.length && leftOutNames('allowed list', 121, 'an entry outside its five repositories'), `Could not find ${name} admitted by kept.json's check with Left out naming 'an entry outside its five repositories' under runners' allowed list by decision 121: ${JSON.stringify(problems)}`);
    }],
    [588, 'an entry named twice', null, keptSays([...entry({}), ...entry({})], /twice/)],
    ['593, 595, 596, 598', 'a built-in label', null, async (name) => assert.ok(leftOutNames('built-in labels', 24, 'a built-in label'), `Could not find machine-rule/README.md's Left out naming 'a built-in label' under runners' list of built-in labels by decision 24, so dropping ${name} is a dropped refusal`)],
  ]);
});

// ================================================================ kept.json's names (decision 182)
// A stay entry carries the fixed name GitHub shows, which the readings match, so it holds no
// expression; a checks entry carries its job's name: as written, a matrix expression included, as
// dazzer-app's split-trial.yml browser does, since the readings leave checks entries out
// (decisions 142, 154, 182).
test('kept.json\'s names: a stay entry\'s name holds no expression, a checks entry carries its job\'s name: as written, a matrix expression included (decision 182)', async () => {
  need();
  const entry = (effect, name) => ({ repository: 'dazzer-io/dazzer', workflow: 'trial.yml', job: 'browser', name, effect, reason: 'made up', decision: 1, source: 'made up' });
  const MATRIX_NAME = 'browser ${{ matrix.machine }}';
  const trial = workflow('schedule', READ, job('browser', CHECKS2, '    name: browser @{{ matrix.machine }}\n    strategy:\n      matrix:\n        machine: [made-up-a, made-up-b]\n'));
  const keptAs = (e) => ({ ...DAZZER, ...lists(), kept: { about: 'made up', entries: [e] } });
  await everyCase(async (c) => {
    await c(() => {
      const problems = J.checkKept({ about: 'made up', entries: [entry('stay', MATRIX_NAME)] });
      assert.ok(problems.some((p) => /holds an expression/.test(p)), `Could not find kept.json's check refusing a stay entry whose name holds an expression: ${JSON.stringify(problems)}`);
    });
    await c(() => {
      const problems = J.checkKept({ about: 'made up', entries: [entry('checks', MATRIX_NAME)] });
      assert.ok(!problems.length, `Could not find kept.json's check admitting a checks entry carrying its job's name: as written, a matrix expression included: ${JSON.stringify(problems)}`);
    });
    await c(() => mustPass('a job whose name: holds a matrix expression, kept by a checks entry carrying that name: as written', { 'trial.yml': trial, 'ci.yml': check() }, keptAs(entry('checks', MATRIX_NAME)), { file: 'trial.yml', job: 'browser' }));
    await c(() => mustRefuse('the same job kept by a checks entry carrying another name', { 'trial.yml': trial, 'ci.yml': check() }, keptAs(entry('checks', 'browser')), { file: 'trial.yml', job: 'browser', says: /checks entry carrying the name "browser", where its name: as written is/ }));
  });
});

// ================================================================ tool downloads retry (decision 181)
// Every curl in a workflow here fetches a pinned tool, and each one retries: --retry <N> retries a
// timeout and an HTTP 408, 429, 500, 502, 503 or 504, and --retry-all-errors every other failure
// too, a dropped connection (curl's exit 56) among them, removing a partial file written by -o before
// each retry (curl(1), --retry and --retry-all-errors, the latter added in 7.71.0). The required
// check failed four times on 8 Nov on such downloads: 504, 504, curl 56 and 503.
test('every tool a workflow here downloads is fetched with retries, so a passing hiccup at GitHub fails no required check (decision 181)', () => {
  need();
  const dir = join(ROOT, '.github/workflows');
  const misses = [];
  const found = [];
  for (const f of J.readFolder(ROOT) ?? []) {
    const wfRead = J.readWorkflow(f.text);
    for (const [id, jb] of Object.entries(wfRead.js?.jobs ?? {})) {
      for (const s of Array.isArray(jb?.steps) ? jb.steps : []) {
        if (typeof s?.run !== 'string') continue;
        const commands = s.run.replace(/\\\n\s*/g, ' ').split('\n');
        for (const cmd of commands.filter((l) => /(^|[\s;&|(])curl\s/.test(l))) {
          found.push(`${f.path} ${id}`);
          const n = /\s--retry\s+(\d+)\b/.exec(cmd);
          if (!n || Number(n[1]) < 1 || !/\s--retry-all-errors\b/.test(cmd)) misses.push(`Could not find ${f.path} jobs.${id} ('${s.name ?? 'a step'}') fetching with --retry <N ≥ 1> and --retry-all-errors: ${cmd.trim()}`);
        }
      }
    }
  }
  if (found.length < 3) misses.push(`Could not find the three tool downloads, actionlint in machine-rule.yml and osv-scanner and gitleaks in security-scan.yml, among the workflows in ${dir}: found ${found.length} (${found.join('; ')}), so this case would prove nothing`);
  assert.ok(!misses.length, misses.join('\n'));
});

// ================================================================ every class refusal, in every shape a job takes (decision 184)
// A class rule is one about what a job reads, holds, signs in for or where it runs. Every case
// above in which a class rule refuses a job is run again, built from its own text, in the two other
// shapes a job takes: the job made a call of the shared scan, the rest of the file as it was; and
// the job kept by a kept.json checks entry naming its writes. Each shape is refused in the case's
// own words (its says). A refusal that is no class rule is named in NOT_A_CLASS; a shape in which a
// decided admission applies is skipped only by a line of DECIDED, citing its Left out line and its
// decision. So a class refusal added later is run in both shapes too, with no line written here.
const NOT_A_CLASS = [
  [/is not among the jobs kept\.json's whole-file entry/, "a whole-file entry's job list, which each shape rewrites"],
  [/is kept by kept\.json's (?:stay|checks) entry carrying the name|holds an expression other than one trailing parenthetical/, "a kept.json entry's name, which each shape rewrites"],
  [/\(effect stay\)/, "the stay effect's own rules, which neither shape's job is kept by"],
  [/is a canary job|is kept by a canary entry/, "the canary effect's own rules, which neither shape's job is kept by"],
  [/unless its kept\.json entry has the effect checks and names that write/, "a checks entry's own list of writes, which the checks shape names in full"],
];
const DECIDED = [
  { shape: 'call', left: "A call's machine and steps", decision: 129, spelling: "a refusal of the job's runs-on, or of its having none", skips: (h, j) => (j.runsOnLine !== null && h.line === j.runsOnLine) || /names no machine/.test(h.why) },
  { shape: 'call', left: "A call's machine and steps", decision: 171, spelling: "a refusal of a step, a checkout keeping its credential or CodeQL's own scan steps", skips: (h) => /checks out without persist-credentials|runs CodeQL's scan/.test(h.why) },
  { shape: 'call', left: "A change check's secrets list, for a call", decision: 93, spelling: "a change check's secret that secrets.json does not name", skips: (h) => /^is a change check and (?:reads secrets\.|reads the whole secrets context|looks a secret up)/.test(h.why) },
  { shape: 'checks', left: 'for a job a checks entry keeps', decision: 47, spelling: 'a refusal that kept.json names no entry for the job', skips: (h) => /kept\.json names no entry for it/.test(h.why) },
];
const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// Every string a job holds, a bare if: as the expression GitHub reads it as.
const stringsOf = (x, key = null) => {
  if (typeof x === 'string') return [key === 'if' && !x.includes('${{') ? `\${{ ${x} }}` : x];
  if (Array.isArray(x)) return x.flatMap((v) => stringsOf(v));
  if (isMap(x)) return Object.entries(x).flatMap(([k, v]) => stringsOf(v, k));
  return [];
};
const grantLines = (p) => {
  if (p === undefined) return [];
  if (isMap(p)) return Object.keys(p).length ? ['    permissions:', ...Object.entries(p).map(([k, v]) => `      ${k}:${v === null ? '' : ` ${v}`}`)] : ['    permissions: {}'];
  return [`    permissions:${p === null ? '' : ` ${p}`}`];
};
// The job j of text made a call of the shared scan under its own id: its own grant (an environment,
// which a call cannot name, kept as the sign-in it grants), every string it holds handed in under
// with:, and its comment lines kept, so what it reads, holds and signs in for is still in its text.
function asCall(text, j) {
  const lines = text.split('\n');
  const start = j.line - 1;
  if (lines[start]?.replace(/\s+(#.*)?$/, '') !== `  ${j.id}:`) return null;
  let end = start + 1;
  while (end < lines.length && !(lines[end].trim() !== '' && /^ {0,2}\S/.test(lines[end]))) end += 1;
  const job = j.js;
  let grant = job.permissions;
  if ('environment' in job) grant = isMap(grant) ? { ...grant, 'id-token': 'write' } : grant === undefined ? { 'id-token': 'write' } : grant;
  const handed = stringsOf(job).flatMap((v) => v.split('\n')).map((l) => l.trim()).filter(Boolean);
  const comments = lines.slice(start + 1, end).filter((l) => /^\s*#/.test(l)).map((l) => `    ${l.trim()}`);
  const call = [`  ${j.id}:`, `    uses: ${CODEQL_USES}`, ...grantLines(grant), '    with:', ...(handed.length ? ['      languages: |', ...handed.map((l) => `        ${l}`)] : ['      languages: made-up']), ...comments];
  return [...lines.slice(0, start), ...call, ...lines.slice(end)].join('\n');
}
// The case's kept.json without any entry keeping the job, and, for the checks shape, one checks
// entry keeping it, carrying its name: as written and naming every write it holds.
function keptFor(ctx, file, read, j, checks) {
  const repository = ctx.repository ?? DAZZER.repository;
  const entries = [];
  for (const e of (ctx.kept ?? lists().kept).entries) {
    if (e.repository !== repository || e.workflow !== file) entries.push(e);
    else if (Array.isArray(e.jobs)) { const jobs = e.jobs.filter((x) => x !== j.id); if (jobs.length) entries.push({ ...e, jobs }); }
    else if (e.job !== j.id) entries.push(e);
  }
  if (checks) {
    const writes = [...new Set([...J.writesOf(read.js.permissions), ...J.writesOf(j.js.permissions)].filter((w) => /^[a-z-]+: /.test(w) && !w.startsWith('permissions:')).map((w) => w.split(':')[0]))];
    entries.push({ repository, workflow: file, job: j.id, name: j.js.name === undefined || j.js.name === null ? j.id : String(j.js.name), effect: 'checks', ...(writes.length ? { writes } : {}), reason: 'made up', decision: 1, source: 'made up' });
  }
  return { ...ctx, kept: { about: 'made up', entries } };
}
test('every class refusal of a job holds in the two other shapes a job takes, a call and a job a checks entry keeps, each built from the case\'s own text (decision 184)', async (t) => {
  need();
  assert.ok(RECORDED.length >= 300, `Could not find the refusal cases above recorded to run again (${RECORDED.length} recorded): this test runs after them, in the same file`);
  const misses = [];
  const ran = { call: 0, checks: 0 };
  const skipped = { call: 0, checks: 0 };
  const used = new Set();
  const seen = new Set();
  let cases = 0;
  for (const d of DECIDED) if (!leftOutNames(d.left, d.decision, d.spelling)) misses.push(`Could not find machine-rule/README.md's Left out naming '${d.spelling}' under its bullet on ${d.left} by decision ${d.decision}, so skipping the ${d.shape} shape there is a dropped refusal`);
  for (const rc of RECORDED) {
    const text = rc.files[rc.file];
    if (typeof text !== 'string') continue;
    const key = JSON.stringify([rc.files, rc.file, rc.job, String(rc.says), rc.ctx.repository, rc.ctx.visibility, rc.ctx.shared, rc.ctx.moving, rc.ctx.kept ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    const read = J.readWorkflow(wf(text));
    const byJob = new Map();
    for (const l of rc.lines) {
      const m = /^\.github\/workflows\/([^:]+):(\d+) jobs\.([\w-]+): (.*)$/s.exec(l);
      if (!m || m[1] !== rc.file || (rc.job !== undefined && m[3] !== rc.job) || (rc.says && !rc.says.test(l))) continue;
      const j = read.jobs.find((x) => x.id === m[3]);
      if (!j || !isMap(j.js) || 'uses' in j.js) continue;
      const hit = { line: Number(m[2]), why: m[4] };
      if (NOT_A_CLASS.some(([re]) => re.test(hit.why))) continue;
      if (!byJob.has(j.id)) byJob.set(j.id, { j, hits: [] });
      byJob.get(j.id).hits.push(hit);
    }
    for (const { j, hits } of byJob.values()) {
      cases += 1;
      if (!rc.says) { misses.push(`Could not find the words ${rc.name} is refused with: a class case names them (says), so its other shapes can be held to them`); continue; }
      for (const shape of ['call', 'checks']) {
        const live = hits.filter((h) => {
          const d = DECIDED.find((x) => x.shape === shape && x.skips(h, j));
          if (d) used.add(d);
          return !d;
        });
        if (!live.length) { skipped[shape] += 1; continue; }
        const files = shape === 'call' ? { ...rc.files, [rc.file]: asCall(wf(text), j) } : rc.files;
        if (files[rc.file] === null) { misses.push(`Could not find the job ${j.id} of ${rc.name} at its line, two spaces in, to make it a call`); continue; }
        ran[shape] += 1;
        const r = await judgeOf(files, keptFor(rc.ctx, rc.file, read, j, shape === 'checks'));
        const ok = r.lines.some((l) => l.startsWith(`.github/workflows/${rc.file}:`) && l.includes(` jobs.${j.id}: `) && rc.says.test(l));
        if (!ok) misses.push(`Could not find ${rc.name}, its job ${j.id} made ${shape === 'call' ? 'a call of the shared scan' : 'a job a kept.json checks entry keeps'}, refused saying ${rc.says} as the job was on line ${live.map((h) => h.line).join(', ')}: the rule said\n${r.lines.filter((l) => l.startsWith(`.github/workflows/${rc.file}:`)).join('\n') || '(nothing refused)'}`);
      }
    }
  }
  for (const d of DECIDED) if (!used.has(d)) misses.push(`Could not find any case DECIDED's line on '${d.spelling}' skips in the ${d.shape} shape: a line that skips nothing is stale`);
  t.diagnostic(`${cases} job refusals of ${seen.size} cases, run as a call ${ran.call} times (${skipped.call} skipped by DECIDED) and kept by a checks entry ${ran.checks} times (${skipped.checks} skipped)`);
  assert.ok(cases >= 100, `Could not find the class cases to run again: ${cases} found among ${RECORDED.length} recorded`);
  assert.ok(!misses.length, `${misses.join('\n')}\n(${misses.length} of ${ran.call + ran.checks} shapes, of ${cases} job refusals)`);
});

// Every line under a Left out bullet is cited by a case, so a line no case needs is found.
test('Left out names no spelling or refusal that no case cites (decisions 181, 184)', () => {
  need();
  const all = LEFT_OUT.flatMap((b) => b.spellings.map((sp) => `${b.head}\n${sp}`));
  assert.ok(all.length >= 20, `Could not find machine-rule/README.md's Left out lines, one spelling or refusal a line: ${all.length} found`);
  const loose = all.filter((x) => !CITED.has(x));
  assert.ok(!loose.length, `Could not find a case citing each line of machine-rule/README.md's Left out:\n${loose.map((x) => x.split('\n')[1]).join('\n')}`);
});
