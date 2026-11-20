# 194. One painted-contrast helper and one focus hand-off, a card is scored part by part, and no page skips a heading level

**Status:** Accepted, implemented · **Date:** 2026-11-19 · **Issues:** #544

Reference documentation lives in [../testing.md](../testing.md),
[../accessibility.md](../accessibility.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../household.md](../household.md), [../performance.md](../performance.md),
[../dashboard.md](../dashboard.md), [../data.md](../data.md),
[../goals.md](../goals.md),
[../splits.md](../splits.md),
[../translation-lens.md](../translation-lens.md),
[../ui-overflow.md](../ui-overflow.md) and [../e2e.md](../e2e.md).

The accessibility specs had kept second copies of their helpers, and a few
of their passes could read clean without having measured what they claimed.
[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)
listed them under its Known gaps and #544 took them up: thirty-seven spec
files with a painted-contrast helper of their own, `focusWhenRendered`
exported twice and copied four times, two cases that scored a whole card in
one pass, sweeps that might stand below Karma's body, and a `heading-order`
run over one step of one page. This record folds the copies, scores each part
of the two cards, reads every sweep that never stood on the page for its
lowest text, fixes the headings that skipped a level and runs `heading-order`
once per page in the walkthrough. Two repairs of the test harness met on the
way are recorded with it, and so is the sign-in page's heading, which the
first browser run found missing.

Closes four gaps of [0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md):
the specs that define their own `expectPainted` and `tokenValue`, the two
cases that read contrast from a pass over a whole card, the sweeps that may
stand below Karma's body, and heading order held on the upload step alone.

Narrows one more of 0187's: the focus helpers are one, and every hand-off
made through it drops a held key's repeats; the focus calls made straight
from a render hook in four dashboard and transactions files, and in the
period selector, stay outside it.

Applies [0171](0171-second-copies-fold-into-one-copy-of-each-helper.md)
(one copy of each helper),
[0145](0145-a-class-found-by-reading-becomes-a-gate.md) (a class found by
reading becomes a gate) and
[0151](0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)
(the freezes stay empty).

## Context

**The painted-contrast helpers.** 0187 moved new cases onto the shared
`expectPainted` and `tokenValue` in `painted-contrast.ts` and left the older
specs their own. #544 counted 17 files that define an `expectPainted` and 24
a `tokenValue`, the shared file among them, by a grep for `function`
declarations. Read again, the copies ran wider: four more `tokenValue`s were
arrow functions and fifteen copies were named `tokenColour`, thirty-seven
spec files in all. They disagreed about motion. Five local copies let it
settle before reading the node, ten of the token probes never settled, and
the shared `paintedVerdict` read the node's colour first and settled after,
so a node caught mid-transition was read at the colour it started from: the
case written to show it read `rgb(255, 255, 255)` against the token's
`rgb(17, 24, 39)`.

**The focus hand-off.** `focusWhenRendered` lived in `import-focus.ts`, for
the review card, the upload area and the filter panel, and again in
`household-focus.ts`. The first dropped the repeats of a key held through the
hand-off; the second moved focus only once it had fallen to the page, and
passed repeats on. The dashboard layout settings and the split parts each
kept a private copy with one selector, and the receipt viewer and the note
lens one each that took a `Signal<ElementRef>` and wrote their wider test,
focus dropped or inside their host, inline. Held through the hand-off, an
Enter on the layout's Move down saved the layout four times, and one held
through a member's removal opened the confirm four times, in the cases
written to show it.

**Whole-card scores.** The About card's sweep and the review card's *scores
the card's contrast rather than skipping it* expected `color-contrast` among
the passes of one axe pass over the card, which any one node could hold.

**Sweeps below body's box.** Karma's frame is 413px tall and body's box ends
with it. Axe leaves text that runs on below it with no fill of its own
undecided (`elmPartiallyObscured`), and a sweep that expects no violations
reads that as clean. Only the wizard's sweeps and the Goals hint's case stood
on the page through `standOnThePage`; nobody had read the others.

**Headings.** Axe's `heading-order` is best practice, outside the `wcag2a`
and `wcag2aa` pass every sweep runs, and only the wizard's two upload-step
cases ran it. The issue named the weekly recap's title and the Data page's
five `h3`s. Read across the app, the walkthrough would have failed
`/dashboard`, `/budgets`, `/data` and `/settings` the day it ran the rule:
under each page's `h1` the dashboard cards, the budget card and the Data
page's sections were `h3`s, their sub-headings `h4`s, and an empty state
that stood alone under a page was an `h3`. The audit of 18 November added
two: the goal card's name was a plain span, so `/budgets?tab=goals` held no
heading under its `h1`, and Budget Progress's title was a `mat-card-title`
with no heading at all, beside the other cards' `h3`s.

## Decision

### One `expectPainted`, one `tokenValue`, and the settle first

The thirty-seven spec files lose their own `expectPainted`, `tokenValue` and
`tokenColour`, function or arrow form, and read the shared ones, through the
testing barrel or, in the AI search dialog's spec, straight from
`painted-contrast.ts`. A `tokenColour(` call now reads `tokenValue(`. Each
import that only the copies used is dropped; `computedAs` stays in the About
and Data management specs, and the chart theme spec's `computed`, since each
has other readers.

`paintedVerdict` settles the node before it reads its colour: the settle,
and the check that the node is in the document, come before the colour is
read, so a node caught mid-transition is read at the colour it rests on. A
case in `painted-contrast.spec.ts`, modelled on the running-transition case,
holds it.

