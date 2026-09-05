# 102. The review card adds a tag and edits a location

**Status:** Accepted, implemented · **Date:** 2026-09-06 · **Issues:** #370

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../receipt-import.md](../receipt-import.md).

Extends [0099](0099-the-review-step-edits-what-it-shows.md), which made every
value a source *read* editable and left the two it *suggested* with a remove
control only. It closes the "cannot be edited by hand" gap of
[0068](0068-a-country-is-stored-on-the-evidence-that-produced-it.md) while
keeping that record's rule — a country is stored on the evidence that produced
it — and keeps the suggestion ladder of
[0063](0063-an-import-suggests-only-what-the-account-already-knows.md)
unchanged. Every edit still lands before the single mapper of
[0059](0059-one-mapper-builds-every-imported-transaction.md).

## Context

0099's title is the whole of what it delivered: the review step edits what it
shows. The date, the amount and the description became editable, and it stopped
where the row's *suggestions* begin, on the card's standing split — a value a
source **read** is corrected in place, a value the import **offered** is taken
off. A tag and a location are offered. Both got a remove control and nothing
else.

That split is right for a tag the reader offered — dismissing it is the whole
answer, and the dismissal is remembered. It is not the whole question. 0063's
own rule is that a tag is only ever offered from the vocabulary the account
already files by, which means the one tag the reader can never suggest is the
one this merchant should have had and nothing has yet: it is not in the
vocabulary, and the only way to put it there is to import the row, find it in
the ledger and tag it afterwards. The mechanism for remembering a hand-added tag
was already built — `confirmImport` records what the reviewer *kept* on each
merchant's rows — and had no door into it.

The location was worse, because it is one chip carrying two facts. 0068's
*Known gaps* ends: "A country still cannot be edited by hand. It arrives from a
scan or a coordinate; the Location field edits the name only. Removing the
location is the only way to remove a country." On the review card that
understates it: the Location field that edits a name is the transaction
*form's*, and the card's chip had a removal and no editor at all. So a branch
name misread off the paper could be dropped and not corrected, and a country
the reader concluded from a tax number or a phone format could be dropped and
not changed.
The single control cleared both facts together (0099, deliberately), which is
the right answer when the whole chip is wrong and no answer at all when one
half of it is nearly right.

## Decision

**The card edits what the row will file under: one tag at a time, and both
facts on one location chip.**

### A tag field over the account's own vocabulary

**Add tag** stands at the end of the extras strip on every row and swaps itself
for a text input, the way the amount and description triggers do. The input's
`list` points at one `<datalist>` per card carrying the account's vocabulary,
so the browser offers those tags and narrows them itself as the letters go in.

The list is a suggestion, not a constraint: the field files whatever is typed,
because a tag the vocabulary does not have yet is the case the control exists
for. `normalizeTag` spells it on the way in — trimmed, lowercased, cut at 30
characters — which is the rule everything that stores a tag already applies, so
a tag added here matches the stored spelling and the transactions filter finds
the row by it. One tag per commit: this is a single field and not the
transaction form's chip input, so a comma typed here is part of the tag.

The vocabulary itself is `AIImportService.tagVocabulary(rows)` — what tag
memory holds, what the recent window carries, and the tags the batch arrived
with — and it reaches the card as an `@Input()` the wizard fills. The card
injects nothing new to get it. The service loads the memory first, because it
can still be cold here: the JSON door, and a CSV that carried its own tags,
never run `suggest`, which is what usually warms it. The read never rejects,
the contract `suggest` already holds, so a door that failed costs the reviewer
suggestions and nothing else; and neither caller awaits it, because the review
step is ready without it and the field takes a typed tag before the first read
answers.

Nothing else about tags moves. A tag left on a row is remembered against that
merchant at confirm exactly as before — which is what makes a hand-added one an
answer the *next* import can give by itself.

### One chip anatomy for a printed place and a concluded country alike

0099 shipped two chips: the location, and a country-only chip for the row where
`receiptCountry` was set with no printed address. They are the same fact at
different stages of being known, so they are now one chip with three controls,
and `country-chip` goes on meaning the second shape — a country nobody could
see a name for.

- **The name** is an inline editor opened from the chip's own text. On a row
  that has a country and no name the trigger is an edit glyph, and its
  accessible name says what the glyph cannot.
- **The country** is a button opening a menu over the bundled 79-country
  table — the same list the transactions filter offers, lifted into
  `countryOptions` so there is one of it — with **No country** at the top,
  shown only while there is a country to withdraw. The menu's content is lazy:
  naming and collating 79 regions per row, on a batch of twenty, for a menu
  nobody opened is the bulk currency menu's own reason.
- **The removal** is unchanged, and still clears the slot and the mark
  together.

A row with neither fact gets **Add location**, which opens the same name
editor — the one add trigger that is conditional, since a row with a chip to
correct has nothing to add. **Add tag** is unconditional, so the extras strip
renders on every row now rather than only on a row something was suggested
for.

### A country picked by hand is the evidence

Setting a country writes `location.country` **and clears `receiptCountry`**.
That is 0068's rule read forward rather than an exception to it: the mark is
what the reader concluded, and the mapper falls back to it whenever the
location carries no country of its own. Left standing, it would quietly put the
overruled country back the moment the picked one was withdrawn. The hand is the
evidence now.

Which is why the two withdrawals on this chip are not symmetrical:

- **Emptying the name** withdraws the name only. A country under it keeps the
  chip, in the nameless shape; nothing touches `receiptCountry`, because a
  country the reader concluded is not something the reviewer just declined, and
  the removal is where declining it lives. Any `lat`/`lng` the row arrived with
  is carried through rather than rebuilt from the fields named here —
  `importFromJSON` restores a coordinate through `locationSlotFrom`, and a list
  of fields to keep would drop the ones nobody thought of.
