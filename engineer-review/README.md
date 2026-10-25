# Engineer review

The check **Engineer review** passes a pull request only when a person who may merge to the
repository has recorded a review of the commit that will merge.

## What you do: one act per change

When the change is ready and you have read its final diff, do one of these:

- **Comment `reviewed`** on the pull request's conversation, after the last push. The first line
  of the comment is the word alone, in any letter case (`reviewed`, `Reviewed`, `REVIEWED`);
  anything you write on the lines below it is kept as part of the record.
- **Approve the pull request** with a review, on its current head commit (someone other than the
  author; GitHub does not let an author approve their own pull request).

If anything is pushed after your review, the review no longer covers what will merge and the
check goes back to pending: read the new diff and comment `reviewed` again.

What never counts: a comment or review by a bot; a comment by someone who cannot merge to the
repository (write or admin permission); a comment made before the last push; an approval given on
an older commit; a first line with anything beside the word (`reviewed.` or `reviewed, mostly`).

## Why

The audit firm asked for "documented review of the change by the engineer" as a compensating
control in place of a second person's approval (decision D81). Every change to a gated repository
carries that review before it merges, checked by this gate and listed in the weekly list, so the
audit window holds the evidence; it costs one act per change (decision D83).

## The evidence

`decide.mjs` writes into the check's summary who reviewed, when, how (comment or approving
review, with its link), the head commit, and when that commit was pushed; it also lists the
reviews it did not count and why. It prints one `Engineer review` notice line with the same facts
as JSON (ids, logins and times only) for the readings to collect.

The push time is read from the head repository's activity (pushes, force pushes and branch
creations of the head commit to the pull request's branch); the latest one is used. With no record
of that push, a comment cannot count and only an approving review on the head commit passes.

## When it runs

`pull_request` (opened, synchronize, reopened) and `merge_group` runs are the check: they fail
while the review is pending. `pull_request_review` and `issue_comment` runs settle the same
question and, when it passes, re-run the failed `pull_request` run on the head commit so the check
on the pull request reads the review; they never fail themselves, because their result is not
attached to the pull request.

**Known gap.** GitHub runs a workflow required through an organisation ruleset only on
`pull_request`, `pull_request_target` and `merge_group`, at their default activity types; it
ignores the other triggers. In a repository that has this workflow only through the ruleset, a
`reviewed` comment therefore starts nothing: re-run the failed **Engineer review** job once after
commenting (or approve, then re-run). The comment and review triggers work where this workflow
file lives in the repository itself.

## Testing

`node --test test/engineer-review.test.mjs` runs the decision over recorded GitHub answers in
`test/fixtures/engineer-review-events.json`; nothing reaches the network.
