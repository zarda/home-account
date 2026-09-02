# Bill and budget reminders

The app can raise a notification when a recurring bill is about to fall due,
when a budget has crossed its alert threshold, or on Monday morning to say
last week's recap is ready. All three are **local** notifications — raised by
the device, from figures the device already computes. There is no push, no
server, and nothing scheduled anywhere but on the phone in your hand.

The short version: **reminders are an opt-in you give once per account and a
permission you give once per device, and everything about their delivery is
per-device.** Two devices signed into one account each remind independently.

`ReminderService` is the app's only scheduler, which is why the recap's nudge
is raised here rather than by the recap itself — everything pending has to be
produced by one pass, or the pass would retire what the other booked. The
recap's own opt-in, card and figures are in
[weekly-recap.md](weekly-recap.md).

Why the record of what has already been raised lives on the device rather than
in Firestore, and what was rejected on the way, is in
[ADR 0092](ADR/0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md).
This document is the part you need when turning them on, working out why one
did or did not arrive, or changing the service.

## Turning them on

**Settings → Profile → Bill and budget reminders**, between the app lock and
the weekly recap. Free tier, so there is no entitlement gate; the only gate
is the operating system's.

The switch asks for the OS permission **first** and stores the preference
second, both inside the click. That order is not cosmetic. Neither platform
raises its permission prompt outside a user gesture, and the sweeps deliberately
never ask, so a request that does not happen on that click never happens at all
— an opt-in stored after a refusal would be an account that has asked for
reminders it can never receive. A refusal therefore stores nothing, says why,
and puts the switch back.

Turning the switch off stores the opt-out without prompting, and **retires
whatever the operating system is still holding** before it stores anything. On
the installed app that matters: a sweep may have booked a month of reminders
ahead of time, no bill sweep runs once the preference is off to retire them,
and without the cancel the switch would leave them arriving for weeks with
nothing in the app able to stop them. Cancelling before the write rather than
after it means a write that fails still leaves the user's "stop" acted on.
Signing out cancels the same way, under the departing account — otherwise
"Rent is due in 3 days" fires on a device nobody is signed into, naming its
bill.

**The opt-out then sweeps**, because the cancel above empties the pending set
the recap's nudge rides in too. An account that keeps the weekly recap needs
that nudge re-booked, and the sweep does it from the stored preferences —
cancelling outright when neither preference is left on.

A granted opt-in sweeps immediately, so the first reminders arrive with the
click rather than at whatever later moment the service's own effect would have
reached.

`enableReminders` on the user's `preferences` map is the stored value. Absent
means off, and only a literal `true` counts as on — `firestore.rules` validates
`preferences` only as a map, so a foreign client can put any JSON on that key.

## When a sweep runs

| Trigger | What it does |
|---|---|
| App start | the service is constructed by an app initializer, so the sweep exists without a page having to reach it |
| `visibilitychange` back to visible | WKWebView fires this when the installed app returns to the foreground, so one handler covers native and web |
| Either settings toggle | an explicit sweep, deliberately outside the debounce |
| Closing the recap card | an explicit sweep too, so a nudge booked for the week just put away is retired with the click |

**The gate is either preference.** Reminders on, the weekly recap on, or both
— any of those sweeps. Both signals are read on every pass rather than
short-circuited, because an effect only re-runs for the signals it actually
read, and a gate that stopped at reminders would never notice the recap being
switched on.

A sweep does nothing until an account whose preferences ask for one of them
has loaded, so a cold start and a signed-out session raise nothing and open no
listener.
Automatic sweeps are debounced to one per five minutes: each may open and
close a Firestore listener, and flapping between two browser tabs fires
`visibilitychange` every time. A toggle's own sweep skips that debounce —
otherwise turning a preference on within five minutes of an app-open sweep
would appear to do nothing.

**`sweep()` means "make what the operating system holds match the
preferences".** It is one pass with two outcomes:

- **Either preference on** — produce the set the preferences ask for, deliver
  it, and retire everything pending that this pass did not produce.
- **Both off** — close any listener still open, then cancel everything
  pending. Not an empty set through the sweep: that path would open a listener
  and read a month of occurrences for an account that asked for neither.

Closing the listener first is load-bearing on both branches. One left waiting
for its first snapshot delivers after the cancel and books bills the cancel
had just retired.

**A recap-only sweep never opens the recurring listener at all.** That
listener reaches Firestore through `getRecurring()`, which refreshes shared
state as a side effect, and reading a month of occurrences for a pass that
cannot produce a single bill would be a background path rewriting the UI's
state for nothing.

## Bill reminders

