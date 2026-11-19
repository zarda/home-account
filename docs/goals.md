# Goals

The Goals tab on the Budgets page tracks money put aside on purpose:
**saving goals** (an emergency fund, a deposit) and **projects** (a trip, a
purchase list). Budgets cap spending; goals accumulate toward it — the two
are siblings, not the same mechanism
(see [ADR 0021](ADR/0021-one-goal-model-carries-savings-and-projects.md)).

## The model

One `Goal` document per goal at `users/{uid}/goals`, mirroring the budget
pattern (`goal.model.ts`, `goal.service.ts`):

- `kind` — `saving` or `project`. A flavor, not a mechanic: both kinds
  carry the same fields and the same progress math.
- `targetAmount` — **always authoritative**. Progress is
  `(contributedAmount + linkedAmount) / targetAmount` for both kinds;
  every display reads the sum through `goalProgressAmount()`, never a raw
  counter.
- `contributedAmount` — a counter of manual contributions, moved only by
  the Contribute dialog.
- `linkedAmount` — a counter of linked transactions (see below;
  [ADR 0027](ADR/0027-a-linked-transaction-carries-its-converted-amount.md)).
  Absent on documents written before links existed and read as 0.
- `currency` — the unit **both counters** are denominated in, and therefore
  **fixed once either is non-zero**. Neither counter can be rebuilt in another
  unit: `linkedAmount` sums figures already converted onto the rows, and
  `contributedAmount` has no per-row provenance at all. Changing it would
  relabel the stored magnitudes rather than convert them, so the form disables
  the control on a funded goal and the service drops the change rather than
  failing the rest of the edit
  ([ADR 0033](ADR/0033-a-stored-figure-is-re-taken-only-when-its-input-moved.md)).
  An empty goal can still be corrected. If a funded goal really needs another
  currency, the honest shape is a new goal.
- `items` — an optional checklist for projects (`{name, amount, done}`,
  at most 50). The form can copy the list total into the target on
  demand, but the list is never a second source of truth: editing an item
  later does not silently move the target.
- `targetDate`, `note` — optional; `isActive` mirrors budgets.

## Contributions

