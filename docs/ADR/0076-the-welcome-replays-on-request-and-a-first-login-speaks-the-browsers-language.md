# 76. The welcome replays on request, and a first login speaks the browser's language

**Status:** Accepted, implemented · **Date:** 2026-08-28

Two follow-ups to the same wave, both about the first minute in the app. The
first reverses one known gap of
[0072](0072-onboarding-runs-once-and-never-against-a-fallback-profile.md) —
*No re-run from the UI* — and leaves everything that record decided about the
**automatic** run standing. The second extends
[0058](0058-a-formatted-date-follows-the-chosen-language.md)'s rule that what
is rendered follows the *chosen* language, by giving an account with no choice
yet a better opening guess than a constant. Reference documentation lives in
[../onboarding.md](../onboarding.md) and [../i18n.md](../i18n.md).

## Context

The two halves are the same complaint seen from either side of the login
screen.

**The welcome could not be seen twice.** 0072 shipped a three-pane dialog that
opens once per account and completes on every close path, and recorded that
clearing `preferences.onboardingCompleted` on the user document was the only
way back to it. That was a deliberate scope line, and what it did not survive
is people asking for the dialog again. Three panes explaining the three ways
money gets into the app are reference material, and the one moment they are
guaranteed to be on screen is the moment the reader has the least context for
them.

**A first login spoke English whatever the device asked for.**
`TranslationService.init()` already read `navigator.language` at boot and
loaded the ja or tc catalog for a device that asked for one — the login screen
was in the right language. Then the account was created from
`DEFAULT_USER_PREFERENCES`, the preferences-sync effect read `language: 'en'`
off the new profile, and the app switched back. A Japanese device got a
Japanese sign-in and an English app, and stayed English until someone found
Settings. The detection was never missing; it never reached the document that
outranks it.

## Decision

**The About page replays the welcome on demand, and a created account is
seeded with the language the app is already speaking — then the Google
account's, then `'en'`.**

### The replay calls `show()`, with no gate at all

`AboutComponent.onReplayWelcome()` is one line: `this.onboarding.show()`. Not
`shouldShow()`, not a variant entry point. Someone tapping **Replay welcome**
on a card that says so is asking to see the dialog, not asking whether they are
still eligible for a first run. The gate goes false the moment the first run
completes, which is exactly when the button starts being interesting — gating
on it would make it do nothing for every user it exists for.

The card sits on the About page between Privacy and Feedback, keyed under
`about.welcome.*` in all three catalogs. About is the page that already
collects things you go looking for rather than things that find you, which is
exactly what a replay is.

### Nothing is un-completed, because `show()` is idempotent

The replay runs the whole of `show()`, including the parts that exist for the
first run: `attemptedFor` is set to the uid before the dialog opens, every
close path persists `onboardingCompleted: true` again, and an `'add'` or
`'scan'` result still opens the quick-add dialog after the close. All three
are correct on a replay.

The flag write is the load-bearing one. It is a dotted single-field update of
a value that is already `true`, so the second, third and tenth replay each
write the same fact — and `show()` can therefore only ever move `shouldShow`
*towards* false. There is no state in which replaying makes the welcome start
appearing on its own.

Rejected: **clearing the flag and letting the normal gate re-open it.** It
inverts the feature. The user asked to see the dialog now; that would show it
now *and* re-arm it to appear unasked on the next launch — the nag 0072 refuses
— and would need a write and a round trip before anything reached the screen.
The flag records that the first run happened, which stays true forever after.

### One rule maps a tag, and "detected nothing" stays visible

`mapLocaleTag(tag: string): SupportedLocale | null`, exported from
`translation.service.ts`: lowercased prefix match, `zh*` → `tc`, `ja*` → `ja`,
`en*` → `en`, anything else `null`. It is the entire former body of
`detectBrowserLocale()`, which is now a one-line delegate over
`navigator.language`, because the second link of the chain matches a Google
account's `locale` and the two sources must be read by the same rules or a
device and an account naming the same language can disagree.

`null` rather than `'en'` is the point. `TranslationService.init()` stores the
detection result in `browserLocale` before collapsing it into the boot locale,
and exposes it as the `detectedBrowserLocale` getter — a getter over a private
field, so `init()` is the only writer. `currentLocale() === 'en'` cannot
answer the question the chain asks: it is what an English device *and* an
unrecognized one both produce, and only the second hands the turn on.

### The seed goes into the profile, not into the constant

`buildNewUserProfile(firebaseUser, language)` spreads:
`preferences: { ...DEFAULT_USER_PREFERENCES, language }`. Both call sites pass
`translationService.currentLocale()` — the real create branch in
`getOrCreateUser`, and the in-memory fallback the auth-state listener builds
when the profile read fails. The second matters more than it looks: a fallback
profile naming `'en'` drove the same sync effect and flipped the UI out of the
detected language for as long as the degraded session lasted, on the launch
least able to afford another surprise.

