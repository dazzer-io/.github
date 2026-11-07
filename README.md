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

# A newer push to a pull request makes its older scan worthless; a run on main is never cancelled.
concurrency:
  group: codeql-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

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
- **`languages`** is a JSON list in a string, of CodeQL's language names (`actions`, `javascript-typescript`, `python` and the rest), scanned with build mode none and the `security-extended` suite. Each is uploaded under the category `/language:<language>`, the one GitHub's automatic setup uses, so alerts carry on by rule and fingerprint once the setup is switched off on that repository. Name the languages the automatic setup found there.
- **Where it runs.** The analysis runs where the setting `SCAN_RUNNER_2` points, read as the calling repository sees it (a called workflow reads its caller's variables), and on GitHub's computers while that is empty or not visible to the repository.

`test/codeql-shared.test.mjs` pins what the scan scans and what each of its jobs holds; `test/runs-on.test.mjs` holds its jobs to the machine rules every workflow here keeps.
