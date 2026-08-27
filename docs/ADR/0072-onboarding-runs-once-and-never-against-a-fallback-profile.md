# 72. Onboarding runs once, and never against a fallback profile

**Status:** Accepted, implemented · **Date:** 2026-08-27 · **Issues:** #83

Sits directly on top of
[0052](0052-a-profile-read-may-only-write-to-the-session-that-started-it.md)'s
degraded-session model, and settles the first-run consent prompt
[0003](0003-analytics-consent-and-taxonomy.md) left open once
[0004](0004-tier-gated-analytics.md) made it unaskable. Reference documentation
lives in [../onboarding.md](../onboarding.md); the degraded profile itself is
[../auth.md](../auth.md) under *The degraded profile*.

## Context

#83 asks for a first-run welcome, a persisted `onboardingCompleted` flag, and
empty states that link into the create flows. The dialog is the easy half.

The hard half is deciding *when* it is a first run, and the app has a state
that makes the obvious answer wrong. When the profile read fails — an offline
launch, a rules error, a quota error — `AuthService` keeps the session alive on
an in-memory fallback built by `buildNewUserProfile()`. That fallback carries
`DEFAULT_USER_PREFERENCES` and a `createdAt` of *now*, whatever the account's
real age. It is indistinguishable, field by field, from a genuinely new
account.

So "no `onboardingCompleted` in preferences" means first run *or* the profile
never loaded, and the two want opposite behaviour. Reading the fallback would
greet a two-year-old account as a stranger. Worse, the write that follows would
target a document this session never read — the exact shape
[0052](0052-a-profile-read-may-only-write-to-the-session-that-started-it.md)
exists to refuse, arriving from the other end.

## Decision

**The welcome opens only from a real profile, at most once per account per
session, and every way of closing it completes the first run.**

### The gate is `!profileDegraded()`, and a degraded session shows nothing

`OnboardingService.shouldShow` is a computed with four clauses, and the third
is the one worth naming:

```ts
const user = this.auth.currentUser();
if (!user) return false;
if (this.auth.profileDegraded()) return false;
if (user.preferences?.onboardingCompleted === true) return false;
return this.attemptedFor() !== user.id;
```

A degraded session shows nothing at all and **waits**. That costs nothing,
because `AuthService`'s retry effect clears `profileDegraded` when the real
profile arrives, and `shouldShow` — a computed, watched by an effect in
`MainLayoutComponent` — becomes true at that moment, or stays false because the
real preferences already carry the flag. Waiting is strictly better than
guessing here: the answer arrives on its own.

Rejected: **falling back to `createdAt`** — "welcome an account created in the
last five minutes". The fallback profile's `createdAt` is `now`, so the check
passes exactly when it must not.

### `attemptedFor` is keyed by uid, not a boolean

An account switch inside one session is a different first run and must re-arm;
a degraded→recovered transition for a uid already welcomed must not re-open the
dialog. A bare boolean can express one of those, not both.

It is set **before** the dialog opens, not after. Opening is what makes a
second read of `shouldShow` re-entrant, and the guard has to be standing by
then or two welcomes stack.

### Every close path completes the first run

`afterClosed()` persists `onboardingCompleted: true` whatever the reason —
Done, Skip, the close-X, the backdrop, Escape. **A first-run dialog that can
come back is a nag**, and every "did they mean it?" branch is a way for it to
come back.

The write is swallowed on failure with no toast. The flag simply stays absent
and the next launch offers the welcome again; the retry is the construction,
and a failed preference write is not the user's problem on their first minute
in the app.

Rejected: **persisting on Done only.** Skip is the path a user takes when they
have understood the dialog and do not want it — the strongest possible signal
that it should not return.

Rejected: **a `localStorage` flag.** #83 asks for per-user and persisted, and
the account is where per-user lives. A device-local flag re-welcomes on every
new device and forgets on a cache clear.

### Three panes on a signal, not a stepper

`stepIndex` plus `@if` panes and computed view guards (`isFirstStep`,
`isLastStep`, `canSkip`). Nothing else in the app puts a `mat-stepper` inside a
dialog; a stepper's header would duplicate the footer's own `1/3` indicator,
and its animation is one more thing to reason about on the very first surface a
new account ever sees. The computed-guard shape is the in-dialog idiom
`AiSearchDialogComponent` already uses.

