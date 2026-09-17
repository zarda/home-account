# Splitting a purchase across categories

One purchase, more than one category — a grocery run that was also a
hardware-store trip, a rideshare that included a delivery fee. The reasoning
behind the shape below, and what was rejected on the way, is in
[ADR 0135](ADR/0135-a-purchase-split-across-categories-is-stored-as-sibling-rows-sharing-a-group.md).

## What a split is, and is not

A split takes amounts **off** a purchase's total, one category at a time,
and leaves whatever remains on the purchase's own category. It is not a way
to enter several unrelated transactions at once, and it is not a way to
record one category's spending several times over — every part's amount
comes off the same total, and the total never grows.

There is no separate "split transaction" record. A split is stored as
ordinary transactions that happen to share one field.

## The sibling model

Splitting a purchase into three categories writes three ordinary
transaction documents, not one document holding three categories. Every
part is a ready-made row a budget query, a category chart, an export or a
search already knows how to read — nothing downstream of the write has to
learn a second shape.

What ties the rows together is `splitGroupId: string` — the id of the
group's *first* document (the row that kept the remainder). That first row
carries the field too, so a document's own field says "this is part of a
split" and nothing has to be queried to find out. Nothing in the app ever
queries by `splitGroupId`; it exists to be read off a row that is already on
screen, not to be searched for.

## What a part carries, and what it does not

A part copies the purchase's identity: type, currency, exchange rate, base
currency, description, date, tags, location and budget period. Its own
`amountInBaseCurrency` is the purchase's own exchange rate applied to the
part's amount — never re-resolved against a live rate, the same rule every
other stored money figure in this app follows
(see [docs/money-snapshots.md](money-snapshots.md)).

A part never carries the purchase's **note**, its **receipts**, its **goal
link**, or its **recurring link**. Receipts stay on the first row, because
storage objects are keyed by transaction id and a part has no id of its own
to key against until it already exists. A goal link refuses the split
outright — see below. A recurring link is never copied to a part, and the
rule record itself has no split door.

Every part's amount, and the remainder left on the main category, is
rounded to the currency's minor unit — the same rounding that decided the
figure in the first place, so the group's rows always sum back to exactly
the purchase they came from.

## The form

**Add.** The amount field stays the purchase's total throughout. Pressing
**Split across categories** adds a row asking for a category and an amount;
adding more rows takes more off the same total. A footer line under the
rows reads the remainder as it stands — *"NT$2 stays on the main
category"* — and updates as each row changes. A row with no category chosen
reports *"Every part needs a category"* instead, ahead of any amount
problem, because a blank category is the more specific thing to fix first.
A part, or a set of parts, that leaves nothing positive on the main
category — zero or negative — reports the same invalid state with
`role="alert"`, and the submit control is held until it clears: nothing
about a split can be saved half-valid.

**Edit.** Splitting an existing row is two writes, not one: the field
edit lands first, through the ordinary update path, and then the split
reads the amount that edit just wrote to compute the remainder. If the
split itself is refused after that, the earlier field edit is still there —
the dialog reports the failure as a message rather than closing, because
the parts are still on the form to correct.

**The goal field disappears once a part exists**, and reappears the moment
every part is removed — a contribution is a whole-purchase notion, and
splitting it would mean several counter moves landing on one goal at once,
exactly the contention the goal-transaction staging step exists to avoid. A
row already linked to a goal is never offered the split control in the
first place.

**Splitting needs a connection.** A split is one Firestore transaction, and
a Firestore transaction rejects outright while offline. The form checks
connectivity before attempting one and refuses with its own message —
*"Splitting needs a connection"* — rather than letting the generic write
failure explain nothing: the purchase is still on the form to save whole,
or to retry once the connection returns.

**A category the purchase's new type does not offer drops its part.**
Switching a purchase between income and expense filters the category list;
any part already naming a category the new type does not offer is removed
from the split rather than left pointing at a category the picker no longer
shows.

## The list, and deleting a part

A row that carries `splitGroupId` shows a small badge next to its category
— informative, not decorative, so it is announced to assistive technology
as *"Part of a split purchase"* rather than only shown. No query backs the
badge; it costs nothing past what the list already fetched.

Deleting a part deletes exactly that row, nothing else in its group. The
confirmation names what is actually happening — *"Delete this part of
'{description}'? Its other parts stay."* — rather than the ordinary delete
message, so the choice being made is stated rather than implied.

## Budgets and reports need nothing new

Every reader that keys on a transaction's `categoryId` — the category
breakdown, budget `spent` totals, trends, search, both exports — already
reads a part correctly, because a part is a transaction like any other with
its own scalar category. This is the entire reason the feature is shaped as
sibling rows rather than one document holding several categories: nothing
downstream had to change to make a split purchase count correctly.

## Backup and CSV

**The JSON backup carries the field.** A full export already writes every
transaction whole, so nothing about export changed. The restore path does:
`BackupRestoreService` rebuilds each row's create-data field by field before
writing it back in, and a field that create-data does not carry would be
silently dropped — `splitGroupId` was added to it for exactly that reason.
No backup version bump was needed, because nothing recomputes from a
restored `splitGroupId` the way a goal's counter has to be rebuilt; the
field only ever needs to ride along. See
[docs/backup-restore.md](backup-restore.md).

**The CSV export writes parts as plain rows.** `splitGroupId` has no CSV
column in either format; a spreadsheet reading an exported split sees three
ordinary rows with no way to tell they came from one purchase. The group is
JSON-only. See [docs/csv-format.md](csv-format.md).

## Verifying it

Journey 27 in [docs/e2e.md](e2e.md) drives the whole path by hand: the
remainder line updating as parts are added, the invalid state and its held
submit, the goal field hiding and returning, an add that produces three
real documents sharing one `splitGroupId` and one `createdAt`, the badge
reaching assistive technology, the dashboard's category chart crediting
each part, and a restore that deletes all three through the list with the
part-aware confirmation on each.

`transaction-split.smoke.spec.ts` proves both service seams and the rules'
`splitGroupId is string` line against the deployed emulator rules, and
`split-purchase.utils.spec.ts` covers `splitRemainder` — the one function
every consumer of the amount rule shares — as pure cases with no `TestBed`.

## Known gaps

- **Counts still count rows.** A split of three purchases-worth-of-one is
  three rows in every "N transactions" figure, the data hub, and the
  period-totals cap.
- **A recurring rule cannot be split.** A rule posts one category per
  occurrence, and that is unchanged.
- **The import wizard's own split still lands as unrelated rows.** The
  review step's own way of taking an amount off a row predates
  `splitGroupId` and does not write it, so a receipt split during import
  carries none of what is described here — no badge, no part-aware delete.
- **Analytics cannot say "split."** Adding a split purchase still reports
  the one add event the form always sent, with nothing naming that the
  write behind it was several documents.
- **No group view, and no group delete.** Nothing reads a split's siblings
  together, and deleting one part never offers to remove the rest.
- **A part's date edit leaves its siblings untouched.** Nothing propagates
  a date change across a group.
- **Deleting the group's first row leaves the survivors pointing at nothing.**
  The other parts still carry `splitGroupId` set to that row's id and still
  show the badge; the id no longer names any document. Harmless today, since
  nothing queries the group, but the badge itself cannot tell.
