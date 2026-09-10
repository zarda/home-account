# 113. The wizard's picker takes a backup, and grades the category it defaulted

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #380, #383

Reference documentation lives in [../import-fields.md](../import-fields.md)
and [../backup-restore.md](../backup-restore.md).

Applies [0045](0045-a-confidence-grade-names-its-source.md), whose grading
contract — "nothing usable answered" is 0.3 — this door alone disobeyed. It
extends
[0062](0062-the-review-step-can-correct-every-field-the-import-writes.md) and
[0074](0074-a-date-the-scan-cannot-vouch-for-lands-on-today.md), the two
records that fitted the JSON backup door with the currency marks and the date
resolver the review card reads, on a door nobody could open; and it closes
0103's follow-up — "Nothing a user can press reaches the JSON backup door."

## Context

`importFromJSON` has been a complete import door for as long as the wizard has
had doors. It reads a backup's `transactions` array, resolves each row's date
through the shared resolver, falls the currency back to the account's base and
marks it when it does, carries `note`, `tags`, `location`, `period` and
`isRecurring` across, runs the batch through duplicate detection, and hands
the result to the review step like every other door. Three ADRs have widened
it since it was written: 0059 gave it the fields the one mapper carries, 0062
gave it the fallen-back currency mark, and 0074 took its hand-rolled date read
away and put the shared resolver there.

Nothing a user could press reached it. What the wizard's picker offered was
`.csv,.pdf,.png,.jpg,.jpeg,.webp`, and the same string was the dropzone's
default, enforced on drop and on select; the OS share sheet's own list was
shorter still. So the door was reachable from a spec, from a console, and from
the browser journey — which had to hand the file to the component directly
because there was no control to press. A door maintained as if it were live,
by three records, and dead.

The grade it gave was the second half. Every row it built carried
`categoryConfidence: 1.0` under a comment reading *From backup, category is
known* — including a row whose `categoryId` was absent, empty or of some other
type, which the same expression quietly defaulted to the catch-all. Full
confidence on a category nobody chose is exactly what 0045 took off the CSV
path: the chip's dot renders in the high band, the review flag never appears,
and the `low_confidence` tally counts nothing. A restore of a hand-edited or
partial file offered a page of settled-looking rows all filed under *Other*.

There is already a way back in for a whole backup, and it is not this one.
`/data`'s restore writes every section at the backup's own id with `merge:
true`, recomputes what it can derive, asks nothing and shows nothing between
the file and the write — no review card, no duplicate pass, and the figures
exactly as the file holds them. That path is the recovery path. This one is
not a smaller version of it.

## Decision

**The wizard's picker accepts `.json` and the door grades a defaulted
category the way every other door grades one. The share sheet keeps its
shorter list.**

### The picker, the dropzone and the fourth chip

`acceptedFileTypes` on the wizard and `acceptedTypes` on the dropzone both
gain `.json`, the MIME map gains `'.json': ['application/json']`, the file
icon switch gains a `backup` case, and the zone's row of kinds gains a fourth
chip — `backup` / **JSON** beside PNG-JPG, PDF and CSV — with the hint
reworded in all three catalogs to *Supports CSV, PDF, images, and JSON
backups*. `detectFileType` already answered `backup_json` on either the type
or the extension, and `importFromFile` already routed `'json'`, so the door
needed no change to receive what the picker now hands it.

Because the extension is lower-cased before the comparison, a file named
`backup.JSON` is accepted; and a file the OS types `text/json` is accepted
too, since the extension matched before the type was ever consulted. The MIME
map's entry is the narrower half: it lists `application/json` alone, so a JSON
backup carrying some other extension is refused.

### The share sheet does not, and the comment beside it says why

`SHARED_FILE_ACCEPT_TYPES` and `SHARED_FILE_ACCEPT_EXTENSIONS` stay as they
were, and the manifest's `share_target` is untouched. A backup is a file the
user goes and finds; it does not arrive from a photo app or a mail client. And
the share target lives in an installed manifest — a widened one reaches an
already-installed client only when the manifest is re-fetched, so the entry
would advertise a path the running app could still refuse. The comment above
the constants now states all of that, including the third reason: the door
validates nothing past "`transactions` is an array", which is a fair contract
for a file the user chose and a poor one for whatever a share sheet offers.

### A missing category is a default, and is graded as one

```ts
const categoryId = typeof t['categoryId'] === 'string' && t['categoryId'] ? t['categoryId'] : undefined;
…
suggestedCategoryId: categoryId ?? FALLBACK_CATEGORY_ID,
categoryConfidence: categoryId ? 1.0 : UNRESOLVED_CATEGORY_CONFIDENCE,
```

