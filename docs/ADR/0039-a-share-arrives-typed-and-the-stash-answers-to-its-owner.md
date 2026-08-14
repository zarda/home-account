# 39. A share arrives typed, and the stash answers only to its owner

**Status:** Accepted, implemented · **Date:** 2026-08-14 · **Issues:** #261, #253

Reference documentation lives in [../share-import.md](../share-import.md).

## Context

Two defects lived in the share pipelines ADR 0019 built, one per concern it
did not finish.

Every image shared into the app on iOS arrived typed
`application/octet-stream`. The extension matched attachments against
abstract accepted types and asked the match for its MIME —
`UTType.image` is `public.image`, which declares none, so the fallback fired
for every image, every time. The string travelled sidecar → plugin → `File`
→ `data:application/octet-stream;base64,` — and all four prefix strips in
the tree were anchored on `data:image/`, so native OCR rejected the payload
outright and every cloud provider was handed junk (#261). The wizard's five
image predicates were anchored on `type.startsWith('image/')` the same way:
a shared photo got no preview, no receipt-versus-statement chooser, no
multi-image merge, and no `receipt_import` event — the iOS share pipeline
was silently absent from the reliability metric 0019 says it feeds. HEIC —
the iPhone camera default — appeared in no accept list at all, and the
plugin's drain deleted every file unconditionally, so a rejected share was
destroyed unconsumed.

The stash had no owner. `StashedShare` carried five fields and no uid, the
store's reads were whole-database operations, and the navigation effect
keyed on *a* session existing, not the session that made the share — so a
receipt stashed by one account (or stashed signed out) was surfaced,
previewed, and consumed by whoever signed in next on the device (#253).
Nothing cleared the stash at sign-out or account deletion; the deletion
parity spec never forced the question because no cascade step existed. The
offline queue fixed this exact defect in #164 — `userId` on every row,
reads scoped through an injected session, a version bump dropping ownerless
rows — in a store that shipped before this one.

## Decision

**The extension names what it actually saved.** `stash` resolves the
delivered file's concrete type (`contentTypeKey`, then the filename
extension) and falls back to the matched abstract type only after that.
`.jpeg` now leads the accepted types so `loadFileRepresentation` asks the
provider to transcode — an iPhone camera HEIC arrives as JPEG — with
`.image` right behind it for images that have no JPEG representation. The
sidecar also gains `receivedAt`, because the claim policy below needs an
age.

**Every image gate tests MIME or extension, from one helper.**
`looksLikeImageFile` in `file.utils.ts` replaces the five
`startsWith('image/')` predicates (wizard ×4, dropzone), and
`detectFileType` shares its extension list. The provider strips accept any
`data:<mediatype>;base64,` prefix; OpenAI re-declares a non-image data URL
as the JPEG it carries; the Vision OCR plugin's regex widens the same way.

**The stash is scoped to the session that made it.** `StashedShare` gains
an optional `userId`; the store (schema v2) injects the session and filters
every read: an owned row is visible only to its owner, an ownerless row —
legal by construction, since neither the service worker nor the extension
can see auth state — is claimable by the next session only while fresher
than a **30-minute window** on `receivedAt`, and expires unconsumed past
it. The v1→v2 upgrade drops pre-ownership rows rather than guessing an
owner. The worker stamps new rows from a `session` row the app publishes on
every auth change; `consume()` deletes exactly the rows it returned, in the
transaction that read them.

**Native consumption is fetch → decide → complete.** The plugin returns
waiting files without deleting; the web layer claims what the window
allows and names everything it is done with — claimed and expired alike —
to `completePendingShares`. Unparseable sidecars and orphaned payloads are
swept as wreckage instead of being re-walked forever. A new
`clearPendingShares` empties the container for the **`shareStash` deletion
step**, which joins the cascade beside the other device-local stores and is
catalogued in `NOT_A_RECORD_KIND`.

Rejected: **re-stamping rows at drain time** (the consumer cannot know the
writer's session); **a signOut hook** (seven services state the repo
convention — state is cleared from the owning service, not from
`signOut()`); **a postMessage channel to the worker** (a row in the
database both sides already open does the same with no new plumbing);
**unlimited claim** (the disclosure #253 exists to close); **dropping all
ownerless shares** (kills the signed-out share flow 0019 deliberately
bought); **claim-by-stamping-on-first-sight** (turns every count into a
write and assigns a file to a session that only glanced at it).

## Consequences

- A shared photo behaves like a picked one end to end: preview, chooser,
  multi-image merge, both OCR engines, and the `receipt_import` event.
- The claim window is the entire ownership story for iOS shares — the
  extension runs in another process and can never stamp a uid. A share
  older than 30 minutes with no owner is deleted unconsumed, on both
  pipelines; within the window, the single-user flow works unchanged.
- A failed `completePendingShares` re-offers the same files on the next
  activation — a duplicate offer the review step absorbs, strictly better
  than the old delete-first ordering that destroyed shares nobody saw.
- The stash schema now lives in three places (store, worker, extension
  sidecar), all version-locked by hand; the worker and the store must ship
  together.

## Departures from the issues

- #253 asked for `clear()` to filter by uid. `clearAll()` stays total —
  it exists for the deletion cascade, where erasure is device-scoped — and
  the scoping lives in `readAll`/`count`/`consume` instead.
- #261's HEIC criterion ("never deleted without being imported") is
  bounded by the claim policy: a Photos HEIC imports normally via the
  `.jpeg`-first transcode, but a raw HEIC from the Files app is stashed as
  `image/heic`, rejected at the accept gate, and completed — and any share
  past the window is deleted unconsumed. Stated in share-import.md rather
  than silently.
- A rejected-but-fresh native file is completed rather than left pending:
  leaving it makes `checkPendingShares` count it forever and the
  navigation effect nag an empty wizard on every activation.
- #253 predicted the arbitrary-uid navigation spec would fail against a
  correct implementation. It stays green as written: the chokepoint moved
  into the store (the issue's own primary ask), which that spec mocks —
  the policy is pinned by the store's own real-IndexedDB spec instead.

## Known gaps

- A stale cached worker pinned at v1 cannot open the v2 database: that
  share is lost with the existing `error=1` redirect. The window lasts
  until the browser re-fetches the worker, roughly one navigation.
- Extension rows are ownerless by construction; the claim window is the
  mitigation, not attribution.
- CI never builds iOS — the Swift half is verified by a local build and
  the simulator procedure in share-import.md.
- The 10 MB/type gate still applies at consumption, not in the extension.
- `checkPendingShares` counts expired shares until the next consume, so
  one empty wizard visit is possible after a share goes stale.
- The session row can be stale at boot only when the token expired while
  the app was closed — the row was cleared at the last sign-out, so the
  wrong-stamp window is that narrow case, not ordinary account switching.