**A node the page does not draw has no verdict.** Under `display: none`,
hidden, or of no size, a node still computes a colour and a background, so
the verdict read its words as painted in their token at AA, and a
regression that hid them passed. `paintedVerdict`, and `expectPainted`
through it, now throw for such a node; a case in `painted-contrast.spec.ts`
holds each of the three to the throw, and the helper's own cases give their
boxes words, since an empty box has no height. Eight of the import wizard's
colour cases read the processing, review and confirm steps' words while the
stepper stood on the upload step, where Material lays another step's
content out without drawing it, so they passed on words nobody sees; each
now shows the step it reads, with the stepper free to jump to it, as the
camera's hand-off has it.

**The fold settles only the token probe.** A node is read settled only where
the case goes through `expectPainted` or `paintedVerdict` (or
`paintedColor` and `paintedBackground`), or settles the document itself
before it reads. A case that reads the node inside `expect(...)` and the
token inside `.toBe(tokenValue(...))` reads the node first, exactly as before
the fold, because the argument of `expect` is evaluated before `toBe`'s: the
budget form, transaction form, budget progress, empty state, amount display
and AI search dialog specs each hold such a case.

`grep -rnE 'function (expectPainted|tokenValue|tokenColour)\b|const (expectPainted|tokenValue|tokenColour) = \(' src`
names `painted-contrast.ts` alone, and so does the issue's narrower grep.
Probes of other properties (`surface`, `fill`, `tokenSize`), the single-token
probes written inline in a case, and the spending chart spec's
`computedBackground` are not copies and stay.

### One `focusWhenRendered`, and every hand-off drops a held key's repeats

`src/app/shared/utils/focus-when-rendered.ts` exports
`focusWhenRendered(ctx, selectors, options)`, `FocusContext` and
`FocusOptions`. `selectors` is one selector or a list, the first that the
next render shows winning. `onlyIfDropped` moves focus only when it was left
on the document (`focusDropped`) or inside `from`, the control or region an
action was taken from, and it asks where focus is once the render has run,
not at the call. `import-focus.ts` is deleted, with no re-export.
`household-focus.ts` keeps `sameShownHousehold`, `OpenDialog`,
`closeDialogsOnSwitch`, `HouseholdSwap` and `HouseholdPageFocus`, and loses
the helper, its two types and the imports they alone used.

| Caller | Calls | Options |
|---|---|---|
| upload area (`file-dropzone`) | 2 | none |
| review card (`transaction-preview-table`) | 15 | none |
| filter panel (`transaction-filters`) | 4 | none |
| dashboard layout settings | 1 | none |
| split parts | 1 | none |
| household page, members, overview, plans and setup | 3, 2, 2, 1, 1 | `{ onlyIfDropped: true }`; the switch's landing and the plans' landing keep their `from` |
| receipt viewer | 5 | `{ onlyIfDropped: true, from: this.focus.host }`, held in one `abandoned` field |
| note lens (`note-translation`) | 4 | the same |

The eleven calls that name several selectors pass a list. The receipt viewer
and the note lens lose their eight `viewChild` fields and the eight template
references, six names in all, that only those read, and land on their
existing classes
(`.next-button`, `.previous-button`, `.hide-translation-button`,
`.retry-button`, `.translate-button`, `.show-original-button`). The
transaction list joined later on this branch with two calls that pass
`onlyIfDropped`: focus after a confirmed delete
([0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)),
and focus on a row that comes back after Undo or a failed delete, which also
passes the Undo notice as its `from`
([0197](0197-a-deleted-transaction-can-be-brought-back-for-ten-seconds-because-the-delete-waits.md)).

Every hand-off now drops the repeats of an Enter or Space held through it,
until the key comes up or is pressed afresh; one guard, a keydown and a keyup
listener on the window, stands at a time, and a component that goes takes
its hand-off and its guard with it. For the household sections and the four
former private copies this is a change of behaviour: a held Enter on Move
down moves the card one row, and one held through a member's removal asks
about no other member.

### A card's contrast is scored part by part

The About card's install sweep is four cases, the prompt and iOS states in
light and dark, each forced through the real ThemeService (`withScheme`).
Each keeps the whole-card guard, that `results.incomplete` holds no
`color-contrast` (*contrast left undecided somewhere on the card*), and then
scores `.welcome-title`, `p.welcome-body` and either the button's
`.install-button .mdc-button__label` or every `.install-steps li` through
`expectEachContrastScored`.

The review card's whole-card case becomes two, one per scheme, that score
`.description-text`, `.amount-text`, `.extra-text`, `.date-chip-text`,
`.currency-chip-code` and `.duplicate-label` under `withEveryCardShown`. The
date chip's, currency chip's and duplicate badge's words were bare text
nodes, which cannot be a part, so each sits in a span of its own, drawn as
before; the overflow spec holds that nothing moved. The plain row of the
card's fixture now carries a place and a tag, so `.extra-text` is on the
card at all.

### Every sweep that never stood on the page was read for its lowest text

Each `runAxe` caller that never called `standOnThePage` was run with a
temporary probe that sorted every text-bearing element under the audited
root by its bottom and asked `contrastUnscored` about each, in the case's
own state, with Karma's frame at 413px.

