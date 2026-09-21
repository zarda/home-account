# 144. A blanked template is paired with a describe that renders it

**Status:** Accepted, implemented · **Date:** 2026-09-21 · **Issues:** #434

Reference documentation lives in [../testing.md](../testing.md).

## Context

A spec can replace a component's template before compiling it:

```ts
.overrideComponent(FooComponent, { set: { template: '<div></div>' } })
```

It is a reasonable thing to do. Blanking isolates the class from its children,
and it is what makes a shell with seven feature children testable at all.

What it costs is everything the template decides. A mistyped `(click)`, a
broken `@if` gate, a control that lost its label, a child that stopped being
passed an input — none of them fails a spec that never rendered the markup,
and all of them reach the user. Twenty-four components were in that state, and
one of them was `TransactionFormComponent`: 1879 lines of spec, and not one
assertion about anything its template does.

The convention had never been written down. It existed as three comments in
three files, the clearest of them on the one spec that had already solved it:

> Every case above overrides the template to `<div></div>`, so none of them
> would notice a typo'd `(click)` or a broken `@if` gate on the offer chip —
> they call the methods directly. This is the one place the real template is
> rendered and its controls actually clicked.

[0128](0128-a-material-module-a-template-never-uses-fails-the-build.md) came
closest to stating the rule and stated it as a limitation of something else:
*"Spec files are skipped. A test host's `imports` belong to the spec that
declares it, and its template is usually a stub that proves nothing either
way."*

## Decision

**Every component whose every TestBed blanks its template gets one more
`describe` that renders it.**

**The test for whether a component is covered is not a grep.** #434's own
acceptance criterion proposed one — `grep -rl "<div></div>"` — and it cannot
verify itself, because **blanking uses two literals**: `template: '<div></div>'`
(37 sites at the time of writing) and `template: ''` (21). A check that sees
only the first is wrong about a third of the population. That is precisely how
the transaction form survived. The real test is

```
blanking overrides >= TestBeds  &&  DOM references <= 2
```

with two qualifiers, without which the count comes out as 28 files rather than
24 components: the blanked symbol must be an **app component** (a spec that
declares its own inline `@Component({ template: '' })` stub is blanking
nothing real), and the unit is the **component, not the file** (a component
whose unit spec renders is covered even if a `.smoke.` or `.overflow.` sibling
blanks).

**This is deliberately not a check script.** The repo's reflex — and this
wave's other half, [0145](0145-a-class-found-by-reading-becomes-a-gate.md) —
is that a class found by reading becomes a gate. This one does not, because
the rule has two judgement calls in it, and a script that got either wrong
would be worse than the grep it replaced: it would fail honest specs and
teach people to write around it. The rule lives in
[testing.md](../testing.md) instead.

**There are two house shapes, and a task picks by what it is proving.**

- **Full render** — a top-level sibling `describe`, no `.overrideComponent` at
  all, and **`NO_ERRORS_SCHEMA` dropped**. With the schema in place a mistyped
  child selector is silently swallowed, which is the exact class the describe
  exists to catch.
- **Partial render** — the real template kept, the component's **own**
  `imports` narrowed, and `NO_ERRORS_SCHEMA` **kept**, with a comment naming
  what is deliberately not rendered. This is what makes `ReportsComponent`
  tractable.

Partial render is honest proof **when the assertions are about this
component's own template and the excused children are irrelevant to them**. It
only moves the stub if a child is excused and then asserted about.

**A rendering describe asserts what a user reaches** — a control clicked, a
label read, an `@if` gate proven — never a method call the blanked describe
already covers. Otherwise it is the same spec twice, one of them slower.

**Where a file is thin because a spec cannot reach it, the docs name the
branch rather than the number being forced.** #434's criterion allows this,
and `auth.service.ts` takes it.

## What was rejected

**A `stub-template:check` script.** See above; and the user's scope answer was
explicit.

**Rewriting the blanked describes instead of adding to them.** The method-level
cases are not wrong, they are incomplete. Keeping both is the shape
`transaction-preview-table.component.spec.ts` already used and the reason its
split is legible: one describe for what the class decides, one for what the
template does.

