# The dashboard

The landing page: this period's totals, and five cards the account can move,
hide and reset — Recent Transactions, Upcoming Bills, Spending by Category,
AI Insights, Budget Progress. Every change can be made in the Settings
editor, and a card can also be hidden or moved from its own menu on the
page.

Why an arrangement is an account preference rather than a device flag, why
one DOM order drives both breakpoints, and why a hidden card composes
nothing is in
[ADR 0132](ADR/0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md).
Why the stored layout keeps only what the account changed, why one service
saves it, which listeners a hidden card closes, and why each card carries a
menu is in
[ADR 0166](ADR/0166-a-hidden-card-closes-what-nothing-else-reads-the-layout-stores-only-what-changed-and-each-card-has-a-menu.md),
which amends it. This document is the part you need when reading a card's
data source, working out why the grid looks the way it does, or changing
the arrangement.

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
| Upcoming Bills | `app-upcoming-bills` | The 14-day window's occurrences and the count of those behind its floor (`getUpcomingSchedule`), live-converted to the base currency |
| Spending by Category | `app-spending-chart` | `categoryTotals` — the selected period's expenses folded by category |
| AI Insights | `app-ai-summary` | The selected period's transactions, the previous period's totals and per-category breakdown, a trailing historical window sized by the account's RAG tier, active budgets and goals |
| Budget Progress | `app-budget-progress` | `activeBudgets()` — and only while at least one exists; an account with no active budget never sees this card, arranged or not |

Each stream is open only while something on the page reads it:

| Stream | Opened | Closed |
|---|---|---|
| The recent rows (`getRecentTransactions(5)`) | Once, by a constructor effect, while Recent Transactions is not hidden | When the card is hidden; its rows are cleared |
| The upcoming window (`getUpcomingSchedule`) | Once, by a constructor effect, while Upcoming Bills is not hidden, the weekly recap is on, or the build carries the widget plugin | When none of the three holds; the schedule is cleared |
| Budgets (`getBudgets()`) | Once, in `ngOnInit()` | Never, while the page is open |
| AI Insights' trailing window (`getExpensesInRange`) | For each period, while the card is shown on a RAG tier with a window | See [What a hidden card skips](#what-a-hidden-card-skips) |

Neither the recent rows nor the upcoming window follows the selected
period, so a period change reopens neither. Their gates are `computed`
booleans, `recentWanted` and `upcomingWanted`, so a change to another card
or another preference never reopens a listener. The upcoming window's other
two readers are the recap's bills line and the widget's *Next scheduled*;
`WidgetSnapshotService.available` is true on a build that carries the
widget plugin ([widget.md](widget.md)). Budgets stays open whatever is
hidden: the budget alert banner, which cannot be hidden, the recap's
alerts, AI Insights, the widget and the reminder sweep all read the list.
Spending by Category has no listener of its own; it reads the transactions
the period query already loaded.

## The Upcoming window's floor

The window is symmetric. `getUpcomingSchedule(14)` walks each active rule
from 14 whole local days behind today to the end of the fourteenth day
ahead ([recurring.md](recurring.md)). Days already past are grouped and
listed like any other — a rule a few days overdue is the failed-catch-up
case this card exists to surface — but a rule dormant since long before
that floor no longer arrives as one row per day from then to the horizon,
burying everything genuinely upcoming underneath it.

What the floor left behind is counted rather than collected, by the same
walk that builds the list, and named in a single line underneath it:
*"3 older occurrences are overdue and not shown"*
(`dashboard.upcomingOlderHidden`). The line also stands beside the empty
state, since a rule can be entirely behind the floor. The count is exact,
not capped — stopping the walk at some number would leave that rule's
pointer short of the floor, and its in-window occurrences would be the
price.

The card's net folds only the occurrences it shows.

## The preference, the resolver and the service

### What is stored

`preferences.dashboardLayout?: StoredDashboardLayout` — `{ order?:
string[]; hidden?: string[] }` — on the user document. The ids are raw
strings, because a card a later build adds must survive a write from this
one. Either field may be absent: no `order` is the default order
(`DASHBOARD_CARD_IDS`), no `hidden` hides nothing, and no key at all is
both.

### What renders: the resolver

`effectiveDashboardLayout(prefs)` turns the stored value into a
`DashboardLayout` — `{ order: DashboardCardId[]; hidden: DashboardCardId[] }`
— and is tolerant on every read:

- an id it does not recognize, or a repeat, is dropped;
- a known id missing from the stored order is appended after the stored
  ones, in default order (`resolveDashboardOrder`), so an account that
  saved before a card existed still sees it the day it ships;
- a value that is not an array reads as absent.

It filters for rendering only. Its result is never written back as it
stands, because it has already dropped every id this build does not know.

