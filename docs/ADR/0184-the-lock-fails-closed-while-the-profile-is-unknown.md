# 184. The lock fails closed while the profile is unknown

**Status:** Accepted, implemented · **Date:** 2026-10-23

Reference documentation lives in [../app-lock.md](../app-lock.md),
[../widget.md](../widget.md) and [../auth.md](../auth.md).

When the profile read fails, the session runs on an in-memory fallback
profile that never names a lock. The app lock took that as the account's
answer: the app opened with no PIN on an account that asked for one, and
the widget wrote the month's figures to the Home Screen and the Lock Screen.
This record makes the lock treat an unknown answer as a lock wherever this
device holds the account's PIN, and takes the lock screen down once the
real answer turns out to be no. The widget's work (#506) listed
the defect among the Known gaps of app-lock.md and widget.md, and both
entries come out here. It is older than that work, and it is not #503,
which is about the relock clock and a screen lock.

Amends
[0133](0133-the-home-screen-widget-shows-the-dashboards-last-this-month-paint-and-nothing-a-lock-hides.md).
Its rule stands: `canEngage()`, never `isLocked()`, decides the widget's
locked state, because the widget reads a file. What changes is
`canEngage()` itself, which 0133 quotes as `isEnabled() && method() !== 'none'`.
The fail-open rule of
[0130](0130-biometry-unlocks-the-app-and-the-pin-is-still-the-credential.md),
that a device with no PIN stays open, is untouched.

## Context

The path, end to end:

- `AuthService`'s listener reads `users/{uid}`. When the read throws
  (offline at launch with nothing cached, or a rules or quota refusal), it
  keeps the session on `{ id, ...buildNewUserProfile(firebaseUser, locale) }`
  and raises `profileDegraded`.
- `buildNewUserProfile` spreads `DEFAULT_USER_PREFERENCES`, which has no
  `enableAppLock`, and `appLockEnabled()` reads an absent field as off.
- `AppLockService.isEnabled()` read only those preferences, so `canEngage()`
  and `isLocked()` were false. `authGuard` let the start-up navigation
  through, and the dashboard opened.
- `WidgetSnapshotService.publish()` writes `figures` whenever `canEngage()`
  is false, so the dashboard's paint reached the widget: spent and net, the
  budget nearest its limit, the next bill.

That lasted until the retry effect swapped the stored profile in, at once
when the app is online and otherwise on the next connectivity flip. With
the persistent Firestore cache a degraded start is rare: a first launch
offline, a cache the system evicted, a refusal. It is also the moment a
phone in someone else's hands is most likely to be offline.

Two readers took `profileDegraded` into account before this: onboarding
([0072](0072-onboarding-runs-once-and-never-against-a-fallback-profile.md))
and closed-month snapshot generation
([0137](0137-a-closed-month-is-generated-only-against-a-loaded-profile-and-the-servers-own-list.md)).
Both wait for the real profile. A lock cannot wait, because waiting is
opening.

## Decision

### An unknown answer counts as a lock

```ts
readonly canEngage = computed(
  () => (this.isEnabled() || this.auth.profileDegraded()) && this.method() !== 'none'
);
```

While the profile is degraded, the lock treats the account as asking for
one. `method()` still decides whether this device can satisfy it: with no
PIN record for the uid on this device it is `'none'`, and the app opens as
it does on a loaded profile. A PIN record for this account is the only
evidence the device holds that a lock was wanted, and it is the evidence
this rule takes.

The new term goes on `canEngage()`, not on `isEnabled()`. `isEnabled()`
keeps meaning "the account asked for a lock". The settings switch and its
missing-PIN warning read it, and a degraded start with no PIN would
otherwise warn about a lock nobody may have asked for. `isLocked()` and
both of the widget's writers that read the lock read `canEngage()`, so the
guard, the relock effect and the widget follow with no change of their own.
On a degraded start with the PIN, `authGuard` sends the start-up navigation
to `/lock`, the widget's lock effect writes the locked sentence at once,
and every `publish()` composes the locked sentence rather than figures.

The real profile settles it. The retry swaps the stored profile in under
the same uid, so `userId()` does not move, the unlocked timestamp survives,
and an unlock made in the meantime holds. If the account asks for a lock,
nothing else changes. If it does not, `canEngage()` falls.

### The lock screen stands down when the profile settles

`lockGuard` sends anyone with nothing to unlock away from `/lock`, but only
on a navigation, and nothing navigates when the real profile arrives. The
relock effect in `AppLockService` exists for the same reason the other way
round: it puts the lock screen up when nothing is navigating for
`authGuard` to see. A second effect beside it takes the screen down. When
`profileDegraded` settles from true to false while the real profile asks
for no lock, the lock no longer holds, the session is live, the router is on
`/lock` and no other navigation is under way, it goes to the remembered
page. A settle that meets a
navigation under way waits for it to end, reading it tracked only while it
waits, and is decided once against where that navigation landed. A cold
start on the web can settle that way: a refusal while online lets the retry
run at once, while the start-up navigation to `/lock` is still loading the
screen.

It is keyed on the profile settling and on nothing else. Every other way the
lock falls brings its own navigation or reload: an unlock navigates, a
sign-out goes to `/login`, and a PIN removed in another tab is usually a
sign-out or an account deletion there, whose reload places this page. The
lock screen component is unchanged.

### Pinned, not observed: a locked session that turns degraded

`app-lock.service.spec.ts` pins that a locked session whose profile turns
degraded stays locked. Today's SDK does not take that path:
`onAuthStateChanged` emits only when the uid changes, and the same uid
comes back only after a sign-out, whose signed-out branch clears
`currentUser` and so resets the unlocked state first. The one exception is
the registration's first emit repeating a change that landed before it
([auth.md](../auth.md)), which comes at start-up, before any unlock. The case holds
the contract for a listener that someday re-reads a live session.

