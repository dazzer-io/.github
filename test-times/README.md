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
| `record.mjs` | The format's writer and reader: `parseRecord`, `readRunFile` (unzips a downloaded run file with `node:zlib`, stored and deflated entries only), `compareRecords`, `gitBlob`, `Recorder`. And the readers' contract: `jobOf`, `pairRecords`, `ranNoTest`, `jobsOfRun` (attempts and matrix legs), `jobGroups`, `groupTimes`, `KEEP_STEP`. Every other reader imports these, so none rebuilds them. |
| `read.mjs` | The reader's command line and its GitHub reads. |
| `plan.mjs` | The planner: deals test files into parts by their recorded time, and counts parts. A module (`deal`, `count`, `weigh`, `checkDeal`, `loadHistory`, `dealLine`) and a command line. |
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
- **A file that fails as a file** has a failing test line named `(the file itself)`
  (`FILE_ITSELF` in record.mjs), so the record and its end line's count say the file failed:
  - Node's runner: the file threw on import, its process crashed, or it exited non-zero after
    its tests. Its `ms` is the file's own time;
  - vitest: the module reported errors of its own, as when it fails to collect. Its `ms` is the
    module's time;
  - Playwright: the spec failed to load and was reported through `onError`. Its `ms` is null
    and its group null, because no project ran it.
- **A test's `ms`** is null where the runner gives no duration, as vitest does for a skipped
  test.
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
  their `node:timers/promises` forms, each call counted once. Only the process's own code
  counts. Calls made straight from Node's own internals are left out, such as the test
  harness's keep-alive interval on its way out. So are calls from code under `node_modules`,
  such as vitest's own per-test and per-hook timeouts, armed through its safe timers.
- **The touch preload** writes a line the moment its process first does each kind, and one at
  exit with its waits. It sets no signal listener, so a process dies exactly as it would
  without it. A process killed by a signal has said its kinds, and its waits are unknown. So
  `waits_ms` is known only when every process that wrote a line, for the file or in job scope for
  the job, also wrote its exit line; one without makes it null. The runner's own process marks itself,
  and its lines are dropped. So under `node --test --test-isolation=none` (Node 22:
  `--experimental-test-isolation=none`), where the tests run in the runner's own process,
  `waits_ms` is null: the tests' own waits never reach the record (record.mjs `testsInRunner`).
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
  - Playwright's `fullyParallel` is not read, because it says whether one file's tests may spread over several workers, not how many files run side by side: files run side by side up to the workers count under either setting.
- **Complete:** a record is complete only with an end line saying so whose counts match the
  lines it holds. A record with no end line stopped partway. Readers read only version 1, never
  take a time from an incomplete record, and count any other version as unreadable.
- **One runner per job.** A runner leaves `<record file>.started` when it starts. A second
  runner starting in the same job records nothing of its own and ends the job's record
  incomplete: `a second test runner started in this job; a job keeps one runner's record`. The
  first runner's lines are kept, or its run line alone when the second runner emptied the file,
  as Node's runner does to its destination.
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
        timeout-minutes: <this repository's number, with the reading it rests on>
        run: |
          git clone --quiet --filter=blob:none https://github.com/dazzer-io/.github "$RUNNER_TEMP/test-times-src"
          git -C "$RUNNER_TEMP/test-times-src" checkout --quiet "$TEST_TIMES_SHA"
          node "$RUNNER_TEMP/test-times-src/test-times/setup.mjs" >> "$GITHUB_ENV"

      # ... the tests, their runner wired as below ...

      - name: Finish the test times
        id: test-times
        if: always()
        continue-on-error: true
        timeout-minutes: <this repository's number, with the reading it rests on>
        run: node "$TEST_TIMES_DIR/finish.mjs" >> "$GITHUB_OUTPUT"

      - name: Keep the test times
        if: always()
        continue-on-error: true
        timeout-minutes: <this repository's number, with the reading it rests on>
        uses: actions/upload-artifact@<commit, pinned as the repository pins it>
        with:
          name: ${{ steps.test-times.outputs.name }}
          path: ${{ env.TEST_TIMES_FILE }}
          overwrite: true