**Forcing `auth.service.ts` to 85 %.** `FirebaseAuthentication` is a
`registerPlugin` **Proxy over an empty target**, so `spyOn` reads an undefined
descriptor and throws — three call sites are unreachable in Karma, not merely
untested. And `auth.service.smoke.spec.ts` is 622 lines against the real
emulator while `test:ci` excludes `*.smoke.spec.ts`, so a large share of the
file is already covered and invisible to the report — the same situation #434
itself excuses for `firestore.service.ts`. Driving the number up would mean
re-testing emulator-proven behaviour with mocks. Retrofitting an injectable
seam onto the sign-in path is production surgery and belongs to whoever next
has a reason to touch it.

**A shared "render this component" helper.** Every one of the twenty-four
needs a different set of stubs. The shared piece worth having was the
translation stub, and that is what was built.

## Consequences

- Twenty-four components have a describe that renders them. The suite goes
  from **6155** specs to **6525**.
- **Four of the five thin files reach 85 %+**: `file-dropzone` 65.64 → 85.60
  (purely by being rendered — its uncovered block *was* its template's
  handlers), `analytics-transport` 75.00 → 85.29, `ai-settings-page`
  64.08 → 96.73, `category.service` 70.89 → 97.01. `auth.service.ts` stays at
  54.04 as the named exemption.
- `MockFirestoreService.countDocuments` records into its own spy, so a spec
  can tell a server-side aggregate from a full collection read — the
  distinction [0034](0034-a-correctness-read-enumerates-the-collection.md)
  turns on. Two live assertions that counted aggregates through the
  collection spy moved with it.
- The noise floor moves from ERROR 40 / WARN 38 / LOG 26 to **43 / 40 / 0**,
  and every line is attributed: two new errors from the backup work, two from
  new expected-failure specs here, and LOG → 0 from
  [0145](0145-a-class-found-by-reading-becomes-a-gate.md)'s `no-console`.
  **The twenty-four rendered templates contributed none of it.**
- `docs/testing.md` exists, and the convention has a home.

## Departures from the issue

**Twenty-four components, and not the twenty the issue lists.** Six were
unproven and unnamed — `TransactionFormComponent`, `TransactionsComponent`,
`BudgetsComponent`, `AiSummaryComponent`, `HeaderComponent`,
`ReceiptImageManagerComponent` — and two of the named twenty already had
proof: `GoalsComponent` (a second TestBed that renders) and
`RecurringFormDialogComponent`.

**The criterion's grep is not the criterion.** Stated above; the issue's
acceptance line is met by the rule in `testing.md`, not by the command it
proposes.

**No new gate**, by the user's scope answer.

**`analytics-transport.ts` was never under 70 % statements.** It was at 75 %;
its real gap was branches at 48 %. The issue's figure for it was wrong.

## Things that only became apparent while building

**The rendering found no template defects at all.** Twenty-four components, and
every failure along the way was an error in a new assertion rather than in the
markup. That is worth recording rather than dressing up: the templates were
correct, nothing in the suite could have said so, and what these describes buy
is the next change, not this one.

**The cheapest component to fix was also the worst covered.** `FileDropzone`
needed exactly one provider, and its uncovered 44-line block was the drop
handler, the remove control and the preview — everything only the template
calls. "Blanked template" and "low coverage" were the same fact.

**Two of the most valuable assertions exist only in a template.**
`MonthlyComparison` decides a tone inline — `worst.balance >= 0 ? 'positive' :
'negative'` — and inverts `.positive` for the expense column, where a *fall* is
good. Neither is reachable from the class.

**`ReportsComponent`'s tab bodies are lazy on purpose and nothing proved it.**
Insights and Forecast sit behind `<ng-template matTabContent>` so their
Firestore listeners do not open on every visit to Reports. A describe can
assert they are absent until their header is clicked; no method test can.

**A shared spec file is a shared resource.** `git commit --only <path>`
commits the working tree's version of that path, so one commit here carries
another lane's in-flight work under this subject line. The procedure
correction is `git diff -- <path>` before every `--only`, and it is in the
ledger.

## Known gaps

- **`auth.service.ts` stays at 54 %**, with the three unreachable call sites
  named in [testing.md](../testing.md).
- **Nothing enforces the rule.** A twenty-fifth component blanked tomorrow is
  caught by a reader, not by CI — the deliberate choice above.
- **A rendering describe proves the template renders, not that it is
  usable.** Contrast, focus order and reading order are the accessibility
  pass's business ([0145](0145-a-class-found-by-reading-becomes-a-gate.md)),
  and Karma's 756 px window means none of these describes sees a desktop
  layout.
- **The partial-render shape can still hide a child's regression**, by
  construction. Each one names what it does not render; nothing checks that
  the naming is honest.