### What is written: `layoutWrite`

`layoutWrite(raw, next, touched)` (`dashboard-layout.utils.ts`, pure) is
the smallest write that stores a change. `raw` is the stored value as this
session last read it, `next` the resolved layout to store, and `touched`
the fields the change touched. It returns, per field, `{ set: string[] }`,
`{ delete: true }` or nothing — or, over a stored value that is not a map,
the whole key.

| Case | What is sent |
|---|---|
| A field the change did not touch | Nothing, unless a row below deletes it; it is judged from `raw` alone, never from `next` |
| `hidden`, touched | The stored ids that are unknown or still hidden, then the newly hidden ids |
| `order`, touched | `next.order`, with each stored unknown id put back after the id stored before it (one stored first stays first) |
| An empty `hidden` (or one that is not an array), touched or not | A delete |
| An `order` with no unknown id that resolves to the default (the default itself, a prefix of it, or not an array), touched or not | A delete |
| A touched field that ends where it started | Nothing |
| A stored value that is not a map (null, a string, an array, a class instance) | The whole key, leaving out a default order and an empty `hidden` |

A field written is cleaned of anything that is not a string id, and of
repeats. An absent `dashboardLayout` takes the field path, because the
Firestore SDK creates the parent map for a nested path.

The per-field writes go through `AuthService.updatePreferenceFields(key,
fields)`: one `updateDoc` with `preferences.dashboardLayout.<field>` set,
or `deleteField()` for a delete. The whole-key fallback goes through
`updateUserPreferences({ dashboardLayout })`. No rule changed for either:
`firestore.rules` checks only that `preferences` is a map.

### Who writes: `DashboardLayoutService`

`DashboardLayoutService` (`features/dashboard/dashboard-layout.service.ts`,
root) is the only thing that changes the arrangement. The editor and the
card menus both call it.

- **`layout`** is what both render: a `linkedSignal` over the account's
  resolved layout, compared by structure, and held while a save is out, so
  a change shows at once and an unrelated preference write cannot roll it
  back on screen.
- **`hide`, `show`, `moveVisible`, `setOrder`, `reset`.** Each shows its
  change at once and returns the promise of the save run it joined. A call
  that changes nothing gets the current run's promise, or a resolved one.
- **One save at a time.** A change made while a write is out adds its field
  to a queue, and the next write sends every queued field together, judged
  against the stored value as the run's earlier writes left it.
