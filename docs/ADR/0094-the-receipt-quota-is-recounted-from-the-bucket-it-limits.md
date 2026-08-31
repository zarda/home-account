# 94. The receipt quota is recounted from the bucket it limits

**Status:** Accepted, implemented · **Date:** 2026-09-01 · **Issues:** #137

## Context

`ReceiptQuotaService` counted a user's stored receipt images and stopped the UI
at the tier limit. It was the only thing standing between an account and
unbounded Storage spend, and it ran entirely in the client — so it failed open
in the plainest way available: a raw Firebase SDK client, or a modified build,
ignored it.

The count it used was wrong as well as unenforced. It was a Firestore
aggregation over transactions carrying a `receiptUrl`, so an object no
transaction referenced — a failed edit, an orphan from a deletion that stopped
half-way — was invisible to it and still occupied the user's storage. The
figure being defended was not the figure being billed.

Enforcement has to be `storage.rules`, because that is the only thing on the
upload path a client cannot go around. `storage.rules` can read Firestore, so
the shape of the answer is fixed: something trusted writes a count where the
rules can read it.

## Decision

**Two Cloud Storage triggers own the count, at
`users/{uid}/quota/receiptImages`.** `onObjectFinalized` and `onObjectDeleted`
both call one recount.

**Recount, never increment.** The trigger lists the user's bucket prefix and
writes `files.length`. A counter incremented per event drifts on a missed or
duplicated delivery and never recovers; a recount is self-healing — the next
object event corrects whatever the last one got wrong — and it counts objects
that actually exist, which is what closes the orphan hole above.

**The document is written whole, with `set()` and never a merge.** The rule
reads two fields off it and an absent field errors, and an erroring rule denies
— so a partial write would lock the account out of uploading entirely rather
than leave a stale figure behind. That coupling is stated in both files,
because changing the write to an update breaks the rule at a distance.

**`concurrency: 1` on both triggers is what serializes the recounts, and it is
load-bearing.** This is worth being precise about, because the obvious reading
is wrong. `maxInstances: 1` is inherited from the workspace's global options
and caps how many *instances* run — it says nothing about how many requests one
instance serves. Left at that alone the emitted endpoint carries
`concurrency: ResetValue`, i.e. the Cloud Run v2 default of **80 concurrent
requests per instance**, and the recount `await`s twice before it writes. Two
uploads landing together interleave at those awaits: A lists five, yields, B
lists six and writes six, A resumes and writes five. The stale count lands last
and persists until the next object event — which, for a user who has stopped
uploading, is never. Both triggers therefore set `concurrency: 1` explicitly.
The two options together give a single serialized worker; dropping either one
loses that. The built `__endpoint` metadata is where this is checkable, and it
now reads `concurrency: 1` on both.

**Both triggers pin `region: 'us-west1'`, overriding the global
`asia-east1`.** The receipt bucket is `home-accounter.firebasestorage.app` in
`us-west1`. Eventarc requires a storage trigger's region to match its bucket's
location, so on the inherited region these do not merely run far from the data
— they fail to deploy. The bucket name is a named constant for the same reason:
the region has to be justifiable against something visible in the file rather
than against a default-bucket lookup.

**A missing quota document fails open, deliberately.** The triggers create it
on the first object event, so every account has a window with no document at
all, and an account that deletes all its receipts goes back to having none.
Denying there would cost every new user their first receipt. The window is real
and is documented rather than glossed — see Known gaps.

**`limit == 0` is the premium tier's unlimited sentinel, special-cased rather
than compared.** It is stored verbatim because neither JSON nor a rules
expression carries an infinity; read as a number it would deny every upload a
paying account makes.

**Only a new object consults the quota.** An overwrite does not grow the count,
so an account at its limit can still re-shoot a blurred photo; a delete is
never checked, because deleting is how an account gets back under the limit. A
quota that trapped an account at its ceiling with no way down would be worse
than no quota.

**The tier comes from Firestore, the numbers come from Remote Config.** That is
the split [../remote-config.md](../remote-config.md) already states: whether a
user *is* premium lives on their user document; what a tier *gets* is tunable.
The resolved limits are cached per instance for five minutes — `getTemplate()`
is a cross-region RPC, and with no template published for this project it is
one that always fails, so uncached it would add a failed call and a warning to
every upload and every delete on the path that is deliberately serialized. The
fallbacks are cached alongside a success for exactly that reason: caching only
the happy path leaves the failing call running on every event, which is the
cost the cache exists to remove.

**The parsing and the per-tier arithmetic live in a pure module with no imports
and no I/O**, so `node:test` can pin them and the trigger body stays thin — the
same split as `compose-feedback-email` beside `onFeedbackCreated`.

Rejected: **keeping enforcement in the client and calling it good enough.** It
is the state that shipped, and it is the state the issue was opened about.

Rejected: **a counter with `FieldValue.increment`.** Cheaper per event, and
unrecoverable once it drifts. There is no reconciliation pass to write, because
the recount *is* the reconciliation pass.

Rejected: **`maxInstances: 1` as the serialization mechanism.** It was the
plan, and it is not what serializes anything. See above.

Rejected: **a callable function the client asks before uploading.** It is the
client-side check with a network hop; nothing stops a client from not calling
it.

## Consequences

