# Engineer review

Every pull request to a gated repository carries a commit status named **Engineer review** on its
head commit. It reads **pending** until a person who may merge to the repository has recorded a
review of that commit, then **success**, naming who reviewed, when, and the commit. The
organisation ruleset requires the status, and requires it from the GitHub Actions app alone, so
a change cannot merge without it.

## What you do: one act per change

When the change is ready and you have read its final diff, do one of these:

- **Comment `reviewed`** on the pull request's conversation, after the last push, typed by you
  (on the website, the mobile app or the command line). The first line of the comment is the word
  alone, in any letter case (`reviewed`, `Reviewed`, `REVIEWED`); anything you write on the lines
  below it is kept as part of the record. Do not edit it afterwards: post a new one instead.
- **Approve the pull request** with a review, on its current head commit (someone other than the
  author; GitHub does not let an author approve their own pull request).

The status turns to success within a minute or so. If anything is pushed after your review, the
new head commit starts pending: read the new diff and comment `reviewed` again.

What never counts:

- a comment or review by a bot;
- a comment posted through an App (GitHub marks it with the App, `performed_via_github_app`);
- a comment edited after it was posted. It is judged by its edit time: an edit after the last push
  does not count (D89), because GitHub's comment answer does not say who made the edit, and an edit before the last
  push is too early anyway. Post a new comment instead;
- a comment by someone who cannot merge to the repository (write or admin permission);
- a comment made before the last push;
- an approval given on an older commit;
- a first line with anything beside the word (`reviewed.` or `reviewed, mostly`).

## Why

The audit firm asked for "documented review of the change by the engineer" as a compensating
control in place of a second person's approval (decision D81). Every change to a gated repository
carries that review before it merges, checked by this gate and listed in the weekly list, so the
audit window holds the evidence; it costs one act per change (decision D83).

It is a commit status set by a reusable workflow, not a workflow the ruleset runs, because GitHub
runs a ruleset-required workflow only on `pull_request`, `pull_request_target` and `merge_group`,
so a review comment could never start it (decision D86). The status counts only when GitHub
Actions set it from an Engineer review run (decision D89).

## Adopting it in a repository

1. Make the repository's caller file from `engineer-review/caller.yml`, pinned to a commit on the
   shared workflow repository's `main` branch that holds the version you want:

       node engineer-review/decide.mjs caller --owner <organisation> --repo <the shared workflow repository's name> --commit <40-character commit id> > engineer-review.yml

   The template names no organisation, repository or commit; the command fills its one `uses:`
   line, refuses a branch or tag name in place of a commit id, and asks GitHub to compare
   `main...<commit>` in the shared workflow repository, refusing the commit unless the answer is
   `behind` or `identical` (the commit is in main's history). That check matters: GitHub serves a
   commit pushed to any fork of the public shared workflow repository under the repository's own
   name, so a 40-character id alone could pin an imposter commit nobody reviewed.
2. Add the result to the gated repository as `.github/workflows/engineer-review.yml` through a
   reviewed pull request. It runs on `pull_request` (opened, synchronize, reopened),
   `issue_comment` (created, on pull requests only) and `pull_request_review` (submitted), with
   `statuses: write` and `pull-requests: read`, and calls `.github/workflows/engineer-review.yml`
   in the shared workflow repository.
3. The organisation ruleset requires the status check `Engineer review` on the repository's
   default branch, from the GitHub Actions app only (set by the ruleset files, not here). Before
   the ruleset requires it, one live run from a real caller proves the workflow end to end (D89).

The shared workflow repository needs no caller: the workflow's own `pull_request`,
`issue_comment` and `pull_request_review` triggers serve its pull requests.

To move a repository to a newer version, make the caller again with the newer commit id and change
it through a reviewed pull request. **Whoever reviews a caller bump does the same check by hand**:
compare `main...<the new commit>` in the shared workflow repository (on GitHub, or
`gh api repos/<organisation>/<shared workflow repository>/compare/main...<commit> --jq .status`)
and accept only `behind` or `identical`.

The workflow fetches `decide.mjs` with `actions/checkout` (pinned to a commit) from its own
repository at its own commit, read from the `job.workflow_repository` and `job.workflow_sha`
contexts, using the run's token. If either context is empty the run fails, naming the empty
context, and sets nothing.

The job is named **Settle engineer review**, apart from the status **Engineer review** it sets, so
the required name can only be the status.

A repository that merges through a merge queue also needs the status on the queue's commit: add
`merge_group` to its caller's triggers; `decide.mjs` then settles the pull request the queue
carries and sets the status on the queue's commit.

## The evidence

The status itself carries the evidence on the commit: its description reads
`Reviewed by <login> at <time> (<comment | approving review>) on <commit>`, and its link opens the
run whose summary adds the review's own link, the head commit, when that commit was pushed, and the
reviews it did not count and why. The run also prints one `Engineer review` notice line with the
same facts as JSON (ids, logins and times only) for the readings to collect.

The push time is read from the head repository's activity (pushes, force pushes and branch
creations of the head commit to the pull request's branch); the latest one is used. With no record
of that push, a comment cannot count and only an approving review on the head commit passes.

A missing review is a pending status and a successful run, never a failed job. A run fails only
when it cannot read GitHub or cannot set the status; the commit then has no Engineer review
success, so the change still cannot merge.

**Forks and Dependabot.** GitHub gives a read-only token to `pull_request` and
`pull_request_review` runs of a pull request from a fork, and to runs Dependabot starts. Such a run
does not try to write: it ends green with a notice "Engineer review not set" giving the reason. The
head commit then has no Engineer review status, so the change cannot merge until a `reviewed`
comment arrives: `issue_comment` runs always have the repository's own token, so the comment sets
the status. A push by Dependabot after your review leaves the new head with no status until you
comment again.

## Known gap

- **A comment in the engineer's name is taken as his.** An agent or script holding the engineer's
  own GitHub sign-in can post `reviewed` in his name, and GitHub cannot tell that comment from one
  he typed (a comment through an App is told apart and refused; one through his own token is not).
  This is a recorded limit (D86); a machine guard refusing such a post is proposed separately.
- **The status can be forged by anyone who may write statuses.** A commit status is set through
  the API by any holder of `statuses: write` on the repository: another workflow, an App, or a
  person with write access using `gh api`, all with no review. The ruleset therefore requires the
  status from the GitHub Actions app alone, which shuts out Apps and people; a workflow of the
  repository itself still runs as GitHub Actions, so DZ-33 also checks each status's creator and
  that its link opens an Engineer review run of the shared workflow repository's workflow (D89).
- **Withdrawing a review does not withdraw the status.** Deleting the `reviewed` comment or
  dismissing the approval leaves the success standing until the next push; dismissals are not among
  the caller's triggers.

## Testing

`node --test test/engineer-review.test.mjs` runs the decision and the status over recorded GitHub
answers and events in `test/fixtures/engineer-review-events.json`, and checks the caller template;
nothing reaches the network.
