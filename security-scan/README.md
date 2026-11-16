# Security scan

Every pull request to a gated repository, and every merge-queue group, runs the check
**security-scan**. It scans only what the change itself brings in: a vulnerable dependency
the change adds, a secret in one of its commits, a weakness in the code it adds. Advisories
against code already on the default branch are not this check's business; they go on the
fix clock through the repository's Dependabot alerts.

The organisation ruleset requires `.github/workflows/security-scan.yml` from this repository
on every gated repository (its workflows rule), so no gated repository carries a copy or a
caller file, and nobody can skip it.

On both branches the same check also refuses a change to a workflow that signs in to GitHub
with a person's token kept as a repository secret (below, "Person tokens").

## The two branches

The calling repository's variable `SECURITY_SCAN_NATIVE` chooses.

| `SECURITY_SCAN_NATIVE` | What runs | Why |
|---|---|---|
| `true` (GitHub Code Security and Secret Protection are on) | GitHub's dependency review, pinned to a commit: runtime dependencies and those of unknown scope, high and above, the accepted advisories allowed | code scanning there is CodeQL default setup, which the organisation ruleset's `code_scanning` rule requires and which fails a pull request only on new alerts in the code it changes; secrets are stopped by push protection. No other scanner runs. |
| unset, `false` or anything else | osv-scanner over the lockfiles, gitleaks over the pull request's commits, and Semgrep's open-source engine | the repository has no GitHub code security licence, so free open-source scanners stand in. Each is installed by pinned version and checksum, never through an action that needs a licence key. |

On the open-source branch only the change's own findings count: osv-scanner scans the
lockfiles at the change and at its base, and a finding the base already carries is recorded
but never blocks; gitleaks reads only the commits between the base and the change's head;
Semgrep runs with `--baseline-commit` set to the base, so it reports only results the change
adds. A repository with no dependency files, at the change and at its base, passes the
dependency audit with the note "no dependency files".

A change cannot hide its dependencies by removing their lockfile:

- When osv-scanner finds no dependency files at the change (its exit 128) but its scan of the
  base finished (exit 0 or 1), the decision records one high finding with the fixed id
  `dependency-files-removed` ("the change removes every dependency file its base had"), which
  blocks in blocking mode and counts as one would-block item in advisory. A repository that
  retires its last dependency file on purpose accepts it through the accepted list under that
  id, with its record, like any other finding; each lockfile it deletes needs its own entry too
  (below), and both entries may name the same record. A missing or failed base scan is an
  unreadable output and blocks; no entry clears it.
- The osv-scanner job also lists the files the change deletes
  (`git diff --name-only -z --no-renames --diff-filter=D <base> HEAD`, so a rename counts as
  deleting the old name). Each lockfile among them (by file name: `package-lock.json`,
  `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.mod`, `poetry.lock`, `requirements*.txt` and
  the rest osv-scanner reads) is one high finding, `lockfile-removed:<path>`, which blocks in
  blocking mode. A lockfile retired on purpose is accepted through the accepted list under that
  id, with its record. If the list cannot be made (git fails), that blocks too.

A change cannot quiet the open-source scanners with a file or comment of its own:

- Before scanning, each of the three scanner jobs removes every `.semgrepignore`,
  `.gitleaksignore`, `.gitleaks.toml` and `osv-scanner.toml` from the checkout, at any depth
  outside `.git`, and lists what it removed in the job log. In the Semgrep job the removal is
  committed locally on top of the change, because `--baseline-commit` needs a clean tree; the
  commit removes only those files, so the scan still reports only what the change adds.
- osv-scanner runs at the change and at its base with `--config` pointing at an empty config
  the workflow writes, so no `osv-scanner.toml` filters an advisory out, and with `--no-ignore`,
  so a lockfile the change lists in `.gitignore` is still scanned.
- gitleaks runs on its built-in rules only (the workflow hands it its own config), reads its
  ignore file from an empty folder, and ignores `gitleaks:allow` comments.
- Semgrep ignores `nosemgrep` comments (`--disable-nosem`) and scans files the change lists in
  `.gitignore` (`--no-git-ignore`).

A finding is accepted only through the accepted list below.

**Not yet confirmed.** GitHub's dependency-review action asks for Advanced Security on private
repositories. The first advisory run on each private repository whose variable is `true`
confirms that it works under Code Security. If it refuses there, the job ends with no output,
the summary says the dependency review wrote no output, and the repository's
`SECURITY_SCAN_NATIVE` is set back to `false` so the open-source branch runs there.

