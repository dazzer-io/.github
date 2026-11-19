# The machine rule

`judge.mjs` is the organisation's one rule on which job of a dazzer-io repository may run on
which of our machines, and which must stay on GitHub's. It was once held in four places, each
copy a little different; `test/machine-rule.test.mjs` holds this one to every refusal they made,
and this file says each rule and why.

```
node machine-rule/judge.mjs --repository <owner>/<name> --visibility <public|private|internal> [--moving] <folder>
```

Exit 0 means nothing was refused; a folder with no `.github/workflows` is said as `NOTHING TO
JUDGE`, never as clean. Exit 1 means at least one refusal, each a line
`.github/workflows/<file>:<line> jobs.<id>: <why>` saying what to write instead. Exit 2 means the
answer is unknown: a list here fails its own check, a folder is read as dazzer-io/.github though
its origin does not say so, or GitHub could not be asked about a commit.

## Where it runs

- **`.github/workflows/machine-rule.yml`** runs the judge, then two linters, on a pull request's
  or merge queue entry's workflow folder. It runs on the literal `ubuntu-latest`, a job of under
  a minute that reads no setting, so it stays off our machines in public repositories, where the
  fallback watcher does not read the runs. Its token reads the code alone, it holds no secret,
  and its one checkout, the change at its head commit, keeps no git credential.
- **`action.yml`** is the rule's building block: the workflow's steps, which the workflow calls
  as `dazzer-io/.github/machine-rule@main`, the ref the organisation rule already runs the
  workflow from (a second exception to pinning every call). GitHub fetches the
  block itself, with the whole repository at that ref, so `judge.mjs`, its lists, the YAML
  reader's package files and `zizmor.yml` stand beside it and the rule's own folder is never
  checked out: a checkout with the caller's token cannot read a private repository, and the
  internal checks are moving to a private home, `dazzer-io/checks`, the old repository renamed.
  The judge admits that call from either home during the move, `dazzer-io/.github` and
  `dazzer-io/checks`, exactly as `<home>/machine-rule@main`, and refuses it from anywhere else,
  at another ref, in another letter case or as a folder of the change. The change checks,
  `codeql.yml`, `security-scan.yml` and `engineer-review.yml`, stay public in dazzer-io/.github,
  so a call of them is admitted from dazzer-io/.github alone, and one at
  `dazzer-io/checks` is refused.
- **The job keeps `contents: read`.** A live trial read a private repository's workflow granted
  `permissions: {}` failing to fetch its own repository's action by `owner/repo/path@main` ("An
  action could not be found at the URI ..."), while another repository, which the home shares
  its actions with, fetched it. The likely reading is that the job's token held no contents
  read. So the machine rule's job keeps at least `contents: read`, or its call of its own block
  stops working once this repository is private; the private home must also share its actions
  with the organisation's repositories.
- **The linters** run in the block. actionlint is a pinned release, checked by its SHA-256
  before it runs, with shellcheck and pyflakes off. Its two ignores are narrow. actionlint 1.7.12
  does not know the job context's `workflow_repository` and `workflow_sha`, which GitHub gives
  and this repository's other workflows read. And actionlint knows GitHub's labels alone, so it
  calls each of our own sets unknown: the step drops its unknown-label error for exactly a name
  `judge.mjs`'s `OUR_MACHINE` matches, anchored at the message's start, and still reports any
  other label it does not know, so the judge alone rules where our names stand. zizmor is pinned
  and checked the same way, run offline and honouring no ignore comment, by `zizmor.yml`: it
  refuses only an action not pinned by commit, the organisation's own workflows and this block
  excepted, and counts its other findings without refusing them.
