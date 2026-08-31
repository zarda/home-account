# Bill and budget reminders

The app can raise a notification when a recurring bill is about to fall due, or
when a budget has crossed its alert threshold. Both are **local** notifications
— raised by the device, from figures the device already computes. There is no
push, no server, and nothing scheduled anywhere but on the phone in your hand.

The short version: **reminders are an opt-in you give once per account and a
permission you give once per device, and everything about their delivery is
per-device.** Two devices signed into one account each remind independently.

Why the record of what has already been raised lives on the device rather than
in Firestore, and what was rejected on the way, is in
[ADR 0092](ADR/0092-a-reminder-fires-once-and-the-record-of-it-lives-on-the-device.md).
This document is the part you need when turning them on, working out why one
did or did not arrive, or changing the service.

## Turning them on

**Settings → Profile → Bill and budget reminders**, between the app lock and
the usage statistics. Free tier, so there is no entitlement gate; the only gate
is the operating system's.

The switch asks for the OS permission **first** and stores the preference
second, both inside the click. That order is not cosmetic. Neither platform
raises its permission prompt outside a user gesture, and the sweeps deliberately
never ask, so a request that does not happen on that click never happens at all
— an opt-in stored after a refusal would be an account that has asked for
reminders it can never receive. A refusal therefore stores nothing, says why,
and puts the switch back.

Turning the switch off stores the opt-out without prompting. A granted opt-in
sweeps immediately, so the first reminders arrive with the click rather than at
whatever later moment the service's own effect would have reached.

`enableReminders` on the user's `preferences` map is the stored value. Absent
means off, and only a literal `true` counts as on — `firestore.rules` validates
`preferences` only as a map, so a foreign client can put any JSON on that key.

## When a sweep runs

| Trigger | What it does |
|---|---|
| App start | the service is constructed by an app initializer, so the sweep exists without a page having to reach it |
| `visibilitychange` back to visible | WKWebView fires this when the installed app returns to the foreground, so one handler covers native and web |
| The settings toggle | an explicit sweep, deliberately outside the debounce |

A sweep does nothing until an account whose preference is on has loaded, so a
cold start and a signed-out session raise nothing and open no listener.
Automatic sweeps are debounced to one per five minutes: each opens and closes a
Firestore listener, and flapping between two browser tabs fires
`visibilitychange` every time. The toggle's own sweep skips that debounce —
otherwise turning reminders on within five minutes of an app-open sweep would
appear to do nothing.

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

## What counts as "already sent"

Each reminder has a dedup key, and the key names everything that should make it
speak again:

| Kind | Key |
|---|---|
| Bill | `bill \| {recurringId} \| {occurrence day} \| {effective lead}` |
| Budget | `budget \| {budgetId} \| {spentPeriod} \| {severity}` |

So an escalation from warning to exceeded speaks again, a widened lead
reschedules to its new day instead of reading as already delivered, and a
re-render does nothing at all.

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

**This log is per device, by design.** A shared one would let the first device
to sweep silence every other, so a phone that swept in a drawer would cost you
the reminder on the laptop you are actually using.

## The two delivery paths

They share no API. The installed iOS app has no `Notification` constructor, and
on the web the Capacitor plugin proxy has no native half to call, so each path
is fenced off from the other's.

**Web** — `new Notification(...)`, raised immediately, **only while the page is
open**. No service worker is involved, so there is nowhere to schedule an
ahead-of-time reminder: those are skipped entirely on the web. The `tag` is the
dedup key, so the browser coalesces a repeat rather than stacking it.

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
- **The web half is silent when the tab is closed.** Everything a browser could
  do about that needs a service worker, which the app does not register.
- **A budget reminder needs a page to have loaded budgets.** In practice the
  dashboard always has; a Settings-only session would raise none.
- **Nothing checks the pending count against the 64 cap.** Scheduling only the
  nearest occurrence per rule bounds the pending set by the number of rules,
  which is a workaround rather than a measurement.
- **A reminder is not retried.** If the device was off at 09:00, iOS delivers
  when it can; if the web page was closed, the immediate reminder is simply
  never raised and its key is never marked, so the next sweep will try again.

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
