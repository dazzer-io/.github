# dazzer-io shared workflows

The checks every gated dazzer-io repository runs through the organisation ruleset: the AI review, the engineer review and the security scan. Built by the SOC 2 readiness job. The security scan also refuses a change to a workflow that signs in to GitHub with a person's token kept as a repository secret (`security-scan/README.md`, Person tokens).

`test-times/` is the shared test-time recorder. It keeps each test's and test file's time on every run, kept with the run on GitHub, and reads those records back for the planners and the weekly reading. Its README says how a repository wires it in.

## The shared CodeQL scan

`.github/workflows/codeql.yml` is GitHub's code scanning for every repository, kept here once, so no repository carries a copy of its own (decisions 118 and 119). A repository calls it from one short file, `.github/workflows/codeql.yml` of its own, naming its languages and its triggers:

```yaml
name: CodeQL

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

# A newer push to a pull request cancels its older scan; each push to main is a group of one,
# so a scan of main is never cancelled.
concurrency:
  group: codeql-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  codeql:
    uses: dazzer-io/.github/.github/workflows/codeql.yml@main
    permissions:
      contents: read
      actions: read
      security-events: write
    with:
      languages: '["actions", "javascript-typescript"]'
```

- **At `@main`, nothing else.** The scan is then read from this repository's main branch, never from the change being scanned. The scan machines' runner group is to admit only the shared workflows at `refs/heads/main` (decision 119, set by the runners repository's task r-1.54), so a call at another ref would wait for a machine it is never given.
- **The calling job grants exactly those three.** A called workflow's token is at most its caller's: `contents: read` to check out, `actions: read` so CodeQL can read the run's workflow on a private repository, and `security-events: write`, held only by the scan's upload job on GitHub's own `ubuntu-latest`.
- **No secrets.** The scan declares none and reads none: no `secrets:`, no `secrets: inherit`.
- **`languages`** is a JSON list in a string, of CodeQL's language names, scanned with build mode none and the `security-extended` suite. Name the languages the automatic setup found there.
- **Three languages only: `actions`, `javascript-typescript` and `python`.** These are what dazzer and dazzer-app scan today, and their build mode none is known to run no build tool. The analysis's first step refuses any other language and the run is red (decision 133). GitHub's page on compiled languages does not say whether build mode none for C# or Java reads the change's build files, which would run what the change wrote on the scan machines. Go, Swift and Kotlin cannot be scanned without a build at all. So a later language joins by its own decision, never by a caller naming it.
- **Every language or none.** The results are uploaded only when every language's analysis succeeded, so a partial scan never passes. A failed analysis uploads nothing and the run is red. A cancelled one uploads nothing and the run ends cancelled, not red. An upload that fails after every analysis passed may leave other languages' results already sent; that run is red.
- **Require one check: `CodeQL complete`.** It shows as `codeql / CodeQL complete` under the calling job's id, and its name is the same whatever languages are named. It runs after every analysis and upload, on GitHub's own machine with no token, and fails unless both succeeded (decision 135). Require it, not the `Analyze (<language>)` or upload checks: a required-check rule reads a skipped upload as success, and a pull request that adds a language to its own caller fails that language's guard, skips every upload, and leaves the Analyze checks of the languages already named green. It costs one GitHub minute a run.
- **dazzer-io's own workflows at `main` raise no unpinned-tag alert.** Calling the organisation's own shared workflows at `main` is the design, so the analysis of `actions` adds dazzer-io to the publishers CodeQL's `actions/unpinned-tag` query trusts (decision 165). It names dazzer-io alone: any other owner's action or workflow used without a commit still raises the alert, and every other language and query is as before. The list is a model pack, `shared-scan/trusted-publishers`, that the scan writes into CodeQL's package cache on each run; its scope is a CodeQL pack scope, not the organisation's name, since the pack is no GitHub project (decision 167). Nothing is published, since a public package cannot be made private again and a private one needs a grant for every repository (decision 166).
- **No model packs from the scanned code.** A repository can keep CodeQL model packs in a `.github/codeql/extensions` folder, and GitHub's page on editing default setup says such packs are still recognized and used in advanced setup. So a change could quiet its own scan by adding a pack there, for example by trusting another publisher or modelling a source or sink away. Live run 42421160617 showed this: a branch carrying a pack that trusts docker lost the unpinned-tag result on `docker/login-action@v3`. So for every language, the scan hands CodeQL's `database run-queries` the option `--no-database-extension-packs` (decision 169). CodeQL's manual says this option leaves out the extension packs stored in the database when it was created, whether from a configuration file or from the scanned code's own extensions folder. Three kinds of pack still apply. The first is CodeQL's own models, which ship in the bundle with its library packs (`codeql/<language>-all`) and which every query reads as before. The second is the packs the scan names, `shared-scan/trusted-publishers` for `actions`. The third is the action's own pack for a pull request's diff-informed analysis, which the action passes to `run-queries` with `--extension-packs` and never stores in the database. Left out are the packs stored in the database when it is created: those the scanned code carries in its extensions folder and those a configuration file names. The scan names no configuration file. None of dazzer-io's 19 repositories had a `.github/codeql` folder on its default branch when read on 8 Nov 2026 (each answered 404), so no model a repository relies on is dropped. A repository that wants models of its own asks for them here, in the shared scan.
- **Alert history.** Each language is uploaded under the category `/language:<language>`, the one GitHub's automatic setup uses. The analysis is now keyed by this workflow, not the setup, so whether alerts carry on by rule and fingerprint, rather than closing and opening again, is read on the repository's first run on main once the setup is switched off there, not promised here.
- **Where it runs.** The analysis runs where the setting `SCAN_RUNNER_2` points, read as the calling repository sees it (a called workflow reads its caller's variables), and on GitHub's computers while that is empty or not visible to the repository. A repository variable named `SCAN_RUNNER_2` overrides the organisation's, so that repository's admin can point its scan at any label. Only the runner groups' repository lists keep a repository's scan off machines that run changes' own code: a label reaches only a set whose group admits the repository, so the scan stays apart only while no group admitting a gated repository offers it a change-check set's label.
- **Only the scans call it here.** In this repository, no workflow but the two scans may call it (`test/runs-on.test.mjs`).

`test/codeql-shared.test.mjs` pins what the scan scans and what each of its jobs holds; `test/runs-on.test.mjs` holds its jobs to the machine rules every workflow here keeps.
