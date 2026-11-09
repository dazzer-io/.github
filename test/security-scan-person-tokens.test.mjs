// The person-token check (security-scan/person-tokens.mjs): a workflow the change touches must
// not sign in to GitHub with a person's token kept as a repository secret, unless the base
// branch's .github/person-token-exceptions.json still allows that use. No network: the workflow
// texts are below, and the git-level tests build their own repository in a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import {
  findPersonTokens, check, isCheckedFile, namedAsGitHubToken, EXCEPTIONS_FILE,
} from '../security-scan/person-tokens.mjs';
import { decide } from '../security-scan/decide.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, '..', 'security-scan');
const TODAY = '2026-11-05';

// Said only when a check goes red on a person's token that got through.
const MISSED = 'a workflow signing in to GitHub with a person\'s token got through';
// Said only when a check goes red on a token the rule allows, or one for another service.
const WRONGLY = 'a token the rule allows was refused';
// Said only when a check goes red on a refusal that does not say what, why and what instead.
const UNCLEAR = 'the refusal does not say in plain words what was found, why, and what to use instead';
// Said only when a check goes red on an exception counting when it must not, or the reverse.
const EXCEPTION = 'an exception counted wrongly';
// Said only when a check goes red on a file the change did not touch being read.
const UNTOUCHED = 'a workflow the change does not touch was flagged';

const lines = (...l) => `${l.join('\n')}\n`;
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
const secretsOf = (text) => findPersonTokens(text).map((u) => u.secret);

const CHECKOUT_WITH_PAT = lines(
  'name: Release',
  'on:',
  '  push:',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  release:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: Check out the shared library',
  '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  '        with:',
  '          repository: harbor-lane/okafor-ledger',
  '          token: ${{ secrets.OKAFOR_BOT_TOKEN }}',
  '          persist-credentials: false',
);

const CHECKOUT_PLAIN = CHECKOUT_WITH_PAT.replace('          token: ${{ secrets.OKAFOR_BOT_TOKEN }}\n', '');

// ---------- what counts as a person's token ----------

test('a checkout token from a repository secret is a person-token use, found at its line', () => {
  const uses = findPersonTokens(CHECKOUT_WITH_PAT);
  assert.equal(uses.length, 1, `${MISSED}: ${JSON.stringify(uses)}`);
  assert.equal(uses[0].secret, 'OKAFOR_BOT_TOKEN');
  assert.equal(uses[0].line, 14);
  assert.match(uses[0].how, /token/);
  assert.match(uses[0].how, /actions\/checkout/);
});

test('the workflow\'s own token and a GitHub App token are allowed', () => {
  const text = lines(
    'env:',
    '  GH_TOKEN: ${{ github.token }}',
    'jobs:',
    '  sync:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '    steps:',
    '      - name: Mint the App token',
    '        id: app',
    '        uses: actions/create-github-app-token@d72941d797fd3113feb6b93fd0dec494b13a2547 # v1.12.0',
    '        with:',
    '          app-id: ${{ secrets.HARBOR_LANE_APP_ID }}',
    '          private-key: ${{ secrets.GH_APP_PRIVATE_KEY }}',
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    '        with:',
    '          token: ${{ steps.app.outputs.token }}',
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    '        with:',
    '          token: ${{ secrets.github_token }}',
    '      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea',
    '        with:',
    '          github-token: ${{ github.token }}',
    '      - name: Open the pull request',
    '        env:',
    '          GH_TOKEN: ${{ steps.app.outputs.token }}',
    '        run: gh pr create --fill',
  );
  assert.deepEqual(findPersonTokens(text), [], WRONGLY);
});

test('tokens for other services are never flagged', () => {
  const text = lines(
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}',
    '      TURBO_TEAM: ${{ secrets.TURBO_TEAM }}',
    '    steps:',
    '      - name: Deploy to Vercel',
    '        env:',
    '          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}',
    '        run: npx vercel deploy --prebuilt --token "${{ secrets.VERCEL_TOKEN }}"',
    '      - name: Upload the source maps',
    '        env:',
    '          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}',
    '        run: npx sentry-cli sourcemaps upload dist',
    '      - name: Evaluate',
    '        env:',
    '          LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}',
    '          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
    '        run: node eval.mjs',
    '      - uses: codecov/codecov-action@0565863a31f2c772f9f0395002a31e3f06189574',
    '        with:',
    '          token: ${{ secrets.CODECOV_TOKEN }}',
  );
  assert.deepEqual(findPersonTokens(text), [], WRONGLY);
});

