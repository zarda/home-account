# Smart search

Natural-language search over your transactions, from the `travel_explore`
button in the app header. You ask in a sentence — "how much did I spend on
groceries last month", "biggest expense in March", "top 3 categories this
year" — and the answer is either a filtered transaction list or a computed
figure with its scope spelled out.

The reasoning behind the answer history's shape is in
[ADR/0016](ADR/0016-aggregate-answers-persist-as-snapshots-that-refresh-locally.md).

## One model call, and every number computed locally

The cloud model does exactly one job: it translates your sentence into a
structured intent. `NlSearchService`
(`src/app/core/services/nl-search.service.ts`) sends the question with a
small context — today's date, your base currency, and the active category
catalog with children prefixed by their parents — and gets back either

| Intent | What happens |
|---|---|
| `filter` | The interpreted filters are shown as chips for confirmation; **Apply** hands them to the transactions page |
| `aggregate` | The app fetches the resolved date range and computes the figure locally: `count`, `sum`, `average`, `max`/`min` (with the extreme row), or `topCategories` |

No transaction data goes to the model with the question, and no figure in an
answer comes from the model. The interpretation is validated before use
(`src/app/core/utils/nl-search.utils.ts`): unknown shapes throw, individually
invalid fields are dropped rather than guessed, dates outside 1970–2100 are
discarded, and an unrecognized category falls back to a keyword so the term
is not lost.

A question with no dates defaults to the current month; an open-ended range
is clamped to today at the far end and 1970 at the near end. The answer card
always displays the resolved range, so the default is visible rather than
implied. Amount bounds ("over $100") compare in your base currency, matching
how every figure in the answer is computed.

## When it falls back to keyword search

Offline, without a configured AI provider, or when interpretation fails, the
same box degrades to a plain keyword search with a notice saying which of the
three happened. Only this fallback path records into the recent-searches list
(`savedSearches`), on purpose: a recent search replays as a substring match,
which is useful for "starbucks" and useless for an interpreted sentence.
Aggregate answers get their own memory instead — below.

## The answer history

Every computed answer is stored automatically as a per-user record at
`users/{uid}/searchAnswers` (`SearchAnswerHistoryService`,
`src/app/core/services/search-answer-history.service.ts`), so a statistic you
already paid to interpret can be reopened without paying again.

**A record is a snapshot.** It keeps the question as you asked it, the
resolved scope as day keys, the figures as computed, the currency they were
computed in, and `computedAt`. Reopening shows exactly those figures, labeled
"Computed {date}" — an old answer never passes for a fresh one.

**Refresh is local and free.** The stored scope replays through the same
local aggregate path (`NlSearchService.replayAggregate`) — never the model —
and the corrected figures overwrite the record in place with a new
computed-at. "This month" recorded in August stays the August range forever;
refreshing it recomputes August over today's data.

**The same question is one record.** Re-asking a question whose resolved
scope matches an existing record refreshes that record instead of duplicating
it. The newest fifty records survive; past the cap, the oldest by recency is
pruned on write.

**Where it lives.** The search dialog's idle state lists your five most
recent answers — tap one to reopen it, or **See all** for the full list at
`/search-history` (`src/app/features/ai/search-history/`). Both surfaces
offer the same actions: reopen, refresh, view the matching transactions, and
delete (with confirmation; deleting a record never touches transactions).

One visible seam: a reopened `max`/`min` snapshot shows the extreme figure
but not the row's description, because the record keeps the row's id rather
than a copy. The description line returns after a refresh.

## Privacy: what leaves the device, what is stored

- The question text and the category catalog (names and types) go to your
  configured cloud provider once, for interpretation. Transaction rows never
  do.
- A stored answer holds the question text and aggregate figures only — ids
  and day keys, no transaction copies. It lives in your own user document
  tree, is validated by a closed-field security rule
  (`firestore.rules`, `searchAnswers`), and is yours to delete at any time.
- Replaying or refreshing a stored answer is entirely local: no model call,
  and no `ai_assist_used` analytics event — that event measures cloud usage,
  and a replay has none.

## Known gaps

- Reopen and refresh usage is not measured in analytics, so the tokens the
  history saves are invisible in GA4 for now.
- Filter-type interpretations cost the same model call but are not recorded;
  only aggregate answers persist.
- Records cannot be pinned: fifty idle questions can prune an answer you
  cared about.