- **The ruleset `machine-rule-required`** (`ruleset.json`) is a workflows rule. It runs that
  file, read from dazzer-io/.github by its repository id at `refs/heads/main`, on the default
  branch of every repository but the two below, public ones included, and not when a branch is
  created. `machine-rule-required` is required (blocking): it is written `active`, so GitHub
  blocks a merge into a default branch it covers until the workflow has passed. A pull request
  whose machine rule check fails cannot merge into the default branch until a commit that passes
  it is pushed to the pull request; the check's refusal names the file, line and job to change.
  A direct push to a default branch it covers has not run the workflow, so it is taken to be
  refused: GitHub's rule-suite listing records no evaluate result for `machine-rule-required` on
  a push. Before it was made active, `--readings` over every repository's default branch refused
  nothing.
  It excludes exactly two repositories by name, each with its reason, held in one place,
  `EXCLUDED_REPOSITORIES` in `apply-ruleset.mjs`: each lands its default branch by a direct push
  by design, or holds no workflows to judge.

  Its check admits exactly that list as the exclude, and refuses any other exclude, an include
  narrower than `~ALL`, a bypass actor, and an enforcement other than `evaluate` or `active`; its
  test holds the file to `active`. The way back: an organisation owner writes `evaluate` in
  `ruleset.json` and runs `node machine-rule/apply-ruleset.mjs --apply`, or sets it in GitHub's
  organisation settings; in `evaluate` GitHub blocks nothing and records each merge it would have
  refused. Every repository is `~ALL` with no `protected: true`: GitHub refuses that pairing
  with 422 ("Protected repository name conditions cannot include `~ALL`"), and a renamed
  repository stays in `~ALL` anyway, so the check refuses the pairing in GitHub's words, and the
  read-back counts a `protected` read back as false the same as the file leaving it out.
- **The ruleset `main-spelling-refused`** (`main-spelling.json`) refuses the creation of a branch
  spelled main in other letters in the three repositories the locked runner group
  `google-locked` admits. The third of them, the canary's repository, is admitted for one
  workflow alone, `locked-canary.yml`, dispatched by hand: `google-locked` admits it to the
  locked machines at `refs/heads/main` alone, and it is held to main only within the
  existing-branch bound, since a creation rule never touches a branch that is already there (Why
  `main-spelling-refused` comes first, below). The group's admission may match `refs/heads/main`
  without regard to case, so a branch named `MAIN` there must never be created either. It names
  the three by name, with `protected: true` so none can be renamed out of it, is `active`, names
  no bypass actor, and holds one rule, `creation`: only someone with bypass permission may create
  a branch it matches, and it names no one. Its refs are `refs/heads/M[Aa][Ii][Nn]`,
  `refs/heads/mA[Ii][Nn]`, `refs/heads/maI[Nn]` and `refs/heads/maiN`, with nothing excluded.
  GitHub reads a ruleset's patterns with fnmatch and `File::FNM_PATHNAME`, bracket classes
  included, and its pages say nothing of case. Matched case-sensitively, the four take exactly
  the fifteen other spellings of main and never `main` itself; folded, they take `main` too, and
  only creation is restricted, which never touches a push to a branch that is there. So it holds
  either way. Its check refuses a bypass actor, another repository, an exclude, a rule other than
  creation, and a pattern set that, matched case-sensitively, misses a spelling or matches
  `main`, and a wildcard, a complemented class or a backslash, whose names cannot be listed.
- **The ruleset `codeql-complete-required`** (`codeql-complete.json`) requires the shared scan's
  `codeql / CodeQL complete` before a merge to the default branch of the two repositories it
  names. It names them the same way, and its check refuses any other list:
  `codeql-complete-required` stays in the two repositories `codeql-complete.json` names alone,
  the canary's repository never among them. It names no bypass actor, includes
  `~DEFAULT_BRANCH`, and holds one `required_status_checks` rule: that one context from
  integration 15368, GitHub Actions, with `do_not_enforce_on_create: true` and the strict policy
  off, so a branch need not be up to date to merge. Its check refuses another context, another
  integration or none, and a bypass. Its check accepts `evaluate` or `active` and nothing else,
  and the file is held to `active` by its test. `codeql-complete-required` is required
  (blocking): it is written `active`, so a merge to the default branch of either repository
  without `codeql / CodeQL complete` is blocked. A direct push to the default branch of either
  repository is refused unless its commit already passed `codeql / CodeQL complete`, the same as
  their own rulesets already require: both repositories' own main-protection rulesets are active
  with no bypass and already require status checks on every update of the default branch, so
  this rule adds no new kind of refusal. It watched in `evaluate` first. The way back: an
  organisation owner sets `codeql-complete-required` to `evaluate` with a local edit of
  `codeql-complete.json` and `node machine-rule/apply-ruleset.mjs --apply`, or in GitHub's
  organisation settings; `main-spelling-refused` accepts only `active`.
