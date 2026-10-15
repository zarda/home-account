# Smart search

Natural-language search over your transactions, from the `travel_explore`
button in the app header. You ask in a sentence — "how much did I spend on
groceries last month", "biggest expense in March", "top 3 categories this
year" — and the answer is either a filtered transaction list or a computed
figure with its scope spelled out.

The reasoning behind the answer history's shape is in
[ADR/0016](ADR/0016-aggregate-answers-persist-as-snapshots-that-refresh-locally.md),
amended by [ADR/0030](ADR/0030-a-stored-search-holds-either-figures-or-a-scope.md)
for filter records and pinning.

## One model call, and every number computed locally

The cloud model does exactly one job: it translates your sentence into a
structured intent. `NlSearchService`
(`src/app/core/services/nl-search.service.ts`) sends the question with a
small context — today's date, your base currency, the active category
catalog with children prefixed by their parents, and the active goal and
budget catalogs (names and ids only) — and gets back either

| Intent | What happens |
|---|---|
| `filter` | The interpreted filters are shown as chips for confirmation; **Apply** hands them to the transactions page |
| `aggregate` | The app fetches the resolved date range and computes the figure locally: `count`, `sum`, `average`, `max`/`min` (with the extreme row), or `topCategories` (each category rolled up to its parent, totals rounded to the cent, largest first, an exact tie by category id) |

No transaction data goes to the model with the question, and no figure in an
answer comes from the model. The interpretation is validated before use
(`src/app/core/utils/nl-search.utils.ts`): unknown shapes throw, individually
invalid fields are dropped rather than guessed, dates outside 1970–2100 are
discarded, and an unrecognized category falls back to a keyword so the term
is not lost.

An aggregate question with no dates defaults to the current month; an
open-ended range is clamped to today at the far end and 1970 at the near end.
The answer card always displays the resolved range, so the default is visible
rather than implied. A filter question resolves nothing: it keeps exactly the
dates it named, possibly none. Amount bounds ("over $100") compare in your base currency, matching
how every figure in the answer is computed.

**Top categories rank the way every category list does.** `topCategories`
keeps as many categories as the question asked for: three when it names no
number, and ten at most. Each category is rolled up to its parent before it
is totalled, and each total is rounded to the cent. The list then ranks
larger first, and an exact tie by category id, so a tie at the limit keeps
the lower id whichever row arrived first. The answer's headline figure is
the first group's rounded total. A record stored before the rounding gets
rounded groups on its next refresh
([ADR 0176](ADR/0176-every-category-list-breaks-a-tie-by-id-over-cent-rounded-totals.md)).
A question that names neither income nor spending adds both into one total
per category. Only a category of type `both` can hold both, and no default
category has that type.

**The category catalog is loaded where a search runs.** A search reads the
catalog to interpret the question, to take a category's children into its
scope, to roll a top category up to its parent, and to name each group on
the answer card. The search dialog and the history page each subscribe to
the catalog for as long as they are open, as every other page that reads it
does. Before they did, a direct load of `/search-history`, or the dialog
opened first from a page that loads no catalog, searched against an empty
list. Every group then read *Other*, and a Refresh stored its groups
without rolling them up
([ADR 0176](ADR/0176-every-category-list-breaks-a-tie-by-id-over-cent-rounded-totals.md)).

**A search does not wait for the catalog's first snapshot; it reads the
catalog once.** On an account with no custom categories and a device that
never synced the query, that snapshot waits for the server. So when the
published list is still empty, the search reads the account's stored
categories once from the server (`CategoryService.exportAll`) and merges them
over the built-in defaults, as the published list itself does. The list is
resolved once per call and handed to the model's list, the scope and the
roll-up alike, so one answer never mixes two states of the catalog. It is not
written into the published list, which stays the subscription's. A published
list that is not empty is used as it is, with no read
([ADR 0178](ADR/0178-a-schedule-is-held-to-its-ranges-and-a-refusal-says-what-was-written.md)).

- **A search** resolves it before the model is asked. If the read fails, the
  search falls back to keywords like any other failed interpretation, before
  the model is paid.
- **A Refresh** reads it only when its answer needs a catalog: a top-categories
  answer, a category scope, or search text, which is matched against category
  names. Any other Refresh reads nothing for it.