**Contribute** on a goal card records an amount in (or, flipped, back
out). The flip is a pair of toggles in the dialog, a single-choice group
named *Add or take back* (`goal.directionLabel`; ja *追加するか戻すか*, tc
*存入或取回*), as the goal form's saving-or-project pair is named *Goal type*
(`goal.kindLabel`; ja *目標の種類*, tc *目標類型*); `icon-labels:check` fails
any single-choice group of the app that carries no name
([ADR 0196](ADR/0196-sibling-controls-say-what-they-act-on-a-name-holds-its-shown-words-a-focused-button-shows-an-indicator-inside-it-focus-stays-in-the-list-after-a-delete-and-a-failed-dashboard-read-is-quiet.md)).
The write is a Firestore transaction: two devices contributing at
once both land, a withdrawal sees the balance it is shrinking, and one
that would drive the counter below zero aborts with
`GOAL_CONTRIBUTION_BELOW_ZERO`. Checking off a project item commits the
same way. A personal goal keeps no per-contribution ledger — one counter,
corrected by withdrawing (a known gap in the ADR); a household goal keeps
one document per contribution ([below](#household-goals)). Withdrawing
floors on the manual counter alone; money that arrived through links leaves
by unlinking, which is why the card breaks the total down once links exist.

## Linked transactions

A transaction can be linked to an active goal from the transaction form
(add or edit), so money that already exists as a ledger row counts toward
progress without being typed in twice. Mechanics
(`transaction.service.ts`, ADR 0027):

- The link is two fields on the transaction: `goalId`, and `goalAmount` —
  the amount converted into the **goal's** currency when the link is
  written, re-snapshotted when the amount or currency changes, never at
  read time (the `amountInBaseCurrency` precedent). Unlinking or deleting
  backs out exactly the stored figure, so rate movement between link and
  unlink cannot strand a remainder. "Changes" means **compared against the
  stored row**, not "the caller sent the field": the transaction form sends
  every field on every edit, so a presence test would re-snapshot under a
  description edit and move a counter nobody touched. Both stored figures and
  the rules for re-taking them are collected in
  [money-snapshots.md](money-snapshots.md).
- Every counter change commits in the same Firestore transaction as the
  row write — link, unlink, switch, amount edit, delete — so two devices
  cannot double-count and the link can never disagree with the counter.
  Linked writes therefore need the network, like Contribute — and only
  linked ones: whether a write is linked is decided by the *value* of
  `goalId` and of the row's stored link, so an edit to an unlinked row keeps
  the ordinary offline-capable path and one document read.
- Only a **new** link demands an existing, active goal
  (`GOAL_LINK_INVALID` otherwise). A link a row already carries keeps
  counting after the goal is deactivated; deleting a goal sweeps its links
  off the rows first. Back-outs clamp at zero rather than blocking edits.
- Deleting every transaction zeroes every `linkedAmount`; deleting the
  account needs nothing extra (the cascade removes both collections).

The linked share feeds everything progress feeds: the card (with a
"manual · from transactions" breakdown once links exist), and the AI
summary's goal section and cache key.

## Finding a goal's transactions

Once a goal has linked rows its card offers **View Transactions**, which opens
the Transactions page filtered to that goal. The filter carries only the goal,
so it reaches links from any month rather than the page's usual current-month
window.

`goalId` is a first-class transaction filter (`TransactionFilters`,
`buildTransactionWhere`): server-side like `categoryId` and `currency`, which
is what keeps the paged window dense and the header's count exact. It needs
the `goalId`+`date` composite index pair in `firestore.indexes.json` — the
emulator does not enforce composite indexes, so nothing in the test suite
catches a missing one.

The same filter is reachable two other ways: the **Goal** dropdown in the
transactions filter panel (which names whatever filter arrived from a card,
and keeps a since-deactivated goal listed so it can still be cleared), and a
goal-scoped smart-search answer's "view transactions" — see
[smart-search.md](smart-search.md).

## Where goals surface

- **Budgets → Goals tab**: progress cards ([below](#the-goal-card)). The
  bar clamps at 100% while the printed percentage keeps counting —
  overshooting a savings target is success, not overflow.
- **The AI summary** on the dashboard receives active goals as a prompt
  section (names, saved/target in the base currency, percent saved — no
  raw transactions), so insights can speak to pacing. "Saved" is the full
  progress, manual plus linked. A contribution or a link changes the
  summary's cache key, so a fresh summary follows either.
- **The transaction form** carries the goal picker (add and edit) — see
  "Linked transactions" above.

None of these reaches a household: a personal goal is private to its
account, and no household the account belongs to sees it.

## The goal card

- **The goal's name is an `h2`**, one level under the page's `h1`, so a
  reader who moves by headings finds each goal; with no goal, the tab's
  empty state is the `h2`
  ([ADR 0194](ADR/0194-one-painted-contrast-helper-and-one-focus-hand-off-a-card-is-scored-part-by-part-and-no-page-skips-a-heading-level.md)).
- **Each action names its goal.** The card's four buttons are stamped once
  per goal: the icon buttons read *Edit {{name}}* and *Delete {{name}}*
  (`goal.editNamed`, `goal.deleteNamed`), and the two text buttons keep the
  words they show whole inside a name that adds the goal, *View Transactions
  for {{name}}* (`goal.viewTransactionsNamed`) and *Contribute to {{name}}*
  (`goal.contributeNamed`). ja reads `「{{name}}」の取引を表示` and
  `「{{name}}」に積み立てる`, tc `檢視交易：「{{name}}」` and `存入「{{name}}」`, each
  holding the button's own words
  ([ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)).
- **Edit and Delete stand 8px apart**, two 40px targets whose 48px touch
  spans no longer overlap, so a press meant for Edit never reaches Delete.
- **The foot wraps.** *View Transactions* and *Contribute* share a row
  while it holds both, each label on one line, and take a row each, still at
  the end, when it does not.
- **The grid fits a phone.** A column is 300px at least, or the grid's whole
  width where that is less (`minmax(min(100%, 300px), 1fr)`), so on a 320px
  phone each card stays inside the 248px the tab is given.
- **Its type follows the account's text size.** Every size on the card,
  its two small glyphs included, is set in the app's type scale
  (`--text-xs`, `--text-sm`, `--text-lg`), as is the Goals tab's hint, so all
  of it scales with `--app-font-scale`; the 13px text it held before is
  `--text-sm`, 14px at the default size.
- **The tab's header wraps.** The hint and *Add Goal* share a line where
  both fit whole, *Add Goal* at its end. Where they do not, as in the 248px
  a 320px phone leaves the tab, the hint takes its own line and *Add Goal*
  the next, at its start, as the sibling tabs put their button under their
  description. The wrap reads the tab's own width, not the viewport's.
  Before, the two shrank side by side, and *Add Goal*'s label broke a word a
  line in en and a character a line in ja, in a pill grown tall round it.

[ADR 0192](ADR/0192-a-control-repeated-per-item-names-its-item-in-its-own-text-too-a-button-is-named-in-every-branch-and-an-unlabelled-switch-fails-the-axe-pass.md)
records the four before the last; the header's wrap came with *fix: the
Goals tab's Add Goal keeps its label on one line on a phone*.
`goal-progress-card.component.spec.ts` holds the heading, the names in en,
ja and tc, the targets, the foot and the type scale, and
`goals.component.spec.ts` the grid and the header at a phone width and the
hint's scale: its describe *GoalsComponent, its header at a phone width*
renders the header at 248px in en, ja and tc, at text sizes 1 and 1.3, and
holds *Add Goal* at Material's 40px with its label on one line, inside the
tab, and at 640px the hint and *Add Goal* on one line.

## Household goals

A household keeps goals of its own, apart from these:
`households/{hid}/goals`, shown in the plans on the Household page, and
counted only from what its members choose to share ([household.md](household.md),
[ADR 0160](ADR/0160-a-households-budgets-and-goals-are-its-own-counted-from-shared-copies-and-members-contributions.md)).
Any live member makes or edits one; its maker, while still a member, or the
household's owner deletes it. The two kinds never mix.

- **Progress** is the shared rows linked to the goal, of either type, plus
  the contributions members recorded on it, folded on each viewer's device
  as the page reads them; nothing is stored on the goal. The goal's currency
  is picked when it is made (the maker's base unless they choose another)
  and never changes. A linked row counts in it exactly when it is already in
  that currency and at today's rate otherwise, and the card then says
  **At today's rate** ([money-snapshots.md](money-snapshots.md)).
- **Contributions** are one document each
  (`households/{hid}/goals/{gid}/contributions/{cid}`: the member, an amount
  above zero in the goal's currency, a date), written once. A contribution is
  never edited or withdrawn; its member or the owner deletes it instead.
  Only the contributions of members still listed count and are shown. A
  member who leaves or is removed leaves theirs with the goal, counted by
  nobody, and a rejoin of the same generation counts them again; an
  account's erasure deletes its own from every household it is still in.
  Deleting the goal deletes its contributions with it.
- **Count toward a goal** links one of the viewer's own shared rows to a
  household goal, from the flag button on that row in the household's list
  of shared transactions. It sets `goalId` on the row's copy in that
  household, which only the row's author may change, so nobody counts
  another member's row. It commits online in a transaction, as every plan
  write does, never through the device's queue: a link queued offline and
  refused on landing would roll back unseen, and nothing repairs a link
  afterwards. A row shared a moment before still has its copy in that queue,
  so the link first waits for the server to answer this device's earlier
  writes.
- **A personal link never travels.** A row's `goalId` and `goalAmount` are
  not among the fields a shared row's copy reveals
  ([ADR 0157](ADR/0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md)),
  so a row linked to a personal goal and shared into a household shows the
  household neither the goal nor the figure, and a household goal link lives
  on the copy alone, never on the row. Linking, unlinking or deleting a
  personal goal touches no copy. Stopping sharing a row with a household
  deletes its copy there, and the household goal link with it.

## Rules, backup, deletion

- `firestore.rules` validates kind, positive target, non-negative
  contributions and linked counters, and bounds `items` to a list of at
  most 50 (element shapes are validated client-side — per-element map
  validation is not expressible in rules). On transactions it validates
  the link pair and refuses a `goalAmount` without its `goalId`. The
  catch-all carve-out lists `goals`, without which every check above
  would be bypassable.
- Backups carry goals from schema **1.3** and links from **1.4**; older
  backups restore with none. A restore writes each goal at its backup id
  with the contributed balance verbatim — unlike a budget's `spent`,
  there is nothing to recompute it from. `linkedAmount` is the opposite:
  restored rows carry their links verbatim without touching counters (the
  goal may not exist yet mid-restore), and a final pass recomputes each
  involved goal's counter from what the ledger then actually holds — so
  restoring twice, or over a live account with links of its own, cannot
  double-count. A restore merges into the row it finds rather than
  replacing it, so a backup row that predates a link cannot strip the live
  one either; see [backup-restore.md](backup-restore.md).
- Account deletion sweeps `users/{uid}/goals` like every other
  subcollection (see [account-deletion.md](account-deletion.md)).
- A household's goals and their contributions are the household's records,
  not an account's: no backup carries them and a dissolve deletes them. An
  account's erasure deletes the contributions it recorded in a household it
  joined and is still in; those it recorded in one it had already left or
  been removed from stay there, no longer counted (see *Known gaps* in
  [account-deletion.md](account-deletion.md)).
