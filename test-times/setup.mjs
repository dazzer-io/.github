#!/usr/bin/env node
// Run before a workflow's tests, from a plain clone of this folder:
//
//   node "$RUNNER_TEMP/test-times-src/test-times/setup.mjs" >> "$GITHUB_ENV"
//
// It prints three lines for $GITHUB_ENV:
//   TEST_TIMES_DIR   this folder's path on the runner;
//   TEST_TIMES_FILE  $RUNNER_TEMP/test-times.jsonl, the record file;
//   TEST_TIMES_ID    the job id, the run attempt, the runner name (every character other than
//                    a letter, digit or dash turned into a dash) and the moment of setup in ms.
// and writes the run's GitHub and runner facts to <TEST_TIMES_FILE>.run.json while the job's
// whole environment is present, so a runner that strips the environment still records them.
// It also clears what an earlier setup in the same job left: the record, its touch and deal
// files, and the mark a runner leaves when it starts (record.mjs Recorder.start).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const refuse = (why) => { process.stderr.write(`test-times setup: ${why}\n`); process.exit(1); };

if (!env.RUNNER_TEMP) refuse('RUNNER_TEMP is not set, so this is not a GitHub job and nothing is recorded');

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(env.RUNNER_TEMP, 'test-times.jsonl');
const now = Date.now();
const runnerName = env.RUNNER_NAME ?? '';
const id = [env.GITHUB_JOB || 'job', env.GITHUB_RUN_ATTEMPT || '1',
  runnerName.replace(/[^A-Za-z0-9-]/g, '-') || 'runner', String(now)].join('-');

for (const v of [dir, file, id]) {
  if (/[\r\n]/.test(v)) refuse(`a path or name holds a line break: ${JSON.stringify(v)}`);
}

const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const facts = {
  repo: env.GITHUB_REPOSITORY || null,
  sha: env.GITHUB_SHA || null,
  ref: env.GITHUB_REF || null,
  event: env.GITHUB_EVENT_NAME || null,
  run_id: num(env.GITHUB_RUN_ID),
  run_attempt: num(env.GITHUB_RUN_ATTEMPT),
  job_key: env.GITHUB_JOB || null,
  runner_name: runnerName || null,
  runner: {
    os: env.RUNNER_OS || null,
    arch: env.RUNNER_ARCH || null,
    cores: os.availableParallelism(),
    // GitHub hands a job no runs-on label; a workflow may name it, else the runner's image is used.
    label: env.TEST_TIMES_LABEL || env.ImageOS || null,
  },
  setup_at: new Date(now).toISOString(),
};

fs.mkdirSync(env.RUNNER_TEMP, { recursive: true });
for (const stale of [file, `${file}.touch`, `${file}.deal`, `${file}.started`]) fs.rmSync(stale, { force: true });
fs.writeFileSync(`${file}.run.json`, JSON.stringify(facts) + '\n');

process.stdout.write(`TEST_TIMES_DIR=${dir}\nTEST_TIMES_FILE=${file}\nTEST_TIMES_ID=${id}\n`);
