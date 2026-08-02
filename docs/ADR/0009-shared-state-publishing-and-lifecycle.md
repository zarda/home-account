# 9. One publisher for shared account state; owners reset it, holders release it

**Status:** Accepted, implemented · **Date:** 2026-08-02 · **Issues:** #202, #178, #179

## Context

The dashboard, all four report tabs and the two financial summary computeds
render from one root-level signal, `TransactionService.transactions`. Until
this record, that signal was written from inside `getTransactions()` — the
query method every caller shares — so *running a query* and *publishing the
app's current window* were the same operation. One line produced three
distinct, filed bugs: duplicate detection and AI import repainted the
dashboard with their own narrow windows (#202), a leaked listener from a
period the user had left could repaint the current one (#178), and the signal
survived sign-out, showing one account's totals to the next (#179).

Two structural facts made these easy to write and hard to see:

- The Firestore wrappers (`subscribeToCollection`, `subscribeToDocument`)
  return cold observables that never complete. Every `subscribe()` opens a
  distinct `onSnapshot` listener, and nothing ends it but an explicit
  unsubscribe. Fifty-four subscriptions existed in `features/` against five
  uses of `takeUntilDestroyed`.
- The stateful services are root singletons, and sign-out is a router
  navigation, not a reload. Nothing constructed anew, so nothing forgot.

## Decision

Three conventions, each with exactly one owner.

### Publishing is a named privilege, not a side effect

`getTransactions()` is a pure query. The one path that writes the shared
signal is `getByDateRange()`, and its comment says so. Every other reader —
`getTransactionsInRange`, `getExpensesInRange`, `getPeriodCategoryTotals`,
and the rest — is non-mutating by contract. A caller that wants the dashboard
to change must choose the publishing path by name.

Rejected: a separate `publishWindow()` method the components call after
querying. It forces edits at every legitimate call site to fix a problem the
illegitimate ones caused, and it leaves a window where query and publish
disagree.

### The owning service resets its cache on the signed-out edge

Each service holding per-account state — transactions, budgets, categories,
recurring rules, search history, insight snapshots — clears it in its own
constructor `effect()` when `userId()` goes null.

Driven from the consumer, not from `AuthService.signOut()`: these services
inject AuthService, so the reverse call would close a dependency cycle, and
an effect also covers sign-outs the app never initiated (token revocation, a
sign-out in another tab). Reset on the null edge only, not on every account
change: Firebase always passes through null on the way to a different user,
and an unconditional reset on sign-in could race the first snapshot of a
fresh load and blank it with nothing left to re-emit.

### A live listener has exactly one holder, and the holder has an exit plan

Every subscription to a never-completing stream is either piped through
`takeUntilDestroyed` (the leave-the-page half) or held in a `Subscription`
field that is unsubscribed before the next subscribe (the stay-on-the-page
half). Period-scoped streams need both; a component-lifetime stream needs
only the first. Re-subscribing to a live stream as a "refresh" is the
anti-pattern this replaces: the stream already carries every later change,
including the rollback snapshot after a rejected write.

Rejected: driving the queries from a period signal through `switchMap`. It
is the cleaner shape, but it would be the first use of that idiom in the
codebase and restructures loading and error handling in the same change that
fixes the leak. Worth revisiting if the imperative load methods grow.

## Things that only became apparent while building

- The dashboard's loading effect keyed on `transactions().length >= 0` —
  unconditionally true — so it registered the shared signal as a dependency
  and cleared the spinner whenever *anyone* published. Deleting it, rather
  than gating it, was the fix: the `getByDateRange` subscription callbacks
  already mark the real first paint.
- The unit-test mock returns a completing `of(...)` from
  `subscribeToCollection`, which cannot express a leak. Listener-lifecycle
  specs assert against per-call `Subject`s and their `observed` flag instead.

## Known gaps

`getMonthlyTotals` still publishes (it is built on `getByDateRange`) and has
no callers in `src`; it rides along until the dead-code sweep (#194). The
structural split of a window service owning publication outright remains
open under #200/#201 scope.
