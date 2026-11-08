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
  first, so it watches before it refuses.
- **`apply-ruleset.mjs`** prints how the live ruleset differs from the file, with no flag.
  `--apply` writes the file's version, and only to the ruleset of that name: a security
  setting, so this is Ben's own command, run after the merge (decisions 121, 177). Before
  writing it checks the file and checks that dazzer-io/.github's live repository id is the one
  the file names, and after writing it reads the ruleset back. `--readings [--moving a,b]
  [--only a,b] [--class production]` runs the judge over every private, non-archived
  repository's workflow folder at its default branch, read with `gh`. It follows every call at
  the ref it names, up to GitHub's ten levels, and lists each refusal. `--class production`
  keeps only refusals in workflows that sign in.

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

A file whose jobs could not be read is refused, never passed.

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
  that calls a reusable workflow is refused, since its machine cannot be read.
- **A workflow that does not sign in** reads no `LOCKED_` setting (decision 9).
- **A job holding a write token on a pull request** names a literal GitHub standard label
  (`ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`) and reads no setting (decision 36). The same
  holds in dazzer-io/.github whatever starts the job. With no `permissions:` key, the job holds
  the repository's default token, which counts as a write.
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
  A private repository that reads no setting needs no entry for its literal-label jobs; `--moving`
  reads it as though it did (decision 16).
- **A public repository**: every job but the shared scans' names a literal GitHub standard label
  and reads no setting (decision 104).
- **The shared scans** (`codeql.yml`, `security-scan.yml` of dazzer-io/.github) are the only
  workflows that read `SCAN_RUNNER_<N>` (decisions 98, 119, 160). Elsewhere that read is refused,
  however it is spelled and wherever it hides (a job's outputs, a matrix row, an input's
  default, the workflow's top), including in a workflow a call reaches at another ref. Each
  scan job that does not write:
  - reads exactly `${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}` (decision 93);
  - holds no secret, declared or read;
  - checks out with `persist-credentials: false`.

  Its write-token jobs and `codeql.yml`'s one final check run on GitHub's standard machine,
  read no setting and are named in kept.json (decisions 36, 135, r-1.58).
- **dazzer-app's stricter class** (`strict.json`, decision 54): a job off a literal GitHub label
  holds no more than the code. That means no secret, no hand-on of the workflow's token, no
  permission of its own and no checkout keeping a git credential. Its workflow's top grants
  exactly `contents: read` and names no secret or token.

## Calls (decision 171)

A job may call only dazzer-io/.github's shared workflows (`codeql.yml`, `security-scan.yml`,
`engineer-review.yml`), spelled exactly, at `main`. `engineer-review.yml` alone may also be
called at a commit that GitHub's compare of `main...<commit>` reads as behind or identical, as
`engineer-review/decide.mjs`'s `confirmOnMain` holds.

- **Keys:** the calling job holds `uses`, `permissions` and `with` alone.
- **Permissions:** it writes its own `permissions:`, at most what the called workflow's jobs
  use.
- **Inputs:** it hands only inputs the workflow declares.
- **Settings:** it reads no `CHECKS_`, `SCAN_` or `LOCKED_` setting.
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
    may hand `CHECKS_RUNNER_<N>` on in a step's `env` (decision 34).
  - `checks`: judged as a change check, naming the writes it may hold (decision 47).
  - `canary`: runners' `canary.yml` alone. It is started by hand, under `contents: read`, with
    no secret, on our own sets named literally (decision 50).

  An entry is whole-file (`jobs`, every job id of its file, effect `stay` or `canary`) or one
  job (`job` and `name`). A job entry carries the name GitHub shows, as the readings match it.
  An entry naming a job or file not there yet is a note, not a refusal; a job beside those a
  whole-file entry lists is judged like any other.
- **`secrets.json`**: the secrets a change check may read, per repository (decision 121).
- **`strict.json`**: the repositories held to the stricter class (decision 54).

## Left out

- **dazzer-app's pin of the shared scan's languages.** It belongs to that repository's caller,
  not to the machine rule.
- **dazzer-app's hand reader's refusals of spellings the `yaml` package reads alike.** Decision
  42 reads every workflow with the package.
- **runners' list of built-in labels** (decision 24).
- **dazzer's tree-level "nothing read" refusal.** A folder with no workflows is said as nothing
  to judge (decision 142).