### Every entry into a transaction goes through `QuickAddService`

The last pane's two calls to action close with a result (`'add'` / `'scan'`),
and `OnboardingService` runs them **after** the close, never over it — the
quick-add dialogs are the same `MatDialog` surface and would stack on a welcome
still animating out. Both branches call `QuickAddService`, as do the bottom
nav, the transactions page, the empty-state CTAs, the `n` hotkey and the
command palette. One config, one place.

Rejected, and recorded because it is the mechanism that already existed: **the
dashboard's `?action=add` navigation.** `TransactionsComponent` still reads
that query parameter and opens the add dialog behind a `setTimeout(…, 100)`.
Routing the welcome's CTA through it would mean a navigation the user did not
ask for, a timing race for the dialog, and a URL that re-opens the form on
reload. It stays for the deep links that use it; it is not the seam new callers
join.

### No analytics consent step

#113 asked for a first-run consent prompt, to be carried by this flow. It is
deliberately not here.
[0004](0004-tier-gated-analytics.md) made collection follow the tier — always
on for free accounts, opt-out for premium — so a first-run ask would
misrepresent a choice the free tier does not have. Presenting a toggle that
does nothing for most accounts is worse than not presenting one.
[0003](0003-analytics-consent-and-taxonomy.md)'s *No first-run consent prompt*
gap is rewritten to point here. The setting stays discoverable in Settings,
which costs opt-in rate but no privacy.

### Empty states link into the create flows

#83's second criterion, and it needed no new component: `EmptyStateComponent`
already accepted `actionLabel` / `actionIcon` / `(action)`, and six callers
already passed them. The two lists that most obviously should have — the
transaction list and the goals list — did not. They do now: the transactions
CTA through `QuickAddService`, the goals CTA into the same goal form the
page's own add button opens. The transactions CTA is shown for a genuinely
empty list *and* for filters that match nothing, which is right for both:
adding a transaction is still the one action worth offering.

## Consequences

- The welcome is owned by the authed shell. `/login` and `/lock` are top-level
  routes outside `MainLayoutComponent`, and `authGuard` has already waited out
  `AuthService.isLoading` before routing here, so there is no
  "welcome flashes over the login screen" case to guard against.
- An effect rather than a one-shot in `ngOnInit`, because a launch that started
  degraded becomes eligible only later, with the shell already mounted.
- The flag needs no rules change: `preferences` is validated as a map. A rules
  smoke assertion pins that the dotted update is accepted.
- Every existing account is welcomed exactly once, on its next launch. There is
  no backfill and none is wanted — an account that has been using the app for a
  year gets one dismissible dialog explaining three ways to add a transaction,
  which is a cheap cost for not writing a flag onto every user document.

## Things that only became apparent while building

- **The degraded profile is not merely stale, it is confidently wrong.** It
  reports a `createdAt` of now and a full default preferences map, so every
  heuristic that could stand in for the gate — age, emptiness of preferences,
  transaction count — reads exactly as a new account would. The explicit
  `profileDegraded` flag is the only thing in the system that knows.
- **"Marked before open" is not a style choice.** `shouldShow` is read by an
  effect; opening a dialog schedules work that re-enters change detection, so
  the guard has to be true before the open call, not in its callback.
- **The result and the completion are independent.** A CTA close still
  completes the first run, and a completion still runs the CTA. Folding them —
  "only Done completes" or "only a plain close completes" — produces a welcome
  that can return after the user has already started adding a transaction.

## Known gaps

- **The welcome teaches; it does not configure.** #83's summary mentions base
  currency and a first category or budget. Those are all editable in Settings
  and all have working defaults, and a first-run wizard that writes four
  documents before the user has seen the app is a larger commitment than three
  panes of explanation. The panes point at the three ways money gets in, which
  is the one thing an empty app cannot show by itself.
- **No re-run from the UI.** Clearing `onboardingCompleted` on the user
  document is the only way to see the welcome again — see
  [../onboarding.md](../onboarding.md) for the procedure.
- **The dialog is not resumable.** Closing on pane 2 completes; there is no
  "continue where you left off".
- **Eleven empty states still carry no action**, and most of them should not:
  the report and analysis surfaces are saying "nothing fell in this period",
  where the useful control is the period selector already on the page rather
  than an add button. The ones worth revisiting are the search and import
  histories, where starting one *is* the action.
