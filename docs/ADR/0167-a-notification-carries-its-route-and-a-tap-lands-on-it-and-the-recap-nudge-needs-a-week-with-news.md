# 167. A notification carries its route and a tap lands on it, and the recap nudge needs a week with news

**Status:** Accepted, implemented · **Date:** 2026-10-08 · **Issues:** #446

Reference documentation lives in [../reminders.md](../reminders.md),
[../weekly-recap.md](../weekly-recap.md),
[../dashboard.md](../dashboard.md),
[../share-import.md](../share-import.md),
[../one-shot-reads.md](../one-shot-reads.md) and
[../analytics.md](../analytics.md).

Closes three Known gaps of
[0104](0104-a-web-reminder-is-raised-through-the-worker-the-app-already-registers.md):
a tap opens `/`, not the bill; the constructor fallback's click is silent;
and a registration whose worker is still installing reads as a refusal.
Closes one of
[0096](0096-the-weekly-recap-is-composed-on-open-and-nudged-ahead.md): the
nudge has no figures to check. Leaves two standing: 0104's closed tab,
since a web reminder is still raised only while the page is open, and
0096's week in which the app is never opened, and so never nudged.

## Context

#446 collected two "the surface exists, nobody is led to it" gaps. This
record takes the first, the tap; [0168](0168-the-palette-lists-the-shortcuts-and-the-header-opens-it-and-about-offers-to-install-the-app.md)
takes the second. At `c47d6f26`:

- **The worker.** `public/share-target-sw.js`'s `notificationclick`
  closed the notification and called `focusOrOpen()`, which focused the
  first window or opened one at `/`. No notification carried `data`, so
  there was nothing else it could open.
- **The constructor fallback.** Where `getRegistration()` found nothing,
  `showWebNotification` constructed `new Notification(title, { body, tag })`
  and set no `onclick`. A tap on it did nothing at all.
- **A registration with no active worker.** On a first visit the
  share-target worker can still be installing when the boot sweep runs.
  `registration.showNotification` then rejects, the seam reported `false`,
  and the bill waited for the next sweep.
- **The installed iOS app.** Nothing listened for
  `localNotificationActionPerformed`, so a tap opened the app wherever it
  happened to be.
- **The Monday nudge.** The sweep booked it from the preference and the
  dismissed week alone. A quiet fortnight still booked it, and its tap
  landed on a dashboard with no recap card to show.

## Decision

**Every reminder carries the in-app path its tap should open, and a path
that comes back from the worker or the operating system is admitted only
through one validator. A bill opens the dashboard on its row, a budget
alert the budgets tab, and the recap nudge the dashboard on the recap. On
the installed app the Monday nudge is booked only for a week the card would
show.**

### The routes

`core/utils/notification-route.utils.ts` builds them:

| Reminder | Route | Builder |
|---|---|---|
| A bill | `/dashboard?bill=<rule id>` | `billRoute(ruleId)` |
| A budget alert | `/budgets?tab=budgets` | `budgetRoute()` |
| The recap nudge | `/dashboard?recap=<week key>` | `recapRoute(weekKey)` |

The rule id and the week key go through `encodeURIComponent`. The nudge's
key is the week it announces, fixed when it is booked, so the route reads
the same in whatever zone the tap lands.

`safeAppRoute(candidate)` returns the candidate only when it is a string
that starts with exactly one `/` and carries no backslash and no control
character (`\p{Cc}`); otherwise it returns null. `//host` is
protocol-relative, a URL parser reads `\` as `/`, and it drops tabs and
newlines before it parses, so `/\t/host` would open `//host`. Anything with
a scheme fails the leading slash.

### Each delivery path carries it

`PreparedReminder` gains a required `route`.

- **Native:** each scheduled notification carries `extra: { route }`.
- **Web, through a registration with an active worker:**
  `showNotification(title, { body, tag, data: { route } })`. The worker's
  click sees only the notification, never the page, so the route rides in
  `data`.
- **Web, through the constructor:** where there is no registration, or the
  registration has no active worker yet, the page constructs the
  notification and sets its `onclick` itself: `window.focus()`,
  `notification.close()`, then `router.navigateByUrl(route)`. The worker's
  click never reaches a constructor-raised notification, so the page that
  raised it handles the tap.

### The worker's click

`notificationclick` reads `event.notification.data.route` through a copy of
`safeAppRoute` inlined in the worker, which cannot import the module, and
falls back to `/` for anything it refuses. It then focuses the first window
client and posts it `{ type: 'notification-route', route }`. With no
client, or when `focus()` rejects, it opens a window at the route instead.
`share-target-sw.spec.ts` runs one table of candidates through both copies
of the validator and fails when their answers part.

