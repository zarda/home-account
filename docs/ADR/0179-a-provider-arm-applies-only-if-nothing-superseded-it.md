# 179. A provider arm applies only if nothing superseded it

**Status:** Accepted, implemented · **Date:** 2026-10-19 · **Issues:** #495

Reference documentation lives in [../auth.md](../auth.md),
[../ai-models.md](../ai-models.md),
[../receipt-import.md](../receipt-import.md) and
[../performance.md](../performance.md).

This record takes #495: a provider bring-up that a sign-out did not cancel
could arm the departing account's key under the next account. It found three
routes to that and four more paths of the same shape, and it puts one rule on
every write a provider client or the key service makes after an await.

Extends
[0052](0052-a-profile-read-may-only-write-to-the-session-that-started-it.md).
Its identity rule stands: a write that crosses an await names what started
it, and abandons silently once that has gone. 0052 names a session by its
uid, asked of the SDK. A provider client is handed a key and has no account
to ask about, so here the name is a count that every later arm, bring-up or
reset moves. 0052 turned a counter down for the profile read, because it
would refuse a read that lands after signing out and back in as the same
account, the one read in flight and the one that recovers that session. Here
every sign-in starts a bring-up of its own, so refusing the earlier one loses
nothing. `ProviderKeyService`, which 0052 cited as re-checking the account
before every write, did not after the awaits of `load` and `setKey`; those
two now do (`deleteAll` does not, see *Known gaps*).

The reset keeps [0009](0009-shared-state-publishing-and-lifecycle.md)'s
convention: the strategy, which owns the bring-up, resets the providers on
the signed-out edge, and the reset now also supersedes what is in flight.
[0163](0163-a-page-reloads-on-an-account-change-it-did-not-start-and-the-web-keeps-the-session-in-local-storage.md)
narrows the window: on the web a page reloads on an account change it did not
start, so what remains is the page's own sign-out followed by its own sign-in.

## Context

The cloud provider clients are root singletons, and a sign-out is a router
navigation, so they survive it. `AIStrategyService` brings them up once per
account and connectivity state, through `bringUpFor`, and on the signed-out
edge tears them down through `CloudLLMProviderService.resetProviders()`: the
key cache forgotten, Gemini cleared, OpenAI and Claude reinitialised with no
key. The reset came in `88079204`, because without it account A's key stayed
loaded and account B's receipts went out on it, and it had no record of its
own.

A bring-up, `initializeProviders()`, reads the account's keys and then awaits
each provider's `reinitialize`. Each provider loads its SDK on demand and
builds its client only after that import. The reset cleared synchronously
and cancelled nothing in flight, and the strategy started B's bring-up on
sign-in without invalidating A's. The readiness wait
([0178](0178-a-schedule-is-held-to-its-ranges-and-a-refusal-says-what-was-written.md))
answers for B's own bring-up, so it could not see what A's did afterwards. The
window is a bring-up's key read, or the session's first SDK import,
outlasting a sign-out and a sign-in, and it predates the branch that found
it.

There were three routes to A's key under B, where the issue named one:

- **A provider's own import landing late.** A's bring-up waits inside
  `openai.reinitialize(A's key)` for the SDK chunk. The reset nulls the
  client, B signs in, and then the chunk lands: the continuation builds A's
  client, stores A's key and reports OpenAI available.
- **A parked import carrying the bring-up on.** A's bring-up waits in
  Gemini's import. When it lands, the bring-up goes on to call
  `openai.reinitialize` and `claude.reinitialize` with A's keys: fresh arms
  that start after the switch, which nothing inside those providers can tell
  from B's own. If B's bring-up had armed OpenAI with B's key in between, A's
  fresh arm replaced it.
- **A late key read.** `clearCache()` drops the read in flight from
  `ProviderKeyService`, so B never joins it, but A's bring-up still awaits
  that promise. It resolves with A's keys after the reset, and the bring-up
  arms all three.

Four more paths wrote after an await, or armed a key nobody had chosen:

- **The failure branches.** Each provider's `catch` wrote too: an import that
  failed after a newer arm had landed nulled the newer client and logged.
- **The model switch.** `reinitializeGemini` reads the stored key and then
  reinitialises Gemini, with nothing between the two.
- **The build's own Gemini key.** `GeminiService`'s constructor arms from
  `environment.geminiApiKey`, unawaited. And with no stored key, a model switch
  and a cleared key handed `undefined` to `reinitialize`, which falls back to
  that key: Gemini came up for an account that had none, or had just removed
  its own.
