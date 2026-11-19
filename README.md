# dazzer-io/.github

This repository is the public home of three things for Dazzer's GitHub organisation:

- **The organisation profile.** `profile/README.md` is the page shown at
  [github.com/dazzer-io](https://github.com/dazzer-io).
- **Community defaults.** `SECURITY.md`, `CONTRIBUTING.md`, the issue forms and the pull request
  template in `.github/` apply to every public dazzer-io repository that has no copy of its own.
- **The shared checks** that Dazzer's repositories run on every change, kept here once so no
  repository carries a copy of its own.

To report a security problem, follow [SECURITY.md](SECURITY.md); please do not open a public issue.

## The shared checks

| Check | Files | What it does |
|---|---|---|
| CodeQL | `.github/workflows/codeql.yml` | GitHub's code scanning, called by each repository from a short caller file (below). |
| Security scan | `.github/workflows/security-scan.yml`, `security-scan/` | Scans only what a change brings in: dependency advisories, leaked secrets, static analysis, and workflows that sign in to GitHub with a person's token. See [security-scan/README.md](security-scan/README.md). |
| Engineer review | `.github/workflows/engineer-review.yml`, `engineer-review/` | Sets the commit status `Engineer review`, pending until a person who may merge has recorded a review of the pull request's head commit. See [engineer-review/README.md](engineer-review/README.md). |
| Leak check | `leak-check/` | Refuses a change that adds a private name, held only as a one-way hash. See [leak-check/README.md](leak-check/README.md). |
| Decide tests | `.github/workflows/decide-tests.yml` | Runs the leak check and this repository's own tests on every pull request. |

Every workflow here grants its token nothing at the top (`permissions: {}`), each job names the
least it needs, and every action is pinned by its full commit id.

## Calling the shared CodeQL scan

A repository calls the scan from one short file of its own, `.github/workflows/codeql.yml`,
naming its languages and its triggers:

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

- **At `@main`, nothing else.** The scan is read from this repository's main branch, never from
  the change being scanned.
- **The calling job grants exactly those three.** A called workflow's token is at most its
  caller's: `contents: read` to check out, `actions: read` so CodeQL can read the run's workflow
  on a private repository, and `security-events: write`, held only by the scan's upload job on
  GitHub's own `ubuntu-latest`.
- **No secrets.** The scan declares none and reads none: no `secrets:`, no `secrets: inherit`.
- **`languages`** is a JSON list in a string, of CodeQL's language names, scanned with build mode
  none and the `security-extended` suite. Only `actions`, `javascript-typescript` and `python` are
  taken, since their build mode none is known to run no build tool; any other language turns the
  run red.
- **Every language or none.** The results are uploaded only when every language's analysis
  succeeded, so a partial scan never passes.
- **Require one check: `CodeQL complete`.** GitHub shows it as `codeql / CodeQL complete` for a
  calling job with the id `codeql` and no `name:`. It fails unless every analysis and the upload
  succeeded, whatever languages are named.
- **A caller that merges through a merge queue adds `merge_group`** to its triggers; without it
  the required check never reports on the queue's commit.

The header of `.github/workflows/codeql.yml` explains each choice in full, and
`test/codeql-shared.test.mjs` pins what the scan scans and what each of its jobs holds.

## Running the tests

```
npm ci --ignore-scripts
node --test test/*.test.mjs
```

The tests read fixtures only: nothing reaches the network.

## Contributing and licence

Issues are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). The code here is released under the
[MIT License](LICENSE). The Dazzer name and logo are trademarks of Dazzer; you are welcome to use
them to refer to the project, but not in a way that suggests Dazzer endorses you or your work.