| Caller | Lowest text | What it took |
|---|---|---|
| `budget-form.component.spec.ts`, names per locale and scheme | Cancel's label, scored | Nothing: already on the dialog surface (`renderOnDialogSurface`). The disabled Create Budget is exempt; the two select values and the slider's `80%` are left undecided by Material's layers (`bgOverlap`) |
| `household-plans.component.spec.ts`, per theme | Add contribution, scored on its card | **Moved**: both subtitles and the New budget and New goal labels stood on the page with no fill, `elmPartiallyObscured`. It stands on the page now, and nothing is left unscored |
| `auditPlanDialog`: budget, goal and contribution dialogs | the budget dialog's threshold hint at 646–666px, never scored | **Moved, another remedy**: the content scrolls inside the dialog (the budget's 588px in a 226px box, the goal's 304) and axe skips clipped text outright. The pass runs at every half-screenful. The goal leaves only its disabled currency field (exempt), the contribution its `EUR` select value (`bgOverlap`) |
| `ai-settings-page.component.spec.ts`, the auto-sync row per locale | the switch's label, scored | Nothing; the case asserts `button-name` only |
| `category-form-dialog.component.spec.ts` | Cancel, `elmPartiallyObscured` | Nothing: the header, labels and Cancel are undecided, but the case claims `button-name` only |
| `settings.component.spec.ts`, Sign out under the phone rule | the label, hidden by the rule | Nothing: only the glyph shows, and the case is about naming |
| `transaction-list.component.spec.ts`, phone | the row's date, `pseudoContent` | Nothing: rows have their own fill; the pseudo-element is the reason |
| the same, desktop and the select-mode bar | the shared chip and the cap note, scored | Nothing |
| `command-palette.component.spec.ts` | Scan Receipt, `elmPartiallyObscured`, 20 of 29 parts | **Moved, another fill**: painted with its dialog's surface; only `?`, `/` and `⌘` are left |
| `header.component.spec.ts` | the app's title, scored | Nothing |
| `about.component.spec.ts`, the install card | the last step and the button's label, scored on the card | Nothing; each part is scored (above) |
| `transaction-preview-table.component.spec.ts`, two cases | Add a row, scored; 0 of 62 unscored | Nothing |
| `import-wizard.component.spec.ts`, the tab strip under the phone rule | the step labels, hidden by the rule | Nothing: step 1's number is scored on its circle, steps 2 to 4 are `aria-disabled` |
| `add-entrypoints.smoke.spec.ts` | the app's title, scored | Nothing |
| `shortcuts.smoke.spec.ts`, the palette | destinations below the palette's scroller, skipped | Nothing: the case pins the swept section in view, and the unit palette case scores the rest on the same surface |
| `app.smoke.spec.ts`, the household switcher's panel | every option, `bgOverlap` | Nothing, and never scored (Known gaps) |

