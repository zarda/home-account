# 87. The deploy is not green until its indexes are built

**Status:** Accepted, implemented · **Date:** 2026-08-31 · **Issues:** #352

## Context

`firebase deploy` returns as soon as Firestore accepts an index definition.
The build itself is asynchronous and takes anywhere from seconds to minutes on
a populated collection, so a merge could show a fully green deploy while the
query its new index serves still threw `failed-precondition` — an error that
[0035](0035-what-the-emulator-cannot-see-is-checked-from-the-files.md)
deliberately does not retry, so the user sees it on the first attempt. Green
CI, shipped release, broken feature.

**This was 0077's first known gap.** Automating the deploy moved the release
into CI but left the verification outside it: both reference documents told a
human to watch Firestore → Indexes until every entry read **Enabled**, after
any merge that added entries. A manual step at the end of an automated
pipeline is the shape of failure that pipeline was built to remove.

**The emulator makes the index file the least-exercised artifact in the
repo.** It serves any query, indexed or not
([../emulator-blind-spots.md](../emulator-blind-spots.md)), so nothing local
ever proves an index exists — which is how ten of fifteen transaction filter
combinations once shipped broken. The one moment the truth is knowable is
right after the deploy, and nothing was looking.

## Decision

**`deploy-web` polls index state after the deploy and fails the job when the
bound is hit.** `scripts/wait-for-indexes.mjs` runs immediately after the
`Deploy` step, under the same stand-down guard, polling every 15 seconds for
up to ten minutes until no index is left in a non-`READY` state.

**Red after `Deploy` means shipped but unverified.** The release has already
happened by the time this step reports; a failure here is never "nothing was
released" and never a reason to roll back. Every failure message says so, and
names the recovery: watch the console until every entry reads Enabled, then
re-run the job — re-deploying identical content is safe.

Rejected: **warning instead of failing.** A warning printed on an otherwise
green run is read by exactly the people who were already reading green runs,
which is the manual watch with extra steps. There is one moment where the
answer changes what anyone does, and a red check is the only signal that
reaches it. Rejected: **the issue's other permitted outcome — recording the
numbers and confirming the manual watch as deliberate.** The numbers were the
argument against it: in the overwhelmingly common case, where every index is
already READY, the wait is a single poll that reports having waited no time at
all — so the manual watch would have been kept to save nothing.

### A zero-dependency poller, in the job that holds the deploy key

The credential is already on the runner: `google-github-actions/auth` exports
`GOOGLE_APPLICATION_CREDENTIALS` for firebase-tools. The script signs an
RS256 assertion with `node:crypto`, exchanges it for an access token through
the service-account JWT flow, and reads the Firestore Admin API with Node's
global `fetch`. Nothing is installed, and no third-party code enters the most
credential-sensitive job in the repo — the same reasoning 0077 used to reject
a marketplace path-filter action, applied to the same workflow.

The token requests **both** scopes, `datastore` and `cloud-platform`:
`datastore` is what the Firestore Admin API checks for this read, and
`cloud-platform` is the one the CLI's own credential path already requests —
which moots the question of whether the narrower one alone would have
sufficed.

### What is fatal, and what is patient

- **401 or 403, at either the mint or a poll → fail immediately.** An IAM
  answer does not become a different answer ten minutes later, so this refuses
  now instead of burning the budget, and points at the runbook's grant
  procedure: read the error, grant exactly what it names, re-run.
- **400 or 404 at the poll → fail immediately, with its own message.** A
  wrong path or a rejected wildcard is a request the API will never accept.
  Letting it run out the clock would report a timeout, and a timeout headline
  blames the index build for a defect in the URL. For the same reason, the
  timeout message distinguishes three different truths — indexes still
  building, the list was never read, a token was never obtained — because
  "timed out" alone would send someone to watch a console that was never the
  problem.
- **`NEEDS_REPAIR` → fail immediately.** It never becomes `READY` on its own;
  the rebuild is a deliberate local act.
- **At the poll, 5xx, 429 and network errors → logged, retried inside the
  budget.** Each costs one interval, not the job. At the mint, the same
  patience covers only 5xx and network errors — anything else, a 429 or a
  400 (`invalid_grant` included), is immediate, the same as 401/403.
- **Every unfamiliar state counts as building.** `READY` is done and
  `NEEDS_REPAIR` is fatal; `CREATING`, `STATE_UNSPECIFIED` and whatever
  Firestore adds next year all count as not-yet-built. An unknown state can
  cost time; it can never pass an unbuilt index off as verified.

### The bound means what it says

Each request carries an `AbortSignal` timeout (floored at 5s, twice the poll
interval, capped at 30s), so one hung socket cannot stretch a ten-minute
budget; the workflow step carries `timeout-minutes: 15` so a wedged process
cannot outlive the bound it advertises; and pagination stops at 50 pages, so a
server handing the same `nextPageToken` back cannot page forever inside a
single poll.

## Departures from the issue

- The issue named `gcloud firestore indexes composite list` *or* the Admin API.
  The API was chosen so the step depends on nothing the runner image happens
  to ship and nothing installed at deploy time.
- The issue framed this as an investigation with two acceptable endings; only
  one of them was ever going to survive the first sentence of the other. The
  work went straight to the implementation.

## Things that only became apparent while building

- **The token mint needed the same patience as the poll.** The first shape
  minted once, before the budget started, and failed hard on any mint error —
  so a momentary 5xx at Google's token endpoint would have failed a deploy for
  a reason that had nothing to do with indexes. The mint now retries inside
  the same ten-minute budget for 5xx and network errors (401/403 and every
  other non-retried status still immediate), and running out of budget there
  produces its own message saying the token was never obtained, so nobody
  goes looking at index state that was never read.
- **An unreadable poll must never look like an empty index list.** That is the
  one bug in this script that produces a silent false green, and it has two
  shapes: a 5xx misclassified as "no indexes found", and a partial listing
  that treats the indexes it never saw as READY by omission. Hence following
  `nextPageToken` to the end, and hence the only thing that counts as "nothing
  to wait for" being a page that genuinely carries no `indexes` key.
- **Reading a credentials file is a place secrets escape through error
  messages.** `JSON.parse` reports the fragment it choked on, and that file
  holds a private key. The parse is wrapped in a bare `catch` with no error
  binding, so V8's message cannot be interpolated even by accident; the
  failure names the path and says the file is not valid JSON.

## Known gaps

- **The step is first proven by the merge that ships it.** `.github/**`
  deploys nothing (0077), so a workflow-only change is never exercised by its
  own pull request; this one rides along only because the same branch touches
  `scripts/**`. The whole token-and-poll loop is self-tested offline against a
  local stub server, which is not the same as having run once for real.
- **The 403 branch is a hypothesis until it fires.** `github-deploy` holds
  `roles/datastore.indexAdmin` for the deploy itself, which should cover the
  Admin API read; if the raw API wants something else, the first live run says
  so, and the message is written to name what to grant.
- **Ten minutes is a guess.** An index over a large collection can take
  longer, and a red run there would be correct but noisy. Re-running is the
  answer; raising the bound is a decision for the first time it actually
  happens, with a real duration to raise it to.
- **This waits for what the project reports, not for what the file
  declares.** An index the deploy silently failed to create would leave
  nothing behind to be non-READY. `npm run indexes:check` is what proves the
  file is complete; this proves the project finished building what it
  accepted.
