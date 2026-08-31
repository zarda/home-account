# 85. The deploy key's rotation is an issue the repo opens for itself

**Status:** Accepted, implemented · **Date:** 2026-08-31 · **Issues:** #350

## Context

[0077](0077-merges-deploy-what-they-changed.md) chose a scoped
service-account key over Workload Identity Federation for a single-owner
repo, and the sentence that made that trade acceptable was "a granular-role
key **with a written rotation habit**". GCP service-account keys never expire
on their own, so rotation is not a hygiene nicety here — it is the entire
compensating control for the decision 0077 made.

**The control existed only as prose.** [../deploy.md](../deploy.md) carried
the rotation commands and the WIF revisit condition, but no cadence, and
nothing anywhere fired on one. #350 was explicit that closing it required
both halves: a cadence written down, and something that actually fires —
"discipline alone does not count".

**The repo already has a place where work that must happen becomes
visible.** Its own issue list is where every other piece of outstanding work
in this project lives, and it is the only such place that a second person
could inherit.

## Decision

**Semi-annual — January 1 and July 1 at 09:00 UTC — and a scheduled workflow
opens the rotation issue using the repo's own `gh`.**
`.github/workflows/rotation-reminder.yml` is one job with one step: cron
`0 9 1 1,7 *` plus `workflow_dispatch`, `permissions: issues: write`, no
checkout, and no `uses:` anywhere.

**Twice a year is the interval at which the reminder is still an event.** The
key's exposure is a secret store and a runner, not a public endpoint;
quarterly rotation of a single deploy key would earn a reflex to close the
issue rather than act on it, and annual leaves a year-old key in place as the
normal state. Semi-annual keeps the maximum age of a live key at six months
and the ceremony at two occurrences.

**The issue carries the whole procedure, not a pointer to it.** The body is
the five rotation commands read verbatim out of the runbook (line
continuations joined so each is one checklist item), a sixth item to confirm
the rotation through the next merge or a dispatched deploy, a link to
`deploy.md#key-rotation`, and the WIF revisit condition restated so it stays
visible at the moment someone is actually handling the key. The revisit
condition itself is unchanged from 0077: if key creation is ever
policy-blocked (`iam.disableServiceAccountKeyCreation`), Workload Identity
Federation is the path forward.

**The dedup is exact, and it fails hard.** The step lists open issues, and
creates one only when no *open* issue has that exact title — a fixed-string,
whole-line match, so a related issue whose title merely contains the phrase
neither suppresses the reminder nor gets mistaken for it. If the listing
itself fails, the step exits 1 with a message instead of falling through to
create.

Rejected: **a marketplace action that opens an issue from a template.** This
is 0077's rejection of third-party actions in the deploy pipeline, extended:
the entire body of this workflow is a `gh` call and a `grep`, and importing a
dependency to save those lines buys a supply-chain surface in a repo whose
workflows hold deploy credentials. Rejected: **a calendar entry.** It fires,
but it fires into one person's account and leaves nothing in the repository —
the reminder disappears with the calendar, and no one else can see that the
control exists. Rejected: **automation that checks the key's age and warns.**
Keys have no expiry to check against, so such a job would be measuring
`keys list` output to reproduce a date arithmetic the cadence already states,
and it would need credentials of its own to do it.

## Departures from the issue

- The issue accepted "a scheduled reminder, a calendar entry, or a recurring
  issue" as equivalents. They are not: only the third leaves evidence in the
  repo, so the recurring issue was chosen rather than picked.
- The cadence sentence in the runbook was written as part of the workflow's
  own commit rather than left to this record, because the link in the issue
  body points at it — and that link is what promoted the rotation paragraph to
  a real `### Key rotation` heading.

## Things that only became apparent while building

- **The obvious dedup one-liner fails in the wrong direction.** The first
  shape was `gh issue list … | grep -Fxq "$TITLE"`. Grep's own "no match"
  exit is 1 whether `gh` failed outright and printed nothing, or `gh`
  succeeded and the title genuinely isn't there — the `if` cannot tell them
  apart, with or without `pipefail`. `pipefail`, which GitHub's default
  shell flags set, widens the same hazard rather than causing it: it lets
  `gh`'s own non-zero exit outrank a `grep` that already found the match, so
  even a `gh` call that fails only *after* printing the matching title still
  fails the pipeline. Either way, the one failure where the reminder cannot
  see what already exists is the failure where it opens a duplicate.
  Splitting the listing into its own command, failing the step when it
  errors, and grepping the captured text makes an unreadable issue list a
  red run rather than a second open issue.
- **A quoted heredoc delimiter is load-bearing here, not stylistic.** The
  issue body is a checklist of shell commands in backticks; with an unquoted
  delimiter the shell would have run `gcloud iam service-accounts keys create
  …` while *building the body*. The quoted form was verified by a canary that
  would have left a marker file had anything in the body executed.
- **YAML block-scalar dedent decides whether the checklist renders.** Every
  heredoc line has to sit at the same column as the rest of the `run:` block,
  so the real script sees them at column 0 — otherwise the terminator does not
  match at all, and any line that survives with more than three leading spaces
  is read by GFM as a code block, which would swallow the checklist.

## Known gaps

- **Scheduled workflows run the default branch's copy of the file.** A change
  to this reminder is never exercised by the pull request that makes it, and
  only takes effect once merged — the same shape as 0077's "a workflow change
  ships unexercised". `workflow_dispatch` is both the test path and the manual
  override, and it is the cheap way to find out on purpose.
- **Cron here is best-effort, and it can be switched off by inactivity.**
  GitHub delays scheduled runs under load, and disables scheduled workflows
  entirely after 60 days without repository activity. Neither matters much on
  an active repo with a twice-yearly job — but a repo that goes quiet for two
  months loses precisely the reminder that a quiet repo most needs.
- **Nothing verifies that the rotation happened.** The issue is opened, and a
  human closes it. Because the dedup only looks at *open* issues, an issue
  left open through the next cadence suppresses the next reminder rather than
  escalating — the reminder is a prompt, not a tracker.
- **The dedup only ever sees the first 100 open issues.** `gh issue list
  --state open --limit 100` caps the listing there; a repo carrying more
  open issues than that could have the exact-title match miss the existing
  one and open a duplicate anyway.