test('GH_TOKEN or GITHUB_TOKEN set from a repository secret is a use, at the workflow, job or step', () => {
  const text = lines(
    'env:',
    '  GH_TOKEN: ${{ secrets.HARBOR_READER }}',
    'jobs:',
    '  read:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      GITHUB_TOKEN: ${{ secrets.OKAFOR_READER }}',
    '    steps:',
    '      - name: Read the other repository',
    '        env:',
    '          GH_TOKEN: "${{ secrets.LEDGER_READ_TOKEN }}"',
    '        run: gh api repos/harbor-lane/okafor-ledger',
  );
  const uses = findPersonTokens(text);
  assert.deepEqual(uses.map((u) => [u.line, u.secret]),
    [[2, 'HARBOR_READER'], [7, 'OKAFOR_READER'], [11, 'LEDGER_READ_TOKEN']], MISSED);
  for (const u of uses) assert.match(u.how, /GH_TOKEN|GITHUB_TOKEN/);
});

test('a secret named like a GitHub token is a use wherever it is passed', () => {
  const text = lines(
    'jobs:',
    '  read:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Read the billing and the runs',
    '        env:',
    '          LEDGER_READER: ${{ secrets.GH_LEDGER_TOKEN }}',
    '          RELEASE: ${{ secrets.HARBOR_GITHUB_TOKEN }}',
    '          PUSHER: ${{ secrets[\'RELEASE_PAT\'] }}',
    '        run: node read.mjs',
  );
  assert.deepEqual(secretsOf(text), ['GH_LEDGER_TOKEN', 'HARBOR_GITHUB_TOKEN', 'RELEASE_PAT'], MISSED);
  for (const name of ['GH_TOKEN_FOR_SYNC', 'GITHUB_PAT', 'okafor_pat', 'PAT_RELEASE', 'GH_SYNC_TOKEN']) {
    assert.ok(namedAsGitHubToken(name), `${MISSED}: ${name}`);
  }
  // A GitHub App's own credentials are how an App token is minted; they are not a person's token.
  for (const name of ['GITHUB_TOKEN', 'GH_APP_ID', 'GH_APP_PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY',
    'GH_WEBHOOK_SECRET', 'SPATIAL_KEY', 'PATH_SECRET', 'VERCEL_TOKEN']) {
    assert.ok(!namedAsGitHubToken(name), `${WRONGLY}: ${name}`);
  }
});

test('an input that is a GitHub token by its name or its action is a use', () => {
  const text = lines(
    'jobs:',
    '  label:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea',
    '        with:',
    '          github-token: ${{ secrets.OKAFOR_BOT }}',
    '          script: core.info("hi")',
    '      - with:',
    '          token: ${{ secrets.HARBOR_BOT }}',
    '        uses: peter-evans/create-pull-request@271a8d0340265f705b14b6d32b9829c1cb33d45e',
    '      - uses: harbor-lane/push-action@0123456789abcdef0123456789abcdef01234567',
    '        with:',
    '          github_token: ${{ secrets.LEDGER_BOT }}',
  );
  assert.deepEqual(findPersonTokens(text).map((u) => [u.line, u.secret]),
    [[7, 'OKAFOR_BOT'], [10, 'HARBOR_BOT'], [14, 'LEDGER_BOT']], MISSED);
});

test('a secret on a line that signs in to GitHub is a use', () => {
  const text = lines(
    'jobs:',
    '  push:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: |',
    '          curl -fsS -H "Authorization: Bearer ${{ secrets.OKAFOR_BOT }}" https://api.github.com/user',
    '          git push "https://x-access-token:${{ secrets.HARBOR_BOT }}@github.com/harbor-lane/okafor-ledger.git"',
    '          GH_TOKEN=${{ secrets.LEDGER_BOT }} gh pr list',
    '          curl -fsS -H "Authorization: ${{ secrets.STATUS_PAGE_KEY }}" https://status.example.com',
  );
  assert.deepEqual(findPersonTokens(text).map((u) => [u.line, u.secret]),
    [[6, 'OKAFOR_BOT'], [7, 'HARBOR_BOT'], [8, 'LEDGER_BOT']], MISSED);
});