### The page's listener

`NotificationTapService` (`core/services/notification-tap.service.ts`,
root) receives a tap in a page that is already running.

- **Its own chunk.** `armNotificationTaps` in `app.config.ts` loads it by
  dynamic import, in the shape `armLedgerSweep` already uses, so its code
  stays out of the initial bundle. On the web it waits for an idle task
  (`whenBrowserIdle`); in the iOS app it loads at once, from the app's own
  files (see *Things that only became apparent*).
- **Web:** a `message` listener on `navigator.serviceWorker` that acts only
  on `notification-route`. The type is a literal on both sides. The
  listener is removed when its injector is destroyed, because the container
  is global and outlives it.
- **iOS:** `addListener('localNotificationActionPerformed')` through a
  `nativePlugin()` seam. It awaits the listener's handle, never the plugin,
  whose proxy would answer `then` as a native call
  ([0138](0138-a-plugin-call-nothing-implements-is-the-developers-failure-not-the-users.md)).
  It acts only on the `tap` action, so a dismissal is ignored, and reads
  `notification.extra.route`. The plugin holds a tap that launched the app
  until a listener attaches. A refused `addListener` is logged, and arming
  settles.
- **Opening.** A route `safeAppRoute` refuses is ignored, and the app stays
  where it is. Once the router has completed a navigation, the route opens
  at once. Before that it waits for the first navigation to settle: a
  `NavigationEnd`, a `NavigationError`, or a `NavigationCancel` that is
  neither a redirect nor superseded. The start-up navigation, or the lock
  screen's redirect, would otherwise start after the tap's and replace it.

### The dashboard follows the link

The dashboard subscribes to `queryParamMap`, so a second tap while it is
mounted is seen. It takes both parameters off the URL with `replaceUrl` as
it reads them, in the shape
[0082](0082-one-shot-query-params-leave-the-url-once-consumed.md) set, and
the stripped URL comes back through the same subscription and does nothing.

- **`?bill`.** With Upcoming Bills hidden, the page announces
  `dashboard.billLinkCardHidden` and goes to `/budgets?tab=recurring`.
  Otherwise it waits for the upcoming listener's first emission, since the
  signal's initial empty schedule would answer "absent" for every rule, and
  then binds the rule to the card's `focusRuleId`. The card picks that
  rule's day nearest today (a tie goes to the later day), scrolls the row
  to the middle of the view (without animation under reduced motion),
  focuses it, marks it with a 3 px primary edge for two seconds, and answers
  `focused` or `absent`. The page checks an "absent" with the server before
  it acts (see *Things that only became apparent*). A rule the server does
  not list in the fortnight, an unanswered read, or a second "absent" for a
  rule the server did list announces `dashboard.billLinkNotUpcoming` and
  goes to `/budgets?tab=recurring`, which lists every rule that still
  exists. Both redirects replace the history entry, so Back does not land on
  the link and bounce straight back.
- **`?recap`.** The page awaits `WeeklyRecapService.load()`, which is
  single-flight, so it shares the card's own load. When the card's
  `weekKey()` is the linked week and the recap is `visible()`, the page
  focuses the card's region after the next render. A link to another week,
  or to a week the card does not show, is only stripped.

### The lock screen keeps the query

`lockGuard` sends a session with nothing to unlock to the remembered
destination with `router.navigateByUrl`. The lock screen's own unlock paths
already did.

### The nudge needs a week with news

On the installed app, `recapNudge` asks a protected seam,
`recapWeekHasNews(at)`, before it produces the nudge. The web build still
produces it and drops it unread, as 0096 decided, so it asks nothing there.

- **The test is the card's own.** The seam reads `recapWindow(at)`, the
  week the nudge announces, which from Monday at nine to Sunday is the
  week in progress, so far, and `weekBeforeWindow(at)`. It folds both with
  `composeRecapFigures` and `amountInBase` and returns
  `hasSomethingToSay`: transactions in the announced week, or spending in
  the week before.
- **From the server.** Both reads are
  `TransactionService.getTransactionsInRangeFromServer`. The services are
  resolved through the injector at call time, so a harness that stands in
  for the seam never builds them, and neither does the startup path.
- **It fails open.** A rejected read books the nudge, and the failure is not
  remembered.
