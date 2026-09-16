# The app lock

A second gate in front of an already signed-in session. The account asks for
it; the **device** satisfies it, with a six-digit PIN and — on an iPhone that
offers one and has been opted in — Face ID or Touch ID.

It is not encryption. Stored data is protected by Firestore rules and by the
session, exactly as it is without a lock; this stops someone who picks up an
unlocked phone from reading the ledger on it. The disclaimer under the switch
says so in as many words.

Why biometry never replaces the PIN, why the opt-in is a device flag, and what
the simulator did and did not prove is in
[ADR 0130](ADR/0130-biometry-unlocks-the-app-and-the-pin-is-still-the-credential.md).
This document is the part you need when using the lock, working out why it did
or did not engage, or changing it.

## The pieces

| Piece | File |
|---|---|
| The gate, the method ladder, the backoff | `core/services/app-lock.service.ts` |
| Storage reads and writes, the backoff curve | `core/utils/app-lock.utils.ts` |
| PBKDF2 derivation and verification | `core/utils/pin-hash.utils.ts` |
| The biometric wrapper | `core/services/biometric-auth.service.ts` |
| The plugin interface and its injection token | `core/plugins/biometric-auth.plugin.ts` |
| The native plugin and its error mapping | `ios/App/App/Plugins/BiometricAuthPlugin.swift`, `BiometricOutcome.swift` |
| The lock screen (`/lock`) | `features/auth/app-lock/` |
| The settings panel | `features/settings/security-settings/` |

`AppLockService.init()` runs from an app initializer, before the first guarded
navigation. `authGuard` sends a locked session to `/lock` and remembers where
it was going; `lockGuard` sends anyone with nothing to unlock back out again,
so `/lock` is never a dead end.

## The method ladder, and the fail-open rule

`method()` answers one of three values, recomputed whenever the credential,
the signed-in user or the biometric probe moves:

```
no PIN record on this device                        → 'none'
PIN record + device opt-in + probe says available   → 'biometric'
otherwise                                           → 'pin'
```

**`'none'` means the app stays open.** The account asked for a lock and this
device has nothing to satisfy it with, so locking would strand the user with
no way in. Settings shows a warning instead, naming the missing PIN. This is
the oldest rule here and biometry did not change it.

Biometry is therefore never a credential of its own: `'biometric'` requires a
PIN record to exist. *Remove PIN* clears the record, the attempt state **and**
the biometric opt-in together.

`isLocked()` is `canEngage() && unlockedAt() === null`. The unlocked timestamp
lives in memory and starts null, so a cold start is locked by construction —
there is no "locked" flag on disk to keep in sync or to edit.

`canEngage()` alone — a lock configured on this device, not whether the app
happens to be locked right now — is also what the iOS home-screen widget
reads before it will write a figure to disk; a process that can only read a
file has no way to see `isLocked()`'s in-memory timestamp at all. See
[widget.md](widget.md).

## What is stored, and where

All of it in `localStorage`, all of it per device, all of it namespaced by the
signed-in user id:

| Key | Holds |
|---|---|
| `homeaccount.app-lock.<uid>` | The PIN record: `{ v, salt, hash, iterations }` |
| `homeaccount.app-lock.<uid>.attempts` | `{ failed, blockedUntil }` |
| `homeaccount.app-lock.<uid>.biometric` | `'1'` when this device may use biometry; absent otherwise |

On the account document there are exactly two fields — `enableAppLock` and
`appLockTimeoutMinutes` (0, 1, 5, 15 or 60; default 5) — and biometry added
neither. There is no `biometricUnlock` preference: biometry is a property of
one device, and a synced flag would carry a Face ID phone's answer to a laptop
that has no sensor.

**Every read degrades to "no credential" rather than throwing.** These are
read during bootstrap, and an exception there white-screens the app, so a
corrupt or partially written record reads as absent and a failed write is
reported as "could not save the PIN" rather than as a lock that will not hold.

A `storage` event on any key under the prefix bumps a credential version. That
event fires only in the app's *other* tabs, and without it a tab sitting on
the lock screen would keep a memoized method after the credential was removed
elsewhere and stay stuck until reload.

## The backoff, and what does not spend it

A wrong PIN costs nothing twice, then time:

```
wrong PINs  1  2  3    4     5     6+
delay       0  0  5s   10s   20s   30s (capped)
```

