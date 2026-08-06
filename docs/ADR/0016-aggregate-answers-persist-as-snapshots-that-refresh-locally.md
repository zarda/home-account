# 16. Aggregate answers persist as snapshots that refresh locally

**Status:** Accepted, implemented · **Date:** 2026-08-06 · **Issues:** #229

Reference documentation lives in [../smart-search.md](../smart-search.md). This
record keeps the decision and the reasoning.

## Context

Smart search pays for exactly one thing: the model call that translates a
sentence into a structured intent. Everything after that is free —
`NlSearchService.computeAggregate` fetches the resolved range and computes the
count, sum, average, extreme or category breakdown locally, from real
transaction rows. But the computed answer lived only in a signal inside the
search dialog. Dismiss the dialog and the statistic was gone; the only way to
see it again was to send the same sentence to the model again and pay for an
interpretation the app had already performed.

The existing search history could not absorb this. `savedSearches` remembers
raw query text and replays it as a substring match — which is exactly right
for keyword searches and exactly wrong for interpreted sentences, which is why
`NlSearchService` deliberately records only the keyword-fallback path there
(the comment at the recording site says so). An interpreted answer is not a
piece of text to re-run; it is a question, a resolved scope, and a set of
figures that were true at a moment.

So the problem had three forces: keep the statistic (the token was already
spent), stay honest about when its figures were computed, and bound the
storage. Issue #229 fixed the outer decisions in review: reopening shows the
stored snapshot with an explicit local refresh, retention is a count cap only,
only aggregate answers are recorded, and the history surfaces in the search
dialog with a routed see-all page.

## Decision

### A stored answer is a snapshot, and it says so

