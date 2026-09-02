# 92. A reminder fires once, and the record of it lives on the device

**Status:** Accepted, implemented · **Date:** 2026-09-01 · **Issues:** #79

## Context

A budget over its threshold already raised a banner, and a bill about to fall
due raised nothing at all — both only for someone who had the app open and was
looking at the right page. The request was for a notification: something that
reaches the user when the app is not the thing they are attending to.

The shape of the answer is decided by what the app is. There is no server that
knows about a user's budgets — the functions workspace exists, but it holds a
feedback mailer and, since #137, a storage recount; nothing schedules anything.
Adding push would mean FCM registration, token storage, a scheduler, and a
backend that reads a user's financial data on a timer. What was actually
needed is a notification raised from a device that is already going to compute
these figures anyway.

That decides the interesting question, which is not "how do we send one" but
**"how do we not send the same one twice"**. Everything below follows from
there being no shared place to record that a reminder has been delivered.

## Decision

**Local notifications only, opt-in, per device.** `enableReminders` on
`UserPreferences`, absent meaning off, resolved by `remindersEnabled()` beside
the other preference resolvers. The resolver tests for exactly `true` rather
than truthiness: `firestore.rules` validates `preferences` only as a map, so a
foreign client can put any JSON on the key, and a truthy test would read a
stored string as consent to send notifications.

**The record of what has been raised lives in `localStorage`, keyed by uid.**
`home-account.reminders.sent.{uid}`, a map of dedup key to delivery timestamp,
pruned to 60 days as it is read. Not in Firestore — and this is the decision
the rest of the document is downstream of.

Storing it in Firestore would make the sent log an account-level fact, and the
delivery it records is not one. The OS permission is per device. Whether a
device was even switched on when the reminder was due is per device. A shared
log means the first device to sweep silences the rest, so a user whose phone
swept while it sat in a drawer never sees the reminder on the laptop they are
actually using. Worse, it makes every sweep a Firestore write on a path with no
other writer, on every app open, for a convenience feature.

The per-device consequence is stated rather than hidden: two devices signed
into one account each remind independently, and the user sees the same reminder
twice. That is the deliberate trade — a duplicate is a smaller failure than a
silence.

**The dedup key names everything that should make a reminder speak again.**

- A bill: `bill|{recurringId}|{occurrence day}|{effective lead}`. The lead is in
  the key, not only the date, because widening a lead moves the reminder
  without moving the occurrence — a key that ignored it would read as already
  delivered, and the old moment would stay pending, since the stale-cancel pass
  spares every id the sweep produced.
- A budget: `budget|{budgetId}|{spentPeriod}|{severity}`. The severity is in
  the key so an escalation from warning to exceeded speaks again; the period is
  in it so one alert does not repeat into every period it survives into. That
  is why `spentPeriod` was carried onto `BudgetAlert` at all — an alert with no
  period stamp is skipped rather than deduped against nothing.

**Delivery is a strict platform split, with no shared API between the two
halves.** The installed iOS app has no `Notification` constructor and the web
build has no native half behind the plugin proxy. Only one method names
`Notification`, so a sweep in the WKWebView cannot reach it and throw.

**On the web, only immediate reminders are delivered.** A browser can raise a
notification only while the page is open, and there is no service worker — a
scheduled reminder has nowhere to be scheduled, so an ahead-of-time one is
skipped. On native, an ahead-of-time reminder is handed to the OS for 09:00
local on its reminder day, built from that day's own local parts so a lead
spanning a DST change still lands at 09:00.

**Native schedules only the nearest future occurrence per rule.** iOS silently
drops pending local notifications past 64 per app. A daily rule with a month's
lead would spend half that budget on its own. The same cap applies to immediate
ones, where an uncapped sweep would raise all 31 of that rule's in-window
occurrences at once.

**Budget alerts are consumed through an effect over `budgetAlerts()`, not
through a `getBudgets()` subscription.** Owning a subscription would make this
service a second driver of the `freshenSpent` recalculation writes, and this is
a convenience feature that must not become a writer. The effect reads
`budgetAlerts()` first and unconditionally, before the gates: reading it after
an early return would leave it untracked, and at app open the alerts have not
landed yet, so the effect would never re-run when they did.

**Permission is requested from the settings toggle and from nowhere else.** iOS
raises its system prompt once per install; spending it on an app open the user
did not connect to notifications loses it for good. Both platforms only prompt
inside a user gesture, so a request that does not happen on that click never
happens at all — which is why the toggle asks first and stores second, and a
refusal stores nothing.

