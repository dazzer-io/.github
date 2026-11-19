# Leak check

A composite action for the organisation's public repositories. It refuses a change that adds a
private name to a tracked file or to a file or folder name.

## What it reads

- The file contents of every file git tracks in the checkout.
- The file and folder names of every tracked path: the whole path and each segment of it.
- The ref names of every branch, tag and pull request ref the remote serves (`git ls-remote`).
- The ref trees: the tip of each of those refs, fetched one commit deep under `refs/leak-check/`,
  file contents and file and folder names alike.

Before matching, text is normalised: NFKC is applied, and format characters (zero-width joiner and
space, word joiner, soft hyphen, direction marks and the rest of Unicode's Cf) are read twice, once
removed and once as spaces. So a name split by an invisible character, separated only by a
zero-width space, or written in fullwidth or decomposed letters is still found.

## What it does not read

Commit messages, author names and emails, tag messages, pull request titles and bodies, and Git
LFS content (it reads the LFS pointer file, not the object). A private name in any of these is not
found by this check.

## What it looks for

The list beside this file, `hashes.json`, holds one-way hashes only: the SHA-256 of the list's
salt followed by a name, normalised, lower-cased and trimmed. A list that is missing, empty or holds
anything but 64-character hex hashes stops the check red.

The list is public, and a one-way hash only goes one way: anyone can confirm a name they already
guess, by hashing it with the salt and looking for it in the list, but the list never discloses a
name nobody guessed.

- `repositories`: a private repository, matched as `<owner>/<name>`, or alone when its name holds
  a hyphen. A one-word name is matched only beside its owner, so an ordinary word is never a finding.
- `people`: a private person's full name, matched as two or three words in a row, in any case,
  across a line break and as a possessive.
- `addresses`: an email address, matched whole or by its domain, and a listed domain wherever it
  stands as a hostname: in a URL, bare, or as the parent of a subdomain. The role addresses in
  `known.json` are never findings.

## What it decides

- A finding in the tracked files or in their file and folder names that `known.json` does not
  accept fails the step, with an error titled "Leak finding" on its file and line, or saying it is
  in the file or folder name.
- A run that read no tracked file fails the step, saying it read nothing.
- Findings on branches, tags and pull request refs, in their names or their trees, fail nothing,
  since a change cannot remove them. They are listed in the log by ref, file and line, and counted
  apart.
- A tracked file that is not UTF-8 text (UTF-16, a stray Windows-1252 byte, a NUL, an image) is
  read as bytes, matched as UTF-8, Latin-1 and UTF-16, and named in the log; a binary holding no
  name passes. A tracked file that cannot be opened is named, counted as not read, and fails the
  step. Paths and refs in the log are escaped, so a file name cannot start a command. A ref the fetch
  did not bring, or holding a file git could not give the text of, is named and counted as not read. A remote that cannot be listed makes the refs unknown.
- Nothing it prints repeats a name it found: a finding is told by file, line, kind and the one-way
  hash it matched, and a path or ref name holding a private name is printed with that segment
  `[hidden]`.

Each run records one notice titled "Leak check":

    files: N read, F new findings, K known; refs: R read, G findings on branches and tags, P on pull request refs

followed by `; not read: U files, X refs` when anything was not read. A run that read no file says
`files: read nothing`, and a run given no remote says `refs: not read, no remote was named`.

## Accepting a finding

Add it to `findings` in `known.json` with the repository, path, kind and hash the error names:

    { "repository": "<owner>/<name>", "path": "docs/notes.md", "kind": "repositories", "hash": "<64 hex>" }

An entry with no `repository` is accepted in every repository. A finding in a file or folder name
is accepted only by an entry carrying `"in": "name"`. The same name in another file is a new
finding.

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
