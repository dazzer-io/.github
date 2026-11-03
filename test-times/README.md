# test-times: the test-time recorder

One record per test job per run on GitHub: each test's time and result, each test file's time,
content hash and workers, what its process was seen to touch, the machine, and a fixed reference
timing. Each test runner's own reporter writes it on every run, passing or failing. GitHub's own
upload step keeps it with the run. Nothing here holds a test's verdict. A run on a person's
computer records nothing.

Everything here uses only what Node 22 has and needs no install. This folder holds no test
name, result or record of any repository.

| File | What it is |
| --- | --- |
| `record.mjs` | The format's writer and reader: `parseRecord`, `readRunFile` (unzips a downloaded run file with `node:zlib`, stored and deflated entries only), `compareRecords`, `gitBlob`, `Recorder`. Every other reader imports these. |
| `read.mjs` | The reader's command line and its GitHub reads. |
| `node-test-reporter.mjs`, `vitest-reporter.mjs`, `playwright-reporter.mjs` | The three adapters. |
| `touch.mjs` | The touch preload. |
| `setup.mjs`, `finish.mjs` | Run before and after a workflow's tests. |

## The format, version 1: `test-times.jsonl`, one JSON object per line

```
{"v":1,"type":"run","repo","sha","ref","event","run_id","run_attempt","job_key","runner_name",
 "runner":{"os","arch","cores","label"},"runner_kind":"node-test|vitest|playwright","reference_ms",
 "kind_scope":"file|job|runner","started_at","ended_at"}
{"type":"deal","parts","part","files":[...],"discovered","discovered_count","history"}   only in a dealt part
{"type":"test","file","name","n","ms","status":"pass|fail|skip|todo","retry"}             one per test
{"type":"file","file","group","blob","ms","workers","serial","kinds":[...],"waits_ms"}    one per test file
{"type":"end","tests","files","complete":true|false,"why"}
```

- **GitHub and runner fields** come from `<record file>.run.json`, which setup.mjs writes. A run
  with no such file says `"event":"local"`, and its other fields are null.
- **Lines are ordered** run, deal, then each file by path (then group): the file's tests in the
  runner's order, then its file line, and the end line last.
- **`name`** is the title path joined by ` > `, as given. `n` counts earlier tests in the record
  with the same file and name, so two tests with one title are both kept. That includes a
  retried attempt, and the same test in another project.
- **`kinds`** are `process`, `local-service` (loopback or a socket file), `network` (any other
  address) and `browser`. They are never a host, address, port or argument. An empty list means
  none of them was seen.
- **`kind_scope`** is one of three:
  - `file` for Node's runner, which starts one child per file;
  - `job` for vitest, where every file carries the union of the job's processes, and its
    `waits_ms` the job's sum;
  - `runner` for Playwright, whose kinds are `browser` alone and whose `waits_ms` is null.

  When no touch line came back, `kind_scope` falls back to `job`, `kinds` is empty and
  `waits_ms` is null, which means unknown, never "touched nothing".
- **`waits_ms`** sums the delays a process asked for through `setTimeout`, `setInterval` and
  their `node:timers/promises` forms, each call counted once. Calls made straight from Node's
  own internals are left out, such as the test harness's keep-alive interval on its way out.
- **A file's `ms`:**
  - Node's runner: its own `test:complete` time;
  - vitest: its module's environment, prepare, collect, setup and test durations added
    together;
  - Playwright: the sum of its results' durations in its project, retries included. Playwright
    reports no file time of its own.
- **`workers` and `serial`** are read from the run's own configuration:
  - Node's `--test-concurrency`, else Node's default;
  - a vitest project's `maxWorkers`, or 1 with `fileParallelism: false`;
  - a Playwright project's `workers`, else the config's.

  `serial` is true when that number is 1.
- **Complete:** a record is complete only with an end line saying so whose counts match the
  lines it holds. A record with no end line stopped partway. Readers read only version 1, never
  take a time from an incomplete record, and count any other version as unreadable.
- **`reference_ms`** is the time to SHA-256 64 MiB of zero bytes in 1 MiB pieces, in the
  reporter's own process before the first test. Only ratios between runs mean anything.

## Wiring a workflow

There is no action of our own, so it works where a repository allows only GitHub's actions.
Pin this repository's commit once, at the top of the workflow:

```yaml
env:
  TEST_TIMES_SHA: <a commit of dazzer-io/.github>
```

Around the job's tests, add three steps:

```yaml
      - name: Fetch the test-time recorder
        continue-on-error: true
        run: |
          git clone --quiet --filter=blob:none https://github.com/dazzer-io/.github "$RUNNER_TEMP/test-times-src"
          git -C "$RUNNER_TEMP/test-times-src" checkout --quiet "$TEST_TIMES_SHA"
          node "$RUNNER_TEMP/test-times-src/test-times/setup.mjs" >> "$GITHUB_ENV"

      # ... the tests, their runner wired as below ...

      - name: Finish the test times
        id: test-times
        if: always()
        continue-on-error: true
        run: node "$TEST_TIMES_DIR/finish.mjs" >> "$GITHUB_OUTPUT"

      - name: Keep the test times
        if: always()
        continue-on-error: true
        uses: actions/upload-artifact@<commit, pinned as the repository pins it>
        with:
          name: ${{ steps.test-times.outputs.name }}
          path: ${{ env.TEST_TIMES_FILE }}
          overwrite: true
```