- **One question at a time.** The answer is asked once at a time per account
  and week, and a yes is remembered for the session. A quiet answer is asked
  again on the next pass, since the next expense makes it news.
- **The pass waits for it.** A sweep closes the bill listener and numbers
  itself (`retireSweeps`) before the read. After it, a pass that a later
  pass or a cancel has overtaken stands down and resolves with the later
  pass's run, and a pass whose account has changed delivers nothing. Only
  then does it deliver.
- **No news retires a booked nudge.** Producing nothing for the week lets
  the sweep's stale-prune cancel the one already pending.

## What was rejected

- **Navigating the open tab from the worker.** `WindowClient.navigate()`
  reloads the app. Only the page's router can open a route in place, so the
  worker hands the route to the page.
- **Arming the tap service from the initial bundle.** The initial bundle
  sits at its budget. On the web, arming it late costs a message that
  arrives before it is armed; see Known gaps.
- **Trusting the card's first "absent".** Its first emission can be this
  device's cache. Sending the user away is done once, so the answer is
  asked of the server first.
- **Reading the nudge's weeks from the cache.** `getTransactionsInRangeOnce`
  answers from the cache, and a cache that never held those weeks answers
  with no rows. A quiet fortnight read that way would retire a nudge the
  account has news for. The server read rejects offline instead, and the
  nudge is booked.
- **Asking the gate on the web.** The web never books the nudge, so the
  read would buy nothing.
- **Figures in the nudge.** 0096's reason stands: a notification carrying
  last week's spending puts an account's finances on a lock screen.

## Consequences

- **A tap opens what it names** on every path: the worker with a tab open
  or none, the page's constructor fallback, and the installed iOS app.
- **A notification raised before routes were carried opens `/`** on the
  web: the worker posts `/` to an open tab, which navigates there, where it
  used to be only focused. On iOS such a tap carries no route and is
  ignored.
- **A first visit with reminders on raises its due bill at once.** Until the
  worker is active the constructor raises it, where the bill used to wait
  for the next sweep, and its tap is handled by that page.
- **The installed app reads two weeks from the server per sweep** while the
  recap is on, until a yes for that week is remembered.
- **New i18n keys** in en, ja and tc: `dashboard.billLinkCardHidden` and
  `dashboard.billLinkNotUpcoming`.
- **`upcoming-bills.component.spec.ts` joins `test:dates`**, since the card
  keys its rows by local day. The bill-link cases date every row at noon, so
  no zone's midnight moves one to another day ([../dates.md](../dates.md)).
- **The initial bundle carries the routes and the late arming**, about
  0.8 kB, and **the nudge's recap fold**, about 1.1 kB, since
  `ReminderService` is eager. The tap service is a lazy chunk.
- **No deploy.** No rule or index changed; both server reads use queries
  the app already runs.

## Departures from the issue

- **The nudge's gate is the card's, not "a non-empty week".** #446 proposed
  booking the nudge only when the sweep can see a non-empty week. An empty
  week after a week of spending still shows a card, because that nothing is
  the story (0096), and two quiet weeks show none. The gate is the card's
  own `hasSomethingToSay`, so a nudge never points at a card that will not
  show, and never withholds one that will.
- **A bill link lands on its row only while the card can show it.** The
  issue's criterion is a bill focused on the Upcoming card. With the card
  hidden, or the rule due past the fortnight, already posted or deleted,
  there is no row, so the link opens the recurring rules and says why.
- **Budget alerts carry a route too**, to `/budgets?tab=budgets`. The issue
  named bills and the recap.

## Things that only became apparent while building

- **The card's first "absent" could come from the cache.** In a browser run
  against the emulators, a link to a rule written by another client, due in
  three days, opened the recurring rules on a cold load. The upcoming
  listener's first emission was this device's persistent cache from before
  the rule existed, the card had no row for it, and the page acted on that
  answer. It is the class
  [0139](0139-a-transaction-read-acted-on-once-names-its-source-and-a-listeners-first-value-is-banned.md)
  names, in a new place: a value acted on once, taken from a listener's
  first emission. "Absent" is now asked of the server with
  `RecurringService.getUpcomingScheduleFromServer` before the redirect.
  When the server lists the rule, the page binds at once if the listener
  already has it, or re-opens the listener and binds on its first emission,
  and a second "absent" for it is final. Offline the read rejects, and the
  rules page is still the answer. The emulator smoke could not have caught
  it: its client keeps no persistent cache. Pinned by
  `dashboard.component.spec.ts` "re-opens the listener when the server has
  the rule the window lacked, and asks the card on its first emission" and
  by `dashboard-layout.smoke.spec.ts` "opens the recurring rules for a rule
  the server does not list in the fortnight".
