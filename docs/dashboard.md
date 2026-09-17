# The dashboard

The landing page: this period's totals, and five cards the account can move,
hide and reset — Recent Transactions, Upcoming Bills, Spending by Category,
AI Insights, Budget Progress.

Why an arrangement is an account preference rather than a device flag, why
one DOM order now drives both breakpoints, and what a hidden card does and
does not skip is in
[ADR 0132](ADR/0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md).
This document is the part you need when reading a card's data source,
working out why the grid looks the way it does, or changing the arrangement.

## The page's fixed parts, and the arranged five

Three pieces of the page are not part of the arrangement and never move:

| Part | Component | Why it stays fixed |
|---|---|---|
| The period selector and financial summary | `app-financial-summary` | The headline the period selector answers; there is no reading of "hide your own totals" |
| The weekly recap | `app-weekly-recap` | Its window is always last week, never the selected period — a peer of the period-following cards it is not ([weekly-recap.md](weekly-recap.md)) |
| The budget alert banner | `app-budget-alert-banner` | A threshold notice, dismissible on its own terms; folding it into the arrangement would let an account hide the one card that exists to interrupt it |

Below those, `arrangedCards()` renders the account's own order over exactly
five ids — `DashboardCardId = 'recent' | 'upcoming' | 'chart' | 'insights' |
'budgets'` — as one `@for` loop, one DOM tree for every breakpoint.

## What each card reads

| Card | Component | Reads |
|---|---|---|
| Recent Transactions | `app-recent-transactions` | The five most recent transactions (`getRecentTransactions(5)`), independent of the selected period |
| Upcoming Bills | `app-upcoming-bills` | Occurrences due in the next 14 days (`getNextOccurrences`), live-converted to the base currency |
| Spending by Category | `app-spending-chart` | `categoryTotals` — the selected period's expenses folded by category |
| AI Insights | `app-ai-summary` | The selected period's transactions, the previous period's totals and per-category breakdown, a trailing historical window sized by the account's RAG tier, active budgets and goals |
| Budget Progress | `app-budget-progress` | `activeBudgets()` — and only while at least one exists; an account with no active budget never sees this card, arranged or not |

