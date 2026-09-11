# 121. A bulk currency switch says how many rows it blanked

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #415

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Extends [0117](0117-every-doors-figure-is-whole-in-its-currency.md) and
closes the gap it filed: "A bulk currency switch can blank several rows at
once." It also amends
[0108](0108-the-review-step-removes-a-row.md), whose own amendment left one
asymmetry standing on purpose; that asymmetry is closed here.

## Context

0117 made a currency change re-round the row it lands on, and chose — for
the per-row chip — that a figure which rounds to nothing **leaves the row
unfilled** rather than being refused. The reasoning was that the chip is a
menu, there is nothing to refuse into, and the unfilled row already
announces itself: a muted *Add an amount* placeholder, a held Continue, and
a count on the confirm summary. The reviewer is looking at the one row they
just changed.

`applyCurrencyToSelected` runs the same rounding over every selected row.
Switch a batch of forty-cent rows into yen and forty cents is nothing in
yen — every one of them empties at once, and the reviewer is looking at a
menu, not at any of the rows. The placeholders are all there to be found,
and they are the only thing that says what happened. 0117 filed exactly
this: "the per-row chip's trade-off, magnified."

## Decision

**The switch goes through, and then says how many rows it emptied.**

```ts
const blanked = selected.filter(
  t => !amountIsUnfilled(t) && amountIsUnfilled({ ...t, amount: roundToMinorUnit(t.amount, code) })
).length;
…
if (blanked > 0) {
  this.notifications.info(
    this.translationService.t('import.bulkCurrencyBlanked', { count: blanked, currency: code })
  );
}
```

A count, in the `info` tone — a neutral status update, politely announced,
three seconds — because nothing has failed and nothing needs acting on this
instant. The message names the count and the currency and stops there:
*2 amounts round to nothing in JPY — add them again*. Each blanked row
already names itself where the reviewer will be looking when they fix it,
and the Continue gate holds until every one is filled.

The count is taken **before** the map that rewrites the rows. After it,
every selected row has already been rounded, and a row that arrived unfilled
is indistinguishable from one this switch just emptied — the count would
read two where the truth is one. `!amountIsUnfilled(t)` is the first clause
for that reason: a row that was already blank is not news.

`import.bulkCurrencyBlanked` is new in all three catalogs. English carries
`one`/`other` members, because `t()` pluralises only on a parameter named
exactly `count` and only English declines (0036); Japanese counts with 件 and
traditional Chinese with 筆, neither of which needs a plural member.

### The alternatives that were rejected

- **Refusing the switch when any selected row would blank.** It reads
  protective and behaves badly: a bulk action on twenty rows refusing
  because of one is its own surprise, and it leaves the reviewer to find
  which one. It would also put the bulk path at odds with the per-row chip,
  which rounds without asking — two rules for one operation, decided by how
  many rows were ticked.
- **Naming the rows in the message.** A snackbar listing descriptions is
  long, is truncated by the surface it sits on, and duplicates what each
  row's own placeholder says in the place the reviewer has to go anyway.
- **Making the chip announce too.** 0117 decided the single-row case
  deliberately; a message for a change the reviewer is watching happen is
  noise.

## Consequences

- **The per-row chip stays silent**, and that is now a stated difference
  between the two paths rather than an accident of where the code lives.
- **`receiptRowIds` is cleared where the batch is cleared.**
  `onFilesSelected` resets `extractedTransactions` to `[]` and now resets the
  id set beside it — the asymmetry 0108's amendment named and left. It is
  **inert**, and this record says so rather than claiming a fix: the set is
  only ever read against rows that are present, and the rows it could
  describe are emptied on the line above. What changes is that a reader of
  `onFilesSelected` can see the batch being cleared without going to
  `processFiles` to learn that the other half is cleared there.
- **No spec needed a new provider.** `NotificationService` is
  `providedIn: 'root'` over root `MatSnackBar`, `AnnouncerService` and
  `TranslationService`, so both sibling suites that render the card for real
  resolved it through the root chain untouched.

## Things that only became apparent while building

- **The discriminating case is the row that was already empty.** The count's
  other three edges — a row that blanks, a row that survives, a row nobody
  ticked — are all right whether the count is taken before or after the map.
  Only the already-unfilled row tells the two implementations apart, and it
  is the case that pins the ordering.
- **One of the three new cases is a vacuous red.** "Says nothing when a bulk
  switch blanks no row" asserts that the snackbar was *not* raised, which
  passes before any call site exists. It is a forward-looking guard rather
  than a proof of this change, and it is recorded as one rather than counted
  among the reds.
- **An unticked row cannot reach the filter at all**, because the count is
  taken over `selected`. There is no case pairing an unticked row that
  *would* blank with the message assertion; the exclusion is read off the
  code and covered sideways by an adjacent case.

## Known gaps

- **The rounding is not reversible.** Switching back does not restore the
  figure: the row's amount was replaced by the rounded value, so forty cents
  switched to yen and back is zero, not 0.40. The message says how many were
  emptied, not what they were, and the original figure is only in the file.
- **The per-row chip still empties a row without saying so.** 0117's fork,
  untouched here by choice. A reviewer who switches twenty rows one at a
  time is told nothing, and the same twenty in one gesture are counted.
- **The count is of rows, not of figures the reviewer will recognise.** Two
  is a number to go looking with; which two is a question the placeholders
  answer and the message does not.
- **The rows themselves change unannounced.** The snackbar is announced
  politely, so the count reaches a screen reader; the placeholders that
  replaced the figures are visible state and no live region says a row's
  amount went. That is the unannounced-edit gap 0107 names, on the edit that
  touches the most rows at once.