- **`ProviderKeyService`'s own writes.** `load` wrote the cache, its owner and
  the failure flag after its read and after the preference migration, which
  awaits writes of its own, with no account check after either. A departed
  account's read became the cache under its own id, and its outcome, good or
  failed, set the next account's failure flag. `setKey` ran its write-through
  after the write's acknowledgement, for whoever was signed in by then. It
  wrote the next account's cached keys, with the departed account's new one
  merged in, back under the departed account's id, so the next account's
  cache was lost. With no read yet, its `clearCache()` dropped the next
  account's read in flight and its failure flag.

Two facts kept the fix small:

- **The readiness wait already compared bring-ups by identity.** A bring-up
  that resolves without arming is never the one it answers for once a newer
  bring-up has started, so it needed no change.
- **OpenAI and Claude already loaded their SDKs through a `loadSdk` seam** the
  specs substitute. Gemini imported inline.

## Decision

**An arm applies only if nothing superseded it since it started. Each
provider counts its arms, and the façade counts its bring-ups. Every
reinitialise or clear of a provider takes the next arm; every bring-up takes
the next generation on entry, and a reset moves it. After each await, an arm
or a bring-up that finds its count moved writes nothing more, on success or
on failure, and clears nothing it armed. A model switch reads the façade's
count and never moves it. With no stored Gemini key every path clears Gemini
rather than arm the build's key, and `ProviderKeyService`'s `load` and
`setKey` write after an await only for the account that started them.**

Each commit is cited by its subject.

### Gemini's seam

`refactor: Gemini loads its SDK through a seam` adds
`GeminiService.loadSdk()` (`gemini.service.ts:131-134`), a dynamic `import()`
like OpenAI's (`openai.service.ts:60-63`) and Claude's
(`claude.service.ts:62-65`), and `initializeGemini` awaits it (`:108`). The
SDK stays a lazy chunk. *loads its SDK through the loadSdk seam and arms the
key it was given* spies the seam with a fake module.

### The arm counter

`fix: a provider arm superseded by a later reinitialize or clear applies
nothing` puts the counter in `CloudLLMProviderBase`
(`cloud-llm-provider.base.ts:150-153`): `supersedeArms()` takes the next arm
and `isLatestArm(arm)` asks whether it is still the latest.

- **What takes an arm.** Every `reinitialize`, keyed or not, as its first
  statement (`openai.service.ts:69`, `claude.service.ts:71`,
  `gemini.service.ts:141`), Gemini's `clear()` (`:153`) and Gemini's
  constructor (`:72`). A reinitialise for the key a provider already holds,
  which builds nothing, takes one too, so it still supersedes an arm for
  another key that is loading: the latest call wins.
- **Where it is checked.** Right after `await this.loadSdk()`, before the
  client is built (`openai.service.ts:42-43`, `claude.service.ts:40-41`,
  `gemini.service.ts:109-110`), and first in the failure branch
  (`openai.service.ts:51-52`, `claude.service.ts:53-54`,
  `gemini.service.ts:120-121`).
- **A superseded arm writes nothing**: no client, key, model ids or
  `available`, and no log. Each provider's writes after the import are one
  synchronous block, so no half state is visible.
- **The synchronous paths need no check**: the keyless clear in OpenAI's and
  Claude's `reinitialize`, Gemini's no-key branch (`:84-87`, which calls
  `clear()` and so takes a second arm, harmlessly), and Gemini's same-key
  model switch (`:95-104`).

Each provider's spec gains *an arm superseded while its SDK loads*:

- a clear while the import is in flight leaves the provider down;
- the later key wins when the earlier import lands last;
- a superseded import that fails touches nothing and logs nothing;
- for Gemini, *a clear() while the constructor's environment arm loads leaves
  the instance down*, on a second instance built with a fake build key.

The base's *arm generations* holds that a later arm makes an earlier one
stale. The smoke's new describe, *cloud LLM providers across an account
switch*, signs two anonymous accounts in and out against the emulators. Its
*arms nothing on the departing account's key once the next account is signed
in* holds A's bring-up in OpenAI's real import, signs A out and B, with no
key, in, and finds B's readiness wait true and, once the import lands,
nothing up. Without OpenAI's check after the import, that smoke and the
first two OpenAI cases fail. Without the arm on the keyless branch, the clear
case fails. Each provider's two checks and the arm its keyless path takes
were removed one at a time, and each removal failed a case of that
provider's own.

