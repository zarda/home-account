# 107. The review card has one editing machine

**Status:** Accepted, implemented · **Date:** 2026-09-10 · **Issues:** #385, #386

Reference documentation lives in [../import-fields.md](../import-fields.md).

Extends [0099](0099-the-review-step-edits-what-it-shows.md), which built the
card's inline editors and the state they run on, and
[0102](0102-the-review-card-adds-a-tag-and-edits-a-location.md), whose chips
put controls on the card that can take *themselves* off it — the case whose
focus half that record left open.

## Context

The card ran two editing machines and did not say so.

The first is `editing`, a `Map<row id, field>` with `startEdit` to open a
field and `closeEdit` to end one, a per-field table of the triggers focus
returns to, and a single `cancelEdit` that every editor's Escape binds to.
Five fields ride it: the amount, the description, a tag, the place name and
the split figure.

The second was the notes editor, and it shared none of that vocabulary.
`notesOpen` was a `Set<row id>` beside `editing`; `initNotes` opened the box;
`commitNotes` closed it by deleting from that set, but only when the draft was
empty; `cancelNotes` deleted from it unconditionally and then hand-wrote its
own focus call to `.add-notes-btn` — the one landing on the card spelled at a
call site rather than in the table. Two containers meant two answers to
"is this row being edited", and the second one was reachable only by reading
the notes methods.

The two machines also disagreed about how many editors a row could have open.
`editing` holds one field per row by construction; `notesOpen` was an
independent set, so a row could have its amount editor and its notes box open
at once — a shape nothing had decided on, that simply fell out of there being
two containers.

`startEdit` had a matching gap of its own: it focused a hard-coded
`.inline-input`, which is right for the five fields that render an
`<input class="inline-input …">` and wrong for a `<textarea>`.

Then the focus half. 0102 recorded that a commit on the location chip can take
its own trigger off the card, and gave the *editors* a per-field tuple of
landings for exactly that. Three controls that are not editors had the same
problem and no answer at all: **Remove suggested location**, a tag chip's
removal, and the currency offer's **Dismiss** each replace the row through
`replaceRow`, the button they were pressed on unmounts with the chip, and the
browser drops focus at the document root. A keyboard reviewer clearing three
suggested tags off a row was returned to the top of the page three times.

## Decision

**Every editor on the card opens through `startEdit`, closes through
`closeEdit`, and lands where the `EDITORS` table says; a row edits one field
at a time, notes included; and every control that takes itself off the card
names its landing, with a landing its own editor can replace naming that
editor next.**

### One table, holding the input as well as the triggers

`EDIT_TRIGGERS` — field to a list of triggers — became `EDITORS`, field to
`{ input, triggers }`. `startEdit` focuses `EDITORS[field].input` instead of a
literal, which is what lets a sixth field whose editor is not an
`.inline-input` join at all: `notes: { input: '.notes-input', triggers:
['.add-notes-btn'] }`. Every other entry names `.inline-input` and nothing
about the five older fields changed.

Each input selector must match **at most one element per row**, and notes is
why that is a rule rather than an accident. A filed note's box renders on
`!!row.notes`, independently of `editing`, so had the textarea been given
`.inline-input` too, a row with a filed note *and* its description editor open
would offer `querySelector` two matches and resolve them by DOM order. The
textarea keeps `.notes-input` as its own class so the ambiguity cannot arise.

### A row edits one field at a time, notes included

`notesOpen` is gone. `showsNotes(row)` is `!!row.notes || isEditing(row,
'notes')`, `initNotes` is gone and the trigger calls `startEdit(row, 'notes')`,
and `forgetRow` — which prunes per-id state when a row leaves — names four
containers now rather than five: `editing`, `amountRejected`, `draftNotes`,
`fellBackEligible`.

The one slot per row is now a stated rule and not a side effect of one
container's shape. It is also a behaviour change, recorded under
*Consequences* below.

### Notes keeps two handlers of its own, and they delegate

`commitNotes` and `cancelNotes` survive as methods because the notes box is
the one editor whose presence is not `editing`'s to decide, and both now
delegate:

```ts
if (this.isEditing(row, 'notes')) this.closeEdit(row, false);   // commitNotes
if (this.isEditing(row, 'notes')) this.closeEdit(row, true);    // cancelNotes
```

The guard is the whole point. A row that came with a note has a box on the
card and no slot of its own to close, so Escape there is a *draft drop* and
not an editor exit — and if the row's slot is holding some other field, that
editor was opened deliberately and is not what Escape in the notes box means.
`commitNotes` passes `false` for the focus restore because a blur is already
taking focus somewhere the reviewer chose; `cancelNotes` passes `true`, and the
`.add-notes-btn` landing it used to write by hand now comes out of the table
like every other.

### A control that leaves names its landing, and a replaceable one names the editor next