A category the backup recorded is the reviewer's own earlier pick and keeps
the full grade — nobody guessed it, and re-grading it would put a mark on a
decision the account already made. A row that recorded none is defaulted to
the catch-all and graded `UNRESOLVED_CATEGORY_CONFIDENCE` (0.3), the value
0045's contract assigns to "nothing usable answered", so the chip's dot reads
low and the `low_confidence` tally counts the row.

The `typeof` guard is doing more than narrowing a type. A `categoryId` that is
a number, `null`, or an object — a hand-edited file, or one written by
something else — is treated as absent, so it is defaulted *and* flagged rather
than written into `suggestedCategoryId` as whatever it is.

### The alternatives that were rejected

- **Retiring the door instead of opening it.** 0048's rule points that way for
  a path nothing calls, and it is the wrong answer here: this is the only
  *reviewed* way back into an account. `/data` restores everything by id with
  no review and no duplicate check; a user who wants some of a backup's
  transactions, checked against what is already there, has no other door. The
  code was not half-present for want of a job — it was half-present for want
  of a control.
- **Widening the share target too.** See above: an installed manifest lags,
  and a backup does not arrive by share.
- **A schema check at the door.** Tempting, since the door validates only the
  array. The review step is the guard: every row lands on a card that shows
  its figure, its date and its category, holds Continue on an unfilled amount
  or description, and can be edited or deselected before anything is written.
  The `/data` path, which has no review step, does its own `parse` on the
  file's shape — the checking belongs where the reviewing does not.
- **Grading every backup row 0.8.** It is the value 0045 gives "extraction
  named a category", and a backup's category was not extracted from anything —
  it was chosen. Halving the grade of a settled row would put a review flag on
  every row of a clean restore.

## Consequences

- **The dropzone shows four kinds of file, and the hint names backups.** The
  hint is one string in three catalogs; the chips are literal text in the
  template, as the other three are.
- **The browser journey for a backup goes through the picker's own input**,
  and the direct hand-off it used is gone — journey 13 in
  [../e2e.md](../e2e.md) now drops a three-row file into the wizard and reads
  the review cards it produces.
- **A backup with no categories raises the `low_confidence` warning.** The
  warning is built for every door in `buildImportResult` — rows under 0.5 —
  and a defaulted backup row is now under it. What a reviewer actually *sees*
  is the chip's low-confidence dot: see *Known gaps*.
- **A restore through this door is duplicate-checked against the account.**
  That is a Firestore read per batch, and it is the point — re-importing a
  backup over rows that are already there is precisely what the review step
  can catch and `/data`'s merge-by-id does not have to.

## Things that only became apparent while building

- **The grade was wrong before the door was reachable, and fixing it first is
  what made the widening safe.** Had the picker been opened first, the first
  file a user dropped would have produced a page of high-confidence chips over
  categories nobody picked — the defect #383 describes, on a surface that had
  never had a user.
- **A non-string `categoryId` was already reaching the row.** The old
  expression was `(t['categoryId'] as string) || 'other_expense'`, so a `0` or
  an empty string fell back and any other non-string value was written
  through the cast. The `typeof` guard closes both, and it is not covered by a
  case of its own — it was traced by hand.
- **`text/json` needed no map entry.** The extension check runs first and
  returns before the MIME map is consulted, so the entry added for
  `application/json` is exercised only by a JSON file named something else —
  which is to say, by nothing in the suite.

## Known gaps

- **An id the account no longer has keeps the full grade.** The door reads the
  backup's `categoryId` as evidence that somebody chose it, and it has no
  category list at parse time to check it against, so a category deleted since
  the backup was taken arrives at 1.0. The chip renders it as *Unknown* with
  the generic icon — `categoryName` falls back when the id matches nothing —
  wearing a high-confidence dot, and the reviewer has to notice and pick
  again.
- **The door still validates nothing past the array.** A row missing every
  field becomes `Unknown` at 0 with today's date, which the Continue gate
  holds and the reviewer must fix or deselect; a `transactions` key holding
  something other than an array is the only shape refused outright.
- **The share list is unchanged, in both places.** `public/manifest.json` and
  the iOS copy under `ios/App/App/public/` still name images, PDF and CSV, and
  the iOS Share Extension's own list is separate again.
- **The `low_confidence` warning is rendered nowhere.** `buildImportResult`
  raises it onto `ImportResult.warnings`, nothing persists it —
  `ImportHistory` has no warnings field — and no template reads it: the wizard
  inspects only `parse_error`. The low-confidence dot on the category chip is
  the whole of what a reviewer sees.