## Person tokens

GitHub automation never signs in to GitHub as a person. A GitHub token kept as a repository
secret is a person's own (a personal access token, a bot account's or anyone's), so a workflow
handing one to GitHub acts as that person, with all their access. The job **Person tokens in
workflows** (`security-scan/person-tokens.mjs`) runs on both branches and needs no secret and no
permission beyond `contents: read`.

**What it reads.** Only the workflow files (`.github/workflows/*.yml` or `.yaml`, at the top of
that folder, where GitHub runs them) and composite actions (`.github/actions/**/action.yml` or
`.yaml`) the change itself changes: `git diff` from the merge base of the pull request's base and
its head commit to that head commit, renames read as a new file. Each is read at the head commit.
A workflow the change does not touch is never read, so nothing already on the default branch is
flagged until someone changes its file.

**What counts as a use.** A repository secret, other than the workflow's own `GITHUB_TOKEN`,
named inside `${{ }}` (`secrets.NAME` or `secrets['NAME']`) where:

| The secret is | For example |
|---|---|
| set as `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` or `GITHUB_ENTERPRISE_TOKEN`, at the workflow, job or step | `GH_TOKEN: ${{ secrets.SOME_TOKEN }}` |
| an action input that is a GitHub token by its name (`github-token`, `github_token`, `gh-token`, `gh_token`, `repo-token`, `repo_token`) | `github-token: ${{ secrets.SOME_TOKEN }}` on `actions/github-script` |
| the plain `token` input of an action that talks only to GitHub: GitHub's own (`actions/*`, `github/*`), `octokit/*`, `peter-evans/*`, `dependabot/*` and a short list in `person-tokens.mjs` | `token: ${{ secrets.SOME_TOKEN }}` on `actions/checkout` |
| the `password` of `docker/login-action` signing in to `ghcr.io` | |
| on a script line that signs in to GitHub: a `github.com`, `githubusercontent.com` or `ghcr.io` address, `x-access-token`, `gh auth login`, or `GH_TOKEN=` | `git push https://x-access-token:${{ secrets.SOME_TOKEN }}@github.com/...` |
| named as a GitHub token, wherever it is passed: `GH` or `GITHUB` with `TOKEN`, or `PAT` (`GH_*_TOKEN`, `*GITHUB*TOKEN*`, `*_PAT`) | `READER: ${{ secrets.GH_READ_ONLY_TOKEN }}` handed to a script |

A YAML comment is not a use; a comment inside a `run:` script is, because GitHub fills in
`${{ }}` there before the shell reads it.

**What is allowed.** The workflow's own token (`${{ github.token }}`, `${{ secrets.GITHUB_TOKEN }}`)
and a GitHub App token minted in the job by `actions/create-github-app-token`
(`${{ steps.<id>.outputs.token }}`), which is no secret at all; the App's id and private key are
secrets, and are not a person's token (no `TOKEN` or `PAT` in their names). Tokens for other
services (Vercel, Sentry, Turbo, LangSmith, Anthropic and the like) are never read as GitHub's.

**The ratchet.** In a file the change touches, every use is refused unless the calling
repository's `.github/person-token-exceptions.json` allows it. That file is read from the base
commit, never from the change, so a change cannot let itself in:

```json
[
  {
    "file": ".github/workflows/release.yml",
    "secret": "SOME_TOKEN",
    "reason": "reads the shared library until the App is installed there",
    "until": "2027-01-31"
  }
]
```

- An entry allows every use of that secret in that file. Secret names are read without case, as
  GitHub reads them; file paths exactly.
- It counts through its `until` day (UTC) and stops the day after. After that, the next change
  to the file is refused until the use moves off the person's token, so no exception lives on
  by being forgotten.
- An entry with no file, no secret, no one-line `reason` or no `until` as `YYYY-MM-DD` counts for
  nothing, and the summary says so. A repository with no such file has no exceptions.
- A change that writes the file is read against the base's version; its own entries count from
  the next change once it merges. Its version must still read as a JSON list: one that does not
  blocks, like a malformed accepted list.
- A use already in a file the change touches is refused like a new one when nothing allows it:
  that is what makes the end date hold. The summary says which: "this change adds it", "already
  in this file, with no exception", or "its exception ended on".