- `firestore.rules` gains a `quota` block: the owner may read the figure
  enforced against them, and nothing client-side may write it. The Admin SDK
  bypasses rules, so no `allow` has to admit the triggers. `'quota'` also joins
  the catch-all carve-out list in the same change — rules are additive, so
  without that entry the `write: if false` is decorative and the catch-all
  grants the owner writes to the path anyway.
- `ReceiptQuotaService` is unchanged. It is now the fast, friendly answer that
  keeps the UI from offering an upload that will be refused; it is no longer
  the only answer. [../remote-config.md](../remote-config.md) is corrected
  accordingly — those parameters now have a server-side consumer.
- `storage.rules`' create branch carries `(resource != null || underReceiptQuota(userId))`.
  In production that first clause is provably inert: Cloud Storage splits
  `create` from `update` on exactly the condition that no object is there, so
  `create` implies `resource == null`. It is there because **the storage
  emulator routes every upload through `create`** and hands the object being
  replaced in as `resource`. Without it, emulator and production would disagree
  about overwrites, and the overwrite exemption would be unreachable by any
  test this repo can run. Recorded in
  [../emulator-blind-spots.md](../emulator-blind-spots.md).
- The `allow update` branch cannot be reached by an emulator upload at all, so
  the smoke suite pins it through `updateMetadata()` instead — indirect on
  purpose.
- Seeding a document no client may write needed a door of its own: an
  emulator-only helper that writes through the Firestore emulator's REST API
  with the owner credential.
- These are the project's first `us-west1` functions. The first deploy
  provisions Eventarc in a new region and may prompt for a service-agent
  permission grant. [../receipt-quota.md](../receipt-quota.md) is the runbook.

## Things that only became apparent while building

- **A v2 storage trigger has no server-side path filter.** Every object event
  in the bucket invokes both functions, so the prefix check in
  `receiptOwnerOf` is mandatory rather than defensive — it is the only thing
  between an unrelated upload and a pointless recount.
- **`receiptOwnerOf` has to reject `.` and `..` as a uid.** A uid is an opaque
  identifier, never a relative path segment, and `..` there would send the
  `users/{uid}/quota/...` write somewhere else entirely. `storage.rules`
  already pins the owner to `request.auth.uid`, so this states the constraint
  rather than relying on it being inferred two files away.
- **Deletes keep arriving after the account is gone.** Account deletion
  ([0018](0018-account-deletion-is-a-client-side-cascade.md)) sweeps every
  receipt object and only then deletes the user document. Writing a quota
  document for a user that no longer exists would recreate `users/{uid}` as a
  ghost holding a subcollection, and the cascade has no step that would ever
  sweep it. The recount deletes its own document instead when the user document
  is absent.
- **A blank Remote Config parameter must not read as zero.** `Number('')` and
  `Number('  ')` are both `0`, which is the unlimited sentinel — a parameter
  someone cleared in the console would hand every free account an unlimited
  quota. Only a non-empty string parsing to a non-negative integer is accepted,
  and `0` is additionally refused for the free tier, where reading it literally
  would lock every free account out of the feature instead.
- **Conditional values are unreadable from a trigger.** Remote Config resolves
  them against a client's context — app, platform, audience — which a trigger
  does not have and cannot fabricate. Only `defaultValue` is read, so a limit
  set only as a conditional value will not reach the server-side half.
- **The error goes to the logger positionally.** `logger.error` reads a stack
  only off an argument that *is* an `Error`; nested inside the structured
  payload it serializes to `{}`, because `message` and `stack` are
  non-enumerable.

## Known gaps

- **The bootstrap window lets a burst past the limit.** Before the first object
  event there is no quota document, and a missing document allows uploads. A
  client uploading in parallel can therefore exceed its limit; the first
  recount then records the true count and the door closes. **Nothing deletes
  the overage.** This is the accepted cost of not locking new users out of
  their first receipt.
- **A tier change does not take effect until the next object event.** The limit
  is refreshed only by the recount, so an account upgraded to premium keeps its
  free-tier limit in the document until it next uploads or deletes something.
  The remedy is named and deliberately deferred: a `users/{uid}` document
  trigger that rewrites the quota document on a `subscription.tier` change,
  which belongs with the billing work — premium is not purchasable yet, so
  today the only way to change a tier is to edit the document by hand.
- **The cross-service read needs a one-time IAM grant.** `firestore.get()` from
  `storage.rules` requires the Storage service agent to hold Firestore read
  access. Grant it via one interactive `firebase deploy`, which prompts for
  it, before relying on CI's non-interactive path.
  [../receipt-quota.md](../receipt-quota.md) carries the procedure.
- **The overwrite path is only verifiable in production.** The emulator cannot
  take the `update` branch on an upload, so "an overwrite at the limit
  succeeds" is a named post-deploy check against the live project, not a test.
- **App Check is not enabled.** The quota now survives a raw SDK client, which
  is what #137 asked for. It does not distinguish a request from this app from
  a request from any other client holding a valid user token; that is App
  Check's job and it is a separate decision for the whole project, not for this
  path.
- **The recount costs a bucket listing per object event.** For a user near the
  free-tier ceiling that is a list of up to 200 objects on every upload and
  every delete. Acceptable at this scale, and the first thing to revisit if the
  limits ever rise by an order of magnitude.
