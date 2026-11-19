# 192. A control repeated per item names its item in its own text too, a button is named in every branch, and an unlabelled switch fails the axe pass

**Status:** Accepted, implemented · **Date:** 2026-11-19 · **Issues:** #542

Reference documentation lives in [../accessibility.md](../accessibility.md),
[../testing.md](../testing.md),
[../emulator-blind-spots.md](../emulator-blind-spots.md),
[../goals.md](../goals.md), [../dashboard.md](../dashboard.md),
[../receipt-import.md](../receipt-import.md),
[../import-fields.md](../import-fields.md), [../i18n.md](../i18n.md),
[../performance.md](../performance.md),
[../ui-overflow.md](../ui-overflow.md) and [../e2e.md](../e2e.md).

[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md)
named the controls the label gate's sixth rule had frozen and listed under
its Known gaps what the gate could not see, filed as #542. Some controls
stamped once per item were named by the words they show, which name no
item, so a screen reader moving down a list of review cards, goal cards or
receipt groups heard the same thing on every copy. A button whose only words
sat inside an `@if` had no name in the state where the block was false, and
no rule read a button's name at all. And the shared axe pass took the empty
label Material renders beside a slide toggle as the switch's name, so no
sweep could fail a switch nobody named. This record names the listed
controls and ten more that a wider gate found, teaches the gate to read a
control's own text and every branch of its blocks, and makes the shared pass
fail an unnamed switch.

Closes three gaps of
[0187](0187-repeated-controls-name-their-item-the-upload-area-has-one-button-and-numbers-photos-among-photos-resting-text-is-a-token-sentences-end-in-the-readers-stop-and-a-spec-that-expects-nothing-fails.md):
the controls repeated per item whose name is their visible text, the plain
button no gate named, and the Material switch axe could not find unnamed.

0187's *The sixth rule's remaining blind spots* stand. The issue's third
bullet, a key that one case of a held-apart switch reaches only through a
component it stamps, was already read when the issue was filed (*Departures
from the issues*).

## Context

**A name that is the words a control shows.** The sixth rule of
`icon-labels:check` fails a control stamped once per item whose
`aria-label` is one catalog key with no parameters, since every copy then
says the same thing. A control with no `aria-label` is named by what it
holds, and the rule did not read that. So the review card's *Add location*,
*Add tag* and *Notes* (`.location-add`, `.tag-add`, `.add-notes-btn`), the
goal card's *View Transactions* and *Contribute*, and the receipt image
manager's thumbnails, whose alt read *Receipt image 1 of 2* in every group
(`receiptImages.imageNumber`), passed the gate and read alike on every copy.

**A name inside a block.** The eighth rule held a checkbox, a slide toggle,
a radio button and a slider's thumbs to a name. A button, a link or an
element with a control's role was held to nothing, and words a control held
counted as its name whether or not they rendered. The transaction filters'
toggle had only its badge's count, inside `@if (activeFilterCount() > 0)`,
and was unnamed with no filter set until 0187's first browser run found it.

**What axe took as a switch's name.** `button-name` passes a button through
its `explicit-label` check when a `<label for>` points at it, and passes it
outright when that label is out of sight, whatever it says. Material's slide
toggle renders such a label beside its `role="switch"` button and hides it
while it projects nothing (`label:empty { display: none }`). Every sweep
therefore passed a switch named or not, and the AI page's spec removed the
label before its pass so that the pass meant something there. Axe reads a
rule's `checks`, but its `RuleObject` type declares `enabled` alone, and the
issue proposed declaring the option in an `axe.d.ts`.

**Words a voice user says.** A speech-input user reaches a control by saying
what it shows, so a name that adds the item has to keep those words (WCAG
2.5.3, Label in Name). Axe's rule for that is experimental and off, as 0187
recorded, so each such name is held to its words in its component's spec.

## Decision

### A repeated control names its item around the words it shows

