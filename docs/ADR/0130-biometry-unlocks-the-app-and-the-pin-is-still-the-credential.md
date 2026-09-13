# 130. Biometry unlocks the app, and the PIN is still the credential

**Status:** Accepted, implemented · **Date:** 2026-09-13 · **Issues:** #121, #75

Reference documentation lives in [../app-lock.md](../app-lock.md).

## Context

The app lock shipped in `451b1f3 feat(security): app lock with a device PIN` —
2026-07-25, three days after the first record in this series is dated, and it
has no record here. `AppLockService` gates every guarded route behind a
six-digit PIN derived with PBKDF2 and stored per device; the timeout, the
escalating backoff, the persisted attempt state and the sign-out escape hatch
are all from that commit and the two that followed it (`81a020c fix(security):
close defects found reviewing the security batch`, `ec3a05e fix(app-lock): make
a forgotten PIN unable to strand the user`). Biometry was left out on purpose:
#121 says it "cannot be built or verified from the web toolchain", and it was
blocked behind #120 — app-target Swift plugins were not registered with the
Capacitor bridge at all, so a new plugin would have rejected with
`Unimplemented` exactly like the two that already existed. `5026a61 fix(ios):
register the app-target plugins with the Capacitor bridge` cleared that.

What is left is a lock people meet several times a day and type six digits
into every time, on a device that has a sensor for precisely this.

Three forces make it harder than "call `evaluatePolicy`".

**`LocalAuthentication` offers a passcode fallback that undoes the lock.**
`deviceOwnerAuthentication` drops through to the device passcode on its own
when biometry fails. Anyone holding an unlocked phone knows the passcode of
that phone — it is how they unlocked it — so a lock that accepts it is not
guarding the account against the person holding the device, which is the
threat the app lock exists for.

**The probe runs on the boot path.** #121's own note: probing biometry
availability during bootstrap needs a timeout race, or a wedged bridge
white-screens the app. The lock state has to be settled before the first
guarded navigation, and the guard cannot wait on a bridge.

**The existing behaviour is fail-open, and it has to stay that way.** When
the account asks for a lock and the device has no credential, `method()`
answers `'none'`, the app stays open, and Settings shows a warning. Failing
closed would strand someone with nothing to unlock with. Biometry adds a
rung; it must not change what happens when every rung is missing.

## Decision

**Biometry is a faster way past the lock. The PIN is what the lock is made
of, and every failure lands on it.**

### The method is a three-rung ladder, and the bottom rung is still open

```
no PIN record on this device                          → 'none'   (app stays open)
PIN record + device opt-in + probe says available     → 'biometric'
otherwise                                             → 'pin'
```

`method()` is a computed, so every input that can move — the credential
version, the signed-in user, the probe's `available` signal — re-evaluates
it. `'none'` is untouched from the PIN-only version: the fail-open rule is
prior to this record and is not renegotiated by it.

Biometry therefore never exists without a PIN. Removing the PIN removes the
opt-in with it, in the same `clearCredential()` that clears the record and
the attempt state.

### The policy offers no passcode, and says so in the code

`deviceOwnerAuthenticationWithBiometrics`, with
`context.localizedFallbackTitle = ""`. An unset title restores the system's
default offer rather than removing it, so blanking it is the removal. The
user chose this over the OS-passcode fallback on 2026-09-02, "with the app
PIN still required".

What that looks like on a real sheet is the point: a non-matching face shows
*Face Not Recognized* with *Try Face ID Again* and *Cancel* — and nothing
else. Cancel returns to the app's own lock screen with the PIN field on it.

### The opt-in is a device flag, not a preference

`localStorage`, at `homeaccount.app-lock.<uid>.biometric`, beside the PIN
record and read through the same `app-lock.utils.ts` with the same
corrupt-degrades-to-false contract.

Biometry is a property of one device. A preference on the user document would
carry a Face ID phone's choice to a laptop that has no sensor, and would have
to be reconciled against a probe on every device anyway. The flag has the
same lifetime as the credential it accelerates. The consequence is that this
feature adds no `UserPreferences` field and no `firestore.rules` change at
all.

### The probe is fired, not awaited, and it has a deadline

`AppLockService.init()` calls `detectAvailability()` and discards the
promise. The lock state settles synchronously from `localStorage`; the probe
only decides whether the *biometric* rung is offered, and the PIN is on
screen either way.

On web it returns before touching the plugin — `Capacitor.isNativePlatform()`
is the first line — so `registerPlugin`'s proxy is never reached and no
`Unimplemented` rejection appears in any spec or console. On native it races
`isAvailable()` against 1500 ms. **A rejection and a timeout both reset
`available` to false**, rather than leaving whatever a previous probe wrote:
the deadline is exactly the "the bridge went away" case, and a stale `true`
surviving it would offer a prompt that cannot be raised.

### A failed prompt spends nothing

