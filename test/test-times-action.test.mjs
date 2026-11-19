// The test-time recorder as a composite action, test-times/action.yml: a caller writes
// `uses: dazzer-io/.github/test-times@<full commit>` in place of its clone-and-setup step. This
// test pins what the action is and runs what it runs:
//
//   - it is a composite action of one step, a bash script written exactly as SCRIPT below, whose
//     env holds exactly ENV below; it starts no other action, so it pins none, and clones nothing;
//   - its script, run here under bash from a copy of this folder placed where no clone puts it,
//     writes TEST_TIMES_DIR as that copy into $GITHUB_ENV, so the scripts the caller runs next
//     (finish.mjs, read.mjs, plan.mjs) are read from the action's own path, and setup.mjs's run
//     facts carry the label the caller gives;
//   - the clone path keeps working: setup.mjs run from a plain clone's folder names that folder,
//     and the README still shows the clone beside the action.
//
// Every child starts from an environment this file builds from a short list, so nothing of a
// GitHub runner reaches it. Every temporary folder is removed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOLDER = path.join(ROOT, 'test-times');
const ACTION_TEXT = fs.readFileSync(path.join(FOLDER, 'action.yml'), 'utf8');
const README = fs.readFileSync(path.join(FOLDER, 'README.md'), 'utf8');
const FAULT = 'the test timings action does not read its scripts from its own path';

const SCRIPT = 'node "${GITHUB_ACTION_PATH:-$TEST_TIMES_ACTION}/setup.mjs" >> "$GITHUB_ENV"\n';
const ENV = {
  TEST_TIMES_ACTION: '${{ github.action_path }}',
  TEST_TIMES_LABEL: '${{ inputs.label || env.TEST_TIMES_LABEL }}',
};

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function tmp() {
  // The real path: Node names a script by it, and macOS's temp folder sits behind a link.
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-times-action-')));
  made.push(d);
  return d;
}

function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const at = line.indexOf('=');
    out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

// The action's one step, as GitHub would run it: its env expressions resolved from `given`
// (the values GitHub would put there), refusing any expression this test does not know.
function runStep(step, given, extraEnv = {}) {
  const resolved = {};
  for (const [k, v] of Object.entries(step.env)) {
    assert.ok(Object.hasOwn(given, v), `an env expression this test does not know: ${k}: ${v}`);
    resolved[k] = given[v];
  }
  return spawnSync('bash', ['-e', '-c', step.run], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...extraEnv, ...resolved },
  });
}

test('the action is one composite step, written as pinned here, starting no other action', () => {
  const action = parse(ACTION_TEXT);
  assert.deepEqual(Object.keys(action).sort(), ['description', 'inputs', 'name', 'runs']);
  assert.deepEqual(Object.keys(action.inputs), ['label']);
  assert.equal(action.inputs.label.required, false);
  assert.equal(action.inputs.label.default, '');
  assert.equal(action.runs.using, 'composite');
  assert.equal(action.runs.steps.length, 1);
  const [step] = action.runs.steps;
  assert.deepEqual(Object.keys(step).sort(), ['env', 'name', 'run', 'shell']);
  assert.equal(step.shell, 'bash');
  assert.deepEqual(step.env, ENV, FAULT);
  assert.equal(step.run, SCRIPT, FAULT);
  for (const s of action.runs.steps) {
    if (s.uses) assert.match(s.uses, /^[^@]+@[0-9a-f]{40}$/, `an outside action not pinned by full commit: ${s.uses}`);
  }
  assert.doesNotMatch(ACTION_TEXT, /git clone|RUNNER_TEMP\/test-times-src/, FAULT);
  assert.doesNotMatch(ACTION_TEXT, /secrets/, 'the action reads no secret');
});

test('run from where GitHub unpacks it, the action names its own folder for the scripts that follow', () => {
  const action = parse(ACTION_TEXT);
  const [step] = action.runs.steps;
  const home = tmp();
  // A copy of this folder at a path no clone uses, as GitHub's _actions folder would hold it.
  const unpacked = path.join(home, '_actions', 'owner', 'repo', 'commit', 'test-times');
  fs.cpSync(FOLDER, unpacked, { recursive: true });
  const runnerTemp = path.join(home, 'runner-temp');
  fs.mkdirSync(runnerTemp);
  const githubEnv = path.join(home, 'github-env');
  fs.writeFileSync(githubEnv, '');
  // The clone a caller's old step would leave, holding nothing: a step that reads it fails.
  fs.mkdirSync(path.join(runnerTemp, 'test-times-src', 'test-times'), { recursive: true });

  for (const [label, given, extra, want] of [
    ['the env value GitHub sets', { '${{ github.action_path }}': '/nowhere', '${{ inputs.label || env.TEST_TIMES_LABEL }}': 'big-runner' },
      { GITHUB_ACTION_PATH: unpacked }, 'big-runner'],
    ['the expression alone', { '${{ github.action_path }}': unpacked, '${{ inputs.label || env.TEST_TIMES_LABEL }}': '' },
      { ImageOS: 'ubuntu24' }, 'ubuntu24'],
  ]) {
    fs.writeFileSync(githubEnv, '');
    const r = runStep(step, given, { RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv, GITHUB_JOB: 'unit', GITHUB_RUN_ATTEMPT: '1', ...extra });
    assert.equal(r.status, 0, `${FAULT} (${label}): ${r.stderr}`);
    const written = readEnvFile(githubEnv);
    assert.equal(written.TEST_TIMES_DIR, unpacked, `${FAULT} (${label})`);
    assert.equal(written.TEST_TIMES_FILE, path.join(runnerTemp, 'test-times.jsonl'));
    assert.match(written.TEST_TIMES_ID, /^unit-1-runner-\d+$/);
    for (const script of ['finish.mjs', 'read.mjs', 'plan.mjs', 'record.mjs']) {
      assert.ok(fs.existsSync(path.join(written.TEST_TIMES_DIR, script)), `${FAULT}: ${script} is not beside it`);
    }
    const facts = JSON.parse(fs.readFileSync(path.join(runnerTemp, 'test-times.jsonl.run.json'), 'utf8'));
    assert.equal(facts.runner.label, want, `the runner label (${label})`);
  }
});

test('the clone path keeps working beside the action', () => {
  const home = tmp();
  const clone = path.join(home, 'test-times-src', 'test-times');
  fs.cpSync(FOLDER, clone, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(clone, 'setup.mjs')], {
    encoding: 'utf8', env: { PATH: process.env.PATH, RUNNER_TEMP: home },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^TEST_TIMES_DIR=${clone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(README, /git clone --quiet --filter=blob:none https:\/\/github\.com\/dazzer-io\/\.github/, 'the README keeps the clone');
  assert.match(README, /uses: dazzer-io\/\.github\/test-times@<a full commit of dazzer-io\/\.github>/, 'the README shows the action');
});