Each control #542 lists carries a name whose sentence holds the words the
control shows and the item it acts on, in en, ja and tc: an
`[attr.aria-label]` on each button, and an alt on each thumbnail.

| Control | Key | en |
|---|---|---|
| Review card, *Add location* | `import.addLocationTo` | *Add location to {{description}}* |
| Review card, *Add tag* | `import.addTagTo` | *Add tag to {{description}}* |
| Review card, *Notes* | `import.notesLabel`, reused | *Notes for {{description}}* |
| Goal card, *View Transactions* | `goal.viewTransactionsNamed` | *View Transactions for {{name}}* |
| Goal card, *Contribute* | `goal.contributeNamed` | *Contribute to {{name}}* |
| Receipt thumbnail, its alt | `receiptImages.imageNumberOf` | *Receipt image {{index}} of {{total}} for {{description}}* |

- **The shown words stay whole in every language.** A name contains them,
  read without regard to case in the reader's locale. tc's goal card reads
  `檢視交易：「{{name}}」`, which holds *檢視交易* as the button shows it;
  `檢視「{{name}}」的交易` would split it round the name. ja places the item
  where its sentence puts it, `「{{name}}」の取引を表示`, and still holds
  *取引を表示*.
- **The slot is filled with the row's announced name**
  (`announceDescription(row)` on the review card, `quotedName(group)` in the
  receipt manager), never a raw description, so an untitled row reads its
  stand-in. The keys they fill hold no quotation marks of their own.
- **Notes reuses its field's own label**, `import.notesLabel`.
- **The thumbnail's alt takes a key of its own.** `receiptImages.imageNumber`
  keeps its five other readers: the camera capture, the transaction form
  twice and the receipt viewer twice. The thumbnail's tooltip stays
  `receiptImages.viewImage`: it is the thumbnail's description and does not
  say the transaction again.
- **One check holds a name to its words.**
  `holdsShownWords(name, shown, locale)`, in
  `core/services/testing/axe.ts` beside `accessibleName` and reached through
  the testing barrel, reads both strings in the reader's locale without
  regard to case, a run of white space as one space, and throws when the
  control shows no words, since every name would hold an empty string. Every
  label-in-name case written since goes through it.

Each name is pinned in its component's spec through the shipped catalogs,
in en, ja and tc: it holds its item and the words its control shows, two
rows of the review card read apart, and a thumbnail's description does not
say the transaction again.

### The sixth rule reads a control's own text

A link, a button, a Material toggle or an element with a control's role,
stamped once per item and named by no `aria-label` or `aria-labelledby`, is
now read by what it holds (`readOwnTexts`). The text is every run the
control holds, its descendants' included, outside a `mat-icon` (MatIcon
hides its ligature) and outside an element with a literal
`aria-hidden="true"`, with control-flow syntax taken out. It is bare when
what is left is one interpolation of one key with no parameters, or of a
ternary between two such keys, and nothing else.

Each control records where its name comes from, `via: 'label'` or
`via: 'text'`, and both feed one tally across templates
(`heldApartAcross`) and one freeze, `ITEMLESS_FROZEN`: a key is one name
however a control comes by it, so the dashboard's two *View All* links, one
in each of two cards, are two cases of one switch reaching one key.
`walkTemplate` reports opening tags only, so the text pass keeps its own
stack of open elements. A text hit is reported at the control's opening tag,
since its text may run over several lines, and its hint begins *keep the
visible words, add the item*.

Two text-named controls are exempt:

- **One inside a `<mat-menu>`.** A menu's panel is open for the one trigger
  that opened it, and that trigger is already held to name its item, by the
  fourth rule and this one. A control inside a menu that is named by its
  `aria-label` is read there as anywhere.
