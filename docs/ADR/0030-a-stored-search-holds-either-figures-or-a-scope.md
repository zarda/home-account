# 30. A stored search holds either figures or a scope, and a pinned one does not expire

**Status:** Accepted, implemented · **Date:** 2026-08-08 · **Issues:** #231

Reference documentation lives in [../smart-search.md](../smart-search.md).

## Context

ADR 0016 gave smart-search answers a home and recorded three deferrals in its
known gaps: filter-shaped interpretations were not recorded, records could not
be pinned, and replays were invisible in analytics. All three were deliberate
scope cuts, and all three touch the same collection.

The first is the one that cost something. Interpreting "coffee last month" as
a filter costs exactly the same model call as interpreting "how much on coffee
last month" as an aggregate, and only the aggregate was kept — dismiss the
chips and the interpretation was gone, so asking again paid the model again.
Picking it up meant reopening decisions ADR 0016 had closed: the field set is
a closed allowlist in the rules, the identity key assumes an operation and a
limit, and the fifty-record cap assumed every record was the same thing.

## Decision

**Two kinds in one collection, behind a discriminator.** `kind` is
`'aggregate'` or `'filter'`. An aggregate carries figures and the `computedAt`
they were true at; a filter carries the resolved scope alone. They are a
genuine union rather than one shape with optional halves, so the compiler
forces every reader to say which it means. Rejected: a separate collection for
filter records — same lifecycle, same cap, same rules shape, and two
collections to keep in step in the deletion cascade and the backup for no gain.
Rejected: extending `savedSearches` instead, which ADR 0016 already rejected
for answers and which fits filter records no better: open-set validators and a
different lifecycle.

**The rules make the required set conditional on the kind.** `hasOnly` is one
allowlist across both, but an aggregate must carry its figures and a filter
must carry none of them. Without the second half a filter record could be
written with a `value` and would render as an answer nobody computed. This is
the part only the emulator suite can check — a mistake here rejects every
filter write silently in production, which is exactly how the `goalId` omission
in ADR 0028 would have shipped.

**The kind participates in the identity key; operation and limit do not, for a
filter.** The same sentence can legitimately produce either shape across prompt
revisions, and an aggregate answer must never be overwritten by a filter
reading of the same words. A filter record has no operation or limit, so
folding them in would make its identity depend on fields it never carries.

**Re-asking a filter refreshes only recency.** There are no figures to rewrite,
which is the whole difference from `recordAnswer`. Reopening one hands its
scope to `PendingFiltersService` and leaves for the transactions list — the
channel the dialog already used for a live interpretation — so a replay costs
no model call. There is no Refresh on a filter row, because nothing was
snapshotted.

**Schema version 2, and a record without a kind reads as an aggregate.**
Settled once, in the single read path. Aggregates are all this collection ever
held, so the default is not a guess. Rejected: a migration pass — the field is
absent on old records, `undefined` is the only thing it can mean, and rewriting
every stored document to say so buys nothing.

**The cap counts unpinned records only.** A pinned record is exempt from the
prune and sorts above the rest, which is the same split `MAX_RECENT_SEARCHES`
already applies to `savedSearches`. A pinned record still subject to eviction
would not answer the complaint the issue filed — fifty idle questions pruning
the quarterly answer someone cared about. Pinning is typed among the rules'
optionals rather than frozen with the identity set, which is what leaves it
writable; it is deliberately not part of `writeSnapshot`, so a refresh replaces
figures without disturbing a pin.

**Ordering is a client-side sort.** `pinned desc, lastUsedAt desc` would need a
composite index deployed before the feature worked at all, and at fifty records
the sort costs nothing. The sort is stable, so recency still orders within each
group.

**`search_history_used` reports reopen, refresh and apply.** `ai_assist_used`
deliberately does not fire on a replay — it exists to weigh cloud cost and a
replay has none — which left the tokens the history saves invisible. Collapsing
a row reports nothing, because putting a record away is not a use of it, and
refresh fires past the recomputation so the event counts what happened rather
than what was intended. The parameter carries no trace of the question itself.

## Consequences

- Filter interpretations now take slots, so a history of mostly filter
  searches prunes aggregate answers sooner than before.
- Pinning fifty records leaves the collection unbounded. `savedSearches` has
  always allowed the same, and matching it beat inventing a second rule.
- The rules require `kind` on create, so nothing can write a pre-version-2
  record any more. Existing ones are still readable, touchable, pinnable and
  refreshable — the update rule never required it.

## Things that only became apparent while building

- A filter row cannot reuse the expand-in-place treatment at all. There is
  nothing to expand into, so opening one has to navigate, which makes it the
  only row in either surface whose click leaves the page.
- The pin needed no icon swap: this app ships the filled Material Icons font,
  which has no outlined pin, so colour carries the state.
- `Array.prototype.sort` being stable is load-bearing for the ordering. Sorting
  on `pinned` alone preserves the query's `lastUsedAt desc` within each group,
  which is why the comparator does not mention recency at all.

## Known gaps

- A pre-version-2 record cannot be reconstructed in the emulator, because the
  create rule now demands a kind. The read-side default is covered by the unit
  spec against a seeded signal instead.
- The scope line still shows only the resolved date range (ADR 0016's gap
  stands), which matters more for a filter record: the chips it was made of
  are not named on the row.
- `action` has to be registered as an event-scoped custom dimension in the GA4
  console before the values appear in any report, and that cannot be done from
  the repository.