`auditPlanDialog` returns its `stops` and refuses, rather than reads clean,
a dialog with no `.mat-mdc-dialog-content` and one whose last stop does not
show the content's end; the budget dialog's two audit cases expect more than
one stop (five in Karma's frame). The helper has its own spec,
`household-plan-dialog.testing.spec.ts`.

### Headings sit one level under the page, fixed rather than frozen

- **`h3` to `h2`:** the dashboard card titles (spending chart, recent
  transactions, upcoming bills, and the weekly recap, whose `id` and
  `aria-labelledby` stay), the budget card's name and the Data page's five
  sections, with the section header's `h3` rule and two spec selectors.
- **A heading where there was none, at `h2`:** the AI summary's title
  (`<h2 class="title">`), the goal card's name, and as `<h2 mat-card-title>`
  Budget Progress, the recurring list and the Reports page's country and
  recurring-versus-one-off cards.
- **`h4` to `h3`:** upcoming bills' day header, the category breakdown's
  section title, which sits under the reused spending chart, and the
  recurring list's two section labels.
- **`[headingLevel]="2"`** on the seventeen empty states that stand directly
  under a page `h1`: security activity, budgets, goals, recurring
  transactions, the transaction list, spending analysis, monthly comparison,
  the category breakdown, the insights tab (five), the forecast, import
  history, saved answers and the category manager. Each site's parent was
  read first. An empty state under a card title stays `h3`, the default.

Each site has an outline case in its spec's real-template block; the budget
card's pinned *names the budget in an h3* now reads the outline and expects
an `h2`. Every outline case reads through one helper, `headingOutline(root)`
in `core/services/testing/axe.ts`, beside `expectHeadingsInOrder`: the
headings under the root, in order, each as its tag and its trimmed words,
`h2 Budget Progress`. The heading work had first pasted a reader of its own
into 25 spec files, beside the empty state's, which wrote its outline
another way and now reads `h3 No data` where it read `H3:No data`. The
recurring list's title rule targets `.mat-mdc-card-title`, where an element
rule on `mat-card-title` no longer matched the `h2`; Material's class matches
the element and the attribute form alike. Budget Progress's stylesheet gives
the same class the other cards' title look: `--text-lg`, weight 600, a line
one and a half times the size, normal tracking and `--text-primary`.
Material's own rule keeps the title's margin at 0, and its case pins that with
the rest. Its two utility classes are gone.

### The walkthrough runs `heading-order` once per page

`headingsOutOfOrder(root)` in `core/services/testing/axe.ts` runs
`heading-order` alone, by a rule-type `runOnly` with no rules map and nothing
taken from `axeOptions()`, and gives `summarizeViolations` lines. A run that
neither passed nor failed a heading adds the line
`heading-order: no heading found`, since an inapplicable rule reports no
violation and a page whose headings had all gone would read as ordered.
`expectHeadingsInOrder(root, where)` expects no line, with the context
`heading-order on <where>`. `expectNoAxeViolations` in `app.smoke.spec.ts`
asks it once per page, after the scheme passes, since a scheme cannot move a
heading; the wizard spec's own run goes through it too. `axeOptions()` is
untouched. The case `'stays out of the contrast sweep and of the heading run'`
reads the helper's own run and pins that it runs `heading-order` alone and
reports no `button-name`.

With the Data page's first section put back to `h3`, `npm run smoke` failed
the walkthrough (`TOTAL: 1 FAILED, 928 SUCCESS`):

```
heading-order on /data:
    Expected $.length = 1 to equal 0.
    Unexpected $[0] = 'heading-order (1): h3' in array.
```

Restored, it passed (`TOTAL: 929 SUCCESS`).

### The sign-in page's title is its `h1`

The sign-in page stands outside the shell, and its title was a plain
`mat-card-title`: a reader who moves by headings found nothing on it. The
title is now `<h1 mat-card-title class="text-2xl font-bold text-center
mt-4">`, the same directive and classes on a heading, and the colour spec
finds it by `.mat-mdc-card-title`, not by its tag. Its spec holds one `h1`
that reads the app's title, the heading run over the page, and the title's
look in both themes against a `mat-card-title` twin put in its place, so a
rule that reaches an `h1` and not a card title fails.

That look is pinned twice, because it differs by where the stylesheets
load. Karma links the global stylesheet in the body, after the sheets
components add to the head, so the utilities win: 24px, weight 700, a 32px
line and a 16px top margin. The built app links the global stylesheet in the
head, first, so the card's own rule wins: 22px, weight 400, a 28px line and
no margin. *keeps its title's look in the app's sheet order, in both themes*
moves the card's real sheet after the utilities, reads the `h1` and its twin
in that order, pins the app's figures and puts the sheets back in Karma's
order, checking that they are.

The title keeps the look the app drew before it was a heading. The fix was
a heading, not a restyle, and the twin comparison holds that the look did
not move in either order.

### A sweep reads the same wherever the page was left

- **The plan dialogs' sweep runs from the page's top.** `auditPlanDialog`
  runs inside `fromThePageTop`, from the dialog's opening to its close, since
  the CDK records the page's scroll when the dialog opens, and puts the page
  back after. A stop at which axe skipped a rule on an error is refused:
  `auditPlanDialog: axe skipped <id> (<message>) on an error at stop <n>
  (<top>px)`.
- **A case that hit-tests brings its node inside the window first.** The
  phone's wrapped totals line scrolls its host to the window's top once its
  line is laid out (`intoTheWindow()`) and puts the scroll back after, and
  its dot case and both focus-outline cases also run with 3000px of page
  above the fixture (`withPageAbove`). Without the scroll, the dot case with
  the spacer fails with
  `the point (8, 3131), inside the window: Expected false to be true.`
- **A case that scrolls the page puts back the scroll it found**, not the
  page's top. `keepThePageWhereFound()` in
  `src/app/core/services/testing/page-scroll.ts`, exported from the barrel,
  records the scroll before each case of the describe that calls it and
  restores it after. The axe harness's *below the fold* and *below body's
  box* describes, the plan dialogs' helper spec and the totals line's
  describe call it. `page-scroll.spec.ts` turns red with the helper's body
  taken out: `Expected $[0] = 2000 to equal 700`.

## What was rejected

- **Running `heading-order` in the in-view audits**, as #544 proposes. Axe
  orders every heading of the document and judges those inside the root, so
  an audit of one node judges its first heading against whatever came before
  it anywhere, once per node and scheme, for a property no scheme moves.
  Once per page, over the routed element, says the same thing once.
- **The heading run as a `best-practice` tag run spread over
  `axeOptions()`.** Axe honours a rule's own `enabled` ahead of its tags, so
  the shared map's `button-name` entry rides along: a helper built that way
  ran 23 rules and returned a `button-name` line.
- **Freezing the skips** in `KNOWN_VIOLATIONS`. The freezes stay empty, and
  each skip found is fixed.
- **Folding only what the issue's grep names.** The four arrow-form
  `tokenValue`s and the fifteen `tokenColour`s would have stayed, and the
  grep would have read clean over them.
- **Reordering the cases that read the node first**, so that the token is
  read before it. The same shape stands in other cases, so a partial reorder
  leaves the claim no truer, and an order dependence nothing in the code
  shows is easy to undo by accident. Routing those cases through
  `expectPainted` belongs with a fold of call sites.
- **A re-export from `import-focus.ts`.** Two paths to one helper is what the
  fold removes.
- **A household wrapper** that passes `onlyIfDropped` for the household
  sections. Each call passes it, and a case pins it at every call a spec can
  reach.
- **`standOnThePage` for the command palette and the plan dialogs.** The
  palette never stands on the page, and the page's fill is not what a reader
  sees behind it; `renderOnDialogSurface` in the budget form's spec was the
  precedent for its dialog's surface. A plan dialog's lower text is clipped by
  the dialog's own scroller, which no page fill reaches.
- **An `[mat-card-title]` attribute selector** for the recurring list's
  title. Material's class matches both forms, so a later change of tag cannot
  drop the look again.
- **Making only the security activity's label a heading.** It sits among the
  Settings sections, every one labelled by a span, and one heading among them
  leaves the outline uneven.
- **Removing jasmine's HTML reporter** from Karma's page. It comes with the
  builder's built-in config (`reporters: ['progress', 'kjhtml']`), and taking
  it out needs a Karma config of the app's own. The case that hit-tests is
  made to stand wherever the page is instead, as `fromThePageTop` does for
  the plan dialogs.
- **Putting back every scroll a focus leaves behind.** About seventeen spec
  files do it, a different set in each order, and putting each back would
  not fix the hit test: with the page at its top, a fixture lands at the
  reporter's foot, about 3,000px down by the end of a run.
- **Restyling the sign-in title to its utilities.** It would change the look
  the app drew before the title was a heading, in a change that only made it
  one.

## Consequences

- Thirty-seven spec files read painted contrast through one helper, and a
  case that goes through `expectPainted` or `paintedVerdict` reads a node at
  the colour it rests on, and fails on a node the page does not draw.
  Elsewhere the fold settles only the token probe.
- One focus hand-off serves thirteen components. A held Enter or Space
  presses nothing where focus lands, on the household sections, the
  dashboard layout's arrows, the split parts, the receipt viewer and the note
  lens as on the import screens.
- The shared helper is an initial chunk of its own, 935 B. At its commit the
  initial bundle fell from 2,424,691 B to 2,424,109 B, the private copies and
  the second export gone, so the budget's warning did not move for it.
- The About card and the review card fail a part that goes unscored, not
  only a card where nothing passed. The review card's date chip, currency
  chip and duplicate badge each carry a span, drawn as before.
- The household plans section stands on the page in its sweep, the command
  palette on its dialog's surface, and a plan dialog is swept at every
  half-screenful, its budget dialog's dates and alert threshold scored for
  the first time.
- A reader who moves by headings finds each dashboard card, each budget and
  goal, each Data section and the first empty state of a page one level
  under the page's `h1`, and the sign-in page has one.
- The walkthrough fails a page whose headings skip a level, once per page.
- Four spec helpers more: `keepThePageWhereFound()`, the plan dialogs'
  `fromThePageTop`, the totals line's `intoTheWindow()` and the shared
  `headingOutline(root)`.
- **The fold has no emulator surface.** It changes spec helpers only, no app
  code, so there is nothing for an emulator case to read. The heading run is
  the walkthrough's own, and the focus hand-off is read by the wizard's
  existing focus cases on the emulator.

## What the browser runs found

### Run 1, on 19 November 2026

On the emulators only, served from this branch's checkout with the bundle
naming `demo-home-account` alone, as Alex, signed in by a session record
written into the page, and as a fourth demo account made empty on the auth
emulator. Journey 124 is the run's outline and hand-off part. The desktop
pane painted about four frames a second, as a background page, so every
reading followed a flush and finished animations, and the keys were real
ones, for `:focus-visible`. Pages were read at 1024px in light and dark, at
375px in dark and at 320px in light, in English, Japanese and Traditional
Chinese.

The run re-walked the audit of 18 November, made on the same emulators and
seed in a hidden pane at 1024px and 320px, in light only, before any code.
On the screens this record owns it had found four things:

- the goal card's name was a span, and `/budgets?tab=goals` read `H1 Budget`
  and no other heading;
- Budget Progress's title was a `mat-card-title` at 16px / 400 with no
  heading, where the other cards' titles were `h3`s at 18px / 600;
- at 320px a Data page row's description stood in a column of about 60px, a
  word or two a line (*Every / income / and / expense / you have /
  recorded*);
- an unavailable count on the Data page showed a dash explained by a
  `title` alone, read from the template; every count was available, so it
  was not reproduced.

Each is fixed: the first by `fix: card titles, the Data page's sections and
first empty states sit one level under the page`, the second by that commit
and `fix: Budget Progress's title wears the other dashboard cards' title
look`, the last two by `fix: the Data page's rows fit a phone, and an
unavailable count says why`. A dash for an unavailable count is now hidden
from the reader, one line over the list (`data.countUnavailable`) says why,
and each such row's link takes it as its description.

- **The outline.** No heading skipped a level on `/dashboard`, `/budgets`
  (three tabs), `/data`, `/settings`, `/reports` (five tabs), `/household`,
  `/about`, `/import/file`, `/import/history`, `/search-history` and `/ai`.
  The dashboard read its `h1`, four `h2` card titles and `h3` day headers;
  the Data page its `h1` and five `h2`s; each goal's name an `h2`. Empty
  states under a page's `h1` read `h2` (*No goals yet*, *No saved answers
  yet*, *No sign-ins recorded yet*), and one under a card title `h3` (*No
  countries recorded yet*). A sweep at 375px in dark found no skip either,
  on `/dashboard`, `/data`, `/ai`, `/reports`, `/settings`,
  `/search-history`, `/import/history`, `/household` and `/about`.