- **One with a bound `aria-describedby`**: `[attr.aria-describedby]`,
  `[aria-describedby]`, or a literal that interpolates. The household's six
  buttons are named by what they do, *Remove*, *Try again*, *Revoke*, *Add
  contribution*, *Decline* and *Accept*, and described by their item. This
  exemption is recorded under Known gaps, not offered as a pattern: a
  description is read after the name, after a pause or not at all. A literal
  `aria-describedby` with no interpolation points every copy at one element
  and exempts nothing.

### Ten more controls name their item

The text pass found ten controls the issue does not list, each named alike
on every copy. Frozen, they would have kept the gate green and the controls
alike; the freezes stay empty, so the ten are named here. The gate's commit
listed them in `ITEMLESS_FROZEN`, and the commit after it named them and
emptied the list. Each is read through its own template in en, ja and tc
from the shipped catalogs, its names pinned per locale, and two of a kind
are read one after the other so that they cannot share a name.

| Control | Key | What tells one from another |
|---|---|---|
| A transaction row's swipe *Edit* and *Delete* | `transactions.editNamed`, `transactions.deleteNamed` | the transaction, by the quoted name the list's other row buttons read |
| An import record's *View transaction* and *Delete* | `import.viewTransactionFrom`, `import.deleteFromHistory` | the file and when it came in |
| An insight card's *View transactions*, and its toggle *Show transactions* / *Hide transactions* | `insights.viewTransactionsNamed`, `insights.showTransactionsNamed`, `insights.hideTransactionsNamed`, each beside a twin ending `NamedWith` | the insight's title, and what tells it from others of its kind |
| A saved answer's *Refresh* | `aiSearch.historyRefreshLabel` | the question and its day |
| A saved answer's *View matching transactions* | `aiSearch.viewTransactionsFor`, `aiSearch.viewTransactionsIn` | the answer and its period, or its period alone |
| The dashboard's two *View All* | `dashboard.viewAllNamed` | the card's title |

- **Two of a kind read apart.** Insight cards of one kind share a title, and
  the tab shows up to three trends and three recurring payments at once, so
  a card names its category as well (`itemDetail`), and a new recurring
  payment its figure per month (`insights.recurringItemDetail`), since two
  can share a category: *Show transactions: A new recurring payment
  (Subscriptions, $15.99 per month)*. The toggle's name follows the words it
  shows, and `aria-expanded` says which state it is in.
- **A card about one category shows it.** No body sentence names the
  category, so a sighted reader could not tell two *Rising* cards apart
  either; the category line now shows on a card about one category, as it
  did on a card about several.
- **An import record is named by its file and by when it came in.** Two
  photos from one phone are both *image.jpg*. The record's *View
  transactions* menu, whose key already had a slot for the count and so
  passed the gate, names its record too (`import.viewTransactionsFrom`),
  since two records can share a count.
- **A count answer is named by its period alone.** Its label says what the
  button already says.
- **The insight card takes keys of its own.** `insights.showTransactionsFor`,
  which the recurring list keeps, reads `顯示「{{name}}」的交易` in tc and
  splits the toggle's *顯示交易*; the new keys read `顯示交易：「{{name}}」`.

### A control is named in every state of its blocks

The eighth rule widens from toggles to every control named by what it
holds: a button, a link, an element with a control's literal role, and the
three Material toggles, read through a tree of each template (`readTree`,
`heldBy`); slider thumbs are read as before. A control fails when no
`aria-label` or `aria-labelledby` with a value that is not blank names it,
and what it holds does not render in every state of its blocks. Words
outside every block render always; an `@if` renders in every state when it
ends in a plain `@else`, an `@switch` when it has an `@default`, and an
`@for` when it has an `@empty`, each with words in every branch. A hit is
reported at the opening tag with `sometimes`, true when words render in some
states only, since the fixes differ, and feeds `UNNAMED_FROZEN`, which is
empty. The scan is `scanUnnamedControls` now, and the reading that counted
the filter toggle's badge as text is gone.

