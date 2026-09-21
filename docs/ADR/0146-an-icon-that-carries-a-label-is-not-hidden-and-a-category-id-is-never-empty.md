# 146. An icon that carries a label is not hidden, and a stored category id is never empty

**Status:** Accepted, implemented · **Date:** 2026-09-21 · **Issues:** #454

Reference documentation lives in [../accessibility.md](../accessibility.md).

## Context

Three small defects, found by reading rather than by using, and grouped here
because each is the same shape: a guard that looks present and is not.

**A `mat-icon` that carries a label was announcing nothing.** Angular
Material's `MatIcon` sets `aria-hidden="true"` on its own host element at
construction unless the template carries a **literal** `aria-hidden`
attribute — it reads the static attribute through `HostAttributeToken`, which
sees the template's text, not a binding. So a `[attr.aria-hidden]` binding
does not satisfy it, and neither does `role="img"` or `[attr.aria-label]`.
Three icons in the tree carried `role="img"` and a bound label and no literal
attribute: the amount and date verification flags in the transaction form,
and the amount flag on the import review card. Each is the only thing that
tells a screen-reader user that a scanned figure needs checking, and each was
hidden from the reader it was written for.

The correct spelling was already in the tree, twice — the split indicator in
`transaction-list.component.html` and `transaction-row.component.html` both
carry a literal `aria-hidden="false"` beside their bound label, with a
comment saying why. So this was a class that had been met, solved, and not
swept for.

**The rules accepted a category id of `''`.** `firestore.rules` required
`d.categoryId is string` on transactions, budgets and recurring rules, on
create and on update. An empty string is a string. The client never writes
one — the form requires a category and `splitRemainder` refuses a part
without one — so only a direct SDK call, a hand edit or a malformed restore
could produce such a row, and every category reader would then bucket it
under a category that cannot be named, filtered on or edited. The stricter
spelling was also already in the file, on merchant memory
(`d.categoryId.size() > 0`), added when that collection was written.

**A split part's remove button read the same sentence on every row**, and a
type change that dropped parts said nothing at all. The button bound
`transactions.splitRemovePart` with no parameter, so a screen reader heard
"Remove this part" once per row with nothing to tell the rows apart. And when
the transaction type flipped, parts whose category the new type does not offer
were filtered out silently — where the parallel `categoryId` reset at least
leaves a visibly empty required field, a dropped row leaves nothing.

## Decision

**A `mat-icon` that carries an accessible name carries a literal
`aria-hidden="false"`.** Not a binding — the attribute has to be in the
template's text for Material's constructor to see it. The three flags get it.

**The gate keys on `mat-icon` and treats any literal `aria-hidden` as the
author's decision.** Both halves are load-bearing. A rule scoped to
`role="img"` alone would fire on `category-suggestion.component.html`'s
confidence dot, which is a `<span role="img">` where `MatIcon`'s constructor
never runs and which is therefore already correct. And a rule that demanded
`"false"` specifically would fire on the two decorative `.verify-flag` icons
in the import review card, which sit inside a button that carries its own
`[attr.aria-label]` and are deliberately `aria-hidden="true"` so the button
is announced once rather than twice.

**A required category id is checked for length, not only for type** — on
create unconditionally, and on update **inside the `touched()` guard**:

```
&& (!touched('categoryId')
    || ('categoryId' in d && d.categoryId is string && d.categoryId.size() > 0))
```

The guard is the whole point. `touched()` diffs the incoming document against
the stored one, so a row that somehow already carries `''` stays editable for
every other field — its amount, its note, its date, its receipts, and the
deletion cascade — and is refused only if a write tries to *keep* it empty.
Written outside the guard the clause would make every such row permanently
unwritable, including by any repair path, while leaving it deletable. Rules
deploy ahead of hosting ([deploy.md](../deploy.md)), so the stricter form
would have been live before any client change could have avoided it.

**The optional `scope.categoryId` on a stored search is left alone.** It is an
absent-or-string field on a saved query, not a required pointer on a stored
row; an empty one names no category and filters nothing, which is the same
outcome as its absence.

**Each remove button's name carries its row's position**, 1-based, through a
`{{position}}` parameter — never `{{count}}`, which is the name the
translation layer pluralises on and would have silently selected a plural
form instead of interpolating.

