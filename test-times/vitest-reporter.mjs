// The test-time adapter for vitest (its reporter interface: onInit, onTestCaseResult,
// onTestModuleEnd, onTestRunEnd; vitest 3 and later).
//
// The config, in the runner's main process, reads and removes TEST_TIMES_DIR and
// TEST_TIMES_FILE before any test starts, and only when they were set adds this reporter with
// the record file as its option, and the touch preload to its pool's execArgv:
//
//   reporters: [...today's, [`${dir}/vitest-reporter.mjs`, { file }]]
//   execArgv:  [`--import=${dir}/touch.mjs?out=${file}.touch`]
//
// Kinds are per job (kind_scope "job"): vitest's pool processes each run several files, so
// every file line carries the union of what the job's processes were seen to do, and its
// waits_ms the job's sum.

import { Recorder, markRunner, readTouch } from './record.mjs';

function status(testCase) {
  const s = testCase.result?.()?.state;
  if (s === 'passed') return 'pass';
  if (s === 'failed') return 'fail';
  return testCase.options?.mode === 'todo' ? 'todo' : 'skip';
}

function titlePath(testCase) {
  const names = [testCase.name];
  for (let p = testCase.parent; p && p.type === 'suite'; p = p.parent) names.unshift(p.name);
  return names.join(' > ');
}

function groupOf(project) {
  return project?.name ? project.name : null;
}

// A file's own wall time as vitest reports it: its environment, preparation, collection,
// setup and test time (TestModule.diagnostic()).
function moduleMs(d) {
  if (!d) return null;
  const parts = ['environmentSetupDuration', 'prepareDuration', 'collectDuration', 'setupDuration', 'duration'];
  return parts.reduce((sum, k) => sum + (Number(d[k]) || 0), 0);
}

// How many files the project ran side by side, from its resolved config as the run uses it.
function workersOf(config) {
  if (config?.fileParallelism === false) return 1;
  return Number.isInteger(config?.maxWorkers) ? config.maxWorkers : null;
}

export default class VitestTestTimes {
  constructor(options = {}) {
    this.file = options.file ?? null;
    this.rec = null;
  }

  onInit() {
    if (!this.file) {
      process.stderr.write('test-times: vitest-reporter.mjs was given no file, so it records nothing\n');
      return;
    }
    markRunner();
    this.rec = new Recorder({ file: this.file, runnerKind: 'vitest' });
    this.rec.start({ kindScope: 'job' });
  }

  onTestCaseResult(testCase) {
    if (!this.rec) return;
    const d = testCase.diagnostic?.();
    this.rec.test({
      file: testCase.module.moduleId,
      group: groupOf(testCase.project),
      name: titlePath(testCase),
      ms: d?.duration ?? 0,
      status: status(testCase),
      retry: d?.retryCount ?? 0,
    });
  }

  onTestModuleEnd(testModule) {
    if (!this.rec) return;
    const workers = workersOf(testModule.project?.config);
    this.rec.fileTime({
      file: testModule.moduleId,
      group: groupOf(testModule.project),
      ms: moduleMs(testModule.diagnostic?.()),
      workers,
      serial: workers === 1,
    });
  }

  onTestRunEnd(_testModules, _unhandledErrors, reason) {
    if (!this.rec) return;
    const complete = reason !== 'interrupted';
    this.rec.finish({
      complete,
      why: complete ? null : 'the run was interrupted',
      touchLines: readTouch(`${this.file}.touch`, process.pid),
    });
    this.rec = null;
  }
}