- **What renders a name.** Text and interpolations; an `<img>` whose alt is
  not empty; and, read as words since what they render is not in this
  template, a component, an `<ng-content>`, and an element that a binding
  (`[textContent]`, `[innerText]`, `[innerHTML]`) or a template outlet
  fills. An `<ng-container>` is read through. A `mat-icon` names nothing
  unless it is written to be read, named with a literal
  `aria-hidden="false"`, and nothing inside a literal `aria-hidden="true"`
  element or an `<ng-template>` names anything. A field (`select`,
  `textarea`, `mat-select`) is never read by what it holds.
- **A control that holds nothing fails too.** An icon button with no
  `aria-label` is the case of every branch with no block
  (`sometimes: false`). The tree has none.
- **An `@switch` closes with an `@default`, or with Angular's exhaustive
  `@default never;`**, which has no body and which the compiler checks
  against the subject's type, so a value added later fails the build. Cases
  that cover every value without saying so read as incomplete: the gate
  cannot read the type. `readBlockHead` reads that spelling, and ends an
  `@let` at its `;`, for `readBlocks` and `readTree`; the sixth rule's text
  pass (`ownTextKey`) takes the same two spellings out before it reads a
  control's text.
- **An `@defer` reads as an `@if` with no `@else`.** Its main block renders
  once loaded, and nothing says what shows when loading fails.
- **A blank name names nothing.** An `aria-label` or `aria-labelledby` whose
  value is blank leaves the control to what it holds, here and in the sixth
  rule's text pass.
- **The toggle case flips.** The self-test's case of a toggle whose text
  sits inside a block, once a pass, is the must-hit
  `'text inside an @if with no @else names the toggle in one state only'`,
  beside a must-not-hit twin with an `@else`. Run against the old toggle
  scan, the new cases failed with `13 self-test failure(s)`, every one a
  must-hit.

The real tree has 17 controls named through a block, and every one is
complete. Seven hold words only inside blocks: one button each in the
feedback dialog, the sign-in page, the export dialog, the share dialog (an
`@switch` with an `@default`) and the transaction list (its select toggle),
and two on the Data page, one of them its upload area, a role button. The
other ten hold words outside a block as well, among them the transaction
form's stored-receipt thumbnail, whose `<img [alt]>` sits beside an `@if`
holding a spinner.

### The shared axe pass fails a switch nobody named

`axeOptions()` runs `button-name` without its `explicit-label` check:

```ts
const buttonName = { enabled: true, checks: { 'explicit-label': { enabled: false } } };
```

- **Scoped to the one rule.** Five rules share `explicit-label`, and a field
  named by its `<label for>` alone has to keep that name. Only Material's
  slide toggle labels a `<button>` that way here; a checkbox and a radio
  button are untouched.
- **A named switch still passes.** Material points the button's
  `aria-labelledby` at its label, and so at the words it projects, unless
  the page names it otherwise.
- **A plain const.** Axe's `RuleObject` declares `enabled` alone, and an
  object literal written in place would be refused for the extra key; a
  const is not held to that check, so no declaration file is needed.
- **The harness spec holds it** (`axe.spec.ts`, *an unnamed switch*): a
  toggle nothing names reports `button-name`; the same fixture without the
  entry passes, through `explicit-label`, which proves the gap; twins named
  by `aria-labelledby` and by projected words report nothing, contrast aside;
  the entry turns the check off for `button-name` alone and leaves a field
  its label; and neither the contrast sweep nor the heading run carries it.
