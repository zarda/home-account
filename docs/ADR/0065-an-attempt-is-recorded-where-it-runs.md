# 65. An attempt is recorded where it runs

**Status:** Accepted, implemented · **Date:** 2026-08-23 · **Issues:** #151

Closes the first known gap of
[0008](0008-universal-receipt-language-support.md) — "there is no diagnostic
channel" — and extends the provenance
[0060](0060-a-confirmed-import-keeps-its-photos-and-names-its-source.md) put
on the Import History record. The event registry and the privacy boundary
live in [../analytics.md](../analytics.md); what each door records and what
the Import History page now shows is in
[../receipt-import.md](../receipt-import.md) under *Failure surfacing*.

## Context

`receipt_import` reported `ok | failed | queued_offline` and nothing else.
Which engine ran, whether a native-to-cloud or cloud-to-native fallback fired,
which provider answered, how long it took and what class of error occurred
were all computed in `AIStrategyService.runProcessing` and thrown away: four
`console.warn`s for the fallbacks, a `_lastProcessingTime` with no reader, a
`getLastError()` with no caller. `parseAIError` classified an error into a
closed set that the wizard painted as an icon and never sent. Every language
and currency defect fixed in the receipt waves was found by reading code,
because nothing recorded what had happened.

The record side was worse. `ImportHistory` was written at the wizard's
*confirm* step only — after a successful extraction — so a failed extraction
left nothing anywhere, and the in-form scan wrote nothing under any outcome.

Exploring the two call sites found the existing figure already wrong in three
ways, before any parameter was added:

- **A bank-statement screenshot counted as a receipt.** The wizard's gate was
  "at least one image file", and a statement photo is an image, contradicting
  the registry's own exclusion list.
- **The outcome came from a row count that mixed doors.** Both wizard
  branches read `extractedTransactions().length`, the running total across
  images *and* CSV, PDF and JSON, so a CSV that yielded rows made an
  image-only failure report `ok`.
- **The wizard could fire twice per run**, once after the images and again
  from the catch when a later file threw; the camera had a de-duplicating
  flag across its five branches and the wizard had none.

And there was a fourth door nobody had listed: the offline queue processor,
draining unattended, emitting nothing and writing no record.

## Decision

**An attempt is recorded where it runs**: the facts are produced at the one
chokepoint that knows them, every door reports through one handle that emits
at most one event, and a failure writes a record at the moment it fails.

### Diagnostics are produced at the chokepoint

`runProcessing` now returns `ReceiptAttemptDiagnostics` —
`{ engine, fellBackFrom?, provider, durationMs, errorType?, retryable? }` —
measuring the duration in `finally` so a throw records one too, and turning
the four fallback warnings into the `fellBackFrom` field. A successful result
carries it as `ProcessingResult.diagnostics`; a failure is thrown as
`ReceiptProcessingError`, which carries the diagnostics and the `cause` and
whose message is the cause's own, so every sentinel comparison and every
provider wording shown to the user is unchanged. The error classifier moved
out of `AIImportService` into `ai-error.utils.ts`, with the three sentinel
codes, so the chokepoint can call it without a dependency on the wizard's
service; `AIImportService.parseAIError` delegates and its callers are
unchanged.

### One handle per attempt, one event per handle

`ReceiptAttemptService.begin(door, kind, files)` returns a `ReceiptAttempt`
with three terminals — `succeeded(result)`, `failed(errorOrReason)`,
`queued()` — and the handle sends at most one `receipt_import` however many
terminals a door's control flow reaches. The camera's five branches and the
flag that guarded them collapse into one handle; the wizard opens one per
`processFiles`; the in-form scan, which reported nothing, opens one as door
`form`; the queue processor opens one as door `queue`. `trackReceiptImport`
stays strictly typed and has one call site, the service — the registry's
source column names one file, and the compiler holds the payload to the
taxonomy.

### The event is enumerated, the record is exact

Two channels, two jobs. The event carries six enumerated parameters —
`outcome`, `path`, `engine` (with `cloud_after_native` and
`native_after_cloud` for a fallback), `provider`, `failure`, `duration` as a
bucket — because `validateAnalyticsParams` drops any value outside its list
and any payload missing a declared key, and because a millisecond count or a
provider's error prose must never leave the device. The record carries the
exact values: `ImportHistory` gains optional `door`, `engine`, `fellBackFrom`,
`provider`, `errorType` and `durationMs`, validated by `importOptionalsValid`,
written by the handle on failure and by the confirm step on success from
`ImportResult.diagnostics`, which replaces the never-read `processingSource`.

### A failed attempt is an `imports` record

The record goes in the existing `users/{uid}/imports` collection with
`status: 'failed'`, `source: 'image'`, a `fileType` of `receipt_image` or
`screenshot`, the first file's name and size, the row counters at zero
(`transactionCount`, `successCount`, `skippedCount`, `errorCount`,
`totalIncome`, `totalExpenses`, `duplicatesSkipped` are required on every
record), and the diagnostics. The collection already had a door, a cascade
step, a catalogue row, rules and a UI
([0029](0029-every-stored-kind-has-one-door.md)); a sibling collection would
have needed all of those again for a record that differs from the existing
one only in having no rows. The real cost of sharing the collection was a
read nobody had bounded: `getImportHistory` subscribed to the whole
collection. It is now bounded to the newest two hundred.

### The queue records, and sends nothing

`queued_offline` is terminal for the attempt, as the registry has always
said. Door `queue` opens a handle so the policy is enforced in one place
rather than by the absence of a call: on failure the handle writes the
failed record with `door: 'queue'` — the user can see why a photo taken on
the train produced nothing — and on every outcome it sends no event, because
the photo was counted as `queued_offline` when it was queued and a second
event from the drain would put two events on one attempt.