- **Withdrawing the country** from a location with no name drops the location
  whole, coordinates and all. `locationSlot` refuses a bare coordinate pair, so
  keeping one would leave a chip on the card standing for a location the write
  discards.

### The alternatives that were rejected

- **`mat-autocomplete` for the tag field.** There is not one in the app: it
  would be an overlay pattern with no precedent here and none of the overflow
  probes have ever measured one. A `<datalist>` is the browser's own popup, so
  nothing of ours can cover the row being edited, and it costs no overlay at
  all.
- **A country `<select>` inside the chip.** This is 0062's width argument
  again, unchanged: the card is 288px at its narrowest, a chip costs its own
  width, and a select is a full-width control that has to render its value
  inside itself.
- **Editing `receiptCountry` in place.** A mark is not a field. 0064 settled
  that the mapper names what it writes, and 0068 opened exactly one exception
  for a country as a *fact about the receipt*. A country the reviewer chose is
  not that fact; it is the row's location, and it belongs in the slot the write
  reads.
- **A chip input taking several tags at once.** It is the transaction form's
  control, and it would bring a comma convention onto a card whose every other
  editor commits one value on Enter.

## Consequences

- **The extras strip is on every card**, so it is part of every row's height
  whether or not the reader suggested anything. Its flex line is 40px where a
  chip is 26, which is a geometry the strip did not have before: the chips on
  that line are held to their own size rather than stretched to the trigger's.
- **A hand-typed tag joins the account's vocabulary** through the confirm
  step's existing memory write, on the same terms a kept suggestion does.
- **The country-only chip is no longer its own template branch.** Anything
  selecting `.country-chip` still finds the nameless shape, which is what the
  suites that do are asking about.
- **`receiptCountryText` is gone**; its only caller was the branch that merged
  into the shared chip.
- **A batch of twenty rows names 79 regions per menu opened**, and again on
  every change-detection pass that menu stays open for: the content is lazy,
  but `countryChoices` is a template call built per invocation rather than
  memoized, with a fresh `Intl.DisplayNames` per country. The names and their
  order are the active language's, and both have to change under a language
  switch.

## Things that only became apparent while building

- **The country button cannot wear `.extra-remove`.** Both the card spec and
  the overflow probe find a chip's removal by that class, and a second element
  carrying it on the same chip answers the query first — the assertion then
  measures the wrong control while reading exactly as though it measured the
  right one. The button has a class of its own, and the probe's hit-box guard
  names it directly rather than inheriting it from the removal's selector.
- **Focus fell to the document root on three paths, not on the one that was
  obvious.** A commit on this chip can take its own trigger off the card:
  **No country** on a country-only chip, **No country** on a
  `receiptCountry`-only chip, and an emptied name on a chip with no country
  under it. The last is a keyboard exit, which is where losing focus actually
  costs a reviewer something, and it was one of the cases the plan named — its
  spec used a non-empty name and never reached it. So the per-field map of
  triggers to restore focus to holds **tuples** rather than one selector: the
  place's is the chip's name trigger, then **Add location**, which is also
  where an Escape out of an editor opened from **Add location** has to land.
  The country withdrawal names its own pair — the country button, then
  **Add location** — because it is not an edit commit and cannot route
  through the map, and that is now two places encoding the same fact about
  this chip.
- **The nameless withdrawal and the emptied name want opposite things about a
  coordinate**, and the reason is one line of `locationSlot`: it refuses
  `{ lat, lng }`. Keeping the coordinates is right where a country remains to
  hold the map up, and wrong where nothing does.
- **`.selected` on a menu item collided with `.transaction-card.selected`** in
  the same stylesheet. The current country's item is `.current`, the
  component's own word.
- **The vocabulary was empty in the first driven run, and correctly so.** The
  grounding history answers nothing while the account's level is `off`, so the
  list narrows to whatever tag memory has learned — and on an account that has
  never kept a suggested tag, that is nothing at all. The field was plain free
  text, which is the "suggestion, not a constraint" rule doing its job. But it
  means the list half of the control is emptiest on exactly the accounts with
  no tagging habit yet, which are the ones the control was built for.

## Known gaps

- **A country outside the bundled table still cannot be picked from scratch.**
  0068's first gap is untouched: the table is travel-destination coverage,
  about eighty regions rather than everything CLDR names, and a code arriving
  on a row is appended so it renders and stays withdrawable — but nothing
  offers a region the table has no box for. It is that record's "cannot be
  edited by hand" bullet, and only that one, which this closes.
- **The chip's hit-box budget is LTR arithmetic.** The overhangs are physical
  insets, inside 0071's frozen baseline, while the margin that pays for the
  gap between them is logical — so under RTL the row reverses and the insets
  do not, leaving the name trigger's 9px overhang and the country button's
  6px one overlapping by 11px across a 4px gap. No RTL locale ships and the
  overflow probe measures LTR only, so this is work the RTL conversion has to
  do rather than a live defect.
- **A tag is committed one at a time.** The field closes on each commit, so a
  row that wants three tags is three taps on **Add tag**.
- **The vocabulary is read once per batch**, when the rows land. A tag typed on
  the first row is not offered on the second until the next import.
- **Nothing announces what a commit did.** A withdrawn country, a chip that
  left the card and a filed tag all change the row silently; the moved focus is
  the only signal a screen reader gets, which is 0101's unannounced-verdict gap
  in another place.