- **The empty account.** The welcome dialog read `h2` then `h3`. No skip on
  `/dashboard`, whose cards read `h2` and their empty states `h3`, nor on
  `/transactions`, `/budgets` (three tabs), `/reports` (five tabs), `/data`,
  `/import/history`, `/search-history` and `/household`, where every first
  empty state read `h2` under the page's `h1`. Nothing was unnamed and
  nothing under AA.
- **The hand-offs.** On the dashboard layout settings, Move down kept focus
  on the moved row's Move down (*Recent Transactions moved to position 2 of
  5*), and Move up, pressed to the top, disabled itself and focus landed on
  the row's Move down. In the receipt viewer, Next at the last image disabled
  itself and focus landed on Previous image. The split parts and the note
  lens were not driven: the data held no split purchase, and no note was
  translated without a provider. A held key cannot be made in the pane, so
  the held-key drop was not judged there.
- **The audit re-read.** At 1024px each goal's name is an `h2`. At 320px in
  light the four dashboard card titles read 18px / 600; the "go to page"
  links still differ (Known gaps). A Data page row's description is 128px
  wide on three lines, its count under it. The unavailable count was again
  not reproducible: every count was available.

**Found: the sign-in page had no heading.** Signed out, `/login` held no
heading at all; its title was a plain `mat-card-title`. Fixed by `fix: the
sign-in page's title is its heading` and `test: the sign-in page has one h1
and keeps its title's look`. Red before the fix:
`the h1s on the page: Expected 0 to be 1.` and, from the heading run,
`Unexpected $[0] = 'heading-order: no heading found'`; an
`h1 { margin-bottom: 1rem }` in the page's stylesheet failed the look case
on its pin and its twin with
`Expected $.margin = '16px 0px 16px 0px' to equal '16px 0px 0px 0px'`. Read
again the same day on the fixed head, at 1024×768 in dark, in English,
Japanese and Traditional Chinese: one `h1`,
*Home Account*, which is the card title (`.mat-mdc-card-title`); the outline
`[H1 Home Account]`, no skip, no sideways scroll. The title drew 22px /
400 / 28px with no margin, in `rgb(255,255,255)`, the `--text-primary` of the
dark theme, centred; a `mat-card-title` twin with the same attributes put
beside it read the same on 18 properties. The unit spec had pinned 24px /
700 / 32px with a 16px top margin, which is Karma's sheet order: in the app
`text-2xl font-bold mt-4` do nothing on this title, and only `text-center`
acts. The title was left as it looks. `test: the sign-in title's look case
says which sheet order its figures come from` then pinned both orders.