## What was rejected

- **A remembered last-known setting.** Each real read could store
  `enableAppLock` on the device for a degraded start to use. It would spare
  one kind of account the lock screen (below), at the price of a new
  storage key to write, clear and reason about, for a state the persistent
  cache already makes rare. The PIN record is already on the device,
  already keyed on the uid, and already read through `method()`.
- **Fixing the widget alone.** Writing the locked sentence while degraded
  keeps the figures off the Home Screen and leaves the app itself open.
- **Locking every degraded start, PIN or no PIN.** With nothing on the
  device to unlock with, the only way out is signing out, offline, with no
  way back in until the connection returns.
- **Relocking at once while degraded.** The fallback has no
  `appLockTimeoutMinutes`, so the default 5 minutes applies. Failing closed
  on the delay too would relock at every app switch for as long as the
  profile stays unknown. It is recorded as a gap instead.
- **Refusing every write on a degraded session.** It would not keep the app
  closed, and it is a different question with its own cost.
- **A lock screen that steps aside whenever the lock falls.** An unmerged
  first draft put an effect on `AppLockComponent` that would leave `/lock`
  as soon as `isLocked()` was false. It never shipped. Three rounds of
  review found five exits it would cross:
  - A sign-out from another tab's lock screen needs no PIN, and the PIN's
    removal reaches this tab before the sign-out does, so this tab would
    open the account until the sign-out's reload landed.
  - Excluding a vanished PIN would keep a device's screen up after its
    session ended, with no reload coming and no PIN that could pass.
  - A PIN or a biometric probe finishing during the step-aside would unlock
    a lock the account no longer had and navigate a second time.
  - An unlock whose navigation failed would leave the screen refusing every
    later attempt in silence.
  - A step-aside could supersede a share or a tap arriving at the same
    moment.

  Each fix added state that the next round found a way around. The effect
  on the service touches none of those exits on its own, because none of
  them moves `profileDegraded`. Only an unlock that happens to coincide
  with the profile settling reaches it, the race recorded under Known
  gaps. The review of that effect found one more case it had
  to refuse: a sign-out from this lock screen clears the PIN before the
  session ends, and a retry landing in between brings the real profile
  with the lock down. So the effect asks `isEnabled()`, not only
  `isLocked()`: it acts only when the real profile asks for no lock.

## Consequences

- On a device with the account's PIN, a degraded session writes only the
  locked sentence, from start-up until the real profile arrives.
- An account that switched the lock off but kept its PIN sees the lock
  screen on a degraded start. Its PIN opens it, and the real profile takes
  the screen down by itself. The retry runs at once while online and again
  on each connectivity flip, and a failed retry waits for the next flip. So
  a refusal that persists (rules, quota) holds the screen until the PIN, or
  until a flip after the refusal has cleared; a device that stays online
  waits for the PIN.
- A degraded start with no PIN on the device is unchanged: it opens, and
  the dashboard publishes figures composed from the fallback profile.
- `degraded-profile-lock.smoke.spec.ts` runs the real `AuthService`,
  `AppLockService`, guards, lock screen and `WidgetSnapshotService` through
  the real routes against a Firestore whose network is down from before its
  first read. Against the previous lock code three of its four cases fail.
  With only the stand-down effect disabled, the case where the lock stands
  down fails alone.

## Things that only became apparent while building

- **A disabled network does fail the profile read.** The auth smoke's note
  on its degraded recovery block said a disabled network with a cold cache
  lets the read fall through to the create path; the note is corrected
  here. On a Firestore whose
  network is down before its first read, `getDoc` rejects with
  `unavailable`. The new smoke checks that in every case before relying on
  it, so it drives the production path rather than arming the flag by hand.
- **A smoke with a live routed page cannot call `TestBed.tick()`.** With the
  dashboard listening, the tick lands inside one the page's own Firestore
  callbacks started, and Angular throws NG0101. The smoke lets the scheduler
  run the retry effect and flushes the fixture, as the widget smoke does.
- **Six connections to one origin.** CI disconnected at the fourth smoke
  case, with no failure line, after 30 s of silence, and so did two local
  full runs. The case's first line, the seeder's write to `users/{uid}`,
  never finished. Two recovered dashboard sessions from the cases before it
  were still online, with the seeder. Chrome pools at most six HTTP/1.1
  connections per origin, and a probe with lighter clients (one listener and
  one write each) showed a write waiting with three of them online, against
  about 25 ms with two. What else the full run held open was not measured.
  Each case now deletes its client as it ends, and three full runs since
  passed ([testing.md](../testing.md#six-connections-to-the-emulator)).
- **A failing case has to destroy its page anyway.** While each case
  destroyed its page at its own end, a failing case left offline listeners
  behind, and the apps' deletion aborted them into `afterAll`. The page is
  destroyed in `afterEach`.

## Known gaps

- **A degraded session relocks after the default delay**, 5 minutes,
  whatever the account chose.
- **Settings shows the fallback's switch.** *Require a PIN* reads off on a
  degraded session even while the lock is engaged, as the rest of the page
  shows the fallback's values.
- **With no PIN, the widget shows the fallback's figures**, in its default
  currency and with no card hidden.
- **An unlock under way as the profile settles lands on the dashboard.**
  The stand-down consumes the remembered page and an unlock already running
  then navigates to the default page; the later navigation wins. A PIN check
  takes milliseconds. A Face ID or Touch ID sheet the lock screen raised
  stays up over the app that has already opened, for as long as the person
  takes to answer it.
- **No device run.** The degraded path was proved against the Firebase
  emulators only. A simulator start offline with an empty Firestore cache
  was not produced.