test('a YAML comment is not a use, but a shell comment in a run script is, since GitHub fills it in', () => {
  const text = lines(
    'jobs:',
    '  push:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      # token: ${{ secrets.HARBOR_LANE_PAT }}',
    '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    '        with:',
    '          token: ${{ github.token }} # was ${{ secrets.HARBOR_LANE_PAT }}',
    '      - run: |',
    '          # the old way: ${{ secrets.OKAFOR_PAT }}',
    '          echo done',
  );
  assert.deepEqual(findPersonTokens(text).map((u) => [u.line, u.secret]), [[10, 'OKAFOR_PAT']]);
});

test('signing in to ghcr.io with a person\'s token is a use; another registry is not', () => {
  const text = lines(
    'jobs:',
    '  image:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: docker/login-action@74a5d142397b4f367a81961eba4e8cd7edddf772',
    '        with:',
    '          registry: ghcr.io',
    '          username: harbor-lane-bot',
    '          password: ${{ secrets.HARBOR_PACKAGES }}',
    '      - uses: docker/login-action@74a5d142397b4f367a81961eba4e8cd7edddf772',
    '        with:',
    '          registry: europe-docker.pkg.dev',
    '          username: _json_key',
    '          password: ${{ secrets.OKAFOR_REGISTRY_KEY }}',
  );
  assert.deepEqual(findPersonTokens(text).map((u) => [u.line, u.secret]), [[9, 'HARBOR_PACKAGES']]);
});

test('only workflow files and composite actions are looked at', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yaml',
    '.github/actions/setup/action.yml', '.github/actions/harbor/lane/action.yaml']) {
    assert.ok(isCheckedFile(f), `${MISSED}: ${f} is not looked at`);
  }
  for (const f of ['.github/workflows/templates/ci.yml', '.github/actions/setup/run.sh', 'src/ci.yml',
    'docs/.github/workflows/ci.yml', '.github/dependabot.yml', EXCEPTIONS_FILE]) {
    assert.ok(!isCheckedFile(f), `${f} is looked at`);
  }
});

// ---------- the ratchet ----------

const exceptions = (...entries) => JSON.stringify(entries);
const RELEASE = '.github/workflows/release.yml';
const listed = (until, extra = {}) => ({
  file: RELEASE, secret: 'OKAFOR_BOT_TOKEN', reason: 'reads the ledger until the App is installed there', until, ...extra,
});

test('a new checkout token from a repository secret is refused, saying what, why and what to use instead', () => {
  const r = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_PLAIN }], exceptions: null, today: TODAY });
  assert.equal(r.error, null);
  assert.deepEqual(r.looked_at, [RELEASE]);
  assert.equal(r.uses.length, 1, MISSED);
  const u = r.uses[0];
  assert.equal(u.allowed, false, MISSED);
  assert.equal(u.added, true);
  assert.equal(u.line, 14);
  for (const said of [RELEASE, 'line 14', 'OKAFOR_BOT_TOKEN', 'refused', 'github.token', 'actions/create-github-app-token']) {
    assert.ok(u.message.includes(said), `${UNCLEAR}: it never says "${said}": ${u.message}`);
  }
  assert.match(u.message, /this change adds it/i, UNCLEAR);
  assert.ok(u.words.length <= 300, 'the summary words do not fit one table cell');
});

test('an existing use listed in the exceptions file passes', () => {
  const head = CHECKOUT_WITH_PAT.replace('name: Release', 'name: Release the ledger');
  const r = check({ files: [{ file: RELEASE, head, base: CHECKOUT_WITH_PAT }], exceptions: exceptions(listed('2027-01-31')), today: TODAY });
  assert.equal(r.uses.length, 1);
  const u = r.uses[0];
  assert.equal(u.allowed, true, `${EXCEPTION}: ${u.message}`);
  assert.equal(u.added, false);
  assert.deepEqual(u.exception, { reason: 'reads the ledger until the App is installed there', until: '2027-01-31', ended: false });
  assert.match(u.words, /2027-01-31/);
});

