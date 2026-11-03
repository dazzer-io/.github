// A fixture for test/test-times-record.test.mjs, run under the real `node --test` with the
// test-time adapter. It lies outside test/*.test.mjs, so this repository's own check never runs
// it. Every test passes; between them they carry each line the record writes for a passing file:
// a nested title, a title holding the separator, two tests with one title, a skip, a todo, a
// child process (kind "process") and a wait.
import { describe, test } from 'node:test';
import { spawnSync } from 'node:child_process';

describe('a suite', () => {
  test('adds > one', () => {});
});

test('one title', () => {});
test('one title', () => {});

test('skipped', { skip: true }, () => {});
test('later', { todo: true });

test('starts a child', () => {
  spawnSync(process.execPath, ['-e', '']);
});

test('waits', async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
});