- **setup.mjs** prints `TEST_TIMES_DIR`, `TEST_TIMES_FILE` (`$RUNNER_TEMP/test-times.jsonl`)
  and `TEST_TIMES_ID`, and writes the run's facts beside the record.
  - `runner.label` is `TEST_TIMES_LABEL` when the workflow sets it, else the runner image
    (`ImageOS`), because GitHub hands a job no `runs-on` label.
- **finish.mjs** writes a record saying `the test runner never started` when none was written,
  and prints the run file's name, `test-times-<TEST_TIMES_ID>`.
- **A plan job** keeps its history file with
  `finish.mjs --kind history --file <file>`, which prints `test-times-history-<run attempt>`, and
  an upload named `Keep the history`.

### Wiring each runner

The runner's main process reads both variables, removes them from its own environment before
any test starts, and hands the paths on directly. So no test, and nothing a test starts, sees
them. With the variables unset, the command or config is exactly today's.

- **Node's runner.** The reporter finds its record file in its own destination on this command
  line:

  ```
  node --import=<dir>/touch.mjs?out=<file>.touch --test --test-concurrency=<n> \
    --test-reporter=spec --test-reporter-destination=stdout \
    --test-reporter=<dir>/node-test-reporter.mjs --test-reporter-destination=<file> <files>
  ```

- **vitest:**

  ```js
  const dir = process.env.TEST_TIMES_DIR; const file = process.env.TEST_TIMES_FILE;
  delete process.env.TEST_TIMES_DIR; delete process.env.TEST_TIMES_FILE;
  // only when both were set:
  reporters: [...today, [`${dir}/vitest-reporter.mjs`, { file }]],
  execArgv: [`--import=${dir}/touch.mjs?out=${file}.touch`],   // the process pool's
  ```

- **Playwright:** the same read and removal, then
  `reporter: [...today, [`${dir}/playwright-reporter.mjs`, { file }]]`.

A dealt part writes its deal line to `<file>.deal` before its runner starts, and the adapter
copies it into the record.

## Reading records: `read.mjs`

```
node read.mjs --repo <owner/name> --workflow <file> --event <push|pull_request> [--branch <name>] <one mode>
```

- **`--require-complete [--runs <n>]`** reads the newest ten completed runs that were not
  cancelled or skipped.
  - It prints, per job group in which `Keep the test times` ran, the state of its newest record:
    `complete, N tests in M files`, `ran no test` or `incomplete: <why>`.
  - It exits 0 when every group left a complete record in at least one run (or only ever ran no
    test), and the newest run left at least one.
  - Otherwise it exits 1 with `no complete test-time record: <the groups>`.
- **`--history --out <file> [--runs <n>] [--job-prefix <name>] [--allow-none]`** writes the
  history file a planner deals from, from the newest ten successful runs.
  - Its shape: `{"v":1,"repo","workflow","event","branch","attempt","read_at","source","why","runs","files","jobs"}`.
  - `attempt` is `GITHUB_RUN_ATTEMPT`, or 1 outside a workflow.
  - `files[path]` holds `ms` (the median over complete records), with `workers`, `serial` and
    `group` from its newest record, and `n`. A path recorded under more than one group also
    carries `by_group`, each group's own entry, keyed by group name.
  - `jobs[group]` holds `ms` (the median of the group's longest job), `setup_ms` (the median of
    job time minus record span) and `n`.
  - `--job-prefix` limits which jobs feed `files`; `jobs` always holds every group.
  - With `--allow-none`, a refused read still writes the file, with `"source":"none"` and why,
    prints `::warning title=test-times history::could not read: ...`, and exits 0.
- **`--slowest <group>` and `--not-slowest <group>`, with `[--ignore <group>]...`,** compare each
  group's median time over the newest ten successful runs. The one that fails exits 1 with
  `<group> sets the wait: <x> min against <group> <y> min`.
- **Exit 2** says `could not read: <what refused>`: GitHub refused a call, a run file could not
  be opened, there was no token, or the arguments were wrong. A read that could not be made
  never passes.

**How it reads:**

- **Attempts.** For each job, the newest attempt that left a complete record counts. A later
  attempt that left none never hides it.
- **Ran no test.** A job that succeeded and whose record says `the test runner never started`
  ran no test and owes none.
- **Pairing.** A record pairs with the job whose runner name and attempt match and whose start
  and end hold the record's, allowing a second for GitHub's whole-second times.
- **Groups.**
  - A job that kept a record is grouped by its job id (`job_key`).
  - A job that kept none is grouped by the job id its name carried in any run read, so one
    missing upload never splits a matrix; failing that, by its name.
  - A group's time in a run is its longest job's.
- **Token.** `GITHUB_TOKEN` or `GH_TOKEN`, else `gh auth token`. It only reads (`actions: read`).
  The API is `GITHUB_API_URL`, else `https://api.github.com`. A run file's storage redirect is
  followed without the token.

The tests in `test/test-times-record.test.mjs` and `test/test-times-read.test.mjs` prove each of
these. Their fixtures under `test/fixtures/test-times/` lie outside `test/*.test.mjs`, and
`fail.test.mjs` is meant to fail.