The four other defects the run met are names, recorded in
[0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md);
the run's reading of the stylesheet is in
[0195](0195-a-gate-holds-the-test-main-to-the-builders-init-specs-stay-out-of-the-stylesheet-a-lone-date-run-is-silent-and-the-opacity-gate-reads-a-url-in-a-comment-as-a-comment.md).

### Run 2, on 21 November 2026

On the emulators only, on the data run 1 left, served from this branch's
checkout at 26.11.186 with the bundle naming `demo-home-account` alone, as
Alex and as run 1's empty account, each signed in from a saved emulator
record. Every reading followed a flush and finished animations, and the keys
were real ones. Journey 124 was read at 1024px in light and at 375px in
dark, in English.

- **The outline, read again, identical.** Every page and tab opened with its
  `h1` and read in order (`true`). The dashboard read its `h1`, then Recent
  Transactions, Upcoming Bills, Spending by Category and Budget Progress at
  `h2`, with Upcoming Bills' day headers, *December 1, 2026* and *December
  2, 2026*, at `h3`; the Data page its `h1` and five `h2`s; the Budgets tab
  its five budgets and the Goals tab *Japan trip* and *New laptop* at `h2`;
  `/household` its `h1` down to an `h4`, one level at a time; `/settings`
  *No sign-ins recorded yet* at `h2`. `/reports` in its five tabs, `/about`,
  `/import/file`, `/import/history`, `/search-history` and `/ai` read in
  order too. At 375px in dark, `/dashboard`, `/data`, `/ai`, `/reports`,
  `/settings`, `/search-history`, `/import/history`, `/household` and
  `/about` each read in order, with no sideways scroll (`scrollWidth` equal
  to the window's width) and a main overflow of 0.
- **The empty account.** Its welcome dialog did not show: run 1 had skipped
  it on this account, and it shows only to an account that never has, so
  its outline was not read again. The dashboard read its `h1`, then Recent
  Transactions, Upcoming Bills and Spending by Category at `h2`, each over
  its empty state at `h3` (*No transactions found*, *Nothing scheduled*,
  *No expenses yet*). Under the page's `h1`, `/transactions` read *No
  transactions found* at `h2`, `/budgets` *No budgets set*, *No Recurring
  Transactions* and *No goals yet*, each of `/reports`' five tabs its empty
  state, `/import/history` *No import history yet*, `/search-history` *No
  saved answers yet*, and `/household` *Invites for you* and *Start a
  household*, all at `h2`; `/data` read in order as well. Every outline
  read `true`, no control was unnamed (`[]`) and nothing stood under the
  contrast bar.
- **The hand-offs, read again, identical.** On the dashboard layout
  settings, a real Enter on *Move Recent Transactions down* kept focus on
  it, `:focus-visible`, and *Recent Transactions moved to position 2 of 5*
  was said; one on *Move Recent Transactions up* put the row back on top,
  its Move up disabled, with focus on *Move Recent Transactions down* and
  its move to position 1 of 5 said. Reset was pressed after. In the receipt
  viewer, opened on *r2 two images* by a real click on *View receipt for r2
  two images*, a real Enter on Next image reached *Receipt image 2 of 2*,
  disabled Next and put focus on Previous image, `:focus-visible`. The split
  parts and the note lens were again not driven.
- **The sign-in page, read again in light.** Signed out of the empty
  account through the user menu, `/login` read `['H1 Home Account']`, in
  order. The `h1` is the card's own title (`.mat-mdc-card-title`) and drew
  22px / 400 / 28px with a margin of `0px`, the figures run 1 read in dark,
  with no sideways scroll. The lead line, *Please sign in to continue*,
  painted the colour of the `--text-secondary` probe in each palette:
  `rgb(55,65,81)` plain, `rgb(31,41,55)` in high contrast,
  `rgb(229,231,235)` in dark and `rgb(243,244,246)` in dark high contrast.
  Alex was signed back in.

The run met no defect on the screens this record owns.

## Departures from the issues

- **#544's heading run is a page pass, not part of the in-view audits** it
  proposes, for the reason under *What was rejected*. The walkthrough runs
  no heading check on the Reports tabs past the first: it audits the
  Forecast tab only in view and never opens the category, monthly and
  insights tabs. Unit outline cases and journey 124 hold them.
- **The fold reaches thirty-seven spec files**, past the issue's counts and
  its grep. Its acceptance grep names `painted-contrast.ts` alone, and so
  does the wider one that also reads arrow forms and `tokenColour`.
- **Every hand-off drops a held key's repeats**, which the issue does not ask
  for: a change of behaviour for the household sections and the four former
  private copies.
- **Two sweeps moved by other remedies than standing on the page**: the
  command palette's dialog surface, and the plan dialogs' scrolled sweep.
- **More headings than the issue names**, on the dashboard, the budgets and
  goals, the Data page, Settings and Reports, and seventeen empty states.
- **The review card's words gained three spans**, a template change the issue
  does not ask for, with nothing drawn differently.
- **The sign-in page's heading**, which no issue names; the first browser run
  found it.
- **Two repairs of the test harness**, which no issue names: the plan
  dialogs' sweep on a scrolled page, and the totals line's hit tests.

## Things that only became apparent while building

- **The shared helper was the one that read too early.** Five of the copies
  settled before reading the node; `paintedVerdict` did not.
- **An expectation's argument is read before its matcher runs.** A case that
  reads the node in `expect(...)` and the token in `.toBe(tokenValue(...))`
  reads the node first, so the fold could settle the token and not the node.
- **The helper saved bytes rather than costing them.** It was expected to
  land in the initial bundle against 707 B of headroom; measured on a
  production build at its commit, the bundle lost 582 B, and the headroom
  went from 309 B to 891 B.
- **A one-rule run is not one rule when it is a tag run.** A helper written
  as a `best-practice` run over `axeOptions()` ran 23 rules and returned a
  `button-name` line; only a rule-type `runOnly` runs `heading-order` alone.
- **Material's card title is 22px / 400.** Moved onto an `h2`, the recurring
  list's title lost its 18px / 600 (*size: Expected '22px' to be '18px'*,
  *weight: Expected '400' to be '600'*), since its rule named the element.
  The sign-in title shows the same figures in the app, where the card's own
  rule loads after the utilities. Budget Progress's old title read 16px / 400
  in the audit and 16px / 600 under Karma, which fits the same order: its
  weight came from a plain utility, which the card's rule outranks in the app
  and loses to under Karma.