- **Why `main-spelling-refused` comes first.** GitHub compares strings without regard to case
  (its expressions page: "GitHub ignores case when comparing strings"), so the guard
  `github.ref == 'refs/heads/main'` is true on a branch named `MAIN`. A creation rule never
  touches a branch that is already there, and the four patterns name ASCII letters alone, so the
  locked shape below, the guarded `LOCKED_` setting, reaches the two repositories `google-locked`
  admits beside the canary's alone, and is held to main there only once `main-spelling-refused`
  is live and the locked machines' switch-on finds no other spelling of main there, non-ASCII ones
  included. That read is the locked machines' switch-on gate, the one place a `LOCKED_` setting is
  written, which keeps every `LOCKED_` setting empty until then; this command reads no branch.
  The locked canary reads no `LOCKED_` setting: it names its sets literally, and the runner group
  admits it to them. In the canary's repository too, a creation rule never touches a branch that
  is already there, so the locked canary is held to main only once that repository's own reads
  find no branch spelled main in other letters there, ASCII or not: the routine settings apply
  refuses to write `google-locked`'s repository list while any repository it admits is not under
  a live `main-spelling-refused` creation rule or holds a branch spelled main in other letters,
  ASCII or not, and the locked machines' switch-on reads the same before the locked settings are
  written. This command reads neither. So the settings apply never writes a `google-locked`
  repository list naming a repository `main-spelling-refused` does not cover; a change made by
  hand in GitHub's settings is read by neither.