### The bring-up counter

`fix: a provider bring-up superseded by a sign-out or a newer bring-up arms
nothing more` adds `generation` to `CloudLLMProviderService`
(`cloud-llm-provider.service.ts:36-39`).

- **`initializeProviders`** (`:106-130`) takes `++this.generation` on entry
  (`:108`), so a newer bring-up supersedes every earlier one. It returns with
  no further arm call once the count has moved after the key read
  (`:113-114`), after Gemini's arm (`:118-119`) and after OpenAI's
  (`:126-127`). The keyless `clear()` (`:120-123`) is synchronous after the
  first check and needs none of its own. The work on #497 later made every
  return carry the bring-up's outcome, `{ keyReadFailed }`, taken as the read
  lands (`:110-112`); the checks are unchanged by it.
- **`resetProviders`** (`:143-151`) moves the count first (`:144`), then
  clears as before.
- **`reinitializeGemini`** (`:201-211`) captures the count without moving it
  (`:202`) and checks it after its key read (`:204-205`). A model switch is
  not a bring-up, and moving the count would stop the bring-up in flight
  before OpenAI and Claude came up.
- **`updateProviderApiKey`** (`:160-178`) neither moves nor reads it. A typed
  key belongs to the account signed in, and each provider's arm counter
  orders it against a bring-up's arm of the same provider.
- **Never arm, then clear.** A superseded bring-up stops before its next arm
  call. It clears nothing it armed, because by then that provider may hold the
  next account's own arm.
- **Resolved does not mean armed.** A superseded bring-up still resolves.
  Its one caller, the strategy, compares bring-ups by identity, so the
  readiness wait never answers for one a newer bring-up superseded.

The strategy needed no logic change. Its sign-out comment
(`ai-strategy.service.ts:199-213`) now says that a bring-up in flight for the
departing account arms nothing more once the reset lands.

The façade spec's *a bring-up superseded by a reset or a newer bring-up*
holds the façade over spied providers, holding only keyed calls:

- no arm once a reset overtakes the key read, Gemini's arm or OpenAI's;
- only the next account's key when the previous read lands after it;
- only the newer of two bring-ups over one read arming, each provider once;
- no Gemini model switch arming once a reset overtakes its read;
- and two pins: a model switch, and a typed key, during a bring-up do not
  stop it.

A second top-level describe, *CloudLLMProviderService over the real
providers*, runs the real three behind one gate over fake SDK modules with no
transport: a reset while Gemini imports leaves every provider down and builds
no client; the next account, coming up while the previous one is parked,
holds only its own key; and a reset while OpenAI imports leaves Claude
unimported. The smoke's *starts no further arm on the departing account's
keys once its Gemini import lands* holds A's bring-up in Gemini's real import
with an OpenAI key still to arm, and finds nothing up and OpenAI's SDK never
asked for.

Each check was shown to bite. Removing the one after the key read, after
Gemini or after OpenAI failed its own case; removing the one after Gemini
also failed the second smoke. Capturing the count on entry without moving it
failed only the two-bring-ups case. A model switch or a typed key that moved
the count failed its pin. Removing the reset's move failed every case with a
reset and no second account.

### No stored Gemini key clears Gemini

`fix: a Gemini model switch or a cleared key with no stored key leaves Gemini
down` makes the two remaining keyless paths agree with the bring-up's
(`:120-123`):

- **`reinitializeGemini`** clears Gemini when its read finds no key
  (`:206-209`).
- **`updateProviderApiKey('gemini', …)`** clears it for a missing or empty key
  (`:164-170`). The test is truthiness, because `initializeGemini` computes
  `customApiKey || environment.geminiApiKey` (`gemini.service.ts:82`), so an
  empty string falls back exactly as `undefined` does.

Two pins flipped: *clears gemini for an undefined key rather than re-arming
it* and *reinitializeGemini clears Gemini when there is no stored key*. In the
real-provider describe, *with a build that ships its own Gemini key* sets a
fake build key inside each case: *a cleared key leaves Gemini down*, *a model
switch with no stored key leaves Gemini down*, and a pin, *a keyless bring-up
leaves Gemini down*, which fails once the bring-up's `clear()` becomes
`reinitialize(undefined)`. No smoke can show any of it: every smoke strips the
build's key ([0134](0134-an-emulator-run-carries-no-provider-key.md)), so
arming from it and clearing look the same there.