**How it settles.** Each use not allowed is one high finding, id `person-token:<file>:<secret>`,
counted as the change's own because the change touches its file: it fails the check in blocking
mode and is one would-block item in advisory, like any finding. The accepted list never accepts
one; only the exceptions file does, with its end date. An allowed use is recorded in the summary
with its end date and reason, and does not block. Each refused use gets an annotation on its line
of the pull request saying what was found (file, line, secret), why it is refused, and what to use
instead; the summary says the same. A job that wrote nothing, crashed (the base or head commit
cannot be read), or wrote output that cannot be read blocks like a scanner's.

## The mode

The organisation variable `SECURITY_SCAN_MODE` is read on every run.

| `SECURITY_SCAN_MODE` | What the check does |
|---|---|
| `advisory` | records every finding in the job summary, in the scanner's own words, ends with the annotation `security-scan would block: N`, and passes. The dependency-review action runs `warn-only`, and every scanner job runs `continue-on-error`, so the workflow's result is the `security-scan` job's alone. |
| `blocking` | fails on a critical or high runtime finding the change brings in that the accepted list does not accept. |
| unset or anything else | reads as `blocking` and says so in a warning annotation. |

Output a scanner should have written but did not, or wrote in a form that cannot be read (a
crash, a missing job, malformed JSON, a malformed accepted list), counts like a blocking
finding: it fails the check in blocking mode and is counted in `would block: N` in advisory,
one item per scanner. So a scanner job that fails in advisory mode (the dependency review
refusing, a download that fails) leaves the run green and shows as one would-block item in
the summary. The first job, which reads the switches, the four scanner jobs and the person-token job run
`continue-on-error` only when `SECURITY_SCAN_MODE` reads `advisory` exactly (GitHub compares
without case); any other value keeps them strict, the safe direction. The scanner jobs read the
variable itself rather than the first job's output, so a first job that failed in advisory mode
cannot leave them strict.

## Severity, one scale for every scanner

| Scanner | Read as |
|---|---|
| dependency review | GitHub's own word: critical, high, moderate (medium), low |
| osv-scanner | the advisory's CVSS base score: 9.0 and above critical, 7.0 to 8.9 high, 4.0 to 6.9 medium, below that low; with no score, the advisory database's own severity word; with neither, high, and the summary says so |
| gitleaks | always critical: a secret in the code |
| Semgrep | ERROR high, WARNING medium, INFO low (CRITICAL, HIGH, MEDIUM and LOW as written); an unknown word reads as high, and the summary says so |

A dependency counts as runtime unless its scanner says it is a development dependency
(dependency review's scope `development`; osv-scanner's dependency group `dev`). A scope the
scanner calls `unknown` blocks like runtime: the dependency-review action runs with
`fail-on-scopes: runtime, unknown`, and the decision blocks every scope but `development`. A
development dependency's finding is recorded and never blocks.

## Accepting a finding

A finding that cannot be fixed yet is accepted in the calling repository's
`.github/security-accepted.json`, read from the change's own head commit, so the pull request
that accepts a finding is not blocked by it:

```json
[
  { "id": "GHSA-xxxx-xxxx-xxxx", "record": "records/risk-acceptance/2026-11-example-parser.md" }
]
```

- `id` is the scanner's finding id: the advisory id for dependency review (`GHSA-…`), any of
  an advisory's ids or aliases for osv-scanner (`GHSA-…`, `CVE-…`), the finding's fingerprint
  for gitleaks (`<commit>:<file>:<rule>:<line>`), and `<rule id>:<path>` for Semgrep. A
  Semgrep entry naming only a rule id accepts nothing, so one entry never accepts a rule on
  every path, and the summary says so.
- `record` names the approved risk-acceptance record in the records repository. An entry
  without one under `records/risk-acceptance/` accepts nothing, and the summary says so.
- The file is absent until someone needs it and changes only through a reviewed pull request.
  The scan cannot read the private records repository, so the daily reading checks every
  entry against an approved, unexpired record there.

## Known limits

- **Accepting dependency-files-removed covers the repository, and it does not expire.** The
  item has one id per repository, and accepted entries carry no end date, so once accepted it
  also covers any later pull request that removes every dependency file. A later removal needs
  its own record review: take the entry out after the change it was accepted for merges.
- **Dependency review is filtered before the decision reads it.** On the native branch the
  action's `vulnerable-changes` output already leaves out what the action itself would not fail
  on: medium and low advisories in blocking mode, development dependencies, and the accepted
  advisories. So those never appear in the summary there; the decision reads scope, severity
  and acceptance again, so blocking does not rest on the action's filters, but the summary is
  not the full list. Some of the recorded outputs the tests use model entries the real action
  would not produce.