```

- **Each of the three steps also carries a step-level `timeout-minutes`.** A clone or upload that
  stalls never ends, so `continue-on-error` never absorbs it, and the job fails at its own limit.
  Each repository states its number beside the step with the reading it rests on, never typed
  bare; this README names none.
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

- **vitest.** vitest evaluates a config file more than once in one process (each project with
  `extends: true` loads it again), and a later evaluation finds the environment already emptied.
  So the first evaluation keeps the pair on `globalThis` for the life of the process, and later
  ones read it from there:

  ```js
  const KEPT = Symbol.for('dazzer.test-times');
  const dir = process.env.TEST_TIMES_DIR; const file = process.env.TEST_TIMES_FILE;
  delete process.env.TEST_TIMES_DIR; delete process.env.TEST_TIMES_FILE;
  if (dir && file) globalThis[KEPT] = { dir, file };
  const times = globalThis[KEPT];
  // only when times is set:
  reporters: [
    'default', ...(process.env.GITHUB_ACTIONS === 'true' ? ['github-actions'] : []),
    [`${times.dir}/vitest-reporter.mjs`, { file: times.file }],
  ],
  execArgv: [`--import=${times.dir}/touch.mjs?out=${times.file}.touch`],   // the process pool's
  ```

  Setting `reporters` replaces vitest's default, so the list spells that default out: `default`,
  and `github-actions` when `GITHUB_ACTIONS` is `"true"`. A config that set its own reporters
  keeps those in their place.

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
  - `files[path]` is a list with one entry per group the path was recorded under, ordered by
    group with null first: `{"group","ms","workers","serial","n"}`, where `ms` is the median
    over the complete records of that file in that group, `workers` and `serial` come from its
    newest record in that group, and `n` counts the records the median rests on. No single entry
    is ever picked from several groups (spec-split.md, D12).
  - `jobs[group]` holds `ms` (the median of the group's longest job), `setup_ms` (the median of
    job time minus record span) and `n`.
  - `--job-prefix` limits which jobs feed `files`; `jobs` always holds every group.
  - With `--allow-none`, any read error, a refused call or a download that broke off alike,
    still writes the file, with `"source":"none"` and why, prints
    `::warning title=test-times history::could not read: ...`, and exits 0. It covers reading
    only: arguments it does not take, an `--out` it cannot write, and an error while making the
    history from records it did read still exit 2 with `could not read: ...`.
- **`--slowest <group>` and `--not-slowest <group>`, with `[--ignore <group>]...`,** compare each
  group's median time over the newest ten successful runs. The one that fails exits 1 with
  `<group> sets the wait: <x> min against <group> <y> min`.
  - A named group with no job in the runs read fails either mode: `<group> has no job in the N runs read`.
  - `--not-slowest` with no other group left, once the ignored ones are out, exits 1 with `<group> sets the wait: <x> min against no other group`, because a group alone is the longest.
- **Exit 2** says `could not read: <what refused>`: GitHub refused a call, a run file could not
  be opened or broke off while downloading, a run file had expired
  (`could not read: run file <name> expired`), there was no token, or the arguments were wrong.
  A read that could not be made never passes.

**How it reads:**

- **Attempts.** For each job, the newest attempt that left a complete record counts. A later
  attempt that left none, or ran no test, never hides it.
- **Matrix legs.** Jobs of one attempt that share a name, as a matrix's legs may, are separate
  jobs. An attempt is complete only when none of its legs left an incomplete record, so one
  incomplete leg fails `--require-complete`, saying `<name> on <runner>: <why>`.
- **Ran no test.** A job that succeeded and whose record says `the test runner never started`
  ran no test and owes none.
- **Pairing.** A record pairs with the job whose runner name and attempt match and whose start
  and end hold the record's, allowing a second for GitHub's whole-second times.
- **Groups.**
  - A job that kept a record is grouped by its job id (`job_key`).
  - A job that kept none is grouped by the job id its name carried in any run read, so one
    missing upload never splits a matrix; failing that, by its name.
  - A group's time in a run is its longest job's: the longest leg of the newest attempt that
    ran, from that job's start to its end.
- **The touch path** rides the preload's import address. Each well-formed `%XX` in it is
  decoded and a raw `%` that starts none is kept as written, so no path makes a reporter or the
  preload throw.
- **Token.** `GITHUB_TOKEN` or `GH_TOKEN`, else `gh auth token`. It only reads (`actions: read`).
  The API is `GITHUB_API_URL`, else `https://api.github.com`. A run file's storage redirect is
  followed without the token.

## Dealing tests into parts: `plan.mjs`