**A type change that drops split parts says so**, through the live announcer,
with the number of rows removed.

## What was rejected

**A lint rule instead of a check script for the icons.** The relationship is
between three attributes on one element across several lines of a template,
and `@angular-eslint`'s template rules do not express it. A script in the
house shape reads the template text directly and can state its must-not-fire
cases as self-test fixtures, which is what stops the next person from
"fixing" the two deliberately hidden flags.

**`aria-hidden="false"` everywhere, unconditionally.** It would have made the
import review card's currency and date chips announce their icon and their
button label, one after the other.

**Widening the empty-id check to every `categoryId` in the rules.** The saved
search's scope is optional by design; making it non-empty would refuse a
stored search that deliberately scopes to no category.

**Repairing existing `''` rows.** There are none — the probe below found zero
across all three collections — and a repair path for a row that cannot exist
is code with no caller.

**Holding the submit when a type flip drops parts, instead of announcing.**
The parts are already invalid for the new type; keeping them would put the
form in a state the picker cannot express and the writer must refuse. Saying
what happened is the honest half.

## Consequences

- The three flags are announced. The two deliberately silent ones stay silent,
  and a gate now says which is which.
- A stored row cannot carry an unnameable category, from any client, including
  a raw SDK call.
- A legacy `''` row — if one ever exists in an account this project cannot
  read — remains fully editable and deletable, and only its re-save with an
  empty id is refused.
- The split form's buttons are distinguishable by ear, and a silent mutation
  became a spoken one.
- `docs/ui-overflow.md` no longer documents the theme toggle's empty strip as
  an accepted difference, because it is gone.

## Departures from the issue

**Three icons, not two.** #454 named the two in the transaction form. The
amount flag on the import review card
(`transaction-preview-table.component.html`) has the same shape and the same
defect and is fixed with them.

**The issue's rules line numbers label budgets and recurring the wrong way
round.** It reads "recurring rules (`:145`, `:160`) and budgets (`:307`,
`:323`)"; `:145`/`:160` are budgets and `:307`/`:323` are recurring. The fix
covers all six either way.

**The update clause is guarded, which the issue did not ask for.** The issue
asks for `d.categoryId.size() > 0` "beside the type check on create and
update". Taken literally on the update path that is the bricking form; the
guarded form is what shipped, and the reason is in the Decision above.

**One defect beside the work, fixed with it.** The `type` subscription in
`transaction-form.component.ts` had no `takeUntilDestroyed(this.destroyRef)`,
unlike the `note` and `date` subscriptions immediately around it. It is the
subscription this record's announcement was added to, so it was fixed rather
than filed.

**Part 1 of #454 is not in this record.** The iOS keyboard inset that outlives
the keyboard needs a device reproduction and a Capacitor configuration
decision; it stays open.

## Things that only became apparent while building

**The spec that had to be flipped.** `split-parts.component.spec.ts` already
asserted the remove button's accessible name — against the unparameterised
key. The case was not missing; it was pinning the defect. That is what made
it the RED.

**Asserting the announcer is not enough to prove a plural.** The catalog key
pluralises on `count` alone, so a spec that only checks the announcer was
called would pass if the parameter were named anything else. The spec asserts
the parameters reaching `t()` as well.

**The live data was clean, which is the reason the guarded form costs
nothing.** A read of the account before the rules changed — 128 transactions,
2 budgets, 1 recurring rule, 133 categories — found zero empty ids, zero
whitespace-only ids, zero missing or non-string ids, and zero references to a
category that no longer exists.

## Known gaps

- **The probe covered one account.** Rules grant no collection-group read and
  no service-account credential is configured here, so nothing in this project
  can count `''` rows across every account. The guarded update clause is what
  makes that acceptable rather than a risk.
- **A whitespace-only category id still passes.** `.size() > 0` does not trim.
  The probe found none, and the rules language has no trim, so closing it
  would mean a length check against a stored normalised form.
- **A category id pointing at a category that no longer exists still passes**,
  on every collection. The rules cannot read another document to check it.
- **The icon gate reads templates, not the rendered DOM.** An icon built in a
  `.ts` inline template is covered; one whose attributes are spread from a
  directive is not.
- **Nothing checks the inverse**: a `mat-icon` with a literal
  `aria-hidden="false"` and no label at all would announce an empty name, and
  no gate says so.
