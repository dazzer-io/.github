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
// A refusal of <file> (and <job>) whose words match says, on the line holding at when given.
async function mustRefuse(name, files, ctx, { file, job, says, at }) {
  const r = await judgeOf(files, ctx);
  const text = wf(files[file] ?? '');
  const line = at ? text.split('\n').findIndex((l) => l.includes(wf(at))) + 1 : 0;
  const hit = r.lines.find((l) => l.startsWith(`.github/workflows/${file}:${line || ''}`) && (job === undefined || l.includes(` jobs.${job}: `)) && (!says || says.test(l)));
  assert.ok(hit, `Could not find a refusal of ${name}${job ? ` (jobs.${job})` : ''}${line ? ` on line ${line}` : ''}${says ? ` saying ${says}` : ''}: the rule said\n${said(r)}`);
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
    await c(() => mustRefuse('a reusable workflow no workflow calls', { 'orphan.yml': callee('  workflow_call:\n    inputs:\n      machine:\n        type: string\n') }, DAZZER, { file: 'orphan.yml', job: 'reused' }));
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
    await c(() => mustRefuse('the same, read as moving by --moving', { 'sweep.yml': nightly }, { ...QUIET, moving: true }, { file: 'sweep.yml', job: 'sweep' }));
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
    ...['canary-drill.yml:drill', 'contract-watch.yml:watch', 'lane-times.yml:refresh', 'lane-times.yml:open', 'promote-production.yml:start', 'promote-production.yml:promote', 'release-check.yml:find', 'release-check.yml:check', 'release-check.yml:act', 'release-check.yml:handover', 'scorecard.yml:scorecard', 'sweep.yml:sweep'].map((s) => ['dazzer-app', ...s.split(':'), 'stay', 54]),
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
// it, by renderCaller, at a commit GitHub's compare reads as on main, as callerFor confirms.
test('engineer-review/caller.yml, filled as decide.mjs caller fills it, passes the rule in every class of repository that copies it (decision 178)', async () => {
  need();
  const { renderCaller, CALLER_USES } = await import('../engineer-review/decide.mjs');
  const template = readFileSync(join(ROOT, 'engineer-review/caller.yml'), 'utf8');
  const SHA = 'c'.repeat(40);
  const caller = renderCaller(template, { owner: 'dazzer-io', repo: '.github', commit: SHA });
  assert.ok(template.includes(CALLER_USES) && caller.includes(`    uses: dazzer-io/.github/.github/workflows/engineer-review.yml@${SHA}\n`), `Could not find caller.yml's one uses: line filled with dazzer-io/.github at ${SHA}:\n${caller}`);
  const classes = [
    ['dazzer, a private repository whose workflows read a CHECKS_ setting', DAZZER, { 'ci.yml': check() }],
    ['dazzer-app, the repository strict.json names', APP, { 'ci.yml': check() }],
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

// ================================================================ dazzer-app's stricter class (strict.json; verdict.test.ts holdsMoreThanTheCode)
test('in a repository strict.json names, a job off a literal GitHub label holds no more than the code (dazzer-app verdict test)', async () => {
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