Each record at `users/{uid}/searchAnswers/{id}` carries the figures as
computed — value, match count, currency context — plus `computedAt`. Reopening
renders exactly what was stored, labeled with the computed-at date, through
the same card component that renders live answers. The label is the honesty
mechanism: an old number may be exactly what the user wants ("what did I
answer last week?"), but it must not pass for a fresh one.

### The record stores the resolved scope, and refresh replays it locally

The scope written is the one the figures were computed over — after
`resolveScope` filled in the defaults — not the model's elliptical filters.
"How much this month" asked in August is permanently the August range; asked
again in September it is a different question and a different record.

Refresh is `NlSearchService.replayAggregate(operation, filters, limit)`: the
stored intent fed straight back into `computeAggregate`. It sits deliberately
outside `search()`, so it cannot reach `interpretSearchQuery`, and it does not
fire `ai_assist_used` — that event exists to weigh cloud cost, and a replay
costs nothing. A refresh overwrites the record's figures and `computedAt` in
place; vanished optionals (an extreme-row id whose window no longer matches
anything, a breakdown that emptied) are cleared with `deleteField()` sentinels
rather than left to misdescribe the new computation.

### The same question over the same scope is one record

Recording dedupes on a normalized identity: lowercased trimmed query,
operation, limit, and the serialized scope with sorted keys. A hit refreshes
the existing record — new figures, new `computedAt`, new recency — instead of
appending a copy, so asking "how much on food this month" every morning keeps
one record current rather than filling the history with near-duplicates. The
security rules enforce the same identity from the other side: `query`,
`operation`, `limit`, `scope` and `schemaVersion` are immutable on update. A
refresh replaces the figures, never what was asked.

### Retention is a count cap of fifty, pruned on write

The newest fifty records by recency survive; recording past the cap deletes
the oldest. Count-cap-only was the reviewed choice — simple and predictable,
and a rarely-searching user keeps their history indefinitely instead of
watching it evaporate on a timer. The prune computes overflow from the live
subscription signal excluding the just-written document id, for the same
reason `SearchHistoryService.recordRecent` does: the local write's snapshot
lands in the signal before `addDocument` resolves, and counting it again
would prune one record too many.

### The record keeps ids and day keys, never transaction copies

Scope dates persist as `yyyy-MM-dd` day keys (the `SerializableFilters`
precedent, extended with the `searchQuery` an aggregate scope may carry), and
revive through `parseDayKey` at local midnight — a bare
`new Date('2026-08-01')` is UTC midnight and reads as the previous day west
of UTC. The end date's clock time truncates by design:
`getTransactionsInRange` re-clamps the range end to end-of-day, so the
revived scope fetches the identical window. The truncation and revival run in
`test:dates` under both CI timezones.

The max/min answer's extreme row persists as `extremeTransactionId` only,
keeping the convention set by the insight snapshots: stored documents never
embed transaction copies. And every record carries `baseCurrency`, because a
number computed in one base currency is not the same fact after the user
changes their base.

### The collection is closed, validated, and carved out

`searchAnswers` cannot predate its own rule, so the create validator requires
the full closed field set (`hasOnly` + `hasAll`), day-key-shaped scope dates,
an enumerated operation and a bounded limit. The update validator checks
optionals with the `!('x' in d)` form rather than `touched()`, because
`touched()` is true for a key the update deletes — the `searchUpdateValid`
pattern would reject exactly the `deleteField()` writes the refresh issues.
The collection name is appended to the catch-all carve-out, without which the
open subcollection match would re-grant unvalidated writes and every check
above would be decorative; the rules smoke suite mirrors both the validators
and the carve-out entry.

## Rejected alternatives

**Always recompute on reopen.** Cheaper to build — no snapshot fields, just
stored intents — and the numbers are always current. Rejected because it
answers a different question: the history stops being a record of what you
saw and becomes a list of shortcuts. The reviewed requirement was that
statistical results keep; freshness is one explicit tap away.

**Age-based pruning, or age plus count.** A 90-day cutoff was drafted and
declined in review in favor of the count cap alone. Time-based expiry
penalizes exactly the users the feature serves best — someone who asks a
careful question quarterly would find the answer gone when they next looked.
If unbounded age ever matters, an age prune composes cleanly on top of the
existing prune-on-write.

**Embedding the extreme transaction.** Storing the row would let a reopened
snapshot show its description line without a refresh. Rejected on the
insight-snapshot reasoning: an embedded copy freezes description text,
amounts and timestamps into a document that outlives edits to the real row,
and this would have been the first embedded `Transaction` in the app. The
cost is visible and accepted: a reopened snapshot shows the extreme figure
without its description until refreshed.

**Extending `savedSearches`.** One collection for all search memory is
superficially tidy. But the two lifecycles share nothing: recents are text
with a cap of ten and replay as substring matches; answers are structured
snapshots with their own identity, refresh semantics and cap. The
`savedSearches` validators are also deliberately open-set — rows predate the
rules — so answer fields grafted onto them would be typed but not closed, and
a cap shared between pinned shortcuts and answer records would make either
prune the other.

## Things that only became apparent while building

- `touched()` and `deleteField()` do not compose. The update-validation
  pattern used everywhere else in the rules treats "touched and absent" as
  malformed, which is precisely the shape of a field deletion. The
  `!('x' in d)` form exists in the rules for optionals already; what was new
  is that a refresh *requires* it.
- The analytics registry gate reaches further than events. Adding the route
  without a row in the screen table of `docs/analytics.md` fails
  `analytics:check` — the check re-derives the table from `app.routes.ts` —
  so the route and its documentation are one commit, not a code change with
  docs to follow.
- `TransactionService` reaches Firebase Storage through `StorageService` even
  when only the date-range query is used; the page-level emulator smoke stubs
  the storage service shallowly for exactly that reason.
- In a standalone component that imports `MatDialogModule`, the module's
  environment-level `MatDialog` provider shadows a TestBed root `useValue`;
  stubbing it requires `overrideProvider`, which patches every injector.

## Known gaps

- No analytics event records reopen or refresh usage, so the tokens the
  feature saves are invisible in GA4. Adding one is the six-step registry
  ritual including console-side custom dimensions; deferred deliberately.
- Filter-type interpretations cost the same model call and remain
  unrecorded. They produce no figures to snapshot, but a replayable stored
  filter set would save their interpretation too.
- A reopened snapshot cannot show the extreme row's description (id only, by
  decision above) until a refresh recomputes it.
- All fifty slots are equal: there is no pin, so a treasured answer can be
  pruned by fifty idle questions. The pinned/recent split that `savedSearches`
  has does not exist here yet.
