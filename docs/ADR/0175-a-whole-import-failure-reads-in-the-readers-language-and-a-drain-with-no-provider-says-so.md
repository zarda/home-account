# 175. A whole-import failure reads in the reader's language, and a drain with no provider says so

**Status:** Accepted, implemented · **Date:** 2026-10-11 · **Issues:** #487

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Applies [0036](0036-a-user-facing-string-lives-in-the-catalog.md): the last
error line an in-app writer leaves on an Import History card stops showing
its stored English.

Amends [0065](0065-an-attempt-is-recorded-where-it-runs.md). Its handle, its
one event per attempt and its one classifier stand. What changes is what the
classifier is told: `classifyReceiptFailure` takes an optional context, and
files the cloud sentinel as `no_provider` when that context says no provider
is set.

Amends
[0170](0170-the-animations-runtime-the-unregistered-worker-and-nine-dead-items-come-out.md).
Its reading of the history's error lines through the catalog stands. Two of
its statements do not: that a drain which failed online for want of a
provider says to add a key and not to check the connection, and that a
whole-import failure shows its stored English.

It closes a gap of 0170.

## Context

0170 read Import History's error lines through the catalog, and #487 found
two lines on a card that still said the wrong thing.

- **A whole-import failure read in English in every language.** The
  confirm's catch handed `failImport` the thrown error's message alone. The
  row loop, the budget recalculation and the memory writes each catch their
  own failures, so in practice only a refused `completeImport` reaches that
  catch, and it is refused *after* the rows landed. The record it left had no
  `errorType`, no row id and no `originalValue`, and no Firestore `code`
  either, though a refused row keeps one. Neither branch of `errorLineKey`
  matched it, so the card printed *Missing or insufficient permissions.* or
  the literal *Import failed*. 0170 recorded this as a Known gap, and a spec
  pinned the fallback.
- **A queued scan that failed for want of a key was labelled *Connection
  problem*.** On the web the drain hands a photo to the strategy with no
  provider gate of its own, and `ensureCloudAvailable` throws
  `AI_CLOUD_UNAVAILABLE` for two causes: no connection, or no provider.
  `parseAIError` classes that sentinel `network`, `runProcessing` stamps the
  class on its diagnostics, and `classifyReceiptFailure` prefers the
  diagnostics' class. The line under the label came from the stored sentence,
  which `OWN_SENTENCE_KEYS` maps back to `import.errorCloudUnavailable`, and
  that sentence names both causes. So 0170's reading, that such a drain says
  to add a key and not to check the connection, was half true: the line
  offered both, and the label above it blamed only the connection.

No other door reaches that sentinel online with no key. The wizard's
`holdOrRefuse` throws `AI_NO_PROVIDER` when the device is online, the camera
checks for a provider first and files the `no_provider` reason, and the form
starts no attempt without an engine. On iOS the drain reads natively when no
provider is set.

Three facts kept the fix small:

- **`no_provider` was already a class everywhere it is checked.** The rules'
  closed list of failure classes and `analytics-events.json` both name it, so
  neither file changes and no rules deploy is needed for this fix.
- **No reported event moves.** The queue door records and never sends
  (0065), and the doors that do send already file an online attempt with no
  provider as `no_provider`.
- **The row's reading already existed.** `importFailureKey` placed a refused
  row's error by its code, then by its prose, and `errorCode` already read a
  Firestore code off a caught value. A whole import needed the same reading
  and different sentences.

## Decision

**A whole-import failure keeps the code it was refused with. Import History
reads a failed record with no class and nothing naming a row through the same
family reader as a refused row, into a sentence about the record. The cloud
sentinel is filed as `no_provider` only when the attempt knows, as it fails,
that no provider is set, and the record then carries no diagnostics.**

Each commit is cited by its subject.

### The refusal keeps its code

`fix(import): a whole-import failure keeps the code it was refused with`
changes the confirm's catch. The entry it hands `failImport` is
`{ message, ...(code ? { code } : {}) }`, with `code` read through
`errorCode(error)`.

- **The key is left out when no string code was read.** Firestore rejects an
  undefined field, and the pin *should fail the import and rethrow when
  completion throws* asserts the key is absent for a plain `Error`.
- **The message stays**, for logs. It is all a record written before holds.
- **`failImport` keeps its signature.**

