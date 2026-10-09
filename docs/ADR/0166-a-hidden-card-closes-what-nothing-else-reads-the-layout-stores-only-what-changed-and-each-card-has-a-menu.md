# 166. A hidden card closes what nothing else reads, the layout stores only what changed, and each card has a menu

**Status:** Accepted, implemented · **Date:** 2026-10-08 · **Issues:** #442

Reference documentation lives in [../dashboard.md](../dashboard.md) and
[../widget.md](../widget.md). [../testing.md](../testing.md) records what
the unit suite now reaches in `AuthService`.

Amends
[0132](0132-the-dashboard-is-arranged-by-the-account-and-a-hidden-card-composes-nothing.md):
its arrangement stands, and so does what a hidden card composes, but the
stored shape and the listener rules change. Closes three of its Known gaps,
the order pinned in full on the first change, an editor that erases an id
it does not know, and no editing on the dashboard itself, and narrows a
fourth, the listeners a hidden card keeps. Leaves its offline gap standing.

## Context

0132 gave the account an arrangement of the dashboard's five cards and
wrote down what it had left behind. #442 collected four of those gaps. At
`c47d6f26`:

- **P1, listeners.** Only AI Insights' trailing-window query was gated on
  its card being shown. `loadData()` re-established the five-row
  `getRecentTransactions` listener on every period change, and `ngOnInit()`
  opened the upcoming window and the budgets stream once, whatever was
  hidden.
- **P2, the pinned order.** The editor's `apply()` wrote the whole layout,
  `updateUserPreferences({ dashboardLayout: this.layout() })`, on any
  change. An account that had flipped one switch had its `order` stored in
  full, and a later release's default order would never reach it.
- **P3, the stale build.** The editor's working copy was
  `effectiveDashboardLayout()`, which drops every id it does not know. A
  build that predates a card would write that card's id out of the stored
  layout on its next save.
- **P4, nowhere on the page.** Every change happened in Settings.

## Decision

**A field of the stored layout is written only when the account changed
it, and deleted when it says nothing its absence would not, touched or
not. Ids this build does not know survive every write. One root service
holds the layout and saves it for the editor and the dashboard alike. Each
card on the dashboard carries a menu that hides it or moves it one step. A
hidden Recent Transactions card opens no listener, nor does a hidden
Upcoming Bills card while nothing else reads its window; the budgets stream
stays open whatever is hidden. And every profile writer folds its change
into the account as it stands once its write lands.**

### The stored shape

`preferences.dashboardLayout` is a `StoredDashboardLayout`,
`{ order?: string[]; hidden?: string[] }`. The ids are raw strings,
because a card a later build adds must survive a write from this one.
Either field may be absent: no `order` is the default order, and no
`hidden` hides nothing.

`effectiveDashboardLayout()` still resolves the stored value for rendering
and is unchanged in what it does. It drops unknown and repeated ids, and
`resolveDashboardOrder` appends any known card the stored order lacks. The
resolved `DashboardLayout` is what the page and the editor render. It is no
longer what is written.

### The smallest write

`layoutWrite(raw, next, touched)` in `dashboard-layout.utils.ts` is pure.
`raw` is the stored value as this session last read it, `next` the
resolved layout to store, and `touched` the fields the change touched. It
returns, per field, `{ set }`, `{ delete: true }` or nothing, or a
whole-key layout.

- **An untouched field is judged from `raw` alone**, and is written only
  by the delete below. `next` cannot judge it: it is resolved, so it has
  already dropped every unknown id.
- **A touched `hidden`** keeps the stored ids that are unknown or still
  hidden, then adds the newly hidden ones.
- **A touched `order`** is `next.order` with each stored unknown id put back
  after the id stored before it. An unknown id stored first stays first.
- **A needless field is deleted, touched or not:** an empty `hidden`, and
  an `order` with no unknown id that resolves to the default. Absent, each
  follows whatever a later build defaults to.
- **A touched field that ends where it started is not written**, and a
  change with no field to write sends nothing.
- **A stored value that is not a map** (null, a string, an array, a class
  instance) takes a whole-key write, which leaves out a default order and
  an empty `hidden`. A nested path would land too, since Firestore replaces
  the value with a map; the whole key is the chosen shape, one write that
  says outright what is stored. An absent value takes the field path,
  because the SDK creates the parent map.

### Nested preference writes