test('an expired exception fails, naming the day it ended', () => {
  const r = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }], exceptions: exceptions(listed('2026-11-04')), today: TODAY });
  const u = r.uses[0];
  assert.equal(u.allowed, false, `${EXCEPTION}: an exception past its end date still counts`);
  assert.equal(u.exception.ended, true);
  assert.ok(u.message.includes('ended on 2026-11-04'), `${UNCLEAR}: ${u.message}`);
});

test('an exception counts through its end date, and a later entry for the same use wins', () => {
  const onTheDay = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }], exceptions: exceptions(listed(TODAY)), today: TODAY });
  assert.equal(onTheDay.uses[0].allowed, true, `${EXCEPTION}: an exception stopped counting on its own end date`);
  const two = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }],
    exceptions: exceptions(listed('2026-10-01'), listed('2027-02-28')), today: TODAY });
  assert.equal(two.uses[0].allowed, true, EXCEPTION);
  assert.equal(two.uses[0].exception.until, '2027-02-28');
});

test('an exception for another file or another secret does not count', () => {
  for (const other of [listed('2027-01-31', { file: '.github/workflows/ci.yml' }), listed('2027-01-31', { secret: 'HARBOR_BOT_TOKEN' })]) {
    const r = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }], exceptions: exceptions(other), today: TODAY });
    assert.equal(r.uses[0].allowed, false, `${EXCEPTION}: ${JSON.stringify(other)}`);
  }
  // Secret names are read the way GitHub reads them, without case.
  const lower = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }],
    exceptions: exceptions(listed('2027-01-31', { secret: 'okafor_bot_token' })), today: TODAY });
  assert.equal(lower.uses[0].allowed, true, EXCEPTION);
});

test('a use already in a file the change touches needs its exception too', () => {
  const head = CHECKOUT_WITH_PAT.replace('name: Release', 'name: Release the ledger');
  const r = check({ files: [{ file: RELEASE, head, base: CHECKOUT_WITH_PAT }], exceptions: null, today: TODAY });
  const u = r.uses[0];
  assert.equal(u.allowed, false, `${MISSED}: an unlisted use survives every change to its file`);
  assert.equal(u.added, false);
  assert.match(u.message, /already in this file/i, UNCLEAR);
});

test('an exception the change itself adds does not count: exceptions are read from the base branch', () => {
  const r = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_PLAIN }],
    exceptions: null, changedExceptions: exceptions(listed('2027-01-31')), today: TODAY });
  assert.equal(r.uses[0].allowed, false, `${EXCEPTION}: a change let itself in`);
  assert.equal(r.error, null);
  assert.ok(r.notes.some((n) => /base branch/.test(n)), JSON.stringify(r.notes));
});

test('an exceptions file that cannot be read allows nothing, and one the change writes must be readable', () => {
  const unreadableBase = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }],
    exceptions: '{ not json', today: TODAY });
  assert.equal(unreadableBase.uses[0].allowed, false, EXCEPTION);
  assert.ok(unreadableBase.notes.some((n) => n.includes(EXCEPTIONS_FILE) && /not JSON/.test(n)), JSON.stringify(unreadableBase.notes));

  const halfEntries = check({ files: [{ file: RELEASE, head: CHECKOUT_WITH_PAT, base: CHECKOUT_WITH_PAT }],
    exceptions: exceptions(listed(undefined), listed('2027-01-31', { reason: '' }), listed('31/01/2027')), today: TODAY });
  assert.equal(halfEntries.uses[0].allowed, false, `${EXCEPTION}: an entry with no end date or no reason counts`);
  assert.equal(halfEntries.notes.filter((n) => /does not count/.test(n)).length, 3, JSON.stringify(halfEntries.notes));

  const writesBroken = check({ files: [], exceptions: null, changedExceptions: '{"file": 1}', today: TODAY });
  assert.match(writesBroken.error, /person-token-exceptions\.json/, 'a change can write an exceptions file nothing can read');
});

// ---------- as the workflow runs it ----------

const WORKFLOW = path.join(here, '..', '.github', 'workflows', 'security-scan.yml');
const DOC = parseDocument(fs.readFileSync(WORKFLOW, 'utf8'));
const workflow = DOC.toJS();