- **The workaround goes.** The AI page's spec runs its pass over the real
  row with Material's empty label in place, and the hand-copied recipe the
  browser journeys define `audit` from (journey 77's) carries the same entry.

## What was rejected

- **An `axe.d.ts` declaring the option**, as the issue proposes. A plain
  const satisfies axe's type.
- **Switching `explicit-label` off for every rule.** A field named by its
  `<label for>` alone would read as unnamed.
- **Freezing the ten controls the text pass found.** The gate would pass and
  every copy would still read alike.
- **Two new rules, each with a freeze**, as the issue proposes. A key is one
  name however a control comes by it, so the text pass shares the sixth
  rule's tally and freeze; and the branch reading is the eighth rule
  widened, with the freeze it had.
- **tc names that wrap the item inside the shown words**, such as
  `檢視「{{name}}」的交易`: the name would no longer contain *檢視交易*.
- **The transaction in the thumbnail's tooltip as well.** The tooltip is
  read as the thumbnail's description, after its name, which now holds the
  transaction.
- **Reading what a control holds when its bound `aria-label` can be null.**
  A control with an `aria-label` is left to that label. The camera's process
  button and the transaction form's submit button rely on their `@else`
  words while their label is null; the gate's header lists the shape as
  unseen, and a self-test case pins it so.
- **A viewport query for the goals grid**, as the recurring and budget grids
  have. `minmax(min(100%, 300px), 1fr)` reads the grid's own width, so it
  holds in any container, and a spec can show it at a 248px host in Karma's
  756px window, where a viewport query never fires.
- **A wider overhang for a chip's removal on the review card.** Grown
  sideways, it would reach past the 6px gap into the next chip or back into
  the control before it. The removal's own box widens to 28px instead.
- **Trimming the review card's own gutters at a 320px page.** Measured at the
  256px table such a page leaves (list padding 10 to 6px, the card's inline
  padding 16 to 10px), the content column widens from 150 to 170px and the
  card shortens from 671 to 553px, with every control still on a line of its
  own. The finding is recorded under Known gaps.

## Consequences

- A screen reader moving through review cards, goal cards, receipt groups,
  a transaction row's swipe drawer, import records, insight cards, saved
  answers and the dashboard's cards hears each copy's item, and a voice user
  who says the words a control shows still reaches it.
- **An insight card about one category shows that category**, a change a
  sighted reader sees.
- `icon-labels:check` reads a repeated control's own text and every branch
  of every control's blocks. Run on 19 November 2026, it reads, of the
  controls stamped once per item, `0 take their name from a key with no parameters (0 by their aria-label, 0 by their own text), 0 frozen by name`,
  and of the controls named by what they hold,
  `231 take their name from what they hold, 17 of them through a control-flow block; 0 name nothing in some state of their blocks or in all, 0 frozen by name`.
  Its self-test reads `check-icon-labels self-test: 323 passed`.
- A control whose words sit in a block needs that block closed, words
  outside it, or a name: a new `@if` around a button's only words fails the
  gate until it has an `@else`.
- **Every axe pass built on `axeOptions()` fails a switch nobody named**, in
  the specs and in the smoke walkthrough's page pass, and so does the
  journeys' hand-copied recipe. With a reminders switch stripped of its
  words, the walkthrough failed on `/settings` in both schemes with
  `button-name (1)`.
- The emulator proof reads these names in the real app. The wizard smoke
  renders a camera hand-off in English and hears each card's *Add location*,
  *Add tag* and *Notes* name its own row, so two rows read apart; the
  walkthrough sweeps the goal card's actions in view and pins the four
  Settings switches by the words they show.
- The four Settings switches, app lock, reminders, weekly recap and usage
  statistics, are named by the words they show and stand in a group named by
  their section; the usage statistics switch is described by the free plan's
  note (*What the browser runs found*).
- The goal card spaces *Edit* from *Delete*, wraps its foot and sizes its
  text on the type scale, so its 13px text becomes 14px at the default size;
  the goals grid fits a 320px page; the review card's *Notes* and its chip
  removals reach 40px, and a chip with a removal is 8px wider.

## What the browser runs found

### Run 1, on 19 November 2026

Emulators only (Auth, Firestore and Storage), as the seeded Alex, signed in
through a session record written into the page's storage, served from this
branch's checkout with the bundle naming `demo-home-account` alone. The
desktop pane, at 1024px, painted about four frames a second, so every read
followed a flush and finished animations, and focus was read after real
keys. Journey 121 ([../e2e.md](../e2e.md)) is the names half of the run, in
English, Japanese and Traditional Chinese. A walk of the touched screens
came first, on 18 November, in a hidden pane at 1024 and 320px and in the
light scheme, with two goals made for it, one with linked money; its
findings were read again on 19 November at 320px light, 375px dark, 1024px
in both schemes, and at 320px in ja and tc.

- **Goal cards.** With two goals made through the form and a row linked to
  one through the transaction form's goal control, *Edit*, *Delete*, *View
  Transactions* and *Contribute* named their goal in en, ja and tc, each
  holding the words it shows.
- **The review card.** On a two-row CSV, *Add location*, *Add tag* and
  *Notes* named their row and held their shown words, in all three
  languages, and the two rows read apart.
- **Import history.** *View transactions (2) from rows.csv (11/19/2026 5:33
  PM)* and *Delete rows.csv (…) from import history*; ja and tc held their
  shown words.
- **Insight cards.** *View transactions: Falling (Groceries)* and *Show
  transactions: Payday effect*; ja and tc held theirs.
- **The dashboard.** The two links read *View All Recent Transactions* and
  *View All Upcoming Bills*.
- **A row's swipe drawer.** At 375px the pane's drag opened the drawer, and
  *Edit* and *Delete* were named with the row.
- **Receipt thumbnails.** On three rows of one, two and three images, a
  thumbnail read *Receipt image 1 of 3 for e2e three images*, in tc
  *「e2e three images」的第 1 張收據圖片（共 3 張）*; its description, *View
  image*, did not repeat the row, and no two thumbnails shared a name.
- **The AI page's switch** read *Auto-sync when online*, and the sweep at
  375px, which looks for unnamed controls among other things, found none on
  `/ai`.

A saved answer's *Refresh* and *View matching transactions* were not read
one by one; their component specs hold them in three languages.

**The walk of 18 November on the goal cards, the goals grid and the review
card, the Settings switches read from their templates, and what changed:**

- **The goals grid at 320px.** Its 300px floor overflowed the 248px the tab
  leaves: each card ended at x 332 of 320, *Delete* off the page and
  *Contribute* cut. After *fix: goal cards fit a 320px phone, and the Goals
  tab's hint grows with the text size*, the grid is 248px in 248 and the
  cards end at x 280; at 375px, 303px in 303. The recurring and budget grids
  were read beside it and fitted.
- **Edit beside Delete.** At 1024px they stood at x 536 and 576, 40px each,
  touching. The walk read their 48px touch spans as overlapping by 4px;
  measured in the card's spec, each span reaches 4px past a button that
  touched the other, so they overlapped by 8px. After *fix: the goal card
  spaces Edit from Delete, wraps its foot and grows with the text size*,
  they stand at x 528 and 576, 8px apart, and at 320px at x 176 and 224.
- **The goal card's foot at 320px.** *View Transactions* broke onto two
  lines and pushed *Contribute* out. After the same commit, each takes a
  line of its own, in view, at 320px and at 375px.
- **The goal card's text sizes.** Its 12px and 13px sizes did not follow
  the account's text size. After the same commit, every size on the card
  scales by 1.3 with `--app-font-scale` at 1.3, with nothing overflowing;
  its two glyphs moved onto the scale with it, and the Goals tab's 13px hint
  moved in the grid's commit.
- **The review card's Notes** was 74 by 36px. After *fix: the review card's
  Notes is a 40px target*, 74 by 40px.
- **The review card's chip removals** were 32px-wide targets, read from the
  stylesheet, since no chip with a removal rendered in that walk's data.
  After *fix: the review card's chip removals are 40px wide targets*, a
  removal's box is 28 by 20px with a 40 by 40px hit area, hit-tested 19px
  each way.
- **The review card at 320px.** Nested gutters left the card 218 of 320px,
  and one row ran to about 610px with every control on a line of its own.
  Read again, the card was 218 of 320px, and at 375px 281 of 375px with
  every control at 40px and nothing off the page. Left open (Known gaps).
- **The four Settings switches**, found by reading the templates, not seen in
  the pane. Each `mat-slide-toggle` pointed its
  `aria-labelledby` at its section's label, which Material hands to the
  `role="switch"` button in place of its own label: the reminders switch was
  named *Bill and budget reminders* while it showed *Send reminders*, and
  the usage statistics switch *Usage statistics* while it showed *Share
  anonymous usage statistics*. No gate saw it, since every switch had a
  name. After *fix: the reminders switch is named by the words it shows*,
  *fix: the weekly recap switch is named by the words it shows*, *fix: the
  app lock switch is named by the words it shows* and *fix: the usage
  statistics switch is named by its words and described by the plan's
  note*, they read *Require a PIN*, *Send reminders*, *Show the weekly recap*
  and *Share anonymous usage statistics*. The usage statistics switch's
  description had been bound on the toggle's host, which is no control, and
  never reached the switch; it is bound through the toggle's input now.
- **Struck:** a *$NaN* beside goal items was the walk's own seed, items
  written without an amount, not the app.

**Found:** nothing in this record's controls. The run met five defects,
each small, each fixed and read again the same day: two pairs of buttons
that shared a name, the period chip's clear named *Close* and the category
manager's unnamed toggle group, recorded in
[0196](0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md);
and the sign-in page with no heading, recorded in
[0194](0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md).

## Departures from the issues

- **The issue's third bullet was already read.** A key a held-apart case
  reaches only through a component it stamps had been followed into the
  case tally, at any depth, by *fix(a11y): a goal card's Edit and Delete
  name their goal, and rule 6 reads a component another template stamps per
  item*, on 3 November 2026, and 0187 records it under *What reading found*.
  Nothing was built for it.
- **No `axe.d.ts`.** The issue asks for one before the option is passed; a
  plain const needs none.
- **The label check is switched off for one rule, not for the run.** The
  issue asks for the per-run option; it would un-name fields.
- **The two rules the issue proposes are the sixth and eighth rules
  widened**, each with its existing freeze.
- **Ten more controls are named**, and one beyond them, an import record's
  *View transactions* menu, which the gate passed.
- **The branch reading also fails a control that holds nothing at all**,
  which the issue does not ask for. None does.
- **An insight card shows its category on a card about one**, a visible
  change no issue asks for.
- **The four Settings switches change name**, found by reading their
  templates and Material's toggle while the `button-name` entry was built;
  the issue does not name them.

## Things that only became apparent while building

- **Insight cards of one kind share a title.** Named by the title alone, two
  *Rising* trends and two new recurring payments read
  `["View transactions: Rising","View transactions: Rising","Show transactions: A new recurring payment",…]`,
  and a sighted reader could not tell them apart either, since the category
  line showed only on a card about several.
- **A slot is not a name.** The import record's menu had a slot for its
  count and passed the gate, and two records of one count still read alike.
  The gate does not judge what fills a slot.
- **Of 17 controls named through a block, seven hold words only inside
  blocks.** The stored-receipt thumbnail, which looked like one of them,
  holds an `<img [alt]>` beside its `@if`, outside the block.
- **Angular's `@default never;` has no body.** It opens no block, so an
  `@for` around the switch closes at its own brace; three readers of block
  heads had to learn the spelling, the sixth rule's text pass among them.
- **An empty name names nothing**, in a computed name as in the gate; a
  control with an empty `aria-label` is now read by what it holds.
- **Axe honours a rule's own `enabled` ahead of its tags.** A tag run spread
  over the shared options, a best-practice run say, would carry
  `button-name` with it, and the page pass would report one switch twice.
  The case that keeps the entry out of other runs first stood for a one-rule
  run built in place; once the page pass had its heading run, the case was
  rebuilt on that run's own call (*test: the walkthrough fails a page whose
  headings skip a level*), and now reads *stays out of the contrast sweep and
  of the heading run*.
