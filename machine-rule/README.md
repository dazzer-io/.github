# The machine rule

`judge.mjs` is the organisation's one rule on which job of a dazzer-io repository may run on
which of our machines, and which must stay on GitHub's (decision 121). It was held four times
before, each copy a little different: dazzer's gate (`scripts/checks/check-runner-setting.mjs`),
dazzer-app's verdict test (`holdsMoreThanTheCode`), this repository's runs-on test, which
`test/machine-rule.test.mjs` replaces, and runners' repository reader
(`bin/check-repos-read-setting.mjs`). Those copies give way to
this one in their own tasks (r-3.25, r-3.26, r-1.59); this file says each rule and the decision
behind it.

```
node machine-rule/judge.mjs --repository <owner>/<name> --visibility <public|private|internal> [--moving] <folder>
```

Exit 0 means nothing was refused; a folder with no `.github/workflows` is said as `NOTHING TO
JUDGE`, never as clean. Exit 1 means at least one refusal, each a line
`.github/workflows/<file>:<line> jobs.<id>: <why>` saying what to write instead. Exit 2 means the
answer is unknown: a list here fails its own check, a folder is read as dazzer-io/.github though
its origin does not say so, or GitHub could not be asked about a commit.

## Where it runs

- **`.github/workflows/machine-rule.yml`** runs the judge, then actionlint, on a pull request's
  or merge queue entry's workflow folder. It runs on the literal `ubuntu-latest`, a job of under
  a minute that reads no setting, so it stays off our machines in public repositories, where the
  fallback watcher does not read the runs (decision 104). Its token reads the code alone, it
  holds no secret, and both checkouts keep no git credential. The rule is checked out of
  `job.workflow_repository` at `job.workflow_sha`, its own commit, and the change at its head
  commit. actionlint is a pinned release, checked by its SHA-256 before it runs, with shellcheck
  and pyflakes off. Its one ignore is narrow: actionlint 1.7.12 does not know the job context's
  `workflow_repository` and `workflow_sha`, which GitHub gives.