`unlockWithBiometrics` is deliberately blind to the PIN backoff and to the
exhausted-attempts state, and a cancelled, failed or locked-out prompt never
touches `failedAttempts` or `blockedUntil`. Biometric lockout is the
operating system's counter, not the app's, and a thumb slipping off a sensor
must not spend one of the app's ten PIN attempts. The only
outcome that reaches the screen as words is `lockedOut` (and `failed`);
`cancelled` is silent, because the PIN field the user is looking at is
already the answer.

`lastBiometricOutcome` exists only so the screen can word that sentence. It
is cleared on account change and on `lockNow()` — a `lockedOut` from one
account must not greet the next one.

### The screen prompts once, and the button repeats it

An effect on the lock screen raises the prompt the first time it renders with
`method() === 'biometric'`, which is the iOS convention on cold start, and a
`biometricPrompted` flag makes that once per instance — the 250 ms countdown
interval and any `credentialVersion` bump would otherwise re-run the effect
and re-raise the sheet. The *Unlock with Face ID* button raises it again on
request.

The effect also reads `isChecking()`. The probe can resolve up to 1500 ms
after the screen mounts, which is long enough for a PIN submit to be in
flight on the same flag; reading it in the effect means the auto-prompt waits
for that submit to release rather than racing a second unlock — and because
it is a signal read, the effect re-runs by itself when it does.

### Three files across the bridge, and a token in front of them

- **`BiometricAuthPlugin.swift`** — the shell: `isAvailable` and
  `authenticate`, registered from `MainViewController.capacitorDidLoad`
  alongside the other three app-target plugins, which is #120's method.
  **Every call builds its own `LAContext`**: a context caches the evaluation
  it has already run and answers a second `evaluatePolicy` from that cache
  without showing a sheet, so a shared one would wave a locked app through on
  the strength of an unlock from minutes ago.
- **`BiometricOutcome.swift`** — a pure Foundation/LocalAuthentication enum
  collapsing fifteen `LAError` codes to the four strings the web layer
  branches on, and `LABiometryType` to `faceId` / `touchId` / `none`. It
  compiles into the `AppTests` logic bundle as well as the app, which is why
  it links no Capacitor — the same shape
  [ADR 0040](0040-the-native-seams-answer-to-xctest.md) established for
  `ShareIntakeStore`.
- **`biometric-auth.plugin.ts`** — the interface, the `registerPlugin` call,
  and `BIOMETRIC_AUTH_PLUGIN`, an `InjectionToken` the service injects
  instead of the proxy. The proxy `registerPlugin` returns cannot be spied:
  its `get` trap never consults its target, so `spyOn` has nothing to
  intercept.

The token's factory returns a **plain two-method adapter**, not the proxy.
That is not tidiness; see below.

`BiometricAuthService` is the only thing in the app that touches any of it,
and it reduces everything to two signals (`available`, `biometry`) and one
`authenticate(reason): Promise<BiometricOutcome>`.

### Settings offers the toggle only where it can be used

The *Unlock with Face ID* switch renders under the timeout select, inside the
`enabled() && hasCredential()` branch and behind `biometricAvailable()`. Web
never shows it; a device with no enrolment never shows it; a device with no
PIN never gets that far. Its hint says the PIN stays set and still works,
because a switch that reads like it replaces the PIN would be a switch people
turn on and then cannot get past.

### What was rejected

- **`deviceOwnerAuthentication` — biometry with the OS passcode behind it.**
  It is one enum case and it is what most apps do. It also means the device
  passcode opens the account lock, and the device passcode is the thing the
  person holding the phone just used. The user made this call explicitly.
- **A `UserPreferences.biometricUnlock` field.** Synced, it would carry one
  device's answer to another and would still have to be intersected with a
  local probe; it would also put a rules change and a backup field into a
  wave that otherwise touches neither.
- **Awaiting the probe in the app initializer.** The honest version of this
  — block startup until the bridge answers — is what #121 warned about. The
  deadline exists so the answer is "no biometry" rather than "no app".
- **Deriving the biometry name from `isAvailable`'s `available` flag.** The
  plugin reports `biometry` even when `available` is false — a device
  enrolled for Face ID but currently locked out is exactly that — so callers
  branch on `available` and read `biometry` only for the label.
- **A shared `LAContext` on the plugin.** Cheaper, and wrong: see above.
- **Letting the lock screen classify `LAError` itself.** The codes travel as
  strings because that is all a Capacitor rejection carries; collapsing them
  once in Swift means one switch rather than one on each side of a bridge
  that can only pass text.

## Consequences

- **No rules change, no backup field, no migration.** The whole feature is
  one `localStorage` key, one Swift plugin, one service and two controls.
- **The pbxproj was hand-edited: 14 added lines, 7 synthetic ids A8–AE.**
  The plan estimated nine lines. A file compiled into two targets needs a
  `PBXBuildFile` per target — `BiometricOutcome.swift` has one for App and
  one for AppTests — and the test file needs its own file reference, build
  file and group entry. The ids continue the synthetic convention ADR 0040
  established.
- **`NSFaceIDUsageDescription` is in `Info.plist`**, staged before any build
  ran: every `xcodebuild` rewrites that file with a `CFBundleURLTypes` block
  carrying a gitignored client id, so the authored key has to be committed
  ahead of the build that would bury it.