A recurring rule carries `remindDaysBefore`: **absent means no reminder, and
zero means on the day.** See [recurring.md](recurring.md#reminders) for the
picker and the field.

The sweep reads the next occurrences the same way the dashboard's Upcoming card
does, over a window wide enough for the longest lead the picker offers. For
each rule:

- An occurrence **already past its date** is skipped. It is owed, not upcoming
  — the catch-up's business — and warning about it would say the wrong thing.
  (The Upcoming card still shows it; see
  [ADR 0091](ADR/0091-the-upcoming-card-reads-the-live-schedule-not-the-ledger.md).)
- An occurrence **inside its lead window** produces an immediate reminder, at
  most one per rule. A daily rule with a month's lead has all 31 of its
  occurrences inside their windows at once.
- An occurrence **beyond its lead window** produces a scheduled reminder for
  09:00 local on its reminder day — again at most one per rule, the nearest.
  The 09:00 is built from that day's own local parts, so a lead spanning a DST
  change still lands at 09:00 rather than an hour out.

The stored lead is rounded and clamped to 30 days on read. `firestore.rules`
accepts any non-negative whole number with no ceiling — deliberately, so a
restore of a rule written by any build still validates — so a foreign client
can leave a fraction or a decade in the field.

**The bill copy uses `{{count}}` on purpose.** `t()` selects a plural form only
when the parameter is named exactly `count`; called `days` or `n`, the key
would resolve to nothing and `t()` would return the key itself.

## Budget reminders

A budget over its alert threshold produces one reminder per severity per
period. The alert stream is `BudgetService.budgetAlerts()`, the same computed
the in-app alert banner reads, consumed through an effect rather than a
subscription of its own — a subscription would make the reminder service a
second driver of the `freshenSpent` recalculation writes.

**The consequence is worth knowing:** `budgetAlerts()` is computed off the
`budgets` signal, and only a `getBudgets()` subscriber fills it. So a budget
reminder can only be raised in a session where some page has loaded budgets.
The dashboard landing route does, which in practice means every session — but a
session that went straight to Settings and stayed there would raise none.

An alert with no `spentPeriod` stamp is skipped rather than raised. Without the
period the spend was computed for there is nothing to scope the "already sent"
decision to, and one alert would repeat into every period it survives into.
Budget documents written before that field existed land here.

## The weekly recap nudge

One notification, *Your weekly recap is ready*, at **09:00 local on Monday**.
It announces the card described in [weekly-recap.md](weekly-recap.md) and
carries no figures — a notification carrying last week's spending puts an
account's finances on a lock screen.

It is produced by the same sweep, as one more prepared reminder in the set the
pass hands to delivery. That is the whole reason it lives here: the stale
cancel retires everything pending the pass did not produce, so a nudge booked
by any separate path would be retired by the next bill sweep.

- **Always scheduled ahead, never immediate.** It announces a card; one raised
  as the app opens would name a week the user is already looking at. So it is
  **installed-app only** — the web path skips anything carrying a scheduled
  moment, and a browser gets the card instead. Nothing about the recap asks a
  browser for notification permission.
- **The key is the Monday it fires on**, not the week it recaps:
  `recap|{day key}`. One notification per Monday, and the same key on every
  sweep until it fires.
- **A week already dismissed on this device is not announced.** Producing
  nothing also retires an already-booked nudge, since the stale cancel spares
  only what the pass produced. Closing Monday's card at 08:30 therefore
  cancels that morning's notification — the card was read, and the
  notification would point at a card that is gone.
- 09:00 is built from that Monday's own local parts, so a week spanning a DST
  change still lands at nine.

Note the asymmetry with bills: a bill reminder is produced only when
**reminders** are on, and the nudge only when the **recap** is on. An account
with just the recap sweeps, books one notification a week, and touches nothing
else.

## What counts as "already sent"

Each reminder has a dedup key, and the key names everything that should make it
speak again:

| Kind | Key |
|---|---|
| Bill | `bill \| {recurringId} \| {occurrence day} \| {effective lead}` |
| Budget | `budget \| {budgetId} \| {spentPeriod} \| {severity}` |
| Recap | `recap \| {day key of the Monday it fires on}` |

So an escalation from warning to exceeded speaks again, a widened lead
reschedules to its new day instead of reading as already delivered, a new
Monday is a new nudge, and a re-render does nothing at all.

Delivered keys are written to `localStorage` under
`home-account.reminders.sent.{uid}`, scoped to the account so switching users
does not silence the new one. Entries are pruned at 60 days as the log is read
— pruning on read rather than on write, because a device whose permission was
refused never delivers again and would otherwise keep every key it ever
recorded.

Every access is wrapped. Private-mode Safari throws on both halves, and a full
quota throws on the write; the cost of that has to be a possible repeat rather
than a failed sweep. An in-memory mirror of this session's deliveries bounds
that to one repeat: the budget effect re-evaluates on change detection, so a
storage that refuses writes would otherwise turn one alert into a stream.

**A cancel takes its keys with it.** Scheduling marks a key delivered the
moment the OS accepts it, so retiring the notification without retiring the
entry would make the cancel one-way: turning reminders back on would never book
that reminder again, and its day would pass in silence. Only the keys whose
notification was actually cancelled are dropped — a reminder that already fired
is no longer pending, so it is not among them, and its entry is exactly what
stops the next sweep raising it a second time.

That applies to **both** cancels. The opt-out's full retirement does it, and
so does every sweep's own stale-prune, which drops the log entries of exactly
what it just cancelled. Without the second one a rule edited away and
restored, or a recap switched off and on inside the same week, would never be
booked again.

**This log is per device, by design.** A shared one would let the first device
to sweep silence every other, so a phone that swept in a drawer would cost you
the reminder on the laptop you are actually using. Deleting the account
removes it: the `reminders` step of the erasure cascade drops this key on this
device, beside the `weeklyRecap` step that drops the recap's two
([account-deletion.md](account-deletion.md)).

## The two delivery paths

They share no API. The installed iOS app has no `Notification` constructor, and
on the web the Capacitor plugin proxy has no native half to call, so each path
is fenced off from the other's.

**Web** — `new Notification(...)`, raised immediately, **only while the page is
open**. Nothing here depends on a service worker, so there is nowhere to
schedule an ahead-of-time reminder: anything carrying a scheduled moment is
skipped entirely on the web. That covers the far-off bill reminders and the
recap nudge, which is always scheduled ahead and therefore never raised in a
browser at all. The `tag` is the dedup key, so the browser coalesces a repeat
rather than stacking it.

A denied web permission is **sticky**. The browser will not prompt again until
the user resets the site's permissions, and the switch says so instead of
silently failing to ask.

**Native** — `@capacitor/local-notifications`. Immediate reminders are
scheduled with no `at`; ahead-of-time ones carry 09:00 local on their reminder
day, and the OS raises them whether or not the app is running.

- **Only the nearest future reminder per rule is scheduled.** iOS silently
  drops pending local notifications past **64 per app**, and one daily rule
  with a long lead would spend a large fraction of that on its own.
- Scheduling marks the key as delivered the moment the OS accepts it. The sweep
  that runs on the reminder day would otherwise see the same key as now-due and
  raise an immediate copy beside the one already pending.
- The notification id is a 31-bit hash of the dedup key, so re-scheduling the
  same reminder replaces it rather than adding a second. (31 bits because the
  id must fit a Java `int` on Android.)
- Each sweep retires pending notifications it did not produce — a rule that was
  deleted, paused or re-dated. That pass runs **whether or not the permission
  still stands**: cancelling needs none, and a reminder left pending by a
  permission revoked in iOS Settings would fire on the re-grant long after the
  rule behind it was edited away.
- Switching reminders off and signing out run the same pass with nothing
  produced, so everything pending goes — including a recap nudge that was
  riding in it. That is why the reminders switch sweeps immediately after
  storing the opt-out: the sweep re-books whatever the remaining preferences
  still ask for, and cancels outright when neither is left on.
- `capacitor.config.ts` sets `LocalNotifications.presentationOptions` to
  `['banner', 'sound']`. Without it iOS suppresses any notification arriving
  while the app is in the foreground, which is exactly when an open-app sweep
  raises one.

Everything the plugin does is wrapped: a plugin absent from the binary, or an
OS that refuses the call, must never surface as a failure. Reminders are a
convenience.

## Known gaps

- **Two devices remind twice.** The deliberate trade — a duplicate is a smaller
  failure than a silence. See ADR 0092.
- **The web half is silent when the tab is closed.** Everything a browser
  could do about that needs a service worker with a background lifecycle to
  wake it; the only one the app registers is the minimal share-target worker,
  which handles one POST and passes every other fetch through.
- **A budget reminder needs a page to have loaded budgets.** In practice the
  dashboard always has; a Settings-only session would raise none.
- **Nothing checks the pending count against the 64 cap.** Scheduling only the
  nearest occurrence per rule bounds the pending set by the number of rules,
  which is a workaround rather than a measurement.
- **A cancel whose key-drop cannot be written stays one-way.** Private-mode
  Safari and a full quota throw on the write. The cancel itself still happens —
  it is what the user asked for, and it is done before the log is touched — but
  the entry survives, so turning reminders back on will not re-book that one.
  Failing the opt-out instead would be the worse trade.
- **A reminder is not retried.** If the device was off at 09:00, iOS delivers
  when it can; if the web page was closed, the immediate reminder is simply
  never raised and its key is never marked, so the next sweep will try again.
- **Switching reminders off briefly retires a live recap nudge.** The opt-out
  cancels everything pending and the sweep straight after re-books it, but the
  two are separate steps: a failure between them leaves the nudge unbooked
  until the next sweep runs.
- **The recap nudge is only ever booked by a sweep**, so an account that does
  not open the app for a fortnight gets no Monday notification about either
  week. The same limit as every other reminder here, and the reason
  [weekly-recap.md](weekly-recap.md) lists it as a gap of the recap too.

## What push would add

FCM (web) and APNs (iOS) would buy the one thing local notifications cannot: a
reminder that reaches a device which has not been opened. It is a much larger
change than a transport swap — token registration and lifecycle, tokens stored
per device on the user document, a scheduler in the functions workspace, and a
backend that reads a user's budgets and rules unprompted on a timer. It would
also make a shared sent log worth having, since the server would then be the
one thing that knows what was delivered.

None of that is written. If it is ever taken on, the dedup keys above are the
part that carries over unchanged.