- **Two Reports cards ranked their empty states above their titles.** Once
  the empty states went to `h2`, the country and recurring-versus-one-off
  cards, titled by a bare `mat-card-title`, put their only heading under no
  title; their titles became `h2`s and their empty states fell back to `h3`.
- **Axe skips text a scroller clips without leaving it undecided.** The plan
  dialogs read clean with their lower half never scored, and no page fill
  could reach it.
- **A plan dialog on a scrolled page scored nothing.** Its faint-line case
  failed most full runs (*Expected '' to contain '.faint'*) and passed alone.
  The first reading, a line read as off screen, was wrong. While a dialog is
  open the CDK's block scroll strategy puts `cdk-global-scrollblock` on
  `<html>`, fixed at minus the page's scroll; `<html>` and body are 413px
  tall, so on a page scrolled 1700px both sit wholly above the viewport.
  Jasmine's stylesheet gives body `overflow-y: scroll`, so axe files every
  node, the dialog's overlay among them, under body's scroll region, yet
  leaves body itself out of every grid as off screen; `color-contrast` then
  throws on the first node it stacks (*Cannot read properties of undefined
  (reading 'getCellFromPoint') Skipping color-contrast rule.*) and scores no
  node of the dialog. A rule that throws is filed under `incomplete` with its
  error, never under `violations`, so a pass that expects no violations
  reads it clean. With the page scrolled before each spec, all six real
  plan-dialog audits were blind and passed. A dialog with the block
  strategy, audited on a scrolled Karma page, loses `color-contrast`
  entirely.
- **A reset to the top is no cleanup.** Two spec files ended their cases
  with the page scrolled to its top rather than where they found it, which
  moves the next spec's fixture down by as far as the page had been
  scrolled: 1685px and 2720px in a full run with seed 77499.
- **What stands above every fixture is jasmine's report.** The phone's
  totals line failed a full run with *the point (8, 416), inside the window:
  Expected false to be true.* and passed alone. Karma's context page is
  756 × 413. Jasmine's HTML reporter is the first child of body, TestBed
  appends each fixture after it, and it grows a 15px row about every 51
  specs: 66px at the start of a run, 441px after about 1,250 specs and about
  3,140px by the end. With the page at its top a fixture starts at the
  reporter's foot, so a line leaves the 413px window once about 850 specs
  have run before it; alone, the transactions spec has the reporter at 96px.
  Once anything has scrolled the page, Chrome's scroll anchoring raises the
  scroll by the reporter's growth for the rest of the run.
- **Jasmine's order is random and no seed is printed.** jasmine-core 5.9.0
  runs in random order by default, the builder's built-in config sets no
  `client.jasmine`, and the stock reporters print no seed, so a failing order
  cannot be replayed. With a seed printed, eleven spec files and seed 22222
  failed every time (`TOTAL: 8 FAILED, 1766 SUCCESS`). Three full runs with
  their seeds printed (91295, 76576, 55096) passed before the scroll helper
  was shared; after that, the four files it touched pass together.
- **A spec cannot tell one household landing from no option.** The last of
  `household.component.ts`'s landings runs only when focus has already
  dropped by the time `land()` is called, and `land()` and its render run in
  one tick, so no spec can move focus between them.
- **The destroy case pins where the hook registers, not the helper's body.**
  *cancels a hand-off the render had yet to run* stays green with the hook
  left uncleaned, since Angular ties it to the component's view, which is
  never refreshed once destroyed.

## Known gaps

### The shared helpers

- **Cases that read the node before the token are not settled.** The budget
  form, transaction form, budget progress, empty state, amount display and
  AI search dialog specs each hold a case that reads the node's colour in
  `expect(...)`, before the barrel settles motion for the token. Routing
  them through `expectPainted` would close it.