Four handlers gained a `focusWhenRendered` call:

| Control | Lands on | Then |
|---|---|---|
| `removeLocation` | `.location-add` | `.place-input` |
| `removeTag` | `.tag-add` | `.tag-input` |
| `dismissCurrencySuggestion` | `.currency-chip` | — |
| `acceptCurrencySuggestion` | `.currency-chip` | — |

The second column is the control that stands where the removed one stood. The
third is the case 0102's own tuples were the precedent for: the add trigger a
removal lands on renders only in the `@else` of its own editor, so on a row
whose place or tag editor was already open the trigger is not on the card and
the bare input is what is there instead. `.currency-chip` needs no fallback —
it is unconditional.

`updateCurrency` deliberately gains nothing. Its other caller is the row's own
currency menu, where Material restores focus itself and a second call would
fight it; the landing belongs on the handler whose own control unmounts, which
is why accept carries it rather than the shared write beneath it.

### The alternatives that were rejected

- **Giving the textarea `.inline-input` too**, so one selector covers every
  field. It is the two-matches-per-row trap above, and the failure mode is
  focus landing on the right row's wrong box with nothing to say so.
- **A per-field `cancel*` family**, matching what notes had. One `cancelEdit`
  bound to five editors' Escape is the smaller surface, and notes keeps its
  own pair only because a filed note's box genuinely is not an editor exit.
- **A second slot for notes**, keeping `notesOpen` beside `editing` and
  teaching the rest of the machine about both. Two containers is what produced
  the two vocabularies; one row, one slot is the only version of this that
  cannot drift again.
- **A landing on `updateCurrency`.** See above: the shared write is reached
  from the row's own currency menu too, and only one of its callers removes a
  control.

## Consequences

- **An empty, untyped notes box now closes when another editor opens on the
  same row.** `showsNotes` reads the shared slot, so `startEdit(row,
  'amount')` on a row whose notes box was opened and never typed into takes
  the box away with it. A *filed* note is unaffected — its box stands on
  `row.notes` whatever the slot holds — and a typed draft survives in
  `draftNotes` for the blur that files it. It is the intended reading of
  "one field at a time" and it is still a change in what the card does.
- **`forgetRow` names four containers.** Anything added later that is keyed by
  row id has one place to be pruned from, and a fifth container is a line
  there rather than a fifth thing to remember.
- **Three landings, and then a fourth.** #386's criterion is the offer leaving
  the card, and the offer leaves two ways.
- **The table is now the only place a landing is written.** A new editor is an
  `EDITORS` entry; a new control that unmounts itself is one
  `focusWhenRendered` call beside the write.

## Things that only became apparent while building

- **The wave widened by one method, on the offer's own account.**
  `acceptCurrencySuggestion` removes the same offer chip through the same
  `currencySuggestion: undefined` write — including the `.extra-accept` half
  just pressed — and dropped focus exactly as **Dismiss** did. The plan named
  three handlers; accept is the second of the two ways an offer leaves a card,
  so it is the fourth.
- **A same-row `startEdit` was predicted to close the notes entry through a
  departing blur, and probably does not.** Every `commit*` gates on
  `editing.has(row.id)` rather than on the field, so a programmatic
  `startEdit(row, 'notes')` taken while the description editor is open was
  expected to be undone by that input's own blur — but a focused element
  detached by the same change detection pass dispatches no blur in Chrome, and
  nothing pinned the claim either way. The case that stands instead opens
  notes on **another** row, which is the shape a pointer or a keyboard can
  actually produce.
- **`addRow` was still carrying the retired literal.** The rename left one
  `.inline-input` string at a call site (`addRow`'s focus call); it reads
  `EDITORS.description.input` now, so the table is the single spelling.
- **A draft can outlive its box, but only where nothing goes.** `draftNotes`
  is drained by `commitNotes`, and every path a pointer or a keyboard reaches
  blurs the textarea first. The exception is a programmatic same-row
  `startEdit` to another field with no blur in between — recorded on the map
  itself rather than guarded, because a guard would be dead code with a
  reassuring name.

## Known gaps

- **Nothing announces a removal.** A chip that leaves the card, like a verdict
  that flips, changes the row silently; the moved focus is the only signal a
  screen reader gets. This is 0101's unannounced-verdict gap and 0102's
  unannounced-commit gap in a third place, and closing any of them starts in
  the same spot — see 0101's own correction.
- **A notes draft survives only until the next blur.** It is deliberately not
  persisted anywhere: leaving the wizard, or an in-flight import replacing the
  rows, loses whatever was typed and not filed.
- **The one-slot rule is not enforced anywhere but by convention.** Nothing
  stops a future control from writing its own open/closed container beside
  `editing` the way `notesOpen` did; the only thing standing between here and
  a third machine is this record.
