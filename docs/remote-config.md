# Firebase Remote Config

The app uses [Firebase Remote Config](https://firebase.google.com/docs/remote-config)
for tunable product knobs — values that should be adjustable from the
Firebase console without shipping a release (relevant on iOS, where a
release means an App Store review).

## Current parameters

| Parameter | Type | In-app default | Meaning |
|---|---|---|---|
| `free_tier_receipt_image_limit` | number | `200` | Max stored receipt images for free-tier users |
| `premium_receipt_image_limit` | number | `0` | Max stored receipt images for premium users; `0` = unlimited |

The single source of truth for keys and defaults is
[`RemoteConfigService`](../src/app/core/services/remote-config.service.ts).
Keep this table in sync when parameters change.

**These two keys have a second consumer.** Since the receipt quota moved
server-side, the Cloud Storage triggers in `functions/src/index.ts`
(`onReceiptImageFinalized` and `onReceiptImageDeleted`) read the same two
parameters through the Remote Config **admin** API and write the resolved
limit into a function-owned Firestore document that `storage.rules` enforces
on every upload; `functions/src/receipt-quota.ts` holds the key constants and
the pure per-tier limit resolution the triggers call. The parameters
themselves are unchanged; what changed is who acts on them. Two things
follow:

- **The key strings are duplicated in `functions/src/receipt-quota.ts` and must
  stay identical to the client's.** Two halves reading different keys would
  disagree about who is over the limit.
- **The server half reads `defaultValue` only.** Conditional values resolve
  against a client's context (app, platform, audience), which a trigger does
  not have; a limit set only as a conditional value reaches the client and not
  the enforcement. Its fallbacks are 200 and 0, matching the in-app defaults.

[receipt-quota.md](receipt-quota.md) is the reference for the quota itself.

## How it works

- `provideRemoteConfig` is registered in `app.config.ts`; all fetch
  policy, in-app defaults, and typed accessors live in
  `RemoteConfigService`.
- On first injection the service sets the in-app defaults, then runs
  `fetchAndActivate()` once. Values are exposed as **computed signals**
  (`freeTierReceiptImageLimit()`, `premiumReceiptImageLimit()`), so
  consumers such as `ReceiptQuotaService.imageLimit` re-evaluate
  automatically when the fetched template activates.
- The minimum fetch interval is **12 hours** (the recommended default):
  a changed console value reaches a given client on its next app start
  after the cached template expires — not instantly. Don't use Remote
  Config for anything that must propagate immediately.
- If the fetch fails (offline start, throttling) or the project has no
  template at all, the in-app defaults apply silently. Deployments on
  their own Firebase project therefore work with zero setup.

## Changing a value

Firebase console → **Remote Config** → add/edit the parameter → **Publish
changes**. Number parameters should be entered as plain numbers. Every
publish creates a template version; use the version history to roll back
a bad value. Conditional values (per platform, app version, percentage
rollout) and A/B experiments can be attached to a parameter in the same
screen without code changes.

## Adding a new parameter

1. Add the key constant and its in-app default to `RemoteConfigService`
   (`defaultConfig` in `initialize()`), and expose a typed computed that
   depends on `this.activated()`.
2. Validate the remote value before trusting it (see
   `readPositiveNumber` — a console typo must never break the app).
3. Read the computed from the consuming service/component.
4. Cover it in `remote-config.service.spec.ts` (the spec substitutes the
   SDK-call seams `fetchAndActivateConfig` / `getNumberValue`, so no
   Firebase app is needed).
5. Update the table above.

Nothing needs to be created in the console up front — the in-app default
serves until someone publishes the parameter.

## What NOT to put here

- **Secrets** (API keys, tokens): every client can read all parameters.
- **Entitlements**: whether a user *is* premium lives on their Firestore
  user document (`subscription.tier`), written only by a trusted backend
  once billing exists. Remote Config decides what each tier *gets*
  (limits, flags) — never which tier a user is.
- **Security-critical enforcement**, unless something trusted reads the value
  too. A parameter read only by the client is a suggestion: every client can
  read all parameters, and a modified one can ignore any of them. The receipt
  limits used to be exactly that; they are now resolved server-side as well and
  enforced by `storage.rules` ([receipt-quota.md](receipt-quota.md)), and the
  client-side reading survives only as a UX courtesy — it keeps the UI from
  offering an upload that would be refused. A new limit that must actually hold
  needs a trusted reader of its own; putting it here is not one.