- **`apply-ruleset.mjs`** is the one command that writes these three rulesets. With no flag it
  reads each live ruleset and says, for each, how it differs from its file and exactly what
  `--apply` would do with it, closing on that list: each ruleset it would create, update or
  write again as it is, and each it would hold back. `node machine-rule/apply-ruleset.mjs
  --apply` writes each file's version, and only to the ruleset of its name, and reads each back
  at once: an update goes to the id the list names and is read back by it, a created one by the
  id in GitHub's answer to its creation. These are security settings, so this is an
  organisation owner's own command, run after the merge. Both read the organisation's rulesets
  across every page, once, before any write. Each kept ruleset stands alone: its file, its
  checks, its write and its read-back, every GitHub call about it inside its own containment. A
  refusal of one ruleset holds back that one alone and names it, while the others are still
  written and read back: a file that cannot be read or fails its check, dazzer-io/.github's live
  repository id differing from the one `ruleset.json` names, two live rulesets of one name, a
  write GitHub refuses with a 4xx, a write gh gets no answer to or GitHub answers with a 5xx,
  said as one that may have landed, or an answer GitHub does not give about that ruleset or
  gives with no object or no id in it. Exit 0 means every ruleset is its file's version, after
  the writes for `--apply`; exit 1 means one or more were held back or differ, each named, or,
  for the read, that `--apply` would change one; exit 2 means GitHub could not be read at all:
  the organisation's rulesets could not be listed, so nothing was written. `--readings [--moving
  a,b] [--only a,b] [--class production]` runs the judge over every private, non-archived
  repository's workflow folder at its default branch, read with `gh`. It follows every call at
  the ref it names, up to GitHub's ten levels, and lists each refusal. A workflow a call reaches
  is refused there when it holds a spelling this rule refuses, reads a `SCAN_` setting, or calls
  a shared scan not spelled exactly at `main`, at whatever level. `--class production` keeps
  only refusals in workflows that sign in.

## Reading a workflow

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
trigger this rule can read, in every repository: nothing then says when its jobs run or which
class they are in.

Every `${{ }}` is read by GitHub's expression grammar. A job's `runs-on` is read route by route
(each side of `||`, the last side of `&&`, `needs.<job>.outputs`, `matrix.<key>`, `inputs.<key>`),
and a quoted label may stand only as the final `||` fallback. A `vars` read is seen in any case:
by name, by index, whole or by a computed name.

## The settings

The organisation declares `CHECKS_RUNNER_2`, `CHECKS_RUNNER_8`, `CHECKS_RUNNER_16`,
`LOCKED_RUNNER_2`, `LOCKED_RUNNER_8` and `SCAN_RUNNER_2`, and the rule declares beside them the
locked settings' new names, `LOCKED_MACHINE_2` and `LOCKED_MACHINE_8` (below). A setting it does
not declare is empty for ever, so reading one is refused.

- **The locked settings have two names.**
  - `LOCKED_RUNNER_2` and `LOCKED_RUNNER_8` are the old names. Every commit before the rename
    reads them, so once they were written, a re-run, a queued job or a deployment at any such
    commit would take a locked machine with a file no reviewer read for the switch.
  - `LOCKED_MACHINE_2` and `LOCKED_MACHINE_8` are the new names, which no commit held before
    the rename. From the rename on, the locked machines' switch writes the new names alone, and
    refuses while an old one exists; from then, a run at an older commit reads names the switch
    never sets, so it stays on GitHub's machines, whatever its age. This repository does not see
    that switch; it holds the names a workflow reads.
  - The rule holds the new names exactly as the old: read in a job's `runs-on` alone, behind
    `github.ref == 'refs/heads/main'`, declared, and as wide as the fallback (the classes,
    below). It still judges the old names as it did, so a workflow not yet renamed reads as
    before. The refusals of how a job reads the locked setting say where a name it reads is old,
    and give its new name, of the same width, after the fix each refusal gives: a job of a
    workflow that signs in reading it without the main guard, outside its `runs-on`, or with a
    fallback that is not GitHub's machine or of another width, and a job of a workflow that does
    not sign in reading it. Any other refusal naming an old name, a public repository's among
    them, names it as it names any setting, with no word that it is old.

- **A setting read as a job's machine carries GitHub's machine of the same width as its
  fallback**: `${{ vars.CHECKS_RUNNER_8 || 'ubuntu-8-core' }}`. A setting with no fallback, a
  fallback of another width, or a fallback that is not GitHub's machine is refused, so an empty
  setting always means GitHub's machine. GitHub's machine here is a Linux one (`ubuntu-latest`,
  `ubuntu-24.04`, `ubuntu-22.04`, or `ubuntu-<N>-core`); `windows-latest` is never a fallback.
- **GitHub's Windows machine, `windows-latest`, stands only in a job a kept.json stay entry
  keeps** (a small paid Windows machine that runs only an application's own tests on one
  repository's pull requests). It is never one of GitHub's standard machines, so every class
  that asks for a standard label still refuses it, and with no entry it is refused as a machine
  named literally.
- **None of our own machines is named literally** (`dazzer-<set>-<N>-core`). The watcher empties
  the setting to send a waiting job back to GitHub's, and it cannot move a literal label. The
  one exception is the two canaries, below.

## The classes

Every job meets every class below, whatever its shape: a job naming its machine, a job that calls
a shared workflow, and a job kept.json keeps, by any effect. A class's rule on the machine reads
a job that names one; its rule on what a job reads, holds and signs in for reads every job, its
workflow's top included. A kept.json effect admits a job only where its entry's reason does:
`stay` keeps a job of a workflow that signs in on GitHub's machine, `canary` keeps the two
canaries on our sets named literally, and `checks` moves a job onto the change-check machines.
No effect lifts the write-token class or the public one.

- **A workflow that signs in** (`id-token: write`, `write-all` or an `environment`) reads no
  `CHECKS_` or `SCAN_` setting. Each of its jobs reads the locked setting in its `runs-on`,
  held to main: `${{ github.ref == 'refs/heads/main' && vars.LOCKED_MACHINE_<N> || '<GitHub's
  machine>' }}`, or the old `LOCKED_RUNNER_<N>` the same way, and nowhere else; in the two
  repositories the locked setting reaches, the guard holds it to main alone once
  `main-spelling-refused` is live and the locked machines' switch-on finds no other spelling of
  main there, non-ASCII ones included (above).
  In the canary's repository, where the locked canary runs on the locked machines,
  `main-spelling-refused` refuses the same creations, and since a creation rule never touches a
  branch that is already there, the canary is held to main only once that repository's own reads
  find no other spelling of main there, ASCII or not (above and below). Unless kept.json keeps it
  on GitHub, such a workflow is refused when it is started:
  - by `pull_request_target` or `workflow_run`, where `github.ref` is the default branch
    whatever started the run;
  - by a tag (a push of tags, an unfiltered push, a push filtered by paths alone, `release`,
    `create`, `deployment`, `deployment_status`, `registry_package`).

  A tag can name any commit, so it cannot be held to main-line code. A job of such a workflow
  that calls a reusable workflow is refused, since its machine cannot be read. A job kept on
  GitHub here hands no `CHECKS_` setting on, not even in a step's `env`.
- **A workflow that does not sign in** reads no `LOCKED_` setting.
- **A job holding a write token on a pull request** names a literal GitHub standard label
  (`ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`) and reads no setting. The same holds in
  dazzer-io/.github whatever starts the job. With no `permissions:` key, the job holds the
  repository's default token, which counts as a write. A job kept on GitHub in a workflow any of
  whose jobs holds a write, or on `pull_request_target`, hands no `CHECKS_` setting on, not even
  in a step's `env`. A checks entry does not lift it: it admits a write only for a job no pull
  request starts, in a private repository, as a push-started release tag job may hold one. A
  call on `pull_request_target` is refused, since every job there holds a write token and a call
  names no machine.
- **A change check**, a job of a pull-request workflow in a private repository whose workflows
  read a `CHECKS_` or `LOCKED_` setting, reaches `CHECKS_RUNNER_<N>` on every route. It is never
  on `pull_request_target`, and holds no write unless its kept.json entry has the effect `checks`
  and names that write. It reads only the secrets `secrets.json` names for its repository,
  beside `GITHUB_TOKEN`, and never the whole secrets context or a secret looked up by a computed
  name.
- **Unclassified.** In such a repository, a job of a workflow that neither signs in nor runs on
  `pull_request` is refused unless kept.json names it. So is a job on a literal GitHub label:
  either it reads its setting or it is kept on GitHub by an entry of its own. A job calling a
  shared workflow is classed the same way, and no kept.json entry keeps a call. A private
  repository that reads no setting needs no entry for its literal-label jobs; `--moving` reads it
  as though it did.
- **A public repository**: every job but the shared scans', whatever keeps it, names a literal
  GitHub standard label and reads no setting, a `LOCKED_` one included. A call reads none either.
- **The shared scans** (`codeql.yml`, `security-scan.yml` of dazzer-io/.github) are the only
  workflows that read `SCAN_RUNNER_<N>`. Elsewhere that read is refused, however it is spelled
  and wherever it hides (a job's outputs, a matrix row, an input's default, the workflow's top),
  including in a workflow a call reaches at another ref. Each scan job that does not write:
  - reads exactly `${{ vars.SCAN_RUNNER_2 || 'ubuntu-latest' }}`;
  - holds no secret, declared or read;
  - checks out with `persist-credentials: false`.

  Its write-token jobs (today `codeql.yml`'s one upload job, `Upload CodeQL results`, which
  sends every language in turn) and `codeql.yml`'s one final check run on GitHub's standard
  machine, read no setting and are named in kept.json. In dazzer-io/.github no other job, a call
  included, reads a `vars` name spelled as a setting is (`CHECKS_`, `SCAN_` or `LOCKED_` and
  anything after), declared or not.
- **The stricter class** (`strict.json`): every job not on the literal `ubuntu-latest`, whatever
  its class, holds no more than the code; `ubuntu-24.04` and `ubuntu-22.04` are held too. That
  means no secret, no hand-on of the workflow's token, no permission of its own and no checkout
  keeping a git credential. A call is held the same way: it names no secret or token on any of
  its lines, and it asks a grant only as `codeql.yml`'s job `codeql` calling the shared scan,
  file and job both, or as `engineer-review.yml`'s job `engineer-review` calling
  dazzer-io/.github's `engineer-review.yml` at a commit with exactly its three grants,
  `contents: read`, `statuses: write` and `pull-requests: read`, and no `secrets:` or `with:`.
  Its workflow's top grants exactly `contents: read` and names no secret or token.

  One shape is exempt beside the literal `ubuntu-latest`: the locked setting held to main,
  falling back to the literal `ubuntu-latest`,
  `${{ github.ref == 'refs/heads/main' && vars.LOCKED_MACHINE_<N> || 'ubuntu-latest' }}`, or the
  old `LOCKED_RUNNER_<N>` the same way, as a job's whole `runs-on`, on a workflow no
  pull-request event starts (`pull_request`, `pull_request_target`, `pull_request_review`,
  `pull_request_review_comment`, `merge_group`).
  On `pull_request_target`, `github.ref` is the default branch whatever started the run, so the
  main guard would hand a fork's change the locked set. Such a job still meets every class rule
  above: its workflow signs in, or the `LOCKED_` class refuses it; it is started by no tag or
  deployment; and its `LOCKED_MACHINE_<N>` or `LOCKED_RUNNER_<N>` is declared and as wide as its
  fallback. Still held to no more than the code, in a repository strict.json names:
  - the same shape on a workflow a pull-request event starts;
  - a `LOCKED_` setting read without the main guard;
  - a `CHECKS_` setting, held to main or not;
  - a fallback other than the literal `ubuntu-latest`, `ubuntu-24.04` and `ubuntu-<N>-core`
    among them.

## Calls

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
  spelling.
- **Settings:** it reads no `CHECKS_`, `SCAN_` or `LOCKED_` setting, in the call or in its
  workflow's top.
- **Class:** it meets every class rule any other job does, its workflow's top included: what it
  reads, holds and signs in for, as the classes above say. It names no machine and holds no
  steps, so no rule on a machine or a step reads it; the jobs it calls are judged in
  dazzer-io/.github, where they run. A call on `pull_request_target` is refused in every
  repository; in a repository whose workflows read a setting, a call from a workflow that
  neither signs in nor runs on `pull_request` is unclassified and refused, and no kept.json
  entry keeps a call.
- **CodeQL:** a call of `codeql.yml` is the job `codeql`, so its required check is
  `codeql / CodeQL complete`.

A call of a workflow of its own repository (`./` or `$/`), of another repository, or of another
owner is refused, since the machine its jobs run on cannot be read here. In dazzer-io/.github, no
workflow but the two scans calls a scan.

A call of `codeql.yml`, `security-scan.yml` or `engineer-review.yml` at `dazzer-io/checks` is a
call of another repository and is refused: those three stay in dazzer-io/.github alone. A step calling the machine
rule's building block is the one step whose `uses:` is judged here: it names `dazzer-io/.github/machine-rule@main` or `dazzer-io/checks/machine-rule@main`
exactly, and nothing else.

## The lists

The lists are read from this folder, never from the repository judged, so a repository cannot
widen them from its own pull request. Each list is checked before it is used, and a list that
fails its check leaves the rule unread.

- **`kept.json`**: the jobs kept on GitHub's computers. Each entry carries its repository,
  workflow, reason, decision and source, and one of three effects:
  - `stay`: on a literal GitHub standard label, or the one exception, `windows-latest`, reading
    no setting as its machine. A plan job may hand `CHECKS_RUNNER_<N>` on in a step's `env`,
    only in a workflow that neither signs in nor holds a write token.
  - `checks`: judged as a change check after every class rule, naming the writes it may hold,
    which it holds only off a pull request in a private repository.
  - `canary`: the canary repository's `canary.yml` and `locked-canary.yml` alone; an entry for
    any other file is refused, naming those two. Each is started by hand, under
    `contents: read`, with no permission of its own and no secret, on our own sets named
    literally, since a canary proves a set before any setting names it. `locked-canary.yml`
    names the locked sets alone (`dazzer-locked-<N>-core`) and `canary.yml` only sets that are
    not locked, so no canary carries a locked set past the locked canary's own guards. Each job
    of `locked-canary.yml` must carry the main guard as its `if:`, exactly
    `github.ref == 'refs/heads/main'` (bare, or alone in one `${{ }}`), and the judge refuses
    one with no guard or a wider one. A dispatch runs the branch's own copy of the file, so the
    main guard is not the protection by itself: a branch's copy may drop it, and a branch pushed
    with no pull request is never judged. The guard is not what holds the locked sets to main;
    the runner group's selected-workflow admission at `refs/heads/main`, with
    `main-spelling-refused` in each repository it admits, is: the admission takes
    `locked-canary.yml` from main alone, and since it may match `refs/heads/main` without regard
    to case, `main-spelling-refused` keeps a branch named `MAIN` from being created there, though
    a creation rule never touches a branch that is already there, so this holds only once the
    canary repository's own reads find none, ASCII or not: the routine settings apply refuses to
    write `google-locked`'s repository list while any repository it admits is not under a live
    `main-spelling-refused` creation rule or holds a branch spelled main in other letters, ASCII
    or not, and the locked machines' switch-on reads the same before the locked settings are
    written. `canary.yml` is run by hand from any branch and carries none.

  An entry is whole-file (`jobs`, every job id of its file, effect `stay` or `canary`) or one
  job (`job` and `name`). A stay entry carries the name GitHub shows, as the readings match it, a
  fixed string holding no expression. A checks entry carries its job's `name:` as written, a
  matrix expression included, since the readings leave checks entries out.
  An entry naming a job or file not there yet is a note, not a refusal; a job beside those a
  whole-file entry lists is judged like any other.

  Production and scheduled workflows that sign in and are started by no pull request or
  deployment read the locked shape the stricter class exempts, so kept.json names none of them.
  A workflow that writes issues with main's token but signs in to nothing stays, since the
  locked set takes only workflows that sign in; so does one started by `deployment_status`,
  since the deployed commit's own file decides its `runs-on` and no main guard holds it to
  main-line code. Each such entry says why.
- **`secrets.json`**: the secrets a change check may read, per repository.
- **`strict.json`**: the repositories held to the stricter class.

## Left out

Each refusal one of the four older copies made and this rule does not is named here, under its
own heading. So is each shape in which `test/machine-rule.test.mjs` does not rerun a class
refusal, where a decided admission applies. Each line under a bullet is one spelling or refusal,
and a case of that test cites it by its words. Every other refusal of the older copies has a case
of its own there.

- **The hand readers' refusals of spellings the `yaml` package reads alike**: the older copies'
  hand-written YAML readers each refused what they could not read by hand. The package reads
  each of these as GitHub does, and drops comments as GitHub drops them:
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
- **The older copies' narrower call admissions**, `engineer-review/caller.yml`'s call among them,
  in a repository strict.json names too. The shared admission takes these calls, which an older
  copy refused:
  - a call at `refs/heads/main`, which two older copies refused
  - a call of `engineer-review.yml` outside a repository strict.json names, which an older copy
    read as a change check calling a workflow
  - a call of `engineer-review.yml` from another workflow of dazzer-io/.github, which the runs-on
    test refused
  - a call from a repository outside an older copy's list of five, which that copy refused
  - a call of `engineer-review.yml` from `engineer-review.yml`'s job `engineer-review` in a
    repository strict.json names, at a commit with exactly its three grants, which an older copy
    refused
- **An older copy's line-for-line pin of its call of the shared scan**. Its languages and its
  exact grant belong to the calling repository's own caller, not to the machine rule:
  - languages other than the pin's
  - a grant less than the pin's
- **An older copy's tree-level refusals**. A folder with no workflows is said as nothing to
  judge, never as clean:
  - a tree holding no change-check job
  - a tree holding no production job
  - a tree with no workflow folder
- **An older copy's allowed list, held to five repositories**. kept.json names any dazzer-io
  repository, and a private repository that reads no setting needs no entry for its
  literal-label jobs:
  - a literal-label job of a private repository that reads no setting, named by no entry
  - an entry outside its five repositories
- **An older copy's list of built-in labels**:
  - a built-in label
- **A call's machine and steps**, and its keys. A job that only calls an admitted shared workflow
  names no runs-on and holds no steps. The jobs it calls are judged in dazzer-io/.github, where
  they run. So no call is refused for what only a machine or a step holds:
  - a refusal of the job's runs-on, or of its having none
  - a refusal of a step, a checkout keeping its credential, CodeQL's own scan steps or a call of the machine rule's building block
- **A change check's secrets list, for a call**. A call hands on no secret at all, whatever
  secrets.json names for its repository, and a workflow's top-level env does not reach the
  workflow it calls. So secrets.json is not read for a call:
  - a change check's secret that secrets.json does not name
- **The unclassified and literal-label refusals, for a job a checks entry keeps**. The entry
  decides that its job runs as a change check, so the job is not refused for having none. It is
  judged as a change check beside every class rule:
  - a refusal that kept.json names no entry for the job