- **A switch named by other words passes everything.** The four Settings
  switches were found by reading Material's `MatSlideToggle._getAriaLabelledBy`,
  where an `aria-labelledby` input wins over the toggle's own label: axe
  and the gate ask only that a switch have a name.
- **An attribute bound on a toggle's host reaches no control.** The usage
  statistics switch's free-plan description was such a binding and had
  never described the switch.

## Known gaps

### The sixth rule's text pass

- **A bound `aria-describedby` exempts a text-named control.** The
  household's six buttons stay named by what they do, the same on every
  copy, and described by their item. A name that holds the item and the
  words each shows, then the exemption dropped, would close it.
- **A constant bound to `aria-describedby` exempts too.**
  `[attr.aria-describedby]="hintId"` points every copy at one element and
  is read as bound. The upload area, the receipt viewer and the note lens
  carry such a binding, and none of them is a text-named control the
  exemption hides today.
- **Only one interpolation is read.** Text that is a bare key beside literal
  words or a second bare key, or beside a component or an `<img>` that adds
  to the name, is not read as bare.
- **What fills a slot is not judged.** A key with parameters passes, whether
  or not its slot tells two items apart; the import record's menu was such a
  control.
- **Label in name is held per component.** The hint asks to keep the
  visible words, and nothing holds an `aria-label` to the words its control
  shows but the component's own `holdsShownWords` cases. A new name that
  drops them passes the gate. A rule that reads both keys from the catalogs
  and checks one holds the other, per locale, would close it.