Rejected: **seeding `DEFAULT_USER_PREFERENCES` itself.** It is the
resolver-neutral fallback — read by restore, by the accessibility resolvers, by
specs that compare against it as a fixed value. Making a module-level constant
depend on `navigator.language` at evaluation time makes every one of those
answers depend on the device that happened to load the bundle. The constant is
spread, never mutated, and a spec pins that.

### The Google account gets a turn, as a heal after the fact

`healLanguageFromGoogleProfile(user, additional)` runs at the end of both
interactive Google sign-ins, after `currentUser.set(user)` and `recordSignIn`.
Four guards, in this order, and each is a different reason to do nothing:

1. `!additional?.isNewUser` — a returning account has whatever language it has
   chosen, and this is a first-login affordance, not a sync.
2. `detectedBrowserLocale !== null` — a device language we ship a catalog for
   outranks the account's. This link only exists for the device that named
   something we cannot serve.
3. `typeof additional.profile?.['locale'] !== 'string'` — the provider did not
   name one.
4. `mapLocaleTag(tag)` is null, or already equals `user.preferences?.language`
   — nothing to adopt, or nothing to change.

Only then `await updateUserPreferences({ language })`, whose signal write is
what the preferences-sync effect watches; calling `syncFromDatabase` here as
well would fetch the same catalog twice. A failure is logged and swallowed —
the account exists and the session is real by that point, and not adopting a
language must not turn a completed sign-in into a rejected one.

**A heal rather than a branch of the creation path, because of a race.**
`getOrCreateUser` is reached from two directions on a first sign-in: the popup
(or plugin) result, and the `onAuthStateChanged` listener that fires for the
same event. Only the first holds a credential, so only the first has provider
information at all. A creation-time `if (googleLocale)` would consult a value
that is present or absent depending on which of the two won — the account's
language would be nondeterministic across identical sign-ins. A patch applied
after the document exists lands after whichever path created it.

### The native path reads the plugin's result

`signInWithGoogleNative` passes `nativeResult.additionalUserInfo`, not
`getAdditionalUserInfo(result)`. The plugin signs into Firebase in the native
layer first, so the `signInWithCredential` that follows in the web SDK sees an
account that already exists and reports `isNewUser: false` for what is
genuinely a first sign-in. Reading the web SDK's answer there would have made
guard 1 refuse every native sign-in, silently.

## Consequences

- **The welcome is now two features in one dialog**: a first run that arrives
  on its own, and a page of help that can be re-opened. Copy changes are read
  by both audiences, and the second one has already used the app.
- **`show()` has a second caller**, so it is no longer reachable only from an
  effect that has just read `shouldShow`. Everything it does had to be correct
  without that precondition; `attemptedFor` and the flag write already were.
- **Three catalogs gain `about.welcome.*`**, and the About page gains a card
  between Privacy and Feedback.
- **A new account's `preferences.language` is no longer constant.** Anything
  asserting a created profile equals `DEFAULT_USER_PREFERENCES` is asserting
  the stubbed locale is `'en'`, and the smoke suite says so explicitly.
- **No migration.** Existing accounts keep the language they carry, which is
  the only safe reading of a stored value that may well have been chosen.

## Things that only became apparent while building

- **The degraded fallback profile is a language decision too.** It is never
  written to Firestore, so it looked out of scope — but it feeds the same sync
  effect as a real profile, and an `'en'` in it is as visible to the user as a
  persisted one.
- **`readonly` could not hold `detectedBrowserLocale`.** TypeScript permits a
  `readonly` assignment only at the declaration or in the constructor, and the
  value is resolved in `init()`. A getter over a private field expresses the
  property that was actually wanted — read-only to everyone but `init()` — and
  a spec stub can still supply it as a plain field.
- **Two entry points into one dialog is cheaper than a second dialog**, but
  only because `OnboardingDialogComponent` reads nothing except its own
  `MatDialogRef`. A welcome that greeted the user by name, or branched on their
  data, would not have replayed cleanly.

## Known gaps

- **A replay in a degraded session opens the dialog and may fail to persist.**
  `show()` has no `profileDegraded` guard — deliberately, since the dialog reads
  no profile and the user asked for it — but the flag write then targets a
  document this session never read, and is swallowed if it is refused. Nothing
  on screen is wrong; nothing is repaired either.
- **The Google locale is adopted only where a credential is held.** Google is
  the only sign-in method, so a genuine first sign-in always reaches the heal —
  but the auth-state listener can create a profile document with no credential
  behind it (a restored session whose document has gone missing), and that path
  has no provider information and never acquires any. Such an account keeps the
  boot fallback.
- **`profile` is an open map.** The Capacitor plugin types it as
  `{ [key: string]: unknown }` and promises no `locale` key; guard 3 makes an
  absent one a silent no-op, so native degrades to browser detection alone.
  Nothing warns when that happens.
- **The chain runs once and is never revisited.** Moving a laptop to a Japanese
  locale changes nothing about an account created in English — correctly, since
  by then the stored value may be a real choice, and nothing distinguishes the
  two.
- **Three languages, prefix-matched.** `zh-CN` resolves to the Traditional
  Chinese catalog because it is the only Chinese catalog shipped. That was true
  of boot detection before this record and is now true of provider locales too.