Recent Transactions' listener is (re)established in `loadData()` — called
from `ngOnInit()` and again on every period change — and Upcoming Bills' and
Budget Progress' are each set up once in `ngOnInit()`. None of the three
checks whether its own card is currently hidden; hiding costs nothing on any
of them (see [Known gaps](#known-gaps)). AI Insights is the one card whose
cost is actually conditional on being shown; see
[What a hidden card skips](#what-a-hidden-card-skips).

## The preference, and its resolver

`preferences.dashboardLayout?: DashboardLayout` — `{ order:
DashboardCardId[]; hidden: DashboardCardId[] }` — on the user document,
written and read through the same `preferences.<key>` field paths every
other setting uses. Absent means the default order (`DASHBOARD_CARD_IDS`)
and nothing hidden.

`effectiveDashboardLayout(prefs)` is the one place a stored value becomes a
usable layout, and it is tolerant on every read:

- an id it does not recognize, or a repeat, is dropped (`knownDashboardCardIds`);
- a known id missing from the stored order is appended in that id's default
  position, so an account that saved before a card existed still sees it the
  day it ships.

Every write goes through `dashboard-layout.utils.ts`'s pure helpers —
`moveCard` (swap with a neighbor, a no-op past either end), `setCardHidden`
(idempotent, never touches `order`) — so the arithmetic needs no `TestBed` to
exercise.

**Reset deletes the key** (`AuthService.clearUserPreferences(['dashboardLayout'])`)
rather than writing today's default back over it, so a reset account follows
whatever a later build defaults five cards to, rather than freezing this
build's order on the document forever.

## The desktop areas rule, with a worked example

`dashboardGridAreas(cards)` (`dashboard-layout.utils.ts`) turns the account's
order into `grid-template-areas`, bound as the `--dashboard-areas` custom
property and read by the desktop breakpoint's stylesheet only — mobile has
no named areas at all and simply stacks the DOM order in one column.

`DASHBOARD_MAIN_COLUMN = ['chart', 'insights']` decides the split: main
column cards keep their relative order from the arrangement, everything else
falls into the rail, and each main row pairs with the rail row at the same
index. **The shorter column repeats its last card down the rows it does not
have of its own**, so the longer column is never asked to span an area the
DOM has no element for.

**Default order** (`recent, upcoming, chart, insights, budgets`, nothing
hidden) — main is `[chart, insights]`, rail is `[recent, upcoming,
budgets]`:

```
'chart    recent'
'insights upcoming'
'insights budgets'
```

This is the layout the page has always had, reproduced exactly — hand-verified
against a running build (journey 24 in [e2e.md](e2e.md)).

**A shorter rail** — order `chart, recent, insights`, `upcoming` and
`budgets` hidden — main is `[chart, insights]`, rail is `[recent]` alone:

```
'chart    recent'
'insights recent'
```

Row count is `max(2, 1) = 2`; the rail has no second card of its own, so its
one card (`recent`) is repeated into the row the main column still has,
which is what visually stretches a lone rail card down beside two stacked
main-column ones rather than leaving that cell blank.

## The editor, and its keyboard path

`DashboardLayoutSettingsComponent`, a third `mat-expansion` panel on the
Settings page beside Profile/Preferences and Categories, opened by the same
`?panel=` convention Categories already used — `?panel=dashboard`, read once
at arrival and turned into `dashboardExpanded`. The dashboard's own
**Customize dashboard** link is exactly that URL; a dialog was considered
and rejected — see the ADR.

Every change writes immediately; there is no Save. The rows are a
`linkedSignal` held to their last value while a write is in flight, so a
slower write settling after a faster one cannot roll the visible rows back
to what it was asked to change. A rejected write reverts the rows to the
account's own last-known layout and — for a toggle specifically — walks the
switch's own `MatSlideToggleChange['source']` back to the correct `checked`
state by hand, because a rejection can land before change detection paints
the optimistic value and the toggle's binding then has nothing to move.

**Pointer**: a drag handle (`cdkDragHandle`) reorders the whole list.

**Keyboard**: **Move up** / **Move down** per row — "the keyboard path the
drag handle does not offer," in the component's own words. Each move:

- disables at either end of the list (first row's **Move up**, last row's
  **Move down**);
- announces through `AnnouncerService`: *{card} moved to position {position}
  of {total}*;
- moves focus to the row's *other* button once the pressed one becomes
  disabled by the move — a disabled button drops focus, and the row's
  surviving control is what takes it, via `afterNextRender` with a
  destroyed-injector guard (the house idiom,
  `transaction-preview-table.component.ts:808-836`).

That first announcement is optimistic — it names the position the move
asked for, before the write behind it has settled. **A write that fails
announces a second time**, once the rows fall back to the account's
last-known order: *"Couldn't save. {card} is back at position {position} of
{total}"*, read right after the existing error notification. Without it, a
screen-reader user had already been told where the card landed and had no
way to learn that it had not.

Each `mat-slide-toggle` is named `aria-labelledby` pointing at the row's own
visible title span, never a bound `aria-label` — the house idiom
(`security-settings.component.html:9`): the inner `button[role=switch]`
takes its name from the referenced element, and `[attr.aria-label]` would
stay on the host instead.

## What a hidden card skips

Hiding a card removes its component; nothing is hidden with CSS. For AI
Insights that also skips the trailing-window `getExpensesInRange` query that
grounds its anomaly baseline — but only on a RAG tier that runs one at all
(`standard` or `deep`, whose `baselineWindowMonths` is non-zero); `off` and
`light` already skip that query regardless of whether the card is shown.

Recent Transactions, Upcoming Bills and Budget Progress keep their live
listeners whether or not their card is on screen — hiding one of those three
costs nothing (see [Known gaps](#known-gaps)).

## Verifying it

Journeys 24–26 in [e2e.md](e2e.md):

- **24** — the account's arrangement: one DOM order painting as the computed
  desktop grid areas above and as a single phone column, with no divergence.
- **25** — the editor: hiding a card and confirming it composed nothing,
  a keyboard move with its announcement and focus landing, a real reload
  holding the write, and Reset deleting the preference rather than freezing
  a default.
- **26** — the editor at phone width and in both themes.

Journey 25 carries this feature's one authorised write —
`preferences.dashboardLayout` — restored before the run ends; see
[e2e.md's permitted-writes table](e2e.md#what-a-run-may-touch).

## Known gaps

- **Offline, an unsaved change is held in memory rather than by Firestore.**
  The editor saves one write at a time, waiting for each before sending the
  next. Offline that first write never settles (the local cache neither
  resolves nor rejects it), so the rows keep showing what you chose, later
  changes collapse into a single in-memory slot, and nothing reports an
  error — Reset even stays enabled after an offline reset. Reconnecting sorts
  it out; closing the app while still offline loses those changes. See
  [ADR 0132](ADR/0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md).
- **Recent Transactions, Upcoming Bills and Budget Progress keep their live
  listeners while hidden.** Only AI Insights' historical-expenses query is
  conditional on being shown; Spending by Category has no listener of its
  own to begin with — it reads the transactions the period query already
  loaded.
- **An older build's editor can drop an id it does not know, permanently.**
  `effectiveDashboardLayout()` filters unknown ids out of every read,
  including the editor's own working copy — a build that predates a newer
  card writes that card's id out of the stored preference the next time it
  saves anything at all.
- **The order is pinned in full on the first change of any kind.** Toggling
  one card's visibility writes the whole `order` array as it stood at that
  moment, not just the field that changed — so an account that has ever
  flipped a single switch is not reached by a later release's improved
  default order.
- **No in-place editing on the dashboard itself.** Every change happens in
  Settings; nothing on the dashboard page hides or reorders a card from
  where it is actually seen.