- **0187's remaining blind spots of the sixth rule stand**: a key two
  switches on one item each reach in one case, and a label wrapped whole in
  parentheses.

### The branch reading

- **Cases that cover every value without an `@default` read as
  incomplete.** The gate cannot read the type; `@default never;` says so.
- **Grouped cases with no body**, `@case ('a') @default { … }`, which
  Angular 22 allows, read as one `@case`, so the switch looks incomplete: a
  false hit, loud rather than silent. No template writes one.
- **An `aria-label` bound to an expression that is null in some states is
  read as naming every state**, so what the control holds is not read. The
  camera's process button and the transaction form's submit button rely on
  their `@else` words while the label is null.
- **What it cannot read**: a `title`, which names a control only when
  nothing else does; a structural `*ngIf`, read as rendering always (no
  template uses one); an element hidden by a bound `[attr.aria-hidden]`,
  read as rendering; whether a component, a projection or a binding renders
  any words; and a chip or a button toggle, which neither rule counts as a
  control.

### Switches

- **No gate holds a switch's name to the words it shows.** The four Settings
  switches are pinned by their components' specs and the walkthrough. The
  toggles of the accessibility settings, the AI page's auto sync and the
  dashboard layout settings point `aria-labelledby` at the words each shows,
  and nothing would fail one that pointed elsewhere. A case or rule that
  holds each toggle's name to its projected words would close it.

### The review card and the goal card

- **The review card at a 320px page.** The card is 218 of 320px in the
  pane, a 234px card less the hidden pane's 16px scrollbar, and a row stands
  every control on a line of its own: at the 256px table such a page leaves,
  in English, a row with a location and two tags measured 671px tall, with
  15 controls on 18 lines. The rest of the width goes to the wizard's own
  16px gutter inside the shell's and to the 40px checkbox column with its
  10px gap. Closing it takes the wizard and the card together and a new
  place for the checkbox column.
- **Two more small targets on the review card's location chip**, read from
  the stylesheet and not measured: the country picker, when it shows only its
  glyph (`.extra-country`), is 20px wide with a hit area 32px wide, and the
  nameless place-name trigger's hit area is about 21px wide.
- **No spec pins the thumbnail's tooltip key.** The receipt manager's case
  reads the description as non-empty, as the tooltip's own message, and as
  not holding the transaction, so a change of wording passes it.
