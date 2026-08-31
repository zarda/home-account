# The receipt image quota

Each account may keep a bounded number of receipt images in Cloud Storage. The
bound is enforced by `storage.rules`, which reads a count that two Cloud
Storage triggers maintain — so the limit holds against a raw Firebase SDK
client, not only against this app's UI.

The short version: **the count is recounted from the bucket on every object
event, and the rules read it.** `ReceiptQuotaService` in the client still
exists and still stops the UI early; it is the fast, friendly answer, no longer
the only one.

Why it is a recount rather than a counter, and what was rejected on the way, is
in [ADR 0094](ADR/0094-the-receipt-quota-is-recounted-from-the-bucket-it-limits.md).
This document is the part you need when reading a live quota, deploying the
triggers, or changing the limits.

## The document

`users/{uid}/quota/receiptImages`, written **only** by the storage triggers
through the Admin SDK.

| Field | Meaning |
|---|---|
| `count` | objects currently under `users/{uid}/receipts/`, as of the last recount |
| `limit` | the limit in force for this account's tier; **`0` means unlimited** |
| `updatedAt` | server timestamp of the last recount |

`firestore.rules` lets the owner **read** it — you are entitled to see the
figure being enforced against you — and lets nothing client-side write it. The
Admin SDK bypasses rules, so no `allow` admits the triggers.

Two constraints hold this shape together, and both break quietly if changed:

- **The document is written whole, with `set()` and never a merge.** The rule
  reads both fields; reading an absent field errors, and an erroring rule
  denies. A partial write would not leave a stale figure — it would lock the
  account out of uploading entirely.
- **`quota` is in the catch-all carve-out list in `firestore.rules`.** Rules
  are additive, so without that entry the `write: if false` on this path is
  decorative and the catch-all grants the owner writes anyway.

## The triggers

`onReceiptImageFinalized` and `onReceiptImageDeleted` in
`functions/src/index.ts`, both calling one recount.

**They recount rather than increment.** The trigger lists the user's bucket
prefix and writes the length. A missed or duplicated event corrects itself on
the next one, and the figure counts objects that actually exist — which is what
the client's old Firestore-based count could not do, since an object no
transaction referenced was invisible to it and still occupied storage.

**Both pin `region: 'us-west1'`**, overriding the workspace's global
`asia-east1`. The bucket is `home-accounter.firebasestorage.app` and lives in
`us-west1`; Eventarc requires a storage trigger to run in its bucket's region,
so on the inherited region these do not merely run far from the data — they
fail to deploy. Do not tidy either constant back into `setGlobalOptions`.

**Both set `concurrency: 1`, and it is load-bearing.** `maxInstances: 1` comes
from the global options and caps how many *instances* run; on its own each
instance still serves the Cloud Run v2 default of 80 requests at once, and the
recount `await`s twice before it writes. Two uploads would interleave at those
awaits and the older count could land last, persisting until the next object
event. `concurrency: 1` is what makes an instance handle one event at a time.
The two together give a single serialized worker; drop either and that is gone.

To check what actually deployed, read the built endpoint metadata:

```bash
cd functions && npm run build
node -e "console.log(require('./lib/index.js').onReceiptImageFinalized.__endpoint)"
```

`concurrency` must read `1`, not `ResetValue`, and `region` must read
`us-west1`.

**A v2 storage trigger has no server-side path filter**, so every object event
anywhere in the bucket invokes both functions. `receiptOwnerOf` is what returns
early for anything that is not a receipt; it is mandatory, not defensive.

**A recount for a user document that no longer exists deletes the quota
document instead of writing it.** Account deletion sweeps every receipt object
and only then deletes the user document, so these deletes keep arriving after
the account is gone — and a write there would recreate `users/{uid}` as a ghost
the deletion cascade has no step to sweep.

## How the limit is resolved

Two halves, and they answer different questions:

- **Which tier the account is on** comes from `subscription.tier` on the user
  document. Never from Remote Config — see
  [remote-config.md](remote-config.md#what-not-to-put-here).
- **What that tier gets** comes from the Remote Config parameters
  `free_tier_receipt_image_limit` and `premium_receipt_image_limit`, with
  fallbacks of **200** and **0** (unlimited) baked into the function.

The keys must stay identical to the client's in
`RemoteConfigService`, or the two halves of the quota would read different
numbers and disagree about who is over the limit.

Parsing is deliberately strict. Remote Config stores every value as a string,
number-typed parameters included, and `Number('')` is `0` — which is the
unlimited sentinel, so a parameter someone cleared in the console would hand
every free account an unlimited quota. Only a non-empty string parsing to a
non-negative integer is accepted, per key, and `0` is additionally refused for
the free tier, where reading it literally would lock every free account out of
the feature instead.

**Only `defaultValue` is read.** Conditional values resolve against a client's
context — app, platform, audience — which a trigger does not have and cannot
fabricate. A limit set only as a conditional value will not reach the
server-side half.

The resolved limits are cached per instance for five minutes. There is no
published template on this project today, so `getTemplate()` always fails and
falls back; the fallbacks are cached alongside a success precisely so that
failing call does not run on every upload and every delete.

## What the rules allow

In `storage.rules`, on `users/{userId}/receipts/{fileName}`:

| Operation | Quota checked? |
|---|---|
| `create` (a new object) | **yes** |
| `update` (overwriting an existing object) | no — an overwrite does not grow the count, so an account at its limit can still re-shoot a blurred photo |
| `delete` | no — deleting is how an account gets back under the limit |
| `read` | no |

Size (2 MB) and content type (`image/*`) apply to both write branches
regardless.

`underReceiptQuota()` passes when **any** of three things is true: the document
does not exist, `limit == 0`, or `count < limit`. The `limit == 0` case is the
premium tier's unlimited sentinel, stored verbatim because neither JSON nor a
rules expression carries an infinity — compared as a number it would deny every
upload a paying account makes.

The repeated `firestore.get()` of one path costs **one** billed read; rules
serve the rest from a per-evaluation cache.

### The emulator disagrees about overwrites

The create branch carries `(resource != null || underReceiptQuota(userId))`.
That first clause is provably inert in production — Cloud Storage splits
`create` from `update` on exactly the condition that no object is there, so
`create` implies `resource == null`. It exists because the **storage emulator
routes every upload through `create`** and hands the object being replaced in
as `resource`. Without it, the overwrite exemption would be unreachable by any
test this repo can run.

The other side of the same fact: the `allow update` branch cannot be reached by
an emulator upload at all, so the smoke suite pins it through `updateMetadata()`
instead. See [emulator-blind-spots.md](emulator-blind-spots.md).

## Deploying

This is a `functions/**` change, so a merge to `main` fires `deploy-functions`
([deploy.md](deploy.md)). `storage.rules` and `firestore.rules` ride
`deploy-web`. Both jobs run for a merge that touches both.

Three things the pipeline will not do for you:

**1. The cross-service IAM grant, once.** `firestore.get()` from
`storage.rules` requires the Cloud Storage service agent to hold read access to
Firestore. An interactive `firebase deploy` **prompts** to grant it; CI's
non-interactive deploy will not, and the rules will deploy and then deny every
upload with a permission error that names Firestore rather than the quota.

Run **one interactive `firebase deploy --only storage` from a workstation and
accept the prompt** before relying on the CI path. The prompt names the exact
principal and role, which is the authoritative version of what to grant if you
would rather do it by hand in the Google Cloud console. It is needed once per
project, not once per deploy.

**2. The first `us-west1` deploy provisions Eventarc in a new region.** These
are the project's first functions outside `asia-east1`. Expect the first deploy
to take noticeably longer, and expect a possible prompt for a service-agent
permission. If it fails, re-running after the permission is granted is safe —
the deploy is idempotent.

**3. The overwrite path can only be verified live.** The emulator cannot take
the `update` branch on an upload, so this is a **named post-deploy check**, not
a test:

> Sign in to the live app as an account at its limit (or seed
> `users/{uid}/quota/receiptImages` to `count == limit` by hand), then replace
> an existing receipt image on a transaction. **The upload must succeed.** If
> it is refused, the create/update split is not behaving as production is
> assumed to, and the `resource != null` clause is doing more than standing in
> for the emulator.

Two checks worth running with it, both quick:

- Upload a new receipt on that same account. It must be **refused**.
- Delete a receipt, then upload one. It must **succeed** — the recount runs on
  the delete, so the second attempt sees a lower count.

## Known gaps

- **The bootstrap window fails open, and a burst can exceed the limit.** There
  is no quota document until the first object event, and a missing document
  allows uploads. So a client uploading in parallel from a standing start can
  pass its limit; the first recount then records the true count and the door
  closes. **Nothing deletes the overage** — the account simply sits above its
  limit until it deletes something. This is the accepted cost of not denying
  every new user their first receipt, and of not denying an account that has
  deleted all of its receipts.
- **A tier change does not take effect until the next object event.** The
  `limit` field is only rewritten by a recount, so an account upgraded to
  premium keeps its free-tier limit in the document until it next uploads or
  deletes something. The remedy is known and deliberately deferred: a
  `users/{uid}` document trigger that rewrites the quota document when
  `subscription.tier` changes. It belongs with the billing work — premium is
  not purchasable yet, so today the only way to change a tier at all is to edit
  the document by hand, and whoever does that can touch a second document.
- **App Check is not enabled.** The quota survives a raw SDK client, which is
  what it was built for. It does not distinguish this app from any other client
  holding a valid user token.
- **The recount lists the whole prefix on every object event.** For an account
  near the free-tier ceiling that is a listing of up to 200 objects per upload
  and per delete. Fine at this scale; the first thing to revisit if the limits
  rise by an order of magnitude.
- **The client's own count is a separate figure.** `ReceiptQuotaService` still
  aggregates over transactions carrying a `receiptUrl`, which can differ from
  the authoritative count when an orphan object exists. The UI may therefore
  offer an upload the rules refuse. The refusal is the correct answer; the
  mismatch is cosmetic and is not reconciled.