## Goals and budgets in a question

"How much have I put toward the Japan trip?" and "what did I spend against
the groceries budget?" both resolve to a real scope rather than a keyword
guess — but by different routes, because only one of the two is a thing a
transaction carries (see
[ADR/0028](ADR/0028-a-search-scope-only-names-what-a-transaction-carries.md)):

- **A goal becomes a scope field.** A transaction can be linked to a goal
  (see [goals.md](goals.md)), so a matched `goalId` stays on the filters, is
  named in the confirmation chips, is stored with the answer, and narrows the
  transactions page when you open the answer's rows. An unlisted goal is
  dropped into the keyword like an unrecognized category.
- **A budget is resolved and discarded.** A budget is a category plus a
  recurring window, not a field on a transaction, so a matched `budgetId`
  contributes its category and — only when the question gave no dates of its
  own — its current period window, then disappears. "Against my groceries
  budget last year" therefore narrows to last year rather than snapping back
  to this period, and a category the model named itself is never overwritten.

Both catalogs list only active goals and budgets, and are fetched on demand
when no open page has already loaded them, the way the category catalog is
(above): one server read each. Unlike the category catalog's read, which a
Refresh also makes, theirs are made only on the search path, behind the same
connectivity check the model call needs. The confirmation chips resolve a
goal's display name the same way — the published signal when a page has
warmed it, otherwise one uncached read the first time an interpretation
carries a `goalId`. A live `getGoals()` subscription in the dialog was
rejected: a name label has no use for a listener's lifecycle, and the
one-shot read is the same route the catalog itself took to reach the model.

## When it falls back to keyword search

Offline, without a configured AI provider, or when interpretation fails, the
same box degrades to a plain keyword search with a notice saying which of the
three happened. A cold category catalog that cannot be read counts as a
failed interpretation, and falls back before the model is asked. Only this
fallback path records into the recent-searches list (`savedSearches`), on
purpose: a recent search replays as a substring match, which is useful for
"starbucks" and useless for an interpreted sentence. Interpreted searches get
their own memory instead — below.

## The search history

Every interpreted search is stored automatically as a per-user record at
`users/{uid}/searchAnswers` (`SearchAnswerHistoryService`,
`src/app/core/services/search-answer-history.service.ts`), so a question you
already paid to interpret can be put back to work without paying again.

**Two kinds of record share the collection.** Both cost the same model call,
which is why both are kept:

- an **aggregate** record is a snapshot — the question as you asked it, the
  resolved scope as day keys, the figures as computed, the currency they were
  computed in, and `computedAt`. Reopening shows exactly those figures,
  labeled "Computed {date}"; an old answer never passes for a fresh one.
- a **filter** record is the scope alone — and only what the question named,
  so it may carry no dates at all; the resolved bounds are required of
  aggregates only. There are no figures to snapshot, so it shows a *Filters*
  label instead of a value, and opening it re-applies the scope to the
  transactions list rather than expanding in place. Nothing refreshes, because
  nothing was frozen.

**Refresh is local and free.** An aggregate's stored scope replays through the
same local path (`NlSearchService.replayAggregate`) — never the model — and
the corrected figures overwrite the record in place with a new computed-at.
"This month" recorded in August stays the August range forever; refreshing it
recomputes August over today's data.

**The rows it recomputes over are enumerated, not listened for.** The figures
are persisted, so `computeAggregate` reads through
`TransactionService.getTransactionsInRangeOnce` rather than taking a live
listener's first emission — which, with the persistent cache, is whatever
windows the session happened to browse. Refreshing a record from the history
page, opened cold, used to recompute an empty answer and write it over a good
one. This is a registered instance of the class in
[one-shot-reads.md](one-shot-reads.md); the decision is
[ADR 0057](ADR/0057-a-replayed-answer-enumerates-and-reports.md).

**A refresh says what happened.** Correct recomputation over unchanged data
produces the same numbers, so silence cannot distinguish success from failure
or from a dead button. Both outcomes notify — `aiSearch.historyRefreshed` and
`aiSearch.historyRefreshFailed` — and the failure is logged. This holds on
both surfaces: the dialog's opened snapshot and the history page's expanded
row run the same three steps and report them the same way.