```
node plan.mjs --history <file or folder> --files <file> --parts <n> [--part <i> --out <file>] [--deal <file>] [--lane <job group>]
node plan.mjs --history <file or folder> --count --lane <job group> [--ignore <job group>]...
node plan.mjs --history <file or folder> --count --group <name> --under <ms>
```

`--files` holds every test file the runner discovered at the run's commit, one `<path>\t<group>`
per line; a line with no tab, or an empty group, is a file of no group. A file listed twice is
refused: `a file was discovered twice: <file>`.

- **The history.** `--history` is the file `read.mjs --history` wrote, or a folder of them at
  any depth, as `actions/download-artifact` leaves them by pattern. From a folder it takes the
  one whose `attempt` is the highest not above `GITHUB_RUN_ATTEMPT` (with none set, the
  highest), so a part re-run alone deals the deal its first attempt dealt. None fitting is
  refused, and so are two different files of one attempt.
- **The deal**, `deal({ files, history, parts, lane })`:
  - **weights:** a file is matched to the history entry with its own path and group; it weighs
    that entry's `ms` divided by its `workers`, or its whole `ms` when it is `serial`. A file with
    no history weighs the median of the known weights, and is serial when the known files of its
    group are. With no history at all every file weighs the same and the time is unknown;
  - **order:** heaviest first, ties by path, then group (null first);
  - **placement:** each file onto the part with the least total so far, ties to the lower part;
  - **prediction:** each part's total plus the lane's `setup_ms` from `history.jobs[lane]`; with no
    `--lane`, or none recorded, the set-up is unknown;
  - **every file exactly once:** the parts are checked against the discovered files, and a deal
    that misses one, holds one twice or holds one never discovered is refused, exit 1:
    `the deal does not hold every file exactly once: <file>`.

  The same inputs, in any order, give the same deal, so every part computes the whole deal from
  the one history file and takes its own share.
- **The hash** is the SHA-256 of the parts' file lists, each file `[path, group]` and each list
  sorted by path then group, as JSON, in part order. Its first 16 characters are printed.
- **What it prints:** the history it rests on (its files, runs, attempt, the first 16 characters
  of its own SHA-256 and its path, or `none` and why), then per part its file count, its
  predicted time and how many of its files have history, then `deal <hash>`. A part holding one
  file that is the slowest part says `<file> alone sets the wait`.
- **What it writes,** with `--part <i>`: to `--out`, part i's paths, one per line, each path once;
  to `--deal`, the record's deal line, `{"type":"deal","parts","part","files","discovered",
  "discovered_count","history"}`, where `files` holds one path per dealt file, `discovered` is
  the SHA-256 of every discovered `[path, group]`, sorted, as JSON, and `history` the SHA-256 of
  the history file's bytes. A part passes `<record file>.deal` as `--deal`, and the adapter copies
  the line into the record.
- **How many parts**, `--count --lane <job group> [--ignore <job group>]...`: the smallest count
  whose predicted slowest part, set-up included where it is recorded, is no longer than the
  longest median of the other job groups in `history.jobs`, leaving out the lane's own and those
  ignored. The lane's files are every file in the history, so the plan job limits them to the
  lane's jobs with `read.mjs --job-prefix`. With no history, or no other group, one.
- **How many shares**, `--count --group <name> --under <ms>`: the smallest count whose slowest
  share of that group's recorded files is no longer than `--under`.
- Where no count gets under its figure, the count stops at the smallest one at the lowest slowest
  part, and says `<file> alone sets the wait`. The counts print the count and the slowest part
  against the figure it was held to, and append `count=<n>` and `parts=[1,…,n]` to
  `$GITHUB_OUTPUT` when that is set.
- **Exit codes:** 0 dealt or counted; 1 refused, saying why; 2 `plan.mjs: <what is wrong>` for
  arguments it does not take.

The tests in `test/test-times-record.test.mjs`, `test/test-times-read.test.mjs` and
`test/test-times-plan.test.mjs` prove each of these. Their fixtures under
`test/fixtures/test-times/` lie outside `test/*.test.mjs`, and `fail.test.mjs` is meant to fail.
The planner's stored deal, `expected-deal.json`, was worked out by hand from `history.json` and
`files.tsv`, not written by the planner. The files that fail as files are written by the test into a
temporary folder. Each child the tests start gets an environment built from a short list, so
the suite answers the same on a GitHub runner as on a laptop.