The counter and the deadline are **persisted**, because a reload or an app
relaunch is a control the person holding the device already has — without
persistence the whole rate limit would be bypassable with no tooling at all.
A successful unlock clears them.

Three things deliberately do **not** spend an attempt:

- **A cancelled, failed or locked-out biometric prompt.** The operating system
  owns biometric lockout; a thumb slipping off a sensor must not cost one of
  ten PIN attempts. `unlockWithBiometrics` never touches `failedAttempts` or
  `blockedUntil`, and it is equally blind to them on the way in — an exhausted
  PIN state does not disable the face.
- **A wrong PIN entered while the backoff is running.** `unlockWithPin`
  returns false before reading the record at all.
- **Backgrounding the app.** Re-locking on return is a timeout, not a failure.

At ten (`MAX_PIN_ATTEMPTS`) the error copy changes to name the way out —
*Too many incorrect attempts. Sign out to clear the PIN on this device* — and
that is all it changes. The field is not disabled and the count is not a
ceiling: a correct PIN still opens the app once the 30-second backoff has run
down. The escalating delay is the rate limit; the sentence is advice.

*Sign out instead* is always available. It clears the credential **first** and
signs out second, so a sign-out that fails still leaves the device
recoverable. That order matters: neither the stored PIN nor `enableAppLock` is
touched by signing out, so without it the user signs back in and lands
straight back on the lock screen with the same forgotten PIN — behind which
sits the only settings screen that could remove it.

## Biometry

### The plugin trio

- **`BiometricAuthPlugin.swift`** — two methods, `isAvailable` and
  `authenticate`, registered from `MainViewController.capacitorDidLoad`
  alongside the other app-target plugins (auto-registration never sees them;
  see [share-import.md](share-import.md)). The policy is
  `deviceOwnerAuthenticationWithBiometrics` and
  `localizedFallbackTitle` is blanked to `""`, so the system sheet offers
  **no** device passcode — the app's own PIN is the fallback, and it is
  already on the screen behind the sheet.
  Every call builds a fresh `LAContext`: a context answers a second
  `evaluatePolicy` from its own cached result without showing a sheet, so a
  shared one would wave a locked app through on an unlock from minutes ago.
- **`BiometricOutcome.swift`** — a pure Foundation/LocalAuthentication enum
  collapsing `LAError` to four strings (`cancelled`, `lockedOut`,
  `unavailable`, `failed`) and `LABiometryType` to `faceId` / `touchId` /
  `none`. It links no Capacitor
  because it is compiled into the `AppTests` logic bundle as well as the app
  ([ADR 0040](ADR/0040-the-native-seams-answer-to-xctest.md)). The strings are
  the contract across the bridge — renaming one breaks the web layer silently.
- **`biometric-auth.plugin.ts`** — the TypeScript interface, the
  `registerPlugin` call, and `BIOMETRIC_AUTH_PLUGIN`, an `InjectionToken` that
  everything else injects instead of the proxy. The proxy cannot be spied: its
  `get` trap never consults its target, so a spec has nothing to intercept.

**The token's factory returns a plain two-method adapter, not the proxy**, and
that matters beyond tidiness. Angular's injector probes every provided value
for `typeof value.ngOnDestroy === 'function'` at teardown, and the proxy
answers *every* property name with a callable plugin-method wrapper — so DI
registered `ngOnDestroy` as a lifecycle hook, called it, reached the bridge
and got "BiometricAuth plugin is not implemented on web". Once per TestBed
reset, in a suite run, on specs that had nothing to do with the lock.
Production never destroys the root injector, so it was only ever visible in
the test output.

### The probe, and its deadline

`init()` fires `detectAvailability()` and does not await it. The lock state is
settled synchronously from storage; the probe only decides whether the
biometric rung is offered, and the PIN is on screen either way.

- On **web** it returns before touching the plugin, so no `Unimplemented`
  rejection ever reaches a console or a spec.
- On **native** it races `isAvailable()` against **1500 ms**. A rejection and
  a timeout both set `available` to false — the deadline is the
  "bridge went away" case, and a stale `true` from an earlier probe must not
  survive it.

`isAvailable` reports `biometry` even when `available` is false — a device
enrolled for Face ID but currently locked out is exactly that shape — so read
`available` to decide and `biometry` only for the label.