- **`AppTests` is 32 tests, 21 + 11.** The eleven new ones drive
  `BiometricOutcome`: the cancel family, lockout, the three unavailable
  causes, a plain authentication failure, an unrecognized code, the two
  biometry names, and an `NSError` bridged to its LA code.
- **The unit tier is 9 cases on the service, 36 on `AppLockService`, 21 on
  the utils, 20 on the lock screen and 6 on the settings panel**, plus four
  emulator cases driving the real service through a faked plugin behind the
  token.
- **`MainViewController` registers four plugins now**, and its docblock
  stopped counting them: the warning about Main.storyboard instantiating
  `CAPBridgeViewController` directly now says "the plugins registered here",
  which is the last count it will need.

## Departures from the issues

- **#121 lists the Info.plist string, the plugin, the wrapper, the service
  and the `method()` branch. It does not mention an opt-in at all** — it
  reads as though biometry should be offered wherever the device supports it.
  It is opt-in per device instead. Enrolment is not consent: a phone that can
  do Face ID says nothing about whether its owner wants this app unlocked by
  a glance, and the switch is also the only way back to PIN-only without
  removing the PIN.
- **The app-switcher privacy screen is not built.** #121 raises it as "out of
  scope but worth a look"; the user deferred it on 2026-09-02. iOS still
  screenshots the app on resign-active, so the last screen is visible in the
  app switcher even while the app is locked.
- **Optic ID is mapped to `'none'`.** `LABiometryType.opticID` has no prompt
  copy in the catalogs, and a biometry the app cannot name is worth no more
  to it than none at all.

## Things that only became apparent while building

- **Angular's injector destroys the Capacitor proxy.** Providing the proxy
  behind the token was the obvious first shape, and it put two error lines
  into the whole smoke run — "BiometricAuth plugin is not implemented on
  web" — that reproduced on no spec run alone. `R3Injector` probes every
  provided value for `typeof value.ngOnDestroy === 'function'` at teardown;
  the proxy's `get` trap answers **every** name with a callable plugin-method
  wrapper, so DI registered `ngOnDestroy` as a lifecycle hook and called it,
  which reached the bridge and rejected. Every `TestBed` reset after the lock
  service had been constructed did it once. Production never destroys the
  root injector, which is why it was only ever visible in the suite. The
  factory now returns a plain object with exactly two methods, and a unit
  case pins that it has no `ngOnDestroy` and exactly two keys.
- **A timeout has to undo what an earlier probe believed.** The first
  version's timeout path simply returned, on the reasoning that `available`
  starts false. It does — on the first probe. A re-probe that times out
  against a wedged bridge would have left a stale `true` standing, offering a
  prompt nothing could raise. Both failure paths now write false.
- **The probe can change the method under a painted screen.** `available()`
  flipping false → true moves `method()` from `'pin'` to `'biometric'` up to
  1.5 s after the lock screen has rendered, which is squarely inside the time
  someone takes to type six digits. That is the race the `isChecking()` read
  closes, and it is also why `unlockWithBiometrics` re-reads `method()`
  rather than trusting the value the caller saw.
- **`createMockUser`'s preference override replaces the object.** The smoke
  spec's `{ preferences: { enableAppLock: true } }` dropped the factory's
  `onboardingCompleted: true` with it, so two cases opened a real onboarding
  dialog over the dashboard. The override has to spread the defaults back in.

## Known gaps

- **No real-device run is recorded here.** #121 asks for one, and everything
  below was proved on an iPhone 17 simulator under Xcode 26.2: the probe
  reading not-enrolled (`Code=-7`) and then enrolled (`biometryType: 2`)
  after a BiometricKit enrolment; a cold start showing the Face ID button and
  raising exactly one automatic prompt 0.75 s after the probe; a matching
  face unlocking to the dashboard; a non-matching face producing the
  *Face Not Recognized* sheet with no passcode offer, and Cancel
  (`Code=-2`) leaving the lock screen with no error line and the PIN path
  intact; the button raising a second prompt; and enrolment switched off
  falling back to a PIN-only screen with no prompt at all. A simulator does
  not prove the Secure Enclave path, an enrolment change invalidating
  anything, or what a real sensor does in the cold.
- **The app-switcher privacy screen.** Deferred, above.
- **`test:ios` is still local-only and the `AppTests` scheme is still
  unshared** — ADR 0040's gap, unchanged. Nothing in CI compiles this Swift.
- **The bridge payload is not validated.** `isAvailable()`'s result is read
  as the declared shape; a plugin that answered with something else would be
  read as `available: undefined`, which is falsy, but that is luck rather
  than a check.
- **The outcome is matched by string.** `toOutcome` reads `code` then
  `message`, both against the same four literals, because a Capacitor
  rejection carries no structure. Renaming a case in Swift breaks the web
  layer silently — the Swift file says so, and nothing enforces it.
- **The lock screen's `errorParams()` always carries a biometry name**, even
  for `wrongPin` and `tooManyAttempts`, which ignore it. It is harmless and it
  is one more place a reader has to check to see which messages interpolate.
