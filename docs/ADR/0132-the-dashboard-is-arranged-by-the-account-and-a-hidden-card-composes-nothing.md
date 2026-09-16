# 132. The dashboard is arranged by the account, and a hidden card composes nothing

**Status:** Accepted, implemented · **Date:** 2026-09-16 · **Issues:** #87

Reference documentation lives in [../dashboard.md](../dashboard.md).

## Context

The dashboard has always rendered five cards — Recent Transactions, Upcoming
Bills, Spending by Category, AI Insights, Budget Progress — in one order that
every account saw, laid out by two independent, hand-written
`grid-template-areas` blocks: one for the single mobile column, a different
one for the two-column desktop split. Nothing about that order came from the
account; it came from the stylesheet.

That had a real cost for the card two accounts most disagree about. AI
Insights composes a prompt from the account's own spending and, on the
`standard` and `deep` grounding tiers, pulls a trailing months-wide
`getExpensesInRange` query to baseline it against — the two tiers whose
`baselineWindowMonths` is non-zero (`off` and `light` already skip the query
for their own reasons). An account with the card wherever the layout put it
paid for that query whether or not it ever looked at the card, and had no way
to say otherwise.

## Decision

**The account gets a `dashboardLayout` preference — an order and a hidden
set over the same five cards — and one DOM order drives both breakpoints.**

### Five cards, and why the rest of the page does not join them

`DashboardCardId` is exactly the five the page already had:
`'recent' | 'upcoming' | 'chart' | 'insights' | 'budgets'`. Three other
pieces of the page were deliberately left out of the arrangement:

- **The weekly recap** sits above the grid, not in it, and stayed there. Its
  own comment says why: "the recap's window is fixed, while every card below
  follows the selected period." A once-a-week card with its own dismissal
  lifecycle is not a peer of five cards that all repaint on every period
  change.
- **The financial summary** (income / expenses / net) is the headline the
  period selector answers, not one option among several — there is no
  reading of "hide your own totals" that means anything.
- **The budget alert banner** is a threshold notice, dismissible on its own
  terms already; folding it into the arrangement would let an account hide
  the one card that exists to interrupt it.

### The preference lives on the account, not the device

`dashboardLayout?: DashboardLayout` joins `UserPreferences`, written and read
through the same `preferences.<key>` field paths every other setting on this
page uses. This branch's own biometric opt-in went the other way — a device
flag in `localStorage`, because Face ID enrolment is a property of one phone
(ADR 0130). An arrangement of dashboard cards is a property of the account:
two devices signed into the same account almost certainly want to see the
same rows in the same order, and syncing it costs nothing this app does not
already pay for theme and language.

### The resolver tolerates drift, and reset deletes rather than writes

`effectiveDashboardLayout()` is the one place a stored preference becomes a
usable layout. It drops any id it does not recognize and any duplicate
(`knownDashboardCardIds`), and appends any known id missing from the stored
order in that id's default position — so an account that saved before a
sixth card existed still sees it, in a reasonable place, the day it ships.
An account that has never touched the editor gets `DASHBOARD_CARD_IDS`
untouched and `hidden: []`.

**Reset deletes the key** (`clearUserPreferences(['dashboardLayout'])`)
rather than writing today's default order back over it. The distinction only
matters the day the default order itself changes: a written default freezes
that account on the order this build shipped; a deleted key means "however a
future build decides to sort five cards," the same contract
`effectiveDashboardLayout()` already gives every other reader.

### One DOM order, computed into desktop's areas

Before this branch, the mobile stack and the desktop grid were two
hand-maintained truths about the same five cards, and they already
disagreed with each other: the desktop grid's areas placed `insights`
beside `chart` in the main column, but the *DOM order* the mobile CSS
happened to be stacking was `insights, chart, recent, upcoming, budgets` —
the order the components appeared in the template — while the mobile
`grid-template-areas` actually painted them `recent, upcoming, chart,
insights, budgets`. A keyboard user tabbing through the mobile page moved
through the DOM order, not the painted one, so tab order started on AI
Insights while the eye started on Recent Transactions.

