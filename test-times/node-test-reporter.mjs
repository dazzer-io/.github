// The test-time adapter for Node's built-in runner.
//
//   node --import=<dir>/touch.mjs?out=<file>.touch --test --test-concurrency=<n> \
//     --test-reporter=spec --test-reporter-destination=stdout \
//     --test-reporter=<dir>/node-test-reporter.mjs --test-reporter-destination=<file> <files>
//
// It runs in the runner's main process and takes its record file from its own destination on
// that command line, never from the environment. Node opens that destination before the
// reporter starts; the reporter writes the record into it itself (record.mjs Recorder), the
// run line first, the whole record at the end, and yields nothing for Node to write.
//
// Kinds are per file (kind_scope "file"): Node starts one child per test file and forwards its
// `--import` to each, so the touch line of a child whose parent is this process names its file.
//
// A file that fails as a file (it throws on import, its process crashes, or it exits non-zero
// after its tests) is the one top-level failure Node names after the file itself; a file whose
// tests failed is not. Its record gets a failing test line named FILE_ITSELF (record.mjs),
// with the file's own time, so the end line's count holds it.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Recorder, markRunner, readTouch } from './record.mjs';
import { decodeOut } from './touch.mjs';

const SELF = fileURLToPath(import.meta.url);

function toPath(spec, cwd) {
  if (spec.startsWith('file:')) { try { return fileURLToPath(spec.replace(/\?.*$/, '')); } catch { return null; } }
  return path.resolve(cwd, spec.replace(/\?.*$/, ''));
}

// What this run's own command line says: the record file, the touch file, the concurrency and
// the isolation. Answers file: null when this reporter was given no file destination.
export function nodeOptions(execArgv, cwd = process.cwd()) {
  const reporters = []; const destinations = [];
  let concurrency = null; let isolation = 'process'; let touch = null;
  for (let i = 0; i < execArgv.length; i++) {
    const a = execArgv[i];
    const m = /^(--[a-z-]+)(?:=(.*))?$/s.exec(a);
    if (!m) continue;
    const value = () => (m[2] !== undefined ? m[2] : execArgv[++i]);
    if (m[1] === '--test-reporter') reporters.push(value());
    else if (m[1] === '--test-reporter-destination') destinations.push(value());
    else if (m[1] === '--test-concurrency') concurrency = Number(value());
    else if (m[1] === '--test-isolation' || m[1] === '--experimental-test-isolation') isolation = value();
    else if (m[1] === '--import') {
      const v = value();
      if (/touch\.mjs\?/.test(v)) {
        const q = /[?&]out=([^&]*)/.exec(v.slice(v.indexOf('?')));
        if (q) touch = decodeOut(q[1]);
      }
    }
  }
  const at = reporters.findIndex((r) => toPath(r, cwd) === SELF);
  const dest = at >= 0 ? destinations[at] : undefined;
  const file = dest && dest !== 'stdout' && dest !== 'stderr' ? path.resolve(cwd, dest) : null;
  // Node's own default: one at a time without process isolation, else all cores but one.
  if (isolation === 'none') concurrency = 1;
  else if (!Number.isInteger(concurrency) || concurrency < 1) concurrency = Math.max(1, os.availableParallelism() - 1);
  return { file, touch, concurrency, isolation };
}

export default async function* nodeTestReporter(source) {
  const cwd = process.cwd();
  const opts = nodeOptions(process.execArgv, cwd);
  if (!opts.file) {
    process.stderr.write('test-times: node-test-reporter.mjs was given no file destination, so it records nothing\n');
    for await (const _ of source) { /* drain */ }
    return;
  }
  markRunner();
  const rec = new Recorder({ file: opts.file, runnerKind: 'node-test' });
  rec.start({ kindScope: opts.touch && opts.isolation !== 'none' ? 'file' : 'job' });
  const workers = opts.concurrency;
  const serial = workers === 1;
  const stacks = new Map();
  const fileItself = (d) => d.nesting === 0 && d.file && path.resolve(cwd, String(d.name)) === d.file;
  const topLevel = new Map(); // a file's own time when the runner reports none (no isolation)
  for await (const ev of source) {
    const d = ev?.data;
    if (!d || !d.file) continue;
    if (ev.type === 'test:start') {
      const s = stacks.get(d.file) ?? [];
      s.length = d.nesting;
      s[d.nesting] = d.name;
      stacks.set(d.file, s);
    } else if (ev.type === 'test:pass' || ev.type === 'test:fail') {
      if (fileItself(d)) {
        if (ev.type === 'test:fail' && d.details?.error?.failureType !== 'subtestsFailed') {
          rec.fileFailed({ file: d.file, ms: d.details?.duration_ms });
        }
        continue;
      }
      if (d.details?.type === 'suite') continue;
      const s = stacks.get(d.file) ?? [];
      const name = [...s.slice(0, d.nesting), d.name].join(' > ');
      const status = d.todo ? 'todo' : ev.type === 'test:fail' ? 'fail' : d.skip ? 'skip' : 'pass';
      rec.test({ file: d.file, name, ms: d.details?.duration_ms, status, retry: 0 });
      if (d.nesting === 0) topLevel.set(d.file, (topLevel.get(d.file) ?? 0) + (d.details?.duration_ms ?? 0));
    } else if (ev.type === 'test:complete' && fileItself(d)) {
      rec.fileTime({ file: d.file, ms: d.details?.duration_ms, workers, serial });
      topLevel.delete(d.file);
    }
  }
  for (const [file, ms] of topLevel) {
    if (!rec.fileTimes.has(Recorder.key(file, null))) rec.fileTime({ file, ms, workers, serial });
  }
  rec.finish({ complete: true, touchLines: readTouch(opts.touch ?? `${opts.file}.touch`, process.pid) });
}
