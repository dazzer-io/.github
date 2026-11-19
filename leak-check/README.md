# Leak check

A composite action for the organisation's public repositories. It reads what a stranger can read
and refuses a change that adds a private name.

## What it reads

- Every file git tracks in the checkout.
- The tip of every branch, tag and pull request ref the remote serves (`git ls-remote`), fetched
  one commit deep under `refs/leak-check/`.

## What it looks for

The list beside this file, `hashes.json`, holds one-way hashes only: the SHA-256 of the list's
salt followed by a name, lower-cased and trimmed. The list never holds a plain name, and a list
that is missing, empty or holds anything but 64-character hex hashes stops the check red.

- `repositories`: a private repository, matched as `<owner>/<name>`, or alone when its name holds
  a hyphen. A one-word name is matched only beside its owner, so an ordinary word is never a finding.
- `people`: a private person's full name, matched as two or three words in a row, in any case,
  across a line break and as a possessive.
- `addresses`: an email address, matched whole or by its domain. The role addresses in
  `known.json` are never findings.

## What it decides

- A finding in the tracked files that `known.json` does not accept fails the step, with an error
  titled "Leak finding" on its file and line.
- Findings on branches, tags and pull request refs fail nothing, since a change cannot remove them.
  They are listed in the log by ref, file and line, and counted apart.
- A tracked file that is not UTF-8 text (UTF-16, a stray Windows-1252 byte, a NUL, an image) is
  read as bytes, matched as UTF-8, Latin-1 and UTF-16, and named in the log; a binary holding no
  name passes. A tracked file that cannot be opened is named, counted as not read, and fails the
  step. Paths and refs in the log are escaped, so a file name cannot start a command. A ref the fetch
  did not bring is named and counted as not read. A remote that cannot be listed makes the refs unknown.
- Nothing it prints repeats a name it found: a finding is told by file, line, kind and the one-way
  hash it matched.

Each run records one notice titled "Leak check":

    files: N read, F new findings, K known; refs: R read, G findings on branches and tags, P on pull request refs

followed by `; not read: U files, X refs` when anything was not read.

## Accepting a finding

Add it to `findings` in `known.json` with the repository, path, kind and hash the error names:

    { "repository": "<owner>/<name>", "path": "docs/notes.md", "kind": "repositories", "hash": "<64 hex>" }

An entry with no `repository` is accepted in every repository. The same name in another file is a
new finding.

## Using it

The calling job checks the repository out and grants `contents: read`; the action adds no grant.

    permissions: {}
    jobs:
      leak-check:
        runs-on: ubuntu-latest
        permissions:
          contents: read
        steps:
          - uses: actions/checkout@<full commit> # pinned
            with:
              persist-credentials: false
          - uses: dazzer-io/.github/leak-check@<full commit>

Inputs: `hashes` and `known` (paths, empty for the files beside the action), `remote` (default
`origin`) and `path` (the checkout, empty for the workspace).

From a terminal:

    node leak-check/scan.mjs --hashes leak-check/hashes.json --known leak-check/known.json \
      --repository <owner>/<name> --refs origin