This branch collapses that into one list. `arrangedCards()` is the account's
order with hidden ids and an empty Budget Progress filtered out, rendered as
one `@for` in that exact sequence. Mobile has no named areas at all — the
comment on the template says why: "mobile stacks them in DOM order, so
reading and focus order match what is on screen," which for the very first
time they now do. Desktop still needs the asymmetric two-column split, so
`dashboardGridAreas()` (`dashboard-layout.utils.ts`) computes
`grid-template-areas` from that same order: `DASHBOARD_MAIN_COLUMN` (`chart`,
`insights`) forms the left column, everything else the right rail, and the
shorter column repeats its last card down the unfilled rows so the longer
column is never asked to span an area the DOM does not have. Fed the default
order, it reproduces the old hand-written desktop areas exactly — `'chart
recent' 'insights upcoming' 'insights budgets'`, hand-verified against a
running build. Tab order on desktop is still the account's DOM order, not
the visual column a card lands in, which the old fixed layout never had to
reconcile because nothing there was reader-defined; on the default
arrangement that puts Recent Transactions ahead of Spending by Category in
tab order even though the chart paints top-left. That is not new: it is the
same kind of column-crossing jump the old layout already made starting from
Insights. What changed is that this project now owns one number line
instead of two.

### A hidden card skips only what the page already knew how to skip

Hiding a card removes its component from the DOM — nothing renders to be
hidden with CSS. For AI Insights that also means the historical-expenses
query behind it: the constructor effect that feeds `getExpensesInRange` now
reads `insightsShown()` alongside `baselineWindowMonths`, releasing the
trailing-window listener whenever either is why the card should compose
nothing — the same off switch the RAG tier itself already used to skip the
query on `off` and `light`. Hiding the card reaches that switch only on a
tier with a window to begin with (`standard` or `deep`); on `off` or `light`
the query was never running, hidden or not.

### The Settings panel, not a dialog

The editor is `DashboardLayoutSettingsComponent`, a third `mat-expansion`
panel on the existing Settings page beside Profile/Preferences and
Categories, opened the same way Categories already was: a `?panel=dashboard`
query param read once at arrival (`SettingsComponent.panel`) and turned into
`dashboardExpanded`. The dashboard's own "Customize dashboard" link is
exactly that URL. A dialog would have needed its own deep-link story, its
own scroll region for five draggable rows, and a second place Settings had
to remember it did not own; the panel gets both for the cost of one boolean.

### The switch names its row, and a rejected write puts it back

Each row's `mat-slide-toggle` takes `aria-labelledby` pointing at the row's
own visible title span — the house idiom
(`security-settings.component.html:9`), not `[attr.aria-label]`, which stays
on the host element while the inner `button[role=switch]` needs the name.

Every change — a toggle, a move, a drag — writes immediately; there is no
Save button. The rows are a `linkedSignal` held to their last value while a
write is in flight, so a slower write landing after a faster one cannot roll
the screen back to what it already asked to change (`daf8096`'s single-flight
drain loop). A rejected write reverts by re-reading the account's last-known
layout and, for a toggle, walking `MatSlideToggleChange['source']` back to
`checked = !hidden.includes(id)` by hand — the toggle's own binding does
follow the rows, but a rejection can land before change detection has
painted the optimistic value, and the binding then sees no change to make.

## Consequences

- **The preference plumbing:** `dashboard-layout.utils.ts` and its spec are
  new (21 cases, pure functions, no `TestBed`); `user.model.spec.ts` gained 6
  cases for `effectiveDashboardLayout()` (55 total); `auth.service.spec.ts`
  gained 2 for the field-level preference write and delete (38 total).