**Some offline Refreshes fail.** The rows are read from the cache when the
device is offline, but the cold catalog read above is the server's only
([one-shot-reads.md](one-shot-reads.md#the-searchs-category-catalog-490)).
So offline, before the catalog's first snapshot has arrived, a Refresh of a
top-categories answer, a category scope or search text fails with
`aiSearch.historyRefreshFailed`, and the stored answer keeps what it held.
Every other offline Refresh answers from the cache as before. The
alternative was a stored answer with its groups not rolled up, which is the
failure the read exists to prevent. That window is short, though: once the
SDK decides it is offline, the listener can publish a first snapshot from a
cache that never held the query, the built-ins alone, and from then on the
search takes the catalog as loaded and reads nothing. A Refresh then answers,
and a stored custom child is not rolled up in what it stores (see *Known
gaps*).

**The same question is one record.** Re-asking a question whose kind and
resolved scope match an existing record reuses it — refreshing its figures for
an aggregate, its recency for a filter — instead of duplicating it. The kind is
part of that identity, so an aggregate answer is never overwritten by a filter
reading of the same words.

**Pinned records do not expire.** The fifty-record cap counts only unpinned
records, so pinning one takes it out of the prune entirely and sorts it to the
top — the same split saved searches already use for their recents. Past the
cap, the least recently used *unpinned* record is dropped on write.

**Where it lives.** The search dialog's idle state lists your five most recent
records — tap one to reopen it, or **See all** for the full list at
`/search-history` (`src/app/features/ai/search-history/`). Both surfaces offer
the same actions: open, pin, and delete (with confirmation; deleting a record
never touches transactions), plus refresh and view-transactions on an
aggregate.

One visible seam: a reopened `max`/`min` snapshot shows the extreme figure
but not the row's description, because the record keeps the row's id rather
than a copy. The description line returns after a refresh.

## Privacy: what leaves the device, what is stored

- The question text and three catalogs — categories (names and types), goals
  (names) and budgets (names, with their category and period) — go to your
  configured cloud provider once, for interpretation. Transaction rows never
  do, and no amount from any goal or budget goes with the names.
- A stored record holds the question text and either aggregate figures or a
  scope — ids and day keys, no transaction copies. It lives in your own user
  document tree, is validated by a closed-field security rule
  (`firestore.rules`, `searchAnswers`), and is yours to delete at any time.
- Replaying, refreshing or re-applying a stored record is entirely local: no
  model call, and no `ai_assist_used` analytics event — that event measures
  cloud usage, and a replay has none. A separate `search_history_used` event
  counts the three ways a record is reused, with no trace of the question
  itself, so the savings are measurable (`docs/analytics.md`).

## Known gaps

- Pinning fifty records leaves the collection unbounded: nothing prunes a
  pinned record, and saved searches have always behaved the same way.
- The answer card's scope line shows only the resolved date range. A goal or
  category in the scope narrows the figures but is not named there (#444);
  opening the matching transactions is where you see it. For a filter record
  this matters more — the chips it was made of are not named on the row
  either.
- A search that falls back to keyword matching is not recorded here at all; it
  goes to the recent-searches list instead, because there was no
  interpretation to store.
- An offline Refresh of a top-categories answer, a category scope or search
  text fails while the catalog's first snapshot has not arrived (see *Some
  offline Refreshes fail*). It works once the device is online, or once a
  page has loaded the catalog.
- Offline, on a device whose cache never held the catalog's query, that
  first snapshot can be the built-ins alone: the SDK publishes from the
  cache once it decides it is offline, empty or not. The search takes any
  published list as the catalog, so a Refresh of a top-categories answer
  then stores a custom child un-rolled, over what the answer held. Treating
  a list with no stored category as unloaded would fail every such offline
  Refresh on an account with no custom categories, so it is left
  ([ADR 0178](ADR/0178-a-schedule-is-held-to-its-ranges-and-a-refusal-says-what-was-written.md)).
- A record written or refreshed while the catalog was empty, before the
  history page and the dialog loaded it and before a search read a cold
  catalog, keeps its un-rolled groups until it is refreshed again. Nothing
  migrates it.