### The build's own key at start-up

`GeminiService`'s constructor still arms from the build's key
(`gemini.service.ts:72`, `:82`), taking an arm like any other. The first
bring-up to reach Gemini arrives with a clear or with the account's own key.
That is the one the strategy starts in its constructor
(`ai-strategy.service.ts:178`), unless an account is already signed in then:
the effect's bring-up (`:253-263`) takes the newer generation, and the
constructor's returns at its first check
(`cloud-llm-provider.service.ts:114`) without reaching Gemini. Either way,
the bring-up that reaches it supersedes the environment arm if its SDK has
not landed, or clears or replaces its client if it has, so the build's key
does not outlive start-up. Every Gemini arm the façade makes now carries a
key (`cloud-llm-provider.service.ts:117`, `:166`, `:210`), so nothing else
reaches the fallback.

Before, the environment arm survived a signed-out start-up: its chunk landed
after that bring-up's clear, and Gemini stood on the build's key until the
first signed-in bring-up. Nothing runs AI signed out. On a build that ships
a Gemini key, the constructor still starts the fetch of Gemini's SDK chunk at
start-up, for an arm the first bring-up always supersedes. The chunk stays a
lazy one, and the first keyed arm reuses it.

### The key service re-checks the account

`fix: a provider key read or write that lands after an account change leaves
the next account's keys alone` adds three checks to `ProviderKeyService`,
each `this.authService.userId() !== userId`:

- **`load`** (`provider-key.service.ts:93-121`) checks once on its way to the
  cache, right before the write (`:100-103`), so that one check comes after
  every await: the read (`:95-97`) and `migrateFromPreferences` (`:98`),
  which itself awaits its `setDocument` (`:207`) and
  `clearStoredProviderApiKeys` (`:213`). It checks again first in the failure
  branch (`:110-112`), before the warning and the flag.
- **`setKey`** (`:129-166`) returns right after its write is acknowledged
  (`:142-146`), before it reads `known`. So neither the write-through nor the
  `!known` branch's `clearCache()` (`:148-155`) runs for an account that has
  left.
- **What the caller gets.** A departed `load` resolves `{}`, so its caller
  gets no keys. It has three callers: a bring-up
  (`cloud-llm-provider.service.ts:109`) and a model switch (`:203`), which
  the façade's count also guards, and the settings page's key display
  (`ai-settings-page.component.ts:244`), which checks nothing of its own. A
  departed `setKey` resolves; its write landed in the account that made it.
- **It compares `userId()`,** as a consumer of the identity, not the SDK's uid
  (0052). Signed out and back in as the same account, the ids match and the
  write goes ahead: the keys are that account's own.

*a read or write that lands after an account change* holds seven
interleavings, each with a held Firestore call: a departed save leaves the
next account's cache, its flagged failure and its read in flight alone; a
departed read, good or failed, leaves the next account's keys and flag
alone; and a migration write landing after the change leaves the next
account's keys in the cache. Moving the `setKey` check below the `!known`
branch fails the two cases with no read yet. Checking `load` after the read
alone fails the migration case. Removing the failure branch's check fails
the case where the next account's read was good.

### The reference docs

