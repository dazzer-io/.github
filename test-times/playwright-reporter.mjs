// The test-time adapter for Playwright (its reporter interface: onBegin, onTestEnd, onEnd).
//
// playwright.config.ts, in the runner's main process, reads and removes TEST_TIMES_DIR and
// TEST_TIMES_FILE, and only when they were set adds this reporter beside the ones it lists:
//
//   reporter: [...today's, [`${dir}/playwright-reporter.mjs`, { file }]]
//
// Kinds are the runner's (kind_scope "runner"): every Playwright file carries "browser"
// alone, because the touch preload is not loaded in its workers, and waits_ms is not read.
//
// A file's ms is the sum of its test results' durations in its project, retries included:
// Playwright reports no file time of its own, and its tests' durations include their hooks.
// A file run in two projects has a file line for each, its group the project's name.
//
// workers is the project's own workers where it sets them, else the config's. fullyParallel is
// not read: it says whether one file's tests may spread over several workers, while files run
// side by side up to the workers count under either setting.
//
// A spec that fails to load is reported through onError with its location, before or after
// onBegin, and runs no test. Its record gets a failing test line named FILE_ITSELF
// (record.mjs), with no time and no project.

import { Recorder, markRunner } from './record.mjs';

function status(test, result) {
  if (result.status === 'passed') return 'pass';
  if (result.status === 'skipped') {
    return (test.annotations ?? []).some((a) => a.type === 'fixme') ? 'todo' : 'skip';
  }
  return 'fail';
}

function titlePath(test) {
  const names = [test.title];
  for (let p = test.parent; p && p.type === 'describe'; p = p.parent) names.unshift(p.title);
  return names.join(' > ');
}

export default class PlaywrightTestTimes {
  constructor(options = {}) {
    this.file = options.file ?? null;
    this.rec = null;
    this.files = new Map();
    this.failed = [];
  }

  printsToStdio() {
    return false;
  }

  onBegin(config) {
    if (!this.file) {
      process.stderr.write('test-times: playwright-reporter.mjs was given no file, so it records nothing\n');
      return;
    }
    this.config = config;
    this.begin();
  }

  begin() {
    if (this.rec || this.done) return;
    markRunner();
    this.rec = new Recorder({ file: this.file, runnerKind: 'playwright' });
    this.rec.start({ kindScope: 'runner' });
  }

  // A spec that failed to load: its file, from the error's location.
  onError(error) {
    const file = error?.location?.file;
    if (this.file && file && !this.failed.includes(file)) this.failed.push(file);
  }

  onTestEnd(test, result) {
    if (!this.rec) return;
    const project = test.parent?.project?.();
    const group = project?.name ? project.name : null;
    const file = test.location.file;
    this.rec.test({ file, group, name: titlePath(test), ms: result.duration, status: status(test, result),
      retry: result.retry ?? 0 });
    const key = Recorder.key(file, group);
    const f = this.files.get(key) ?? { file, group, ms: 0, project };
    f.ms += Number(result.duration) || 0;
    this.files.set(key, f);
  }

  onEnd(result) {
    if (!this.file) return;
    this.begin(); // a run that ended in load errors may never have begun
    if (!this.rec) return;
    for (const file of this.failed) this.rec.fileFailed({ file });
    for (const f of this.files.values()) {
      // How many files the project ran side by side: its own workers where it sets them, else
      // the config's, as the run resolved them.
      const workers = Number.isInteger(f.project?.workers) ? f.project.workers
        : Number.isInteger(this.config?.workers) ? this.config.workers : null;
      this.rec.fileTime({ file: f.file, group: f.group, ms: f.ms, workers, serial: workers === 1 });
    }
    const s = result?.status;
    const complete = s === 'passed' || s === 'failed';
    this.rec.finish({
      complete,
      why: complete ? null : s === 'timedout' ? 'the run timed out' : `the run was ${s ?? 'stopped'}`,
    });
    this.rec = null;
    this.done = true;
  }
}