- **The page:** `dashboard.component.spec.ts` gained 13 cases for the
  arrangement itself — the account's order, the hidden filter, the computed
  areas, the empty state (72 total; the remaining growth in that file is
  0133's publish effect, below).
- **The editor:** `dashboard-layout-settings.component.spec.ts` is new (21
  cases); `settings.component.spec.ts` gained 2 for the third expansion panel
  (18 total).
- **`dashboard-layout.smoke.spec.ts` is new, 2 cases**, proving the
  preference read and written through the deployed rules under emulators.
- **Testing this feature in a real browser (journey 24 below) turned up two
  pre-existing defects in the financial summary card**, unrelated to the
  arrangement itself, fixed in the same branch rather than filed, because a
  UI defect met while testing is fixed where it is met:
  `0c7e670 fix(ui): a stat card's amount scales to fit instead of breaking
  between digits` (the Net Balance figure wrapped mid-digit at the desktop
  three-column width) and `d57ba3e fix(ui): a stat card's falling delta
  shows its size once, beside the arrow` (the delta chip's direction arrow
  is `aria-hidden` by Material's own default, leaving the signed number as
  the only cue a screen reader had). Both touch
  `shared/components/stat-card/`, which the financial summary renders above
  the arranged grid; neither is specific to this decision.
- **`firestore.rules` needed no change.** `dashboardLayout` rides the same
  `preferences` map check every other preference already satisfies
  (`firestore.rules:667`).
- No backup-format change: `dashboardLayout` is a preference, not a stored
  record kind, and the JSON backup does not carry preferences at all.

## Departures from the issues

None recorded. #87 asked for an arrangement preference and a hidden card
that composes nothing; both shipped as asked.

## Things that only became apparent while building

- **The old layout's own tab order already crossed columns wrong.** Before
  this branch, the desktop grid's DOM order was `insights, chart, recent,
  upcoming, budgets` — the template's own literal order — while the mobile
  view's `grid-template-areas` stacked the same five as `recent, upcoming,
  chart, insights, budgets`. Nobody had reconciled them because nothing
  forced the question until one list had to serve both. Collapsing to one
  DOM order fixes the mobile case outright (reading order now equals
  drawing order by construction) and leaves the desktop case exactly as
  reconcilable as the account's own choice of order — no worse than before,
  and now something a keyboard user's own preference actually explains.
- **`effectiveDashboardLayout()` runs on every read, including the editor's
  own.** The settings panel's `accountLayout` computed calls the same
  resolver the dashboard does, which means an id the resolver does not know
  is invisible to the editor too, not only to the page — see Known gaps.

## Known gaps

- **Offline, the save loop holds changes somewhere less durable than
  Firestore would.** The app initialises Firestore with `persistentLocalCache`
  (`app.config.ts:76`), and an offline `updateDoc` under that cache neither
  resolves nor rejects until the connection returns. `drain()` awaits each
  write before sending the next, so offline the first write hangs, `saving`
  stays true — which is what keeps the rows showing the local arrangement —
  and every further change collapses into the single in-memory `queuedWrite`
  slot. Nothing rejects, so nothing is announced and `customized()` never
  updates: Reset stays enabled after an offline reset. On reconnect this
  converges correctly, but an app killed while still offline loses those
  changes, where a plain per-change `updateUserPreferences` would have handed
  each one to Firestore's own persistent offline queue. The single-flight loop
  exists because overlapping saves raced each other; this is what it costs. A
  card arrangement is worth that trade — a preference carrying real data would
  not be.
- **Recent Transactions, Upcoming Bills and Budget Progress keep their live
  listeners while hidden.** Only AI Insights' historical-expenses query was
  wired to `insightsShown()`; the five-document `getRecentTransactions`
  subscription (re-established on every period change), the upcoming-bills
  window and the budgets stream all still run regardless of whether their
  card is hidden. Hiding a card costs nothing on AI Insights and nothing
  else.
- **An older build's editor drops an id it does not know, permanently, the
  next time it writes anything.** `effectiveDashboardLayout()` filters
  unknown ids out of *every* read, including the one the settings panel
  holds as its working copy. A build that predates a sixth card reads a
  five-card layout with that id already gone; the very next toggle or move
  writes the *filtered* order back in full, and the sixth id — which the
  stored document held until that moment — does not come back on a newer
  build afterwards. Reading tolerates drift; writing from a stale editor
  erases it.
- **The order is pinned in full on the first change of any kind.** `apply()`
  writes the whole `order` array, not just the field that changed, so
  toggling one card's visibility for the first time freezes that account's
  order at whatever it was — today's default, if nothing had been moved yet
  — rather than leaving order untouched while only `hidden` becomes
  customized. A later release that improves the default order will not
  reach any account that has ever flipped a single switch.
- **No in-place editing on the dashboard itself.** Every change happens in
  Settings; there is no per-card control on the dashboard page to hide or
  reorder from the page the cards are actually seen on.