`AuthService.updatePreferenceFields(key, fields)` writes
`preferences.<key>.<field>` for each field in one `updateDoc`, with
`deleteField()` for a delete. It takes only a key whose value is a map
(`MapPreferenceKey`). It rejects with no user, and an empty set writes
nothing. The signal takes the same change through `withPreferenceFields`,
one level deep, replacing a local value that is not a map. The test double
in `MockAuthService` applies that same function. `firestore.rules` checks
only that `preferences` is a map, so no rule changed.

### One service

`DashboardLayoutService` (`features/dashboard/dashboard-layout.service.ts`,
root) owns what the editor owned under 0132, for both callers:

- **The held layout.** `layout` is a `linkedSignal` over the account's
  resolved layout, compared by structure and held while a save is out, so
  an unrelated preference write cannot roll a change back on screen.
- **The calls.** `hide`, `show`, `moveVisible`, `setOrder` (the editor's
  drag and drop) and `reset`. Each shows the change at once and returns
  the promise of the save run it joined.
- **One save at a time.** A change made during a write adds its field to a
  queue, and the next write sends every queued field together, judged
  against the stored value as this run's earlier writes left it. A reset
  deletes the key through `clearUserPreferences(['dashboardLayout'])` and
  supersedes the queued fields. A change made after it is written on top.
- **A failure.** The run ends, and the changes queued behind the failed
  write are dropped, since they were built on it. The layout falls back to
  the account's once, one snackbar says so
  (`settings.dashboardLayoutSaveFailed`), and every caller's promise
  rejects. The run itself carries a no-op `catch`, so a caller that ignores
  the rejection reaches neither zone's unhandled-rejection report nor the
  global error handler.
- **A change of account.** The service is root and outlives the account,
  since signing out and in again on the page does not reload it, and the
  SDK settles a write only while its own account is signed in. So the hold
  and the run belong to the account they were made for, through a
  generation that moves on with each change of account and is read
  whenever the layout is. The next account's layout shows at once. Its
  first change drops whatever the previous account had queued, unsent, and
  starts a run of its own. A write of the previous account's that settles
  late sends nothing more, and leaves the next account's run alone.

The dashboard renders the held layout, so a hidden card leaves the page
before its write lands.

### A card's own menu

`DashboardCardMenuComponent` is projected into a `[card-actions]` slot in
each card's header, so `.dashboard-grid > *` stay the five card hosts the
desktop areas place.

- **The trigger** is a `more_vert` icon button named *More actions for
  {card}* (`common.moreActionsFor`, with the card's title from
  `CARD_TITLE_KEYS`, which moved beside the layout math so the editor and
  the menu name a card alike). Its target is 40 px whatever density the
  theme uses (`--mat-icon-button-state-layer-size`).
- **The items** are Hide, Move up and Move down. There is no Show: a hidden
  card has nowhere to carry a menu, and the hide announcement says where to
  show it again (`dashboard.cardHidden`).
- **Moves count over `[visible]`**, the dashboard's `menuCardsFor(card)`:
  the rendered cards minus an AI Insights card with no provider, which
  renders nothing and carries no menu (`menuCards()`), and from 1024 px,
  where the grid draws two columns, only those of the card's own column.
  `moveVisible` steps the card past the next one in that list, over any
  card between them that renders nothing or is drawn in the other column,
  and only the moved card changes place. The position announced, in
  `'replace'` mode, is counted over the same list.
