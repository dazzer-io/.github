#!/usr/bin/env node
// Lints this repository's GitHub Actions workflows with a pinned release of actionlint.
//
//   node scripts/actionlint.mjs [workflow files...]
//
// With no files named it reads every .yml or .yaml file in .github/workflows. It downloads
// actionlint 1.7.12 for the running platform, refuses unless the archive's SHA-256 is the one
// pinned below, and exits non-zero when actionlint finds anything.
//
// The checksums are the release's own (actionlint_1.7.12_checksums.txt). A platform with no
// pinned checksum is refused, never guessed. The shellcheck and pyflakes integrations are
// switched off, so the result does not depend on what else the runner has installed. One message
// is ignored: actionlint 1.7.12 does not yet know the job.workflow_repository and
// job.workflow_sha properties GitHub Actions provides, and reports them as undefined.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.7.12';
const SHA256 = {
  linux_amd64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  linux_arm64: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
  darwin_amd64: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  darwin_arm64: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
};
const IGNORE = 'property "workflow_(repository|sha)" is not defined in object type';

function fail(message) {
  console.error(`actionlint: ${message}`);
  process.exit(2);
}

const OS = { linux: 'linux', darwin: 'darwin' }[process.platform];
const ARCH = { x64: 'amd64', arm64: 'arm64' }[process.arch];
const platform = `${OS}_${ARCH}`;
const expected = SHA256[platform];
if (!OS || !ARCH || !expected) fail(`no pinned checksum for ${process.platform} ${process.arch}; refusing to run an unchecked binary`);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let files = process.argv.slice(2);
if (files.length === 0) {
  const dir = path.join(root, '.github', 'workflows');
  files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(dir, f))
    : [];
  if (files.length === 0) fail('no workflow in .github/workflows to read (never read as clean)');
}
files = files.map((f) => path.resolve(f));
for (const f of files) if (!fs.existsSync(f)) fail(`no such workflow file: ${f}`);

const name = `actionlint_${VERSION}_${platform}.tar.gz`;
const url = `https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${name}`;
let body;
for (let attempt = 1; ; attempt++) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = Buffer.from(await res.arrayBuffer());
    break;
  } catch (err) {
    if (attempt >= 5) fail(`could not download ${url}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
const actual = createHash('sha256').update(body).digest('hex');
if (actual !== expected) fail(`${name} has SHA-256 ${actual}, not the pinned ${expected}; refusing to run it`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'actionlint-'));
try {
  const archive = path.join(tmp, name);
  fs.writeFileSync(archive, body);
  const untar = spawnSync('tar', ['-xzf', archive, '-C', tmp, 'actionlint'], { stdio: 'inherit' });
  if (untar.status !== 0) fail(`could not unpack ${name}`);
  const run = spawnSync(path.join(tmp, 'actionlint'),
    ['-shellcheck=', '-pyflakes=', '-ignore', IGNORE, ...files],
    { stdio: 'inherit', cwd: root });
  if (run.error) fail(`could not run actionlint: ${run.error.message}`);
  if (run.status !== 0) {
    console.error(`actionlint: found problems in ${files.length} workflow file(s)`);
    process.exitCode = run.status ?? 1;
  } else {
    console.log(`actionlint ${VERSION}: ${files.length} workflow file(s) clean`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