- **Inline probes stay.** Probes of other properties (`surface`, `fill`,
  `tokenSize`), single-token probes written in a case, and the spending
  chart spec's `computedBackground` are not folded, and several cases still
  compare `getComputedStyle(x).color` with `tokenValue` and a ratio by hand
  rather than through `expectPainted`. A fold of call sites would close it.
- **Five files still focus straight from a render hook.**
  `dashboard-card-menu.component.ts`, `dashboard.component.ts`,
  `transactions.component.ts`, `transaction-list.component.ts` and
  `period-selector.component.ts` call `.focus()` inside `afterNextRender`
  outside the helper, the last since the period chip's clear learned to
  hand focus to its quick range
  ([0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)),
  so a key held through those hand-offs is passed on; on the dashboard card
  menu a held Enter can reopen the menu and press its first entry again,
  read and not driven. Moving them onto `focusWhenRendered`, or a lint rule
  against a `.focus()` in `afterNextRender` outside the helper, would close
  it. `upcoming-bills.component.ts` also focuses a bill row from a render
  hook, through `focusRule`, for a reminder's link. The row is no button, so
  a held key presses nothing there, and a lint rule that reads only the
  hook's own body would not see it.
- **One household landing has no pin of its `onlyIfDropped`**, for the
  reason under *Things that only became apparent*.
- **No browser has read a held key, the split parts' hand-off or the note
  lens's.** The pane cannot hold a key, and the run's data offered neither a
  split purchase nor a translated note; the helper's and the components'
  specs hold all three.

### The sweeps

- **The household switcher's panel is never scored.** All five option texts
  are left undecided (`bgOverlap`): under the words stand the option, the
  panel's opaque fill, the pane and the CDK's transparent backdrop.
- **Material's select values and the slider's value label** are left
  undecided by Material's layers in the budget form and the plan dialogs.
- **The transaction list's phone row date** is left undecided by its
  pseudo-element (`pseudoContent`).
- **The category form dialog's words are undecided**, and its case claims
  `button-name` only.
- **Only the plan dialogs refuse a skipped rule.** The shared `runAxe` and
  `summarizeViolations` still read a pass in which axe skipped a rule on an
  error as clean. The same refusal in the shared pass would close it; a full
  diagnostic run found no rule skipped anywhere after the repair, so it would
  break nothing today.
- **No guard catches a spec that leaves the page behind for later specs.**
  Specs that build the real ThemeService leave `dark-theme` or `light-theme`
  on `<html>`, the axe harness's *either scheme* cases clear both classes
  rather than restore them, and `auditPlanDialog` removes its theme class
  even when `<html>` had it before. About seventeen spec files leave the page
  scrolled by a focus. One exploratory full run under heavy load also timed
  out once in *scores a line that only a scroll through the content brings
  into view*, and was not run again. A global guard that compares the page
  at each spec's start with the one before would close it; where such a
  guard can stand, with the test main held to the builder's init, is
  [0195](0195-a-gate-holds-the-test-main-to-the-builders-init-specs-stay-out-of-the-stylesheet-a-lone-date-run-is-silent-and-the-opacity-gate-reads-a-url-in-a-comment-as-a-comment.md)'s
  gap. A printed seed would let a failing order be replayed.
- **One transaction list case measures a fixture row's viewport bottom.**
  *lands a page fetch quietly when the view was destroyed mid-flight* reads
  a value that goes negative only when the fixture lies above the viewport;
  a real run appends each fixture below, so it holds.

### Headings

- **The first heading in a root is judged against the document.** Axe judges
  it against the last heading before it anywhere, the document's first
  heading passes at any level, and `page-has-heading-one` stays disabled
  because Karma owns the document, so a page whose first heading were an
  `h2` with no `h1` would pass.
- **The Reports tabs past the first get no heading run** in the walkthrough,
  which audits the Forecast tab only in view and never opens the category,
  monthly and insights tabs. Their unit outline cases and journey 124 hold
  them.
- **Headings a model writes** into the AI summary and the insight narrative
  are not held.
- **The Settings outline wants one decision.** The security activity's label
  is a span, like every Settings section's, while its empty state is an
  `h2`.
- **Card titles that are no heading.** The AI page's nine cards, the import
  history's records, the insight cards and narrative, and the spending
  analysis's and monthly comparison's two cards each keep a bare
  `mat-card-title`. Nothing skips, but a reader who moves by headings does
  not find them.
- **The sign-in title's utilities do nothing in the app.** `text-2xl
  font-bold mt-4` lose to the card's own rule there and win under Karma; the
  spec pins both. Any other `mat-card-title` whose typography utilities lose
  to the card's sheet in the app has not been looked for.

### The audit's leftovers on these screens

- **The dashboard's "go to page" links keep two looks.** Budget Progress's
  Manage is a Material text button in `--mat-sys-primary` with a 16px
  `arrow_forward`; View All is a plain link in `--color-accent` with an 18px
  `chevron_right`.
- **Budget Progress keeps its own padding**, 12px above its header and 12px
  around its content, where the other cards have 16px 16px 12px.
- **The AI insights card keeps an eyebrow title.** Its `h2` reads
  `--text-sm`, weight 600, upper case and spaced, in `--color-primary-text`
  beside its glyph, where the other cards' titles read `--text-lg`, weight
  600, in `--text-primary`; so the dashboard holds two card-title looks.
  Budget Progress moved onto the others' look. Whether the insights card
  follows them, or keeps its eyebrow as the mark of what a model wrote, is
  not decided.
- **The Data page's note reads singular in English.** *Count unavailable —
  this needs a connection.* stands over the list for every unavailable count,
  and offline all of them are; a number-neutral key would close it.
- **No browser has shown an unavailable count.** The unit cases hold the
  note, the description and the hidden dash.