- **A failure** ends the run. The changes queued behind the failed write are
  dropped, the layout falls back to the account's once, one snackbar says so
  (*Couldn't save the dashboard layout*, `settings.dashboardLayoutSaveFailed`),
  and every caller's promise rejects. A caller that ignores the rejection
  reaches neither the unhandled-rejection report nor the global error
  handler.
- **A change of account.** The service is root, and signing out and in
  again on the page does not reload it. A write still out when the account
  changes settles only once its own account is signed in again, so the hold
  and the run belong to the account they were made for. A generation that
  moves on with each change of account, read whenever the layout is,
  decides it:
  - the next account's layout shows at once;
  - its first change drops whatever the previous account had queued, unsent,
    and starts a run of its own;
  - a write of the previous account's that settles late sends nothing more,
    and leaves the next account's run alone.

Every profile and preference writer (the five that go through
`writeAndMerge`), `updatePreferenceFields` among them, merges its change
into the `currentUser` signal as it stands once its write lands, and leaves
the signal alone when the session ended or moved to another account
meanwhile. So a theme switch sent while a hide is out cannot put the hidden
card back when it lands.

### Reset

**Reset deletes the key** (`clearUserPreferences(['dashboardLayout'])`)
rather than writing today's default back over it, so a reset account
follows whatever a later build defaults five cards to. A queued field
change is superseded by it, and a change made after it is written on top.
The editor's **Reset** is enabled while either field is stored.

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
and rejected — see ADR 0132.

Every change writes immediately; there is no Save. The rows are the
service's held layout, so a slower write settling after a faster one cannot
roll the visible rows back to what it was asked to change. A failed save
reverts the rows once, to the account's layout, and — for a toggle
specifically — the editor walks the switch's own
`MatSlideToggleChange['source']` back to the correct `checked` state by
hand, because a rejection can land before change detection paints the
optimistic value and the toggle's binding then has nothing to move. Every
card is a row here, so the editor's moves step over the whole order.

**Pointer**: a drag handle (`cdkDragHandle`) reorders the whole list.

**Keyboard**: **Move up** / **Move down** per row — "the keyboard path the
drag handle does not offer," in the component's own words. Each move:

- disables at either end of the list (first row's **Move up**, last row's
  **Move down**);
- announces through `AnnouncerService`: *{card} moved to position {position}
  of {total}* — in `'replace'` mode, since a position is current state and the
  next press makes it stale, so a run of presses is not heard as a backlog of
  positions already passed;
- moves focus to the row's *other* button once the pressed one becomes
  disabled by the move — a disabled button drops focus, and the row's
  surviving control is what takes it, via `afterNextRender` with a
  destroyed-injector guard (the house idiom,
  `transaction-preview-table.component.ts:808-836`).

That first announcement is optimistic — it names the position the move
asked for, before the write behind it has settled. **A write that fails
announces a second time**, once the rows fall back to the account's
last-known order: *"Couldn't save. {card} is back at position {position} of
{total}"*, read right after the existing error notification. It leads with
the failed save, an event, so it queues rather than replacing. Without it, a
screen-reader user had already been told where the card landed and had no
way to learn that it had not.

Each `mat-slide-toggle` is named `aria-labelledby` pointing at the row's own
visible title span, never a bound `aria-label` — the house idiom
(`security-settings.component.html:9`): the inner `button[role=switch]`
takes its name from the referenced element, and `[attr.aria-label]` would
stay on the host instead.

## The card menu

`DashboardCardMenuComponent` (`features/dashboard/dashboard-card-menu/`) is
each card's own menu: **Hide**, **Move up** and **Move down**
(`dashboard.cardMenuHide`, `dashboard.cardMenuMoveUp`,
`dashboard.cardMenuMoveDown`). Showing a hidden card again stays in the
editor, since a hidden card has nowhere to carry a menu.

**Where it sits.** The dashboard projects one menu into each card's header
through a `[card-actions]` content slot, last in the header, so
`.dashboard-grid > *` stay the five card hosts the desktop areas place. The
trigger is a `more_vert` icon button, `.card-menu-trigger`.

**Its name.** *More actions for Recent Transactions*: `common.moreActionsFor`
with the card's title from `CARD_TITLE_KEYS`, the keys the editor's rows
use, so a list of buttons tells the five menus apart. Material adds
`aria-haspopup="menu"`.

**Its target.** 40 × 40 px, whatever density the theme moves to
(`--mat-icon-button-state-layer-size: 40px`). The host is pulled 8 px into
the header's padding, so the glyph rather than the box lines up with the
card's content edge.

**What a move counts over.** Every menu takes `[visible]`, the dashboard's
`menuCardsFor(card)`. That starts from `menuCards()`: the rendered cards
(`arrangedCards()`) minus an AI Insights card with no provider, which
renders nothing and carries no menu. From 1024 px, where the grid draws two
columns, it keeps only the card's own column: Spending by Category and AI
Insights in the main one (`DASHBOARD_MAIN_COLUMN`), the other three in the
rail. Below that width it is the whole list. A move steps the card past the
next one in that list (`moveVisible`), over any card between them that
renders nothing — a hidden card, Budget Progress with no active budget, AI
Insights with no provider, or on desktop a card of the other column — so
every press changes what is seen, and only the moved card changes place in
the stored order. **Move up** is disabled on the first card of the list and
**Move down** on the last. The position is announced over the same list,
in `'replace'` mode, with the editor's sentence: *"{card} moved to position
{position} of {total}"* (`settings.dashboardCardMoved`).

**A hide** is announced, queued: *"{card} hidden. Show it again from
Customize dashboard."* (`dashboard.cardHidden`).

**Focus.**

- After a move, focus stays on the moved card's trigger. The grid reorders
  its cards by moving their hosts, and a moved element loses focus, so the
  menu focuses its trigger again once the move has rendered.
- After a hide, the menu has gone with its card, so the dashboard decides:
  `focusAfterHide(card)` focuses the trigger of the next card with a menu in
  page order, the focus order at every width, even where that card is drawn
  in the other column. Past the last, it focuses **Customize dashboard**:
  the link under the grid, or the empty state's once no card is left.

**A failed save** falls back once and the service's snackbar says so. Both
of the menu's announcements were made before the save settled, so the menu
corrects them, queued after the snackbar. The save fails as a whole, though
an earlier write of it may have landed, so each correction says only what
the fallback undid:

- **A move** gets the editor's *"Couldn't save. {card} is back at position
  {position} of {total}"* (`settings.dashboardCardMoveReverted`). It waits
  for the fallback to render, so it counts over the cards back on the page,
  including one a hide in the same save had taken away. It is said once
  however many presses joined the save, and not at all when the card stands
  where it was said to be.
- **A hide** gets *"Couldn't save. {card} is back on the dashboard."*
  (`dashboard.cardHideReverted`), but only when the fallback shows the card.
  The hide's menu has gone with its card by then; the announcer outlives
  it.

**In the rail.** At 1024 px the desktop rail is about 229 px wide, and
there a rail card's actions take a row below its title.

- Recent Transactions and Upcoming Bills group **View All** and the trigger
  in one unbreakable `.header-actions` row. The title's flex basis is its
  whole width (`flex: 1 1 auto`), so when title and actions do not fit on
  one line, the actions drop to the row below rather than the title
  breaking to keep them beside it. The title wraps only when it alone is
  wider than the card.
- Budget Progress does the same with **Manage**, through Material's card
  header.
- Spending by Category, in the desktop main column, keeps the trigger at
  the end of the title's row and wraps the title beside it.
- AI Insights groups the trigger with its refresh button.

A header row with the 40 px trigger is about 13 px taller than one without.
The Recent Transactions and Upcoming Bills specs sweep 200–420 px in
Verdana: "never breaks the title to keep the actions beside it, at any rail
width".

## What a hidden card skips

Hiding a card removes its component; nothing is hidden with CSS. The
dashboard reads the service's held layout, so a hidden card leaves the page,
and its listener closes, before the write behind it lands. What else each
card skips:

- **Recent Transactions**: its listener, which closes, and its rows,
  which are cleared. Shown again, it opens a new listener and shows its
  empty state until the first snapshot arrives.
- **Upcoming Bills**: the same, unless the weekly recap is on, since its
  bills line reads the same window, or the build carries the widget plugin,
  since *Next scheduled* does ([widget.md](widget.md)).
- **Budget Progress**: nothing. The budgets stream stays open for the
  banner, the recap, AI Insights, the widget and the reminder sweep.
- **Spending by Category**: nothing to skip; it has no listener of its own.
- **AI Insights**: the trailing-window `getExpensesInRange` query that
  grounds its anomaly baseline, but only on a RAG tier that runs one at all
  (`standard` or `deep`, whose `baselineWindowMonths` is non-zero); `off`
  and `light` skip that query whether or not the card is shown.

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

Against the emulators, `dashboard-layout.smoke.spec.ts` stores an editor
toggle as the `hidden` field alone ("saves an editor toggle as the hidden
field alone"), counts the listeners with Recent Transactions, Upcoming
Bills and Budget Progress hidden ("opens no recent or upcoming listener for
hidden cards, and one budgets listener for the banner"), and hides a card
from its menu and finds it hidden in the editor ("hides a card from the
dashboard's own menu, and the editor shows it hidden").
`auth.service.smoke.spec.ts` covers the nested writes themselves, including
the parent map the SDK creates and a nested write over a stored value that
is not a map.

## Known gaps

- **Offline, an unsaved change is held in memory rather than by Firestore.**
  The layout service saves one write at a time, waiting for each before
  sending the next. Offline that first write never settles (the local cache
  neither resolves nor rejects it), so the page and the editor keep showing
  what you chose, later changes from either wait in memory for one next
  write, and nothing reports an error — Reset even stays enabled after an
  offline reset. Reconnecting sorts it out; closing the app while still
  offline loses those changes. See
  [ADR 0132](ADR/0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md).
- **AI Insights with no provider has no menu.** The card renders nothing
  without a provider, so there is no header to carry one. It can be hidden
  or moved only from the editor, and a move from another card's menu steps
  over it.
- **A card moved and then hidden in one failed save is not placed again in
  words.** Its menu has gone with it, so only the hide's correction says
  that it is back, not where.
- **A needless field is deleted from this session's view.** Nothing listens
  on the user document, so a session's copy of the account is the profile
  read when the session began, plus its own writes. A change that finds that
  copy's `order` resolving to the default deletes `order`, even when the
  change never touched it, and a custom order another device has stored
  since goes with it. An empty `hidden`, which builds before this one
  stored, is deleted the same way, along with any card another device has
  hidden since. Pinned by `dashboard-layout.utils.spec.ts` "is deleted from
  this session's view, whatever the server now holds"; see
  [ADR 0166](ADR/0166-a-hidden-card-closes-what-nothing-else-reads-the-layout-stores-only-what-changed-and-each-card-has-a-menu.md).
- **A field this session changes is written whole from its copy.** Another
  device's change to that same field since this session began is
  overwritten. The other field is left alone.
- **On a build with the widget plugin, a hidden Upcoming Bills card keeps
  its listener whether or not a widget is placed.**
  `WidgetSnapshotService.available` means the plugin is there; nothing in
  the service can tell whether a widget is on the home screen.
- **A build from before this one still writes the whole layout.** A device
  still running one writes the whole key on its next change, from its
  resolved layout: it pins the order again and drops any id it does not
  know.
- **The older-occurrence count is per window, not per rule.** One figure
  covers everything behind the floor, so the card cannot say which rule
  stalled — and the walk producing it re-runs on every emission of the
  schedule listener, not only when the window itself moves.