The probe can therefore resolve up to 1.5 s **after** the lock screen has
painted, flipping `method()` from `'pin'` to `'biometric'` under it. That is
handled rather than avoided: the screen's auto-prompt effect waits on the same
`isChecking` flag a PIN submit holds, and `unlockWithBiometrics` re-reads
`method()` instead of trusting what the caller saw.

### The lock screen

With `method() === 'biometric'`, the screen raises the prompt **once** on its
own as it renders — the iOS convention on cold start — and the
*Unlock with {Face ID|Touch ID}* button raises it again on request. Once, not
once per change-detection pass: a flag on the component guards it, or the
250 ms backoff countdown would re-raise the sheet on every tick.

Outcomes on screen:

| Outcome | What the screen does |
|---|---|
| success | Navigates to the remembered destination |
| cancelled | **Nothing.** The PIN field is already the answer |
| unavailable | Nothing |
| lockedOut | *{biometry} is locked. Enter your PIN.* |
| failed | *{biometry} didn't recognise you. Try again or enter your PIN.* |

`lastBiometricOutcome` exists only so that sentence can be worded. It is
cleared on account change and on `lockNow()`, so one account's lockout never
greets the next.

### The settings toggle

Settings → Profile → **App Lock**. The *Unlock with {biometry}* switch renders
only when the lock is on, this device has a PIN, and the probe reported
biometry — so it never appears on web and never appears on a device with no
enrolment. Its hint says the PIN stays set and still works: a switch that read
like a replacement is one people turn on and then cannot get past.

The toggle writes the device flag and bumps the credential version; nothing
reaches the account document.

## Verifying on the simulator

`npm run test:ios` covers the outcome mapping and nothing else — the plugin
shell, the bridge and `LAContext` are only exercised by hand. On an iPhone 17
simulator:

1. **Boot with no enrolment.** The native log shows
   `canEvaluatePolicy:1 returned Code=-7 'No identities are enrolled'` — which
   is itself the proof that the plugin is registered and reaching
   LocalAuthentication rather than rejecting with `Unimplemented`.
2. **Enrol** (Features → Face ID → Enrolled; the BiometricKit enrolment
   notification does it) and relaunch. The log reads `canEvaluatePolicy:1
   returned YES, biometryType: 2`.
3. **Set a PIN**, switch *Require a PIN* on, unlock, then switch
   *Unlock with Face ID* on. The lock engages immediately when the preference
   is turned on, and the first lock screen is PIN-only — the opt-in does not
   exist yet, so `method()` is `'pin'`.
4. **Cold start.** The lock screen shows the Face ID button above the PIN
   field, and the log shows `evaluatePolicy:1` about three quarters of a
   second after the probe: one automatic prompt, not two.
5. **Matching face** (Features → Face ID → Matching Face) unlocks.
6. **Non-matching face** raises *Face Not Recognized* with *Try Face ID Again*
   and *Cancel* — and nothing else, which is the biometrics-only policy on
   screen. Cancel logs `Code=-2 'Canceled by user'`, leaves the lock screen
   with **no** error line, and the PIN still works.
7. **The button** raises a second prompt in the same boot.
8. **Enrolment off, cold start.** `Code=-7` again, no `evaluatePolicy`, and
   the screen is PIN-only with no prompt and no error.

Restore afterwards: *Remove PIN* clears the record and the opt-in on the
device and switches `enableAppLock` back off on the account.

## Known gaps

- **No real-device run is on record.** Everything above was proved on a
  simulator, which does not exercise the Secure Enclave, an enrolment change
  invalidating anything, or a real sensor.
- **No privacy screen on resign-active.** iOS screenshots the app when it goes
  to the background, so the last screen is visible in the app switcher even
  while the app is locked. Deferred deliberately.
- **Optic ID reports as `'none'`.** There is no prompt copy for it, and a
  biometry the app cannot name is worth no more to it than none.
- **`test:ios` is local only** and the `AppTests` scheme is unshared, so no CI
  job compiles any of this Swift (ADR 0040's gap, unchanged).
- **The bridge payload is not validated.** `isAvailable()`'s result is read as
  the declared shape; a plugin answering something else would read as
  `available: undefined`, which is falsy by luck rather than by a check.
- **Outcomes are matched by string** on both sides of the bridge, because a
  Capacitor rejection carries nothing else. Nothing enforces that the two
  vocabularies stay equal.
- **The lock is per device, and so is recovery.** Nothing on the account can
  clear a forgotten PIN from another device; the only route is *Sign out
  instead* on the device itself.