- **Semgrep's rules come from its registry on every run.** `--config p/default` fetches the
  rules live, so results can change without a reviewed change here, and a registry outage
  leaves no output, which blocks every pull request on the open-source branch in blocking
  mode (it fails safe).
- **Already on the base means the same package and advisory.** osv-scanner's findings are
  matched to the base by ecosystem, package name and advisory id, not by lockfile path, so an
  advisory the base carries in one lockfile is not new when the change adds it in another.
  And the base is the pull request's `base.sha`, which can be older than the merge base GitHub
  builds the change on.
- **A removed ignore file is removed from the change's side only.** Semgrep builds its baseline
  scan of the base commit itself, and that scan may honour the base's own `.semgrepignore`; if
  it does, when a change touches a file the base's `.semgrepignore` excludes, findings already
  in that file can read as new. That fails safe; such a finding is fixed or accepted.

- **Semgrep's built-in default ignore list applies.** Each scanner job removes the change's
  `.semgrepignore`, and with none Semgrep falls back to its own default ignore list: among
  others `test/`, `tests/`, `vendor/`, `build/`, `dist/`, `node_modules/` and `*.min.js`. Code a
  change puts there is not scanned by Semgrep. Writing a `.semgrepignore` of the workflow's own
  would lift that, at the cost of scanning vendored and generated code.
- **A deleted lockfile is matched by its file name.** A dependency file osv-scanner reads under a
  name not on the list in `decide.mjs` is not flagged when the change deletes it; the change
  scan finding no dependency files at all still blocks.
- **A rewritten lockfile is trusted as written.** A change that keeps a lockfile's name but
  rewrites its content, or replaces it with a symbolic link, is not flagged as removing
  anything: osv-scanner scans what the file now says, and what the rewrite dropped is not
  scanned at the change.
- **A moved lockfile counts as deleted.** Renames are read as a deletion of the old name, so a
  change that moves a lockfile to another folder needs a risk record for the old path under
  `lockfile-removed:<old path>`, even though the dependencies are still scanned at the new one.

- **The person-token check reads lines, not YAML.** It reads a workflow the way GitHub fills it in,
  line by line, so it does not see a secret reaching GitHub by a longer road: through another
  variable (`GH_TOKEN: ${{ env.SOME }}` where `SOME` holds the secret), an expression split over
  lines, a key and its value on different lines, or the plain `token` input of a local composite
  action or of an action not on its list, when the secret's name does not say GitHub. A secret
  named as a GitHub token is caught wherever it is passed, so naming secrets for what they are is
  the strongest backstop. A secret reaches a composite action only as an input, so the use is
  found in the workflow that hands it over.
- **A moved workflow is a new file.** Renames read as new files, so moving a workflow that holds
  an allowed use is refused until the exception names the new path on the base branch.
- **End dates are not capped.** An entry can name any date; how long an exception may last is
  decided in the review of the change that writes it.

## Files

- `.github/workflows/security-scan.yml`: the workflow. Its first job reads the switches through
  `decide.mjs plan`; the scanner jobs only record what their scanners printed and the exit
  code; the final job `security-scan` runs `decide.mjs settle` over those outputs.
- `security-scan/decide.mjs`: the decision. Pure functions, exported for the tests.
- `security-scan/person-tokens.mjs`: the person-token check the job `person-tokens` runs
  (`scan --target <checkout> --base <commit> --head <commit>`); it writes the uses it found, with
  whether each is allowed, as JSON for the final job. Pure functions, exported for the tests.
- `test/security-scan-person-tokens.test.mjs`: the check over workflow texts written in the test,
  and the job's own step run in a temporary git repository whose base branch moves on after the
  change is cut.
- `test/security-scan-decide.test.mjs` over `test/fixtures/scan-outputs.json`: recorded
  outputs, no network. It also runs the workflow's own removal, commit and osv-scanner steps
  in a temporary git repository, with a stand-in osv-scanner that records how it was called,
  and reads the deleted lockfiles that step lists.

Pinned today: GitHub's dependency-review action v5.0.0, osv-scanner v2.7.0, gitleaks 8.30.1 and
the Semgrep image 1.182.0, each by commit or SHA-256 checksum in the workflow. To move one, read
the new release's published checksum and change the version and checksum together in one
reviewed pull request.
