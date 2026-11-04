#!/usr/bin/env node
// Run after a workflow's tests, whatever happened (`if: always()`):
//
//   node "$TEST_TIMES_DIR/finish.mjs" >> "$GITHUB_OUTPUT"
//   node "$TEST_TIMES_DIR/finish.mjs" --kind history --file "$RUNNER_TEMP/history.json" >> "$GITHUB_OUTPUT"
//
// For a record: when no runner wrote one, it writes the never-started record, whose end says
// "complete":false,"why":"the test runner never started". A dealt part's deal line, left in
// `<TEST_TIMES_FILE>.deal`, goes in after its run line, as the adapter writes it, so a part dealt
// nothing, which skips its runner, still says what it was dealt. A record that exists and has no
// end is left as it is: the runner stopped partway. It prints `name=test-times-<TEST_TIMES_ID>`.
// For a plan job's history file it prints `name=test-times-history-<run attempt>`.
// What it saw goes to stderr, so stdout holds only the line for $GITHUB_OUTPUT.

import fs from 'node:fs';
import { NEVER_STARTED, neverStartedRecord, parseRecord, readDeal, readRunFacts } from './record.mjs';

const env = process.env;
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const say = (line) => process.stderr.write(`test-times finish: ${line}\n`);
const refuse = (why) => { say(why); process.exit(1); };

const kind = flag('--kind') ?? 'record';

if (kind === 'history') {
  const file = flag('--file');
  if (!file) refuse('--kind history needs --file <the history file>');
  const attempt = env.GITHUB_RUN_ATTEMPT || '1';
  if (!/^\d+$/.test(attempt)) refuse(`GITHUB_RUN_ATTEMPT is not a number: ${attempt}`);
  if (!fs.existsSync(file)) say(`the history file ${file} is missing, so the upload keeps nothing`);
  process.stdout.write(`name=test-times-history-${attempt}\n`);
  process.exit(0);
}
if (kind !== 'record') refuse(`--kind is "record" or "history", not "${kind}"`);

const file = env.TEST_TIMES_FILE;
const id = env.TEST_TIMES_ID;
if (!file || !id) refuse('TEST_TIMES_FILE or TEST_TIMES_ID is not set: setup.mjs did not run in this job');
if (/[\r\n]/.test(id)) refuse('TEST_TIMES_ID holds a line break');

let text = null;
try { text = fs.readFileSync(file, 'utf8'); } catch { /* no record */ }
if (text === null || !text.trim()) {
  const why = text === null ? NEVER_STARTED : 'the record was empty: the runner stopped before its reporter wrote';
  const lines = neverStartedRecord({ facts: readRunFacts(file), why });
  const deal = readDeal(file);
  if (deal) lines.splice(1, 0, deal);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  say(`no record was written, so it says "${why}"${deal ? `, with its deal line of ${deal.files?.length ?? 0} files` : ''}`);
} else {
  const r = parseRecord(text);
  say(r.complete ? `complete, ${r.tests.length} tests in ${r.files.length} files` : `incomplete: ${r.why}`);
}
process.stdout.write(`name=test-times-${id}\n`);