Rejected: **FCM push with a scheduling backend.** It is the right answer for
reminders that must arrive on a device that has not been opened in a week, and
it is a different project: token lifecycle, a server holding a schedule derived
from the user's rules, and a backend reading financial data unprompted.
Local notifications cover the case the issue actually described — the user
opens the app, or has it in the background — without any of that.

Rejected: **a Firestore sent log.** See above.

Rejected: **a service worker for web scheduling.** It would buy scheduled web
reminders and a great deal else: an install prompt, a cache lifecycle, and a
second copy of the app's assets to invalidate. The web half is honestly
described as fires-while-open instead.

Rejected: **asking for permission during a sweep.** One prompt per install,
spent without context.

## Consequences

- `MAX_REMINDER_LEAD_DAYS` is 30, and it is a product ceiling in the picker and
  the service. `firestore.rules` deliberately stops at "a non-negative whole
  number of days" with no upper bound: a ceiling written there would refuse the
  restore of a rule any earlier build allowed
  ([0031](0031-a-restore-merges-into-the-row-it-finds.md) is the same
  principle). `clampReminderLead` is therefore what enforces the ceiling on
  read, and it rounds as well as bounds — an unrounded fraction from a foreign
  client would reach a comparison that silently never matches.
- **Every mapping site for `remindDaysBefore` tests `!= null`, never
  truthiness.** Zero is the lead a bill due today needs, and the truthy form
  stores it as no reminder at all — silently, and in the restore's field list a
  missing field is dropped in silence too. The end date beside it can use the
  truthy form because no legitimate end date is falsy; this field cannot.
- The picker offers one key per grammatical shape — `reminderSameDay`,
  `reminderDayBefore`, `reminderDaysBefore` — rather than one key run through a
  plural rule, because `t()` pluralizes only on a parameter named `count` and
  only `en.json` carries plural forms.
- `capacitor.config.ts` sets `LocalNotifications.presentationOptions`. Without
  it iOS suppresses any notification arriving while the app is in the
  foreground, which is exactly when an open-app sweep raises one.
- The service is constructed by an app initializer so the sweep and the
  `visibilitychange` handler exist without a page having to reach them. It stays
  inert until an account whose preference is on has loaded.

## Things that only became apparent while building

- **The dedup check has to come before the permission check, not after.** The
  budget effect re-evaluates on change detection — the alert banner needed its
  own `announced` flag for the same reason — and `checkPermissions()` is a round
  trip to the native side. A settled steady state, where every alert has already
  been raised, must cost nothing.
- **The in-memory mirror is not an optimisation.** `localStorage` throws on both
  read and write in private-mode Safari and on a full quota. Without a
  `Set` mirroring what this session delivered, a device whose storage refuses
  writes would turn one alert into a stream of them at change-detection speed.
- **Scheduling counts as delivered the moment the OS accepts it.** Otherwise the
  sweep that runs on the reminder day sees the same key as now-due and raises an
  immediate copy beside the one already pending.
- **The stale-cancel pass must run without the permission.** Revoking
  notifications in iOS Settings does not retire what is already pending;
  cancelling needs no permission, and a reminder left pending by a revoked
  permission fires on the re-grant long after the rule behind it was edited
  away. Only delivery is gated.
- **Pruning belongs in the read, not beside the write.** A device whose
  permission was refused, or whose rules have all lapsed, never delivers again —
  and would keep every key it ever recorded.
- **The sweep debounce must not apply to the toggle.** A five-minute debounce
  stops a tab flap from reopening a listener; applied to an explicit user action
  it would make turning reminders on within five minutes of an app-open sweep do
  nothing visible at all.

## Known gaps

- **Budget reminders need some page to have populated the budgets signal.**
  `budgetAlerts()` is computed off `BudgetService.budgets`, which only a
  `getBudgets()` subscriber fills. The dashboard landing route does, so in
  practice every session qualifies — but a session that only ever visited, say,
  Settings would raise no budget reminder. This is the acknowledged cost of not
  owning a subscription.
- **The web half fires only while the page is open.** No service worker, so a
  closed tab raises nothing and an ahead-of-time reminder is dropped rather
  than scheduled.
- **A denied web permission is sticky.** The browser will not prompt again until
  the user resets the site's permissions; the toggle says so rather than
  silently failing to ask.
- **The 64-pending cap is worked around, not measured.** Only the nearest future
  occurrence per rule is scheduled, which bounds the pending set by the number
  of rules. Nothing checks the actual pending count against the cap.
- **Two devices remind twice.** By design, as above.
