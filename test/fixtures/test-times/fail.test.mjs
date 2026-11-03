// A fixture for test/test-times-record.test.mjs. It is meant to fail: the record keeps a
// failing test's time and says "fail". It lies outside test/*.test.mjs, so this repository's
// own check never runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('passes first', () => {});

test('fails on purpose', () => {
  assert.equal(1, 2, 'this fixture fails on purpose');
});