- **A failed save is announced as well as shown.** Both announcements go
  out before the save settles, so, as
  [../accessibility.md](../accessibility.md#announcements) asks of any
  announcement made ahead of a write, a failure corrects them once the
  layout falls back. A save fails as a whole, after an earlier write of it
  may have landed, so each says only what the fallback undid: a move with
  the editor's sentence and the card's real place
  (`settings.dashboardCardMoveReverted`), counted once the fallback has
  rendered over the cards back on the page, said once per failed save and
  not at all when the card stands where it was said to be; and a hide with
  *Couldn't save. {card} is back on the dashboard.*
  (`dashboard.cardHideReverted`), only when the card is back. Both queue
  after the snackbar.
- **Focus.** After a move, the menu focuses its own trigger again once the
  move has rendered. After a hide the menu has gone with its card, so
  `DashboardComponent.focusAfterHide(card)` focuses the trigger of the next
  card with a menu in page order, which is the focus order in either
  column, or past the last, the Customize dashboard link.

### A hidden card's listeners

The dashboard gates the two streams no period follows on `computed`
booleans, so a change to another card or another preference never reopens
a listener:

- **`recentWanted`**: Recent Transactions is not hidden. The listener is
  opened once by a constructor effect, no longer on every period change,
  and closed with its rows cleared when the card is hidden.
- **`upcomingWanted`**: Upcoming Bills is not hidden, or the weekly recap is
  on (`weeklyRecapEnabled`), or `WidgetSnapshotService.available`, a new
  flag that is true on a build carrying the widget plugin. The recap's
  bills line and the widget's *Next scheduled* read the same window.
- **Budgets** stays as it was, opened once in `ngOnInit()`; see Departures.

Spending by Category has no listener of its own, and AI Insights keeps
0132's gate.

### A profile write folds into the account as it stands

Every writer that sets the `currentUser` signal sends its write through
`writeAndMerge`: `updateUserPreferences`, `clearUserPreferences`,
`updatePreferenceFields`, `clearStoredProviderApiKeys` and
`updateUserProfile`. Once the write lands it reads the signal again, and
merges only its own keys into that value. When the session has ended or
moved to another account meanwhile, it leaves the signal alone. The writes
go through a private seam, `writeUserFields`, which the unit spec holds
open.

## What was rejected

- **Judging an untouched field from the resolved layout.** It has dropped
  every unknown id and appended every missing card, so writing from it is
  P3's defect again.
- **Writing only the touched field, and never deleting.** It stops pinning
  new accounts, but leaves pinned every account P2 is about; see below.
- **A swap with the stored neighbour.** 0132's `moveCard` swapped a card
  with its neighbour in the stored order. On the dashboard a press could
  then swap a card with a hidden one and change nothing on screen.
  `moveVisible` steps over what is rendered. In the editor, where every
  card is a row, it is the same swap.
- **Disabling a desktop step that leaves the drawn areas as they were.**
  Every press would then change what is seen, but the position announced
  would still count the five cards of the page while the screen shows two
  columns. Counting within the column makes both true.
- **A Show item.** A hidden card renders nothing to carry it.
- **Gating Upcoming on a placed widget.** `WidgetSnapshotService` has no
  way to tell whether a widget is on the home screen, so the gate is the
  plugin.
- **A menu outside the card.** A wrapper element in the grid would stop
  `.dashboard-grid > *` being the cards the desktop areas name.

## Consequences

- **Existing accounts are unpinned on their next change.** Any change, from
  the editor or a card's menu, deletes a stored default order, so the
  account follows a later release's default. A custom order is kept.
- **A hidden Recent Transactions card reads nothing.** Shown again, it
  opens a new listener and shows its empty state until the first snapshot
  arrives.
- **A build with the widget plugin keeps the upcoming window open** with
  Upcoming Bills hidden, widget or not.
- **The budgets stream is one listener whatever is hidden.** The emulator
  smoke hides three cards and counts it.
- **Card headers are taller.** A header row with the 40 px trigger is about
  13 px taller. In the right-hand rail at 1024 px, about 229 px wide, the
  actions of Recent Transactions, Upcoming Bills and Budget Progress take
  a row of their own.
- **New i18n keys** in en, ja and tc: `dashboard.cardMenuHide`,
  `dashboard.cardMenuMoveUp`, `dashboard.cardMenuMoveDown` and
  `dashboard.cardHidden` and `dashboard.cardHideReverted`. The trigger
  reuses `common.moreActionsFor`, and a move reuses the editor's
  `settings.dashboardCardMoved` and `settings.dashboardCardMoveReverted`.
- **The unit suite reaches the profile writers** past their guards, through
  `writeUserFields` ([../testing.md](../testing.md)).
- **No deploy.** No rule or index changed.
- **The initial bundle carries `updatePreferenceFields`**, about 0.8 kB,
  because `AuthService` is eager. The service and the menu ship in lazy
  chunks.

## Departures from the issue

- **P1: the budgets stream stays open.** The issue asked that a hidden
  Budget Progress card open no budgets listener, with a smoke counting
  `subscribeToCollection` calls. The list feeds more than the card: the
  budget alert banner, which cannot be hidden, the recap's alerts, AI
  Insights, the widget and the reminder sweep all read it. Gating it on
  the card would empty all of them. The smoke "opens no recent or upcoming
  listener for hidden cards, and one budgets listener for the banner"
  hides Recent Transactions, Upcoming Bills and Budget Progress, counts no
  recent and no upcoming listener, and pins budgets at exactly one. Upcoming
  Bills departs the same way, more narrowly: its window stays open for the
  recap and the widget.

## Things that only became apparent while building

- **Writing only what changed would have left every existing account
  pinned.** The accounts P2 is about already have a full `order` stored,
  the default one unless they moved a card. A write that sends only the
  touched field never touches that `order`, so those accounts would stay
  pinned for good. Only deleting a needless field whether touched or not
  reaches them: a stored default order goes on the account's next change
  of any kind. That delete is what opens the first Known gap below.
- **Every profile writer could undo another write in the signal.** Each
  set `currentUser` from the copy it read before its own await. With two
  writes out together, a theme switch sent while a hide was still out say,
  the later one to land set the signal back to a copy that predated the
  other. Nothing listens on the user document, so the signal kept that
  copy until a reload. Firestore held the hide, but once the save ended the
  held layout followed the signal and the card came back. Each writer now
  merges into the value as it stands when its write lands. The same check
  stopped a write that settled after a sign-out from putting the
  signed-out user back into `currentUser`. Pinned by `auth.service.spec.ts`
  "a write that lands after the signal moved", and at the layout service's
  level by `dashboard-layout.service.spec.ts` "keeps a card hidden when a
  theme write sent before the hide lands after it", which runs the real
  `AuthService`.
- **A moved card loses focus.** The grid reorders its cards by moving
  their hosts, and Chrome drops focus from a moved element, so the menu
  focuses its trigger again after a move. Without that, focus fell to the
  page.
- **The rail had no room for a title and its actions.** In the browser at
  1024 px, *View All* already wrapped onto two lines before the menu
  existed. Grouping it with the trigger in one unbreakable row fixed that,
  and the next run found Upcoming Bills breaking its title (*Upcoming /
  Bills*) to keep the group beside it, while Recent Transactions and Budget
  Progress dropped theirs below. The title's flex basis is now its whole
  width in Recent Transactions and Upcoming Bills, as Budget Progress's
  already was, so the actions drop to the row below and the title wraps
  only when it alone is wider than the card. Pinned in both cards' specs
  by "never breaks the title to keep the actions beside it, at any rail
  width", which sweeps 200 to 420 px.
- **A save still out at sign-out followed the session to the next
  account.** A write left unsettled by the change of account never ended
  the hold, so the next account saw the previous one's layout, and its own
  changes queued behind that write for good
  (`dashboard-layout.service.spec.ts`, "a change of account").
- **On desktop, a move could cross columns and change nothing drawn**,
  while a new position was announced, because the grid places each column
  by its own order (`dashboard.component.spec.ts`, "at the desktop
  breakpoint").
- **A failed save's corrections trusted the rejection alone.** A run
  rejects as a whole, so a hide or a move whose own write had landed was
  announced as undone, and a move was counted over a list bound before the
  fallback (`dashboard.component.spec.ts`, "a failed save shared by a move
  and a hide").
- **A nested path lands on a stored value that is not a map.** Firestore
  replaces the value with a map holding the written field
  (`auth.service.smoke.spec.ts`, "updatePreferenceFields replaces a stored
  value that is not a map"), so the whole-key write over one is a choice of
  shape, not a need.

## Known gaps

- **A needless field is deleted from this session's view.** Nothing
  listens on the user document, so a session's copy of the account is the
  profile read when the session began, plus its own writes. A change that
  finds that copy's `order` resolving to the default deletes `order`. If
  another device has stored a custom order since, that order is deleted
  too. An empty `hidden`, which builds before this one stored, goes the
  same way, and takes with it a card another device has hidden since.
  Pinned by
  `dashboard-layout.utils.spec.ts` "is deleted from this session's view,
  whatever the server now holds".
- **A field this session changes is written whole from its copy.** Another
  device's change to the same field since this session began is
  overwritten. The other field is left alone, where 0132's whole-key write
  overwrote both.
- **A provider-less AI Insights card has no menu.** Without a provider the
  card renders nothing, so there is no header to carry one. It can be
  hidden or moved only from the editor, and a move from another card's
  menu steps over it.
- **The editor's move correction does not check what landed.** When an
  earlier write in a save has landed and a later one fails, the editor still
  says the moved card is back, where the card menu first checks the
  reverted layout.
- **A card moved and then hidden in one failed save is not placed again in
  words.** Its menu has gone with it, so only the hide's correction says
  that it is back, not where.
- **On a build with the widget plugin, a hidden Upcoming Bills card keeps
  its listener with no widget placed.** `available` means the plugin is
  there, which is all the service can tell.
- **A build from before this one still writes the whole layout.** A device
  still running one writes the whole key on its next change, from its
  resolved layout: it pins the order again and drops any id it does not
  know.
