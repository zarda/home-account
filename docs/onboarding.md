# First-run onboarding

A three-pane welcome that opens once per account, explains the three ways a
transaction gets into the app, and offers to start one. It is deliberately a
small feature; almost all of its complexity is in deciding whether this launch
is a first run at all.

The reasoning and the rejected alternatives are in
[ADR 0072](ADR/0072-onboarding-runs-once-and-never-against-a-fallback-profile.md).

## The flow

| Pane | What it says |
|---|---|
| 1 | What the app is for, and that it starts with a single transaction |
| 2 | The three ways money gets in: by hand, by camera, by import |
| 3 | Start with one — **Add a transaction** and **Scan a receipt** |

The footer carries a `1/3` indicator (with an `aria-label` spelling it out),
**Back** from pane 2 on, **Skip** until the last pane, and **Next** / **Done**.
The header carries the usual close-X.

`OnboardingDialogComponent` holds a `stepIndex` signal and renders `@if` panes
— not a `mat-stepper`. Nothing else in the app puts a stepper in a dialog, its
header would duplicate the footer's own step count, and the computed view
guards (`isFirstStep`, `isLastStep`, `canSkip`) are the in-dialog idiom
`AiSearchDialogComponent` already uses.

The two calls to action close the dialog with a result — `'add'` or `'scan'` —
and `OnboardingService` runs it in `afterClosed()`, never over the closing
dialog: the quick-add dialogs are the same `MatDialog` surface and would stack
on a welcome still animating out. Both go through `QuickAddService`, like every
other add-transaction entry point in the app (see
[shortcuts.md](shortcuts.md)).

## The flag

`UserPreferences.onboardingCompleted?: boolean`. Absent means not yet
completed. It is written through `AuthService.updateUserPreferences`, which
sends the dotted field path `preferences.onboardingCompleted` so nothing else
in the map is touched.

**Every close path writes it** — Done, Skip, the close-X, the backdrop, Escape.
A first-run dialog that can come back is a nag, and every "did they really mean
it?" branch is a way for it to come back.

A failed write is swallowed with no toast. The flag stays absent and the next
launch offers the welcome again; the retry is the construction.

No rules change was needed: `preferences` is validated as a map, not field by
field. `firestore-rules.smoke.spec.ts` pins that the dotted update is accepted.

## The gate

This is the part worth understanding before changing anything here.

`OnboardingService.shouldShow` is a computed:

```ts
const user = this.auth.currentUser();
if (!user) return false;
if (this.auth.profileDegraded()) return false;
if (user.preferences?.onboardingCompleted === true) return false;
return this.attemptedFor() !== user.id;
```

**`!profileDegraded()` is the interesting clause.** When the profile read fails
— an offline launch, a rules or quota error — `AuthService` keeps the session
alive on an in-memory fallback built by `buildNewUserProfile()`: it carries
`DEFAULT_USER_PREFERENCES`, so no `onboardingCompleted`, and a `createdAt` of
*now*, whatever the account's real age. See
[auth.md](auth.md) under *The degraded profile*.

Field by field, that fallback is indistinguishable from a brand-new account. So:

- Reading it would greet a two-year-old account as a stranger.
- The write that followed would target a document this session never read.

A degraded session therefore shows **nothing at all** and waits. That costs
nothing: `AuthService`'s retry effect clears `profileDegraded` when the real
profile arrives, `shouldShow` is a computed watched by an effect in
`MainLayoutComponent`, and it becomes true at that moment — or stays false,
because the real preferences already carry the flag. There is no heuristic
standing in for the answer, because the answer arrives on its own.

**`attemptedFor` is keyed by uid**, not a bare boolean. An account switch inside
one session is a different first run and re-arms; a degraded→recovered
transition for a uid already welcomed does not re-open the dialog. It is set
*before* the dialog opens, not in the close callback — opening is what makes a
second read of `shouldShow` re-entrant, and the guard has to be standing by
then or two welcomes stack.

## Where it is wired

`MainLayoutComponent`'s constructor, in an effect:

```ts
effect(() => {
  if (this.onboarding.shouldShow()) {
    this.onboarding.show();
  }
});
```

The authed shell, not the app root: `/login` and `/lock` are top-level routes
outside this layout, and `authGuard` has already waited out
`AuthService.isLoading` before routing here. An effect rather than a one-shot in
`ngOnInit`, because a launch that started degraded becomes eligible only later,
with the shell already mounted.

## Empty states

#83's other half. `EmptyStateComponent` has always accepted `actionLabel`,
`actionIcon` and an `(action)` output; the transaction list and the goals list
now pass them:

| Surface | Action |
|---|---|
| Transaction list (empty, **and** filters matching nothing) | Add a transaction, via `QuickAddService` |
| Goals list | Add a goal, into the same form the page's add button opens |

The transactions CTA is shown for both empty cases on purpose: when a filter
matches nothing, adding a transaction is still the one action worth offering,
and the filter controls are already on screen.

Most of the remaining empty states are report and analysis surfaces saying
"nothing fell in this period", where the useful control is the period selector
rather than an add button.

## Re-triggering it for testing

There is no UI for this by design. To see the welcome again:

1. **The user document.** In the Firebase console (or the emulator UI), open
   `users/{uid}` and delete the `preferences.onboardingCompleted` field — or
   set it to `false`; the check is `=== true`. Reload the app.
2. **A fresh account** is the honest test: sign in with an account that has
   never run the app, and the welcome is what it sees.
3. **The dialog alone**, without the gate, is
   `OnboardingDialogComponent` — its spec constructs it directly and steps
   through the panes, which is the quickest way to iterate on copy.

Note that clearing the flag on a device whose session is degraded still shows
nothing. That is the gate working; get the profile to load first.

## What is tested

- `onboarding.service.spec.ts` — the gate in every combination: no user, a
  degraded profile, a completed flag, a second read in the same session, an
  account switch, a degraded→recovered transition for a uid already welcomed.
  It also asserts that each close reason persists the flag and that the two
  results reach `QuickAddService` after the close.
- `onboarding-dialog.component.spec.ts` — the pane sequence, the Back/Skip/Done
  visibility rules, the step indicator, and the two result values.
- `main-layout.component.spec.ts` — that the shell watches `shouldShow` and
  calls `show()`.
- `transaction-list.component.spec.ts` and `goals.component.spec.ts` — the
  empty-state CTAs reach the right dialog.