This record's commit, `docs: ADR 0179 and the references the provider guards
changed`, brings the reference docs to the code:

- **`auth.md`:** a section, *The AI providers across an account change*,
  after *Sign-out*; *What this does not cover* now says where the providers
  and `ProviderKeyService` stand; and the cross-await checklist asks whether
  a write arms a provider client;
- **`ai-models.md`:** the provider, façade and two-account rows in *Where it
  is tested*;
- **`receipt-import.md`:** a sentence in the drain's wait on superseded
  bring-ups;
- **`performance.md`:** all three SDKs load through `loadSdk`.

## What was rejected

- **One counter on the façade, clearing what a superseded bring-up armed**,
  as the issue proposed. The client is built inside each provider, after that
  provider's own import, so a façade check after `await reinitialize(…)` runs
  once A's client already stands. Clearing it then would also wipe the next
  account's own arm of that provider, wherever B's bring-up had reached it
  first. The façade can stop further arm calls; only the provider can refuse
  the arm already under way. So there are two guards.
- **Comparing uids.** The providers are handed a key, never an account, so a
  check after a provider's import has nothing to compare unless an account is
  threaded into every arm. It would still pass a sign-out and sign-in back as
  the same account: a bring-up that read the keys before the sign-out would
  go on beside the one the new sign-in starts, after the readiness wait had
  answered for that one, and its later calls would override the keys just
  read. The count refuses it and loses nothing, because the new bring-up
  reads the keys afresh. 0052's reason against a counter is that its refused
  read is the recovery; here the refused arm is a duplicate.
- **`resetProviders` awaiting the bring-up in flight.** The teardown would
  wait on the arm it exists to undo: A's client would come up after the
  sign-out and stand until A's bring-up finished, for as long as its key read
  and its imports took, and only then would the reset reach it. Worse, the
  strategy does not await the reset, so B's bring-up could start inside that
  wait, and the deferred clear would land after it and tear down B's own
  arms.
- **Cancelling the import.** A dynamic `import()` cannot be cancelled. What
  can be refused is the arm after it, as 0052 refuses the write after a read
  it cannot cancel.

## Consequences

- **A readiness answer is no longer overturned by a late arm.** Once
  `cloudProvidersReady()` answers for an account's bring-up, no bring-up begun
  before it, and no arm a reset or that bring-up superseded, changes the
  providers afterwards. In the issue's case B's wait answers with nothing up,
  and nothing comes up.
- **The build's own Gemini key arms nothing for an account.** On a build whose
  environment carries one, Gemini stays down until an account's own key arms
  it. A user who removes their key sees Gemini go down at once, where before a
  cleared key, or a model switch with no key stored, fell back to the build's
  key until the next reload.
- **A superseded import is not cancelled.** Its chunk still loads; only its
  arm is refused. A key read whose account has left still completes, and
  resolves `{}`.
- **A key read that fails after its account left logs nothing**: the check
  comes before the warning.
- **The initial bundle.** Measured per input from the build's stats against a
  rebuild of `b8d400ac`: `gemini.service.ts` took 194 bytes,
  `cloud-llm-provider.base.ts` 130, and `openai.service.ts` and
  `claude.service.ts` 110 each, for the arm counter, its checks and Gemini's
  seam; `provider-key.service.ts` took 127 for the three checks.
  `cloud-llm-provider.service.ts` took 375, for the bring-up counter, its
  checks and the two clears, and with them the outcome #497 added; the stats
  do not split one input by commit. The strategy changed only in comments.
  With #497's work the warning moved to 2.411 MB, and with the
  whole-branch review's fixes to 2.412 MB;
  [../performance.md](../performance.md) records the measured figure.

## What the browser run found

The run of 2026-10-19, in the emulator venue, drove journey 97 on this
branch's code. Signed in as Alex on `/ai`, with the device offline, it held
the bring-up for Alex's offline attempt at OpenAI's import: an in-page fake
SDK module with no transport, behind a patched key read that answered a fake
key, which never left the page. The import had been asked for once, and the
strategy's attempt read Alex's offline state. By **Sign Out** it had been
asked for twice: journey 97's second run traced the second load to the
online attempt's bring-up, started at the first interaction after that
reading, once the device read online again, and parked at the same gate; the
visibility re-check that puts the device back online is read from the code
(`pwa.service.ts:76-80`), as journey 97's step 1 says. **Sign Out** from the
header landed on `/login` with no reload, and only once the strategy's
attempt read `null`, which only the sign-out branch sets, right after the
reset, was the import released. The reset superseded both arms.
Every provider stayed down, OpenAI's client was null, and the fake SDK's
constructor never ran. Releasing before that point passes on the unfixed code
too, which is why the journey waits for it. The run found no defect in this
record's work.

## Departures from the issue

- **Two guards, not one chokepoint**, and no clear after the move (see *What
  was rejected*).
- **Wider than the route the issue named.** The late key read and the parked
  import's fresh arms, the failure branches, the model switch, the build's
  key and the key service's own writes are covered by the same rule.
- **The readiness wait needed no change**, as the issue expected; only the
  strategy's sign-out comment changed.
- **The rule is named in `auth.md`**, beside the identity rule it extends,
  and `ai-models.md` lists where it is tested.

## Things that only became apparent while building

- **The first smoke passes with the provider guard alone.** In it every stale
  bring-up has already called `openai.reinitialize` before the switch, so the
  reset's keyless reinitialise and the next bring-up supersede that arm
  inside OpenAI. Only the second smoke, parked in Gemini with OpenAI still to
  arm, needs the façade's count.
- **The next account's entry supersedes the departing bring-up even without
  the reset's move.** With that move removed, the cases where a second
  account comes up still pass, because its bring-up moves the count on entry;
  every case with a reset and nothing after it fails. A sign-out with no
  sign-in after it, journey 97's case, needs the reset's move.
- **The strategy's first bring-up is not always signed out.** In the second
  smoke A is signed in before the strategy is built, and before the fix both
  the constructor's bring-up and the effect's went on to import OpenAI for A.
  The strategy's sign-out comment describes the signed-out start-up; the
  environment arm is superseded, cleared or replaced either way.
- **A check after the read alone is not enough in `load`.** The preference
  migration writes the merged keys and awaits that write, so a check placed
  before it let a change during that write cache the departed account's keys.
  The migration case fails on that placement as well as on the unfixed code.
- **A flag staged true cannot show a departed failure.** A failed read always
  set the flag, so a case that staged the next account's flag true and failed
  the departed read passed on the unfixed code. The case stages it false from
  a good read, and a second case stages it true and lets the departed read
  land with keys, which used to clear it.
- **The keyless reinitialise has to take an arm.** Without it, a sign-out's
  keyless reinitialise of OpenAI or Claude left an arm already loading free
  to land.

## Known gaps

- **A direct change from one account to another keeps a short window.** With
  no signed-out step between them, nothing resets. The next account's
  bring-up stops the departing one's further arm calls on entry, but an arm
  of the departing key already loading its SDK applies when it lands, and
  stands until the next bring-up reaches that provider. A drain waits for
  that bring-up and is not affected; a search or a scan made inside the
  window would go out on the departing key. Inferred unreachable, and not
  tested: on the web an account change the page did not start reloads it
  (0163), the page's own change passes through sign-out, and on a device a
  session the SDK ends runs the null branch.
- **Claude's checks have no smoke.** The first smoke parks in OpenAI's import
  and the second in Gemini's. Claude's checks, after its import and in its
  failure branch, are held by `claude.service.spec.ts` alone, each shown to
  bite, and the façade's stop before Claude's arm by the façade spec.
- **A Test press reports availability, not the typed key.**
  `testGeminiApiKey`, `testOpenaiApiKey` and `testClaudeApiKey`
  (`ai-settings-page.component.ts:349`, `:382`, `:415`) arm the typed key
  through `updateProviderApiKey` and then read `isProviderAvailable`. When a
  later arm supersedes the typed one, a bring-up's or a reset's, the press
  resolves without arming it and reports whether the provider is up on
  whatever it holds: the stored key, or nothing. Even unsuperseded, building a
  client is local, so the press never learns whether the vendor accepts the
  key.
- **The browser run does not drive a sign-in during a held import.** A run
  never signs in through the app: it writes a seeded account's session
  record, which reaches a page only through a load
  ([e2e.md's *Signing in a seeded account*](../e2e.md#signing-in-a-seeded-account)),
  and any other open page reloads itself on an account change it did not
  start
  ([0163](0163-a-page-reloads-on-an-account-change-it-did-not-start-and-the-web-keeps-the-session-in-local-storage.md)).
  A load discards the in-page fake SDK, its held gate and the `window` flag
  the Pass reads. The web's only sign-in through the app is Google's popup
  (`auth.service.ts:488-493`). Journey 97 runs in a pane, where the popup
  opens no window and takes the app's own tab, a load like any other
  ([e2e.md's *A pane opens no popup*](../e2e.md#panes-and-viewports)). In a
  full desktop window it could sign the next account in without a load, as
  the page's own account change, but the protocol does not drive this
  journey there: the next account's own bring-up would read the same patched
  key through the same gate, so its own arm would set the flag the Pass
  reads. So journey 97 shows the departing half alone: a real sign-out over
  a fake import and a patched key read. The two-account race is held by the
  two smokes, whose keys the emulator really stores, and by the unit specs.
- **`deleteAll` clears the key cache with no account check.** The account
  deletion cascade's one call (`account-deletion.service.ts:156`) awaits the
  delete of the secrets document and then calls `clearCache()`. An account
  that signed in during that await would lose its cached keys, its read in
  flight and its failure flag. It only forgets, never arms, and it is not
  reached in practice: the Firestore SDK settles a departed account's write
  only once that account is current again.