function jobOf(name) {
  const job = workflow.jobs?.[name];
  assert.ok(job, `${MISSED}: the workflow has no job "${name}"`);
  return job;
}

// The run: script of the job's step that runs the person-token check.
function scanScript() {
  const step = (jobOf('person-tokens').steps ?? []).find((s) => /person-tokens\.mjs scan/.test(s.run ?? ''));
  assert.ok(step, `${MISSED}: the job person-tokens never runs person-tokens.mjs scan`);
  return step.run;
}

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'person-tokens-'));
  const gitConfig = path.join(dir, 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  // A copy, as the job's sparse checkout writes it: the script runs only when invoked by its own path.
  fs.cpSync(SOURCE, path.join(dir, '.security-scan-source', 'security-scan'), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
  return { dir, target: path.join(dir, 'target'), env };
}

function git(box, ...args) {
  const r = spawnSync('git', ['-C', box.target, '-c', 'user.name=Mira Okafor', '-c', 'user.email=mira@harbor-lane.example',
    '-c', 'commit.gpgsign=false', ...args], { env: box.env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(box, rel, text) {
  const file = path.join(box.target, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commit(box, message) {
  git(box, 'add', '--all');
  git(box, 'commit', '--quiet', '--message', message);
  return git(box, 'rev-parse', 'HEAD');
}

function runScan(box, base, head) {
  const r = spawnSync('bash', ['-c', scanScript()], {
    cwd: box.dir, env: { ...box.env, BASE_SHA: base, HEAD_SHA: head }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `the step ended with exit ${r.status}: ${r.stderr}${r.stdout}`);
  return {
    exit: fs.readFileSync(path.join(box.dir, 'scan', 'person-tokens.exit'), 'utf8').trim(),
    text: fs.readFileSync(path.join(box.dir, 'scan', 'person-tokens.out'), 'utf8'),
  };
}

test('the job looks only at the workflow files the change changes, at its head, with exceptions from the base', () => {
  const box = sandbox();
  try {
    fs.mkdirSync(box.target);
    git(box, 'init', '--quiet', '--initial-branch', 'main');
    write(box, 'README.md', 'ledger\n');
    write(box, '.github/workflows/untouched.yml', CHECKOUT_WITH_PAT);
    write(box, RELEASE, CHECKOUT_WITH_PAT);
    write(box, EXCEPTIONS_FILE, exceptions(listed('2099-12-31')));
    commit(box, 'base');
    git(box, 'checkout', '--quiet', '-b', 'change');
    write(box, RELEASE, CHECKOUT_WITH_PAT.replace('name: Release', 'name: Release the ledger'));
    write(box, '.github/workflows/new.yml', CHECKOUT_WITH_PAT.replace(/OKAFOR_BOT_TOKEN/g, 'HARBOR_LANE_PAT'));
    write(box, '.github/actions/setup/action.yml', lines('runs:', '  using: composite', '  steps:', '    - run: echo set up', '      shell: bash'));
    write(box, 'README.md', 'the ledger\n');
    write(box, EXCEPTIONS_FILE, exceptions(listed('2099-12-31'),
      { file: '.github/workflows/new.yml', secret: 'HARBOR_LANE_PAT', reason: 'let in by the change itself', until: '2099-12-31' }));
    const head = commit(box, 'the change');
    // The base branch moves on after the change was cut: it edits a workflow the change never
    // touches and adds one, so a diff from the base itself rather than from the merge base
    // would read both as the change's.
    git(box, 'checkout', '--quiet', 'main');
    write(box, '.github/workflows/untouched.yml', CHECKOUT_WITH_PAT.replace('name: Release', 'name: Release, edited on main'));
    write(box, '.github/workflows/later-on-main.yml', CHECKOUT_WITH_PAT.replace(/OKAFOR_BOT_TOKEN/g, 'LATER_GH_TOKEN'));
    const base = commit(box, 'the base branch moves on');

    const out = runScan(box, base, head);
    assert.equal(out.exit, '0', out.text);
    const r = JSON.parse(out.text);
    assert.deepEqual([...r.looked_at].sort(), ['.github/actions/setup/action.yml', '.github/workflows/new.yml', RELEASE], UNTOUCHED);
    const byFile = Object.fromEntries(r.uses.map((u) => [u.file, u]));
    assert.deepEqual(Object.keys(byFile).sort(), ['.github/workflows/new.yml', RELEASE], `${UNTOUCHED}: ${JSON.stringify(r.uses)}`);
    assert.equal(byFile[RELEASE].allowed, true, `${EXCEPTION}: the base branch's exception did not count`);
    assert.equal(byFile['.github/workflows/new.yml'].allowed, false, `${EXCEPTION}: the change let itself in`);
    assert.equal(byFile['.github/workflows/new.yml'].added, true);

    const d = decide({ mode: 'blocking', native: 'true', accepted: null,
      outputs: { 'dependency-review': { exit: 'success', text: '' }, 'person-tokens': out } });
    assert.equal(d.result, 'fail', MISSED);
    assert.deepEqual(d.findings.filter((f) => f.blocks).map((f) => f.id), ['person-token:.github/workflows/new.yml:HARBOR_LANE_PAT'], MISSED);
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('an unchanged workflow is never flagged, even with no exceptions file', () => {
  const box = sandbox();
  try {
    fs.mkdirSync(box.target);
    git(box, 'init', '--quiet', '--initial-branch', 'main');
    write(box, RELEASE, CHECKOUT_WITH_PAT);
    write(box, '.github/workflows/ci.yml', CHECKOUT_PLAIN.replace('name: Release', 'name: CI'));
    const base = commit(box, 'base');
    write(box, 'README.md', 'the ledger\n');
    write(box, '.github/workflows/ci.yml', CHECKOUT_PLAIN.replace('name: Release', 'name: Checks'));
    const head = commit(box, 'the change');
    const out = runScan(box, base, head);
    assert.equal(out.exit, '0', out.text);
    const r = JSON.parse(out.text);
    assert.deepEqual(r.looked_at, ['.github/workflows/ci.yml']);
    assert.deepEqual(r.uses, [], UNTOUCHED);
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('a scan that cannot read the change does not finish, so the decision blocks', () => {
  const box = sandbox();
  try {
    fs.mkdirSync(box.target);
    git(box, 'init', '--quiet', '--initial-branch', 'main');
    write(box, RELEASE, CHECKOUT_WITH_PAT);
    const head = commit(box, 'base');
    const out = runScan(box, '0123456789abcdef0123456789abcdef01234567', head);
    assert.notEqual(out.exit, '0', `${MISSED}: a scan with no base commit finished: ${out.text}`);
    const d = decide({ mode: 'blocking', native: 'true', accepted: null,
      outputs: { 'dependency-review': { exit: 'success', text: '' }, 'person-tokens': out } });
    assert.equal(d.result, 'fail', MISSED);
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test('the person-token job runs on every branch, keeps no credentials, names no secret, and hands its output on', () => {
  const job = jobOf('person-tokens');
  const text = JSON.stringify(job);
  const steps = job.steps ?? [];
  assert.ok(!('if' in job), `${MISSED}: the job runs on one branch only`);
  assert.doesNotMatch(text, /secrets\./, 'the job reads a secret');
  // Each checkout by a 40-hex commit, its tag in the comment beside it.
  for (const step of DOC.getIn(['jobs', 'person-tokens', 'steps'], true)?.items ?? []) {
    const uses = step.get('uses', true);
    if (!String(uses?.value ?? '').startsWith('actions/checkout@')) continue;
    assert.match(uses.value, /@[0-9a-f]{40}$/, `not pinned by commit: ${uses.value}`);
    assert.ok(uses.comment, `not pinned by commit with its tag beside it: ${uses.value}`);
  }
  assert.ok(steps.filter((s) => String(s.uses ?? '').startsWith('actions/checkout@')).every((s) => s.with?.['persist-credentials'] === false),
    'a checkout in the job keeps its credentials');
  assert.ok(steps.some((s) => s.with?.['fetch-depth'] === 0), 'the job cannot see the change\'s base without its history');
  assert.match(text, /"name":"security-scan-person-tokens"/, 'the job does not hand its output to the final job');
  assert.ok([jobOf('security-scan').needs].flat().includes('person-tokens'), `${MISSED}: the final job does not wait for the person-token check`);
});