- **The ruleset `machine-rule-required`** (`ruleset.json`) is a workflows rule. It runs that
  file, read from dazzer-io/.github by its repository id at `refs/heads/main`, on the default
  branch of every repository, and not when a branch is created. It is written in `evaluate`
  first, so it watches before it refuses. Every repository is `~ALL` with nothing excluded and
  no `protected: true`: GitHub refuses that pairing with 422 ("Protected repository name
  conditions cannot include `~ALL`"), and a renamed repository stays in `~ALL` anyway, so the
  check refuses the pairing in GitHub's words, and the read-back counts a `protected` read back
  as false the same as the file leaving it out (decision 187).
- **`apply-ruleset.mjs`** prints how the live ruleset differs from the file, with no flag.
  `--apply` writes the file's version, and only to the ruleset of that name: a security
  setting, so this is Ben's own command, run after the merge (decisions 121, 177). Before
  writing it checks the file and checks that dazzer-io/.github's live repository id is the one
  the file names, and after writing it reads the ruleset back. `--readings [--moving a,b]
  [--only a,b] [--class production]` runs the judge over every private, non-archived
  repository's workflow folder at its default branch, read with `gh`. It follows every call at
  the ref it names, up to GitHub's ten levels, and lists each refusal. A workflow a call reaches
  is refused there when it holds a spelling this rule refuses, reads a `SCAN_` setting, or calls
  a shared scan not spelled exactly at `main`, at whatever level (runners' switch-on S6).
  `--class production` keeps only refusals in workflows that sign in.

## Reading a workflow (decision 42)

Workflows are read by the `yaml` package's `parseDocument`, pinned at exactly 2.9.1 and
installed with `npm ci --ignore-scripts`. No hand-written YAML reader is kept. A spelling that
another parser, GitHub's among them, could read another way is refused with its line:

- **What the parser flags or this rule cannot place:** every error and warning the parser
  raises (a duplicate key, a second document); anchors, aliases, tags, explicit keys,
  directives and merge keys.
- **Keys that may not be what GitHub reads:** a key written twice in another letter case, a key
  GitHub reads written in another case, and a double-quoted key holding a backslash.
- **Flows:** a step or block-list entry written as a flow, and `steps:` written as a flow.
- **Characters:** a line break this parser does not count (a lone carriage return, U+0085,
  U+2028, U+2029), a byte order mark anywhere but the file's first character, and a control
  character.
- **Expressions:** a `${{` never closed, and a backslash inside `${{ }}`.
- **Layout:** `jobs:` at column zero, each job id plain and two spaces in, with the job spans the
  line reader gives matching the parser's, and `on:` triggers two spaces in.

A file whose jobs could not be read is refused, never passed, and so is a workflow naming no
trigger this rule can read, in every repository (decision 181): nothing then says when its jobs
run or which class they are in.

Every `${{ }}` is read by GitHub's expression grammar. A job's `runs-on` is read route by route
(each side of `||`, the last side of `&&`, `needs.<job>.outputs`, `matrix.<key>`, `inputs.<key>`),
and a quoted label may stand only as the final `||` fallback. A `vars` read is seen in any case:
by name, by index, whole or by a computed name.

## The settings

The organisation declares `CHECKS_RUNNER_2`, `CHECKS_RUNNER_8`, `CHECKS_RUNNER_16`,
`LOCKED_RUNNER_2`, `LOCKED_RUNNER_8` and `SCAN_RUNNER_2` (runners' `org/settings.json`). A setting
it does not declare is empty for ever, so reading one is refused.

- **A setting read as a job's machine carries GitHub's machine of the same width as its
  fallback** (decision 15): `${{ vars.CHECKS_RUNNER_8 || 'ubuntu-8-core' }}`. A setting with no
  fallback, a fallback of another width, or a fallback that is not GitHub's machine is refused,
  so an empty setting always means GitHub's machine.
- **None of our own machines is named literally** (`dazzer-<set>-<N>-core`). The watcher empties
  the setting to send a waiting job back to GitHub's, and it cannot move a literal label. The
  one exception is the canary, below.

## The classes

Every job meets every class below, whatever its shape: a job naming its machine, a job that calls
a shared workflow, and a job kept.json keeps, by any effect (decision 184). A class's rule on the
machine reads a job that names one; its rule on what a job reads, holds and signs in for reads
every job, its workflow's top included. A kept.json effect admits a job only where its decision
did: `stay` keeps a job of a workflow that signs in on GitHub's machine (decisions 9, 40),
`canary` keeps runners' canary on our sets named literally (decision 50), and `checks` moves a
job onto the change-check machines (decision 47). No effect lifts the write-token class or the
public one.

- **A workflow that signs in** (`id-token: write`, `write-all` or an `environment`) reads no
  `CHECKS_` or `SCAN_` setting. Each of its jobs reads the locked setting in its `runs-on`,
  held to main: `${{ github.ref == 'refs/heads/main' && vars.LOCKED_RUNNER_<N> || '<GitHub's
  machine>' }}`, and nowhere else (decisions 9, 23, 40). Unless kept.json keeps it on GitHub,
  such a workflow is refused when it is started:
  - by `pull_request_target` or `workflow_run`, where `github.ref` is the default branch
    whatever started the run;
  - by a tag (a push of tags, an unfiltered push, a push filtered by paths alone, `release`,
    `create`, `deployment`, `deployment_status`, `registry_package`).

  A tag can name any commit, so it cannot be held to main-line code. A job of such a workflow
  that calls a reusable workflow is refused, since its machine cannot be read. A job kept on
  GitHub here hands no `CHECKS_` setting on, not even in a step's `env`.
- **A workflow that does not sign in** reads no `LOCKED_` setting (decision 9).
- **A job holding a write token on a pull request** names a literal GitHub standard label
  (`ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`) and reads no setting (decision 36). The same
  holds in dazzer-io/.github whatever starts the job. With no `permissions:` key, the job holds
  the repository's default token, which counts as a write. A job kept on GitHub in a workflow
  any of whose jobs holds a write, or on `pull_request_target`, hands no `CHECKS_` setting on,
  not even in a step's `env`. A checks entry does not lift it: it admits a write only for a job
  no pull request starts, in a private repository, as brain-builder's push-started release tag
  job holds one (decision 47). A call on `pull_request_target` is refused, since every job there
  holds a write token and a call names no machine.
- **A change check**, a job of a pull-request workflow in a private repository whose workflows
  read a `CHECKS_` or `LOCKED_` setting, reaches `CHECKS_RUNNER_<N>` on every route (decision
  15). It is never on `pull_request_target`, and holds no write unless its kept.json entry has
  the effect `checks` and names that write (decision 47). It reads only the secrets
  `secrets.json` names for its repository, beside `GITHUB_TOKEN`, and never the whole secrets
  context or a secret looked up by a computed name (decision 121, from dazzer's
  `CHANGE_CHECK_SECRETS`).
- **Unclassified.** In such a repository, a job of a workflow that neither signs in nor runs on
  `pull_request` is refused unless kept.json names it. So is a job on a literal GitHub label:
  either it reads its setting or it is kept on GitHub by a decision of its own (decisions 15, 16).
  A job calling a shared workflow is classed the same way, and no kept.json entry keeps a call
  (decision 181). A private repository that reads no setting needs no entry for its
  literal-label jobs; `--moving` reads it as though it did (decision 16).
- **A public repository**: every job but the shared scans', whatever keeps it, names a literal
  GitHub standard label and reads no setting, a `LOCKED_` one included (decision 104). A call
  reads none either.
- **The shared scans** (`codeql.yml`, `security-scan.yml` of dazzer-io/.github) are the only
  workflows that read `SCAN_RUNNER_<N>` (decisions 98, 119, 160). Elsewhere that read is refused,
  however it is spelled and wherever it hides (a job's outputs, a matrix row, an input's
  default, the workflow's top), including in a workflow a call reaches at another ref. Each
  scan job that does not write:
  - reads exactly `${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}` (decision 93);
  - holds no secret, declared or read;
  - checks out with `persist-credentials: false`.

  Its write-token jobs and `codeql.yml`'s one final check run on GitHub's standard machine,
  read no setting and are named in kept.json (decisions 36, 135, r-1.58). In dazzer-io/.github
  no other job, a call included, reads a `vars` name spelled as a setting is (`CHECKS_`,
  `SCAN_` or `LOCKED_` and anything after), declared or not, as its runs-on test held.
- **dazzer-app's stricter class** (`strict.json`, decision 54): every job not on the literal
  `ubuntu-latest`, whatever its class, holds no more than the code; `ubuntu-24.04` and
  `ubuntu-22.04` are held too, as `holdsMoreThanTheCode` held them (decision 181). That means no
  secret, no hand-on of the workflow's token, no permission of its own and no checkout keeping a
  git credential. A call is held the same way: it names no secret or token on any of its lines,
  and it asks a grant only as `codeql.yml`'s job `codeql` calling the shared scan, file and job
  both (`holdsMoreThanTheCode`, verdict.test.ts:1248, 1258; decision 184). Its workflow's top
  grants exactly `contents: read` and names no secret or token.

## Calls (decision 171)

A job may call only those of dazzer-io/.github's shared workflows (`codeql.yml`,
`security-scan.yml`, `engineer-review.yml`) that declare `workflow_call`, spelled exactly, at
`main`. Today `codeql.yml` and `engineer-review.yml` declare it; a call of `security-scan.yml`,
which does not, is refused, as GitHub refuses to run it. `engineer-review.yml` alone may also be
called at a commit that GitHub's compare of `main...<commit>` reads as behind or identical, as
`engineer-review/decide.mjs`'s `confirmOnMain` holds.

- **Keys:** the calling job holds `uses`, `permissions` and `with` alone.
- **Permissions:** it writes its own `permissions:`, at most what the called workflow's jobs
  use.
- **Inputs:** it hands only inputs the workflow declares, and under `with:` it hands on no
  secret (by name, the whole context or a computed name) and not the workflow's token in any
  spelling (decisions 93, 171, 181).
- **Settings:** it reads no `CHECKS_`, `SCAN_` or `LOCKED_` setting, in the call or in its
  workflow's top.
- **Class:** it meets every class rule any other job does, its workflow's top included
  (decisions 181, 184): what it reads, holds and signs in for, as the classes above say. It names
  no machine and holds no steps (decision 129), so no rule on a machine or a step reads it; the
  jobs it calls are judged in dazzer-io/.github, where they run. A call on `pull_request_target`
  is refused in every repository; in a repository whose workflows read a setting, a call from a
  workflow that neither signs in nor runs on `pull_request` is unclassified and refused, and no
  kept.json entry keeps a call.
- **CodeQL:** a call of `codeql.yml` is the job `codeql`, so its required check is
  `codeql / CodeQL complete`.

A call of a workflow of its own repository (`./` or `$/`), of another repository, or of another
owner is refused, since the machine its jobs run on cannot be read here. In dazzer-io/.github, no
workflow but the two scans calls a scan (decision 93).

## The lists

The lists are read from this folder, never from the repository judged, so a repository cannot
widen them from its own pull request. Each list is checked before it is used, and a list that
fails its check leaves the rule unread.

- **`kept.json`**: the jobs kept on GitHub's computers. Each entry carries its repository,
  workflow, reason, decision and source, and one of three effects:
  - `stay`: on a literal GitHub standard label, reading no setting as its machine. A plan job
    may hand `CHECKS_RUNNER_<N>` on in a step's `env` (decision 34), only in a workflow that
    neither signs in nor holds a write token, as dazzer-app's `ci.yml` and `split-trial.yml`
    are (decisions 9, 23, 36, 181).
  - `checks`: judged as a change check after every class rule, naming the writes it may hold,
    which it holds only off a pull request in a private repository (decision 47).
  - `canary`: runners' `canary.yml` alone. It is started by hand, under `contents: read`, with
    no secret, on our own sets named literally (decision 50).

  An entry is whole-file (`jobs`, every job id of its file, effect `stay` or `canary`) or one
  job (`job` and `name`). A stay entry carries the name GitHub shows, as the readings match it, a
  fixed string holding no expression. A checks entry carries its job's `name:` as written, a
  matrix expression included, since the readings leave checks entries out (decisions 142, 154,
  182).
  An entry naming a job or file not there yet is a note, not a refusal; a job beside those a
  whole-file entry lists is judged like any other.
- **`secrets.json`**: the secrets a change check may read, per repository (decision 121).
- **`strict.json`**: the repositories held to the stricter class (decision 54).

## Left out

Each refusal one of the four older copies made and this rule does not is named here, under its
decision. So is each shape in which `test/machine-rule.test.mjs` does not rerun a class refusal,
where a decided admission applies (decision 184). Each line under a bullet is one spelling or
refusal, and a case of that test cites it by its words. Every other refusal of the older copies
has a case of its own there, citing the old file and line (decision 181).

- **The hand readers' refusals of spellings the `yaml` package reads alike** (decision 42):
  dazzer-app's `readSubset`, the runs-on test's plain subset (decision 99) and runners'
  `parseYaml` each refused what they could not read by hand. The package reads each of these as
  GitHub does, and drops comments as GitHub drops them:
  - a tab between a key and its value
  - a flow mapping, `on:` and `permissions:` included
  - a flow list over lines, `on:` included
  - a flow collection inside another
  - a plain value continued on a line indented under it
  - a quoted key
  - a space before a key's colon
  - a key that is not a plain name
  - a quoted top-level key
  - a double-quoted value holding a backslash
  - a doubled quote
  - a block header with an indentation digit
  - an empty `-` item
  - a leading `---`
  - a byte order mark opening the file
  - a closing `...`
  - a quoted `ubuntu-latest`
  - `permissions:` written as a list, which they counted as a write
- **The older copies' narrower call admissions** (decision 171, and decision 178 for
  `engineer-review/caller.yml`). The shared admission takes these calls, which an older copy
  refused:
  - a call at `refs/heads/main`, which dazzer's gate and dazzer-app's verdict test refused
  - a call of `engineer-review.yml` outside a repository strict.json names, which dazzer's gate
    read as a change check calling a workflow
  - a call of `engineer-review.yml` from another workflow of dazzer-io/.github, which the runs-on
    test refused
  - a call from a repository outside runners' five, which runners' reader refused
- **dazzer-app's line-for-line pin of its call of the shared scan** (decision 153). Its
  languages and its exact grant belong to that repository's caller, not to the machine rule, and
  r-3.26 keeps them in dazzer-app:
  - languages other than the pin's
  - a grant less than the pin's
- **dazzer's tree-level refusals** (decision 142). A folder with no workflows is said as nothing
  to judge, never as clean:
  - a tree holding no change-check job
  - a tree holding no production job
  - a tree with no workflow folder
- **runners' allowed list, held to its five repositories** (decisions 16 and 121). kept.json
  names any dazzer-io repository, and a private repository that reads no setting needs no entry
  for its literal-label jobs:
  - a literal-label job of a private repository that reads no setting, named by no entry
  - an entry outside its five repositories
- **runners' list of built-in labels** (decision 24):
  - a built-in label
- **A call's machine and steps** (decision 129, and decision 171 for its keys). A job that only
  calls an admitted shared workflow names no runs-on and holds no steps. The jobs it calls are
  judged in dazzer-io/.github, where they run. So no call is refused for what only a machine or a
  step holds:
  - a refusal of the job's runs-on, or of its having none
  - a refusal of a step, a checkout keeping its credential or CodeQL's own scan steps
- **A change check's secrets list, for a call** (decision 93). A call hands on no secret at all,
  whatever secrets.json names for its repository, and a workflow's top-level env does not reach
  the workflow it calls. So secrets.json is not read for a call:
  - a change check's secret that secrets.json does not name
- **The unclassified and literal-label refusals, for a job a checks entry keeps** (decision 47).
  The entry is the decision that its job runs as a change check, so the job is not refused for
  having none. It is judged as a change check beside every class rule:
  - a refusal that kept.json names no entry for the job