`refactor: the row loop reads a refusal's code through errorCode` moves the
row loop's inline copy of the same test onto that helper
([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).

### One family reader, two tables

`fix(i18n): Import History reads a whole-import failure in the reader's
language` splits `importFailureKey` in `import-review.utils.ts` into a reader
and two tables.

- **`importFailureFamily(error)`** returns `'amount' | 'connection' |
  'unknown'`, in `importFailureKey`'s old order:
  1. the amount guard's sentinel, `INVALID_TRANSACTION_AMOUNT`;
  2. then, only when `error.code` is truthy, the code against
     `CONNECTION_CODES`. A connection code is a connection, and any other
     code is unknown and final, so the prose is not consulted. An empty or
     absent code falls through;
  3. then the lowercase message ladder: `permission-denied`, `unavailable`,
     `network`. A message that is not a string reads as empty, because a
     restored record keeps whatever it was given.
- **`ROW_FAILURE_KEYS`** holds the three `import.rowFailed*` keys.
  `importFailureKey` reads it, and its output is unchanged.
- **`WHOLE_IMPORT_FAILURE_KEYS`** maps `connection` to
  `import.wholeFailedConnection`, and `amount` and `unknown` to
  `import.wholeFailedUnknown`. The amount guard refuses one row, never a
  whole import, so a whole import read as amount is a shape nothing writes
  and says no more than unknown does. `wholeImportFailureKey` reads it.
- **Both tables are typed `Readonly<Record<ImportFailureFamily, string>>`**,
  so a new family does not compile until both name it. *keys every family, as
  the row table does (pin)* holds the two to the same families.
- **`CONNECTION_CODES` stays private and single.** `permission-denied` is in
  it, as it was for rows, so a completion the rules refused reads as a
  dropped connection.

### The gate

In `errorLineKey`, after the own-sentence and `errorType` lookups and before
the row branch, a line on a record with `status: 'failed'`, no `errorType`,
and neither `transactionId` nor `originalValue` returns
`wholeImportFailureKey(error)`.

- **A record whose every row was refused** is stamped failed too, but each of
  its lines names its row, so it still reads per row. *still reads a record
  whose every row was refused by each row's reason (pin)* holds that.
- **A completed record's bare message** is untouched.
- **A failed receipt attempt always carries its class**, because 0065's
  handle writes one on every failed record. So the gate takes no attempt
  record the app wrote.
- **What still falls back to the stored text** is a line in no shape a writer
  produces: one naming no row on a record that did not fail, or a row's line
  with no message, as a restore or a write from outside the app may leave.

### The record, not the rows

The two sentences say the import's *record* could not be finished, and that
its transactions may already be in the list:

- `import.wholeFailedConnection`: *This import's record could not be finished
  because the connection dropped. Its transactions may already be in your
  list, so check before importing again.*
- `import.wholeFailedUnknown`: *This import's record could not be finished.
  Its transactions may already be in your list, so check before importing
  again.*

What reaches the catch is a refused completion after the rows landed. A
sentence that said nothing was saved would be false, and would invite the
duplicate import the check guards against. ja and tc follow the catalog's
voice. A whole-import failure shows no `.failure-class` label, because it is
not a receipt attempt and has no receipt class.

### Every key the history can return is in the catalog

The component exports `FAILURE_SENTENCE_KEYS` and `OWN_SENTENCE_KEYS`, as
`BUDGET_TABS` is exported for its spec. The case *finds every sentence an
error line can read in the English catalog* collects the four tables and
checks that each key resolves to a non-empty string in `en.json`.

- **`i18n:check` cannot see these keys.** It reads literal keys, and every
  key here is returned from a function.
- **The suite's translation stub echoes any key**, so a missing one would pass
  every other case and reach the reader as a raw key.
- **The tables are the whole list.** `errorLineKey`'s comment says a new
  branch adds its keys to a table rather than returning a literal.

`translation-keys.spec.ts` holds en, ja and tc to the same keys.

### A drain with no provider is filed as no provider

`fix(import): a scan that fails online with no provider set is filed as no
provider` changes the classifier, the handle and the drain.

- **`classifyReceiptFailure(errorOrReason, context?: { providerAbsent?:
  boolean })`.** When the error's message is `AI_CLOUD_UNAVAILABLE` and
  `context.providerAbsent` is true, it returns `{ failure: 'no_provider',
  diagnostics: null, message: REASON_MESSAGES.no_provider }`. The test runs
  before the diagnostics are read, since their class, `network`, would win
  otherwise. A `ReceiptProcessingError` takes its cause's message, so the
  wrapped sentinel matches too.
- **The stored sentence follows the class.** `REASON_MESSAGES.no_provider` is
  the sentence the camera's `no_provider` reason stores, and
  `OWN_SENTENCE_KEYS` reads it back as `import.errorNoProvider`. That
  matters because the own-sentence lookup answers before the class: a class
  change that kept the cloud sentence would have put the two-cause line under
  *No AI provider configured*.
- **Without the context, nothing changes.** The parameter is optional, and
  with `providerAbsent` false or absent the classifier answers as before. A
  real connection failure, `Failed to fetch`, stays `network` even when no
  provider is set.
- **The strategy is not touched.** It still stamps `network` on its
  diagnostics, and the strategy's spec that pins that stands. The
  reclassification belongs to the classifier, the one place both the record
  and the event pass through.

`ReceiptAttemptService` injects `PwaService` and `ProviderKeyService`, and
`failed()` passes `{ providerAbsent: this.providerAbsent() }`.
`providerAbsent()` is true only when all four hold:

- the device is online;
- `keys()` is loaded, not `null`;
- `loadFailed()` is false;
- no provider has a key: not `gemini`, `openai` or `claude`.

It is read when the attempt fails, not when it begins, so a key load that
lands while an attempt runs is seen. *reads the keys when the attempt fails,
not when it begins* holds that. The pin *keeps a drain under network, with its
engine slots, while the provider's absence is not known (pin)* starts from
the absent state and flips one condition at a time: offline, keys `null`, a
failed load, or a Gemini, an OpenAI or a Claude key. Each of the six saves a
`network` record.

The drain waits for the account's key read before it opens its attempt.
`OfflineQueueProcessorService` injects `ProviderKeyService` and awaits
`resolve()` after the ownership check. After a cold offline start the read
the reconnect starts is still in flight when the drain runs, and for an
account that never set a key only the server can answer it: there is no
secrets document, so the read rejects offline. Without the wait, every such
drain failed before that read landed and was filed `network`. `resolve()`
joins a read in flight, or starts one, and answers at once from keys already
loaded. A read that fails resolves too, with `loadFailed()` set, so the drain
then stays `network`. *waits for the account's key read before it opens the
attempt or hands the photo on* holds the order: while the read is held,
neither the attempt nor the strategy is reached.

The drain smoke's failed-drain case does not read the keys first. It starts
with them not loaded, waits for a `door: 'queue'` record with `errorType:
'no_provider'`, and then finds them loaded and empty, by the drain's own
read.

### The diagnostics go with the reclassification

The strategy's diagnostics describe a cloud pass that never named a
provider. A reclassified failure drops them, so its record has no engine, no
provider and no duration. The queue's no-provider card then matches the
camera's: *No AI provider configured* with no *Cloud* chip and no duration.
The camera's `no_provider` reason never carried diagnostics, since there is
no error object to read them from (0065).

## What was rejected

- **"Online" alone, as the issue proposed.** A device that cold-started
  offline drains on reconnect, and that is the offline queue's main
  scenario. There the key read can fail, and the cloud path refuses with the
  same sentinel until the providers are up with the key it found, so a drain
  filed by "online" alone could read *no provider* on a device with a key
  set. Only keys that were read, without a failure, and hold none say that no
  provider is set.
- **A label lookup in the history component**, keyed on the stored sentence
  the way `OWN_SENTENCE_KEYS` reads the line. The issue turned it down: it
  fixes the card and leaves the record's class wrong in every backup.
- **Throwing `AI_NO_PROVIDER` from `ensureCloudAvailable` when online.** The
  issue turned it down too. It changes what every caller of the strategy
  catches, for one caller's sake.
- **Filing a whole-import failure under a receipt class.** `unknown` would
  put *Unknown error* above a CSV import, and its sentence is about an image.
- **Reusing the `import.rowFailed*` sentences.** They say *this row*.
- **A reader for each shape.** A second copy of the code test and the prose
  ladder ([0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)).
  One reader names the family and two tables name the sentences.

## Consequences

- **Two record shapes change.**
  - A whole-import failure written from now on holds `code` beside `message`
    when the refusal carried one.
  - A drain that fails online with no provider set is stored as
    `errorType: 'no_provider'`, with the message *No AI provider is
    configured.*, and no engine, provider or duration.

  The rules already accept both: `no_provider` is in the closed list, and
  `errors` is checked only to be a list.
- **No rules or analytics-events change for this fix.** `git diff --stat`
  of `firestore.rules` and `analytics-events.json` over every #487 commit is
  empty. The branch's one rules change, and the rules deploy it brings, are
  [0174](0174-a-postings-digest-carries-a-salt-only-its-rule-holds-and-the-drain-reads-once.md)'s.
- **Records already stored keep what they hold.** A drain record written
  before this change keeps its `network` class and its cloud sentence, so it
  still reads *Connection problem* above the two-cause line. A whole-import
  record written before the code was kept reads through the message ladder
  (see *Known gaps*).
- **The initial bundle.** Measured after each commit, the family reader and
  its two tables added 232 bytes net, nearly all of it in
  `import-review.utils.ts`'s chunk, and the provider check 376, in the chunk
  `receipt-attempt.service.ts` shares with `ai-import.service.ts`. Reading
  the code made `errorCode` eager, so `firebase-error.utils.ts` became an
  initial chunk of its own, 121 bytes. The drain's wait for the key read
  added 72 more, in the entry chunk.
  [../performance.md](../performance.md) records the branch's measured
  figure and the budget's move to 2.408 MB.
- **The browser run saw both lines** in the emulator venue on 2026-10-11,
  which has no provider key, as journeys 88 and 91.
  - **The no-provider drain.** A scan queued offline drained on `online` and
    failed. Its card read *No AI provider configured* above *No AI provider
    is configured. Add an API key in Settings → AI Processing.*, with the
    chips *Failed*, *Receipt* and the size only. The same held in ja and tc.
  - **The whole-import records.** Two records seeded over REST, one with
    `code: 'permission-denied'` and one with no code, both failed with no
    class, read the connection and the unknown sentence in en, ja and tc.
    Neither card showed its stored English or a failure-class label.

## Departures from the issue

- **"Online" became "known to have no provider".** The issue had `failed()`
  pass whether the device was online. It passes `providerAbsent`, which also
  needs the keys read, without a failure, and empty. The drain waits for
  that read, so a drain stays `network` only when the read itself fails. The
  issue's acceptance holds for a device whose keys are read: online it is
  `no_provider`, and offline it is `network`.
- **The reclassified failure drops its diagnostics.** The issue said the
  stored sentence follows the class, and said nothing of the diagnostics.
  Kept, they would draw a *Cloud* chip and a duration on a card that the
  camera's same failure draws without them.

## Things that only became apparent while building

- **The keys are not loaded for each attempt.** The first comments said the
  strategy loads the keys while the attempt runs. It brings the providers up
  once per account and again on each change of connectivity, and the key read
  behind that is cached once it succeeds. What a drain can meet is a load its
  reconnect started and has not finished. The comments and the spec case now
  say so. The reading stays in the failed terminal, where a load that
  finished during the attempt is seen.
- **For an account with no key, that unfinished load was no race.** The
  record first called it one a drain sometimes loses. Such an account has no
  secrets document, so after a cold offline start the key read always
  rejects, and on reconnect the drain reached the strategy before the read
  the reconnect started had landed, every time. Only the warm path, keys read
  online earlier in the session, was filed `no_provider`, and it was the only
  path the browser run and the drain smoke had taken. The drain now waits for
  the read.
- **An own sentence can have no key.** `parseAIError`'s `messageKey` is
  optional, so `OWN_SENTENCE_KEYS`' values are `string | undefined`. The
  catalog case counts an undefined key as missing, rather than skipping it.

## Known gaps

- **The wizard's toast still shows the English.** On the same refused
  completion, the wizard's `import.importFailed`, *Import failed: {{error}}*,
  interpolates the thrown error's message, a Firestore client sentence in
  English, in every language. It is not part of #487. Saying it in the
  reader's language is a follow-up for the owner; no issue is filed yet.
- **A whole-import record written before the code was kept says less.** It
  holds only the message, and a rules refusal's prose never names its code,
  so *Missing or insufficient permissions.* reads through the ladder as the
  unknown sentence, not the connection one. It shows no English, but says
  only that the record could not be finished.
- **A drain whose key read fails still reads as a connection problem.** The
  drain waits for the account's key read before it opens its attempt, so it
  stays `network` only when that read itself fails, as it does when the
  server cannot be reached. Nothing then says whether a key is set, so the
  record stays `network`, under *Connection problem*, with the sentence that
  names both causes. That is bounded: such a record never claims no provider
  on a device that has one. It is not closed: a device with no key whose key
  read fails still reads *Connection problem*.