- **Waiting on the listener could mean waiting for good.** The listener
  walks its fortnight only when a rule changes, so on a page open since an
  earlier day the server listed a rule the page's window never would, and
  the page waited on that rule and ignored every later bill link; it now
  re-opens the listener, whose first emission walks from today.
- **A server answer could overtake the user's next link.** A read still out
  when a later link was followed sent the user away from that link or moved
  focus off it; the page now counts the links it follows and drops an
  answer asked for an earlier one. Pinned by `dashboard.component.spec.ts`
  "when a newer link arrives during the read".
- **The lock screen lost the link's query.** `lockGuard` restored the
  remembered destination with `router.navigate([url])`, which takes the
  whole URL as one path segment and escapes its `?`. `/dashboard?bill=x`
  became `/dashboard%3Fbill%3Dx`, matched no route, and the wildcard landed
  it on a bare `/dashboard`. Pinned by `auth.guard.spec.ts` "returns to a
  remembered link with its query intact".
- **The read put a gap inside the sweep.** Before the gate, a pass reached
  its delivery, or opened the listener that would deliver, without waiting
  on anything, and the next pass closed that listener first. With the read
  in between, two overlapping passes both booked the nudge, and in the
  emulator smoke the pass the service's first effect started overtook an
  explicit `sweep()`, which then resolved before anything was booked. The
  pass counter stands the earlier pass down, and an overtaken pass resolves
  with the later pass's run. Pinned by `reminder.service.spec.ts` "delivers
  once when an explicit sweep overlaps the pass the effect started" and
  "holds an explicit sweep the effect took over until the effect has
  booked".
- **The switch's cancel did not stand a reading pass down.** Only the
  both-off sweep moved the pass counter on, so a pass that woke from the read
  after the switch's `cancelScheduled()`, whose preference write was not yet
  acknowledged, booked again what the cancel had retired; the cancel now
  retires every pass first. Pinned by "books nothing when the switch cancels
  while the gate is reading, before its write lands".
- **A pass overtaken at its listener never settled.** Closing a listener
  before its first snapshot fires none of its callbacks, so that pass's
  promise stayed pending; closing it now settles the pass, which resolves
  with the later run. Pinned by "settles a pass a later pass closed before
  its first snapshot, once that pass has delivered".
- **The held iOS tap opened seconds late.** Armed from an idle task, the
  listener attached about three seconds after launch, and the tap that
  started the app then navigated over wherever the user had gone. The iOS
  app now loads the service at once, still as its own chunk. Pinned by
  `app.config.spec.ts` "loads and arms it at once in the iOS app, where the
  plugin holds a tap that launched the app".

## Known gaps

- **A web tap in the first idle window after load only focuses the tab.**
  The tap service is armed from an idle task: an idle callback with a
  ten-second timeout, or a three-second delay where the browser has none. A
  worker message that reaches a tab before then is dropped. A tap with no
  tab open is not affected, because the new tab opens at the route.
- **A mounted `/budgets` keeps its tab.** The budgets page reads `?tab=`
  from the route snapshot when it is created. A budget alert tapped while
  the page shows Recurring or Goals reuses the mounted page, and the tab
  stays where it was.
- **A week that gains news after the last sweep is not nudged.** The gate
  is asked by a sweep. A quiet fortnight books nothing, and an expense
  recorded afterwards, on another device or on this one with no sweep after
  it, books nothing until the next sweep runs: a return to the foreground
  past the five-minute debounce, a settings toggle, or the next launch. If
  none runs before Monday at nine, there is no nudge.
- **A week that loses its news keeps its nudge for the session.** A yes is
  remembered per account and week. Deleting the only expense of the
  fortnight leaves the booked nudge in place until a later session asks
  again.
- **Offline, the gate cannot tell.** The read rejects and the nudge is
  booked, quiet fortnight or not.
- **The iOS half ships with a native build.** The installed app runs the web
  bundle it was built with, so the routes in `extra`, the tap listener and
  the nudge's gate reach an iPhone only with a new native build. The web
  half ships with hosting. The iOS half is proven by unit specs only; no
  simulator run was made for it.
- **No notification was tapped in a browser or on a device.** The browser
  run drove the links a tap opens, by URL. The worker's `notificationclick`
  cannot be raised there, and is proven by `share-target-sw.spec.ts`; the
  constructor's click and the native listener are proven by their unit
  specs.