### Statement screenshots are not receipts

The handle is opened for the receipt kind only, so a statement photo reports
no `receipt_import`, as the registry already claimed. The outcome comes from
the image extraction's own result, not from a row count shared with the CSV.

### The alternatives that were rejected

- **A sibling `importAttempts` collection.** Cleaner in name, and a new
  deletion step, catalogue row, rules function, carve-out entry, data-hub row
  and settings door in cost — for a record that is an import with no rows.
- **Writing the record from `runProcessing`.** The chokepoint knows the
  facts but not the door, the kind or the files, and giving a root strategy
  service a Firestore dependency so that every in-form scan writes a document
  was the wrong direction. The chokepoint produces; the handle records.
- **Tagging each call site by hand.** That is how the camera grew five
  branches and a flag. One more parameter per branch is the same shape, worse.
- **A raw `duration_ms` parameter.** Not enumerable, so the validator drops
  the event. The bucket is the analytics answer; the record keeps the number.
- **A `fell_back: true|false` parameter beside `engine`.** Two dimensions to
  register and a pair that can disagree. Folding the fallback into `engine`'s
  value keeps one dimension honest.
- **An event from the queue drain.** See above: it corrupts the denominator
  the figure exists to measure.
- **Keeping the wizard's row-count outcome** to avoid changing the series.
  The series was already wrong; changing it is the point.

## Consequences

- **The reliability series changes meaning at this version.** Statement
  screenshots leave it, the wizard's double count leaves it, and the outcome
  is the image extraction's own. Comparisons across the version boundary are
  not like-for-like, and this record is the only place that says so — the
  registry's *Since* column names the release the row first shipped in, and
  stays `1.16.91`.
- **`analytics:check` holds one source file for `receipt_import`.** A door
  that called `trackReceiptImport` directly would fail CI until the registry
  named it, which is the intended friction.
- **Import History becomes a log of attempts, not of confirmed imports.**
  Failed extractions appear with the error class, engine and provider, and
  the page is bounded to the newest two hundred records.
- **The `imports` rules must be deployed** before the enum validation
  applies in production. The key set was already open, so an undeployed
  rules file accepts the new fields unvalidated rather than refusing them —
  a quieter failure than `tagMemory`'s in 0063, and worth the bold line in
  the pull request.
- **The camera dialog's own error mapper is gone**; it classifies through
  the same `parseAIError` every other door uses.

## Departures from the issues

- **Statement screenshots are excluded from `receipt_import`.** #151 asked
  for a richer event on the existing population; the population was found to
  include bank statements, contradicting the documented rule, and the kind
  gate fixes that in the same change rather than describing it better.
- **The in-form scan writes a record only on failure.** The issue asked for
  "a record on both entry points". A successful in-form scan produces a
  transaction the user is about to save, and that transaction is the record;
  a second document per scan would double the collection for nothing a
  failure does not already capture.
- **The currency that was read is not on the event.** The issue listed it
  among the discarded values; it is a value the privacy boundary forbids
  sending, and the record carries the transaction's currency already.

## Things that only became apparent while building

- **The duration was measured inside the `try`.** A throw — the case the
  whole record exists for — recorded no duration at all, and left the
  previous run's figure standing in the signal. Moving the measurement into
  `finally` is what makes a failed attempt timed exactly like a successful
  one.
- **"The other engine ran and lost" is distinguishable from "the other
  engine ran and won" only by object identity.** `preferUsable` returns the
  *same reference* it was given when the alternative throws or reads no
  better, and a fresh object when it wins. That identity check is what
  separates a real cross-engine fallback from a fallback that was attempted
  and rejected — a comparison of contents would report both as a fallback.
- **A provider can be reported for a request that never left the process.**
  The provider used to be stamped before the cloud call, while the cloud
  path opens with an availability check that throws when the device is
  offline — and that check consults connectivity while the provider
  resolver consults only configuration. An offline phone with a key
  configured would therefore report "sent to Gemini, network error" for a
  request nothing ever sent; the provider is now resolved only once the
  availability check clears.
- **One branch has no error to classify.** The camera's no-provider path
  sets a message and returns without throwing, so there is no error object
  for the classifier to read — which is why the pipeline's own reasons
  (`no_provider`, `nothing_extracted`, `queue_write`) exist alongside the
  classified ones rather than being derivable from them.
- **The survey that found the gap miscounted the thing it was describing.**
  The queue's hand-built DTO named seven fields, not six; the number was
  repeated into a door matrix and a spec comment before anyone counted them.
  Worth knowing if the number turns up quoted somewhere this branch did not
  reach.

## Known gaps

- **The five GA4 dimensions are registered by hand**, after merge, in the
  console. Until `path`, `engine`, `provider`, `failure` and `duration` are
  event-scoped custom dimensions they are collected and appear in no report,
  and GA4 does not backfill.
- **Web events fired offline are dropped.** gtag has no queue, so
  `queued_offline` — the branch that describes exactly that state — is
  under-reported on the web and persisted on iOS. The record is the
  denominator; the event is not.
- **The queue door sends no event by decision**, so a receipt that queued
  and later failed in the drain is in Import History under door `queue` but
  not in the `receipt_import` series, which counted it as `queued_offline`
  at the moment it queued. A queued receipt that drains successfully leaves
  no record at all — its transactions are the record, as for the form.
- **A successful in-form scan leaves no record**, by the departure above.
- **Failed attempts count towards the data hub's `imports` figure.** The hub
  counts documents; a user who scans badly lit receipts will see the number
  rise without importing anything.
- **The on-device engine reports no provider**, so a native attempt's
  `provider` is `none`, and a native-then-cloud fallback names the cloud
  provider that finished.
