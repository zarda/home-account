# 160. A household's budgets and goals are its own, counted from shared copies and members' contributions

**Status:** Accepted, implemented · **Date:** 2026-09-28 · **Issues:** #71, #465

Reference documentation lives in [../household.md](../household.md).

Supersedes step 3 of the road to shared writes in
[0154](0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md)
(a shared budget's `spent` recomputed by a server trigger) and 0154's display
of another member's stale `spent` as 0 with a note. Closes 0154's gap that a
member on another base currency was counted at today's rate without a
caption. Builds on the copies of
[0157](0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md),
their buckets included, and on the memberships of
[0158](0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md).
Applies [0026](0026-every-period-window-comes-from-one-helper.md),
[0148](0148-every-figure-names-its-rate.md) and
[0009](0009-shared-state-publishing-and-lifecycle.md), and leaves
[0027](0027-a-linked-transaction-carries-its-converted-amount.md)'s personal
goals as they were. Extends
[0018](0018-account-deletion-is-a-client-side-cascade.md): erasure deletes
the account's own contributions in each household it is still a live
member of without owning it.

## Context

Under 0152 and 0154 the household page showed every member's personal
budgets and goals, read through the peer rules, on read-only cards. Only a
budget's owner can recompute its `spent`, so a figure stamped for another
period showed 0 with a note, and a viewer in another time zone could see an
owner's every figure that way for good. 0154's road to shared writes planned
the fix for a later model: a household budget whose `spent` a Firestore
trigger recomputes on every ledger write.

0157 takes the peer reads away. A member's personal budgets and goals are
their own again, readable by nobody else, so the page has nothing to show
for plans unless the household keeps plans of its own. The user decided it
should, and set the terms (2026-09-26/27):

- **Budgets and goals are the household's own**, made by any live member and
  counted **only from shared rows**. Personal budgets and goals stay private.
- **A household goal's progress** is the shared rows linked to it plus
  **contributions** members record on it, kept per member. Linked rows
  alone were weighed; the user chose contributions as well.
- **Each viewer sees rows and totals in their own base currency**, converted
  at today's rate and captioned where converted. Budgets and goals carry
  their own currency.

What the plans have to count from made the rest hard.

- **A copy is in the currency its row was entered in**, and holds no
  base-currency snapshot (0157 withholds it). Members may keep different
  bases, and none of them is the household's.
- **A copy's category id is its author's.** A custom category's id means
  nothing in another member's catalogue, which 0154 met when it resolved
  each row through its own member's categories.
- **Several members write at once**, and a stored figure is whoever wrote
  last, judged in that writer's time zone.
- **A commit may make twenty lookups**, so a goal cannot take any number of
  contributions with it in one commit.

## Decision

**A household keeps its own budgets and goals under `households/{hid}`,
made and edited by any live member. Nothing a plan counts is stored: a
budget's spending is folded on each viewer's device, as the page reads it,
from the shared copies whose bucket it names; a goal's progress from the
copies members link to it and the contributions they record on it. Each
plan carries its own currency, chosen when it is made and never changed.
Rows and member totals are shown in each viewer's own base. Whatever is
converted is converted at today's rate, and says so.**

### The model

| Path | What it holds | Written by |
|---|---|---|
| `households/{hid}/budgets/{bid}` | `gen`, `name` (1–100), `categoryIds` (1–10), `amount`, `currency`, `period` (`weekly` \| `monthly` \| `yearly`), `startDate`, `endDate?`, `alertThreshold?`, `isActive`, `createdBy`, `createdAt`, `updatedAt`. No `spent` | any live member |
| `households/{hid}/goals/{gid}` | `gen`, `name` (1–100), `targetAmount`, `currency`, `targetDate?`, `isActive`, `createdBy`, `createdAt`, `updatedAt`. No progress | any live member |
| `households/{hid}/goals/{gid}/contributions/{cid}` | `gen`, `memberUid`, `amount` (in the goal's currency), `date`, `createdAt` | the contributing member, once |

`gen` is the household's `createdAt` when the plan was made, and must equal
the live one, so a plan left under an id formed again is neither read nor
written into the new household (0152's generation stamp). `createdAt` and
`updatedAt` must equal the request time. Each kind's key lists live in
`household-plans.model.ts`, and `npm run ledger:check` fails when one differs
from the rules' `hasOnly` or `hasAll`, or a name or category bound does.

### Who writes what

- **Any live member makes and edits any plan.** The plans are the
  household's, not the maker's. An edit may not touch `gen`, `createdBy`,
  `createdAt` or `currency`.
- **The maker, while a member, or the owner deletes one.** The owner deletes
  any plan, as a dissolve must. A live member's delete of a plan that is not
  there passes, so a delete sent again after its answer was lost succeeds.
- **A contribution is its member's.** A live member records one for itself,
  on a goal of the same generation, and nobody changes it afterwards
  (`allow update: if false`): a mistake is deleted and recorded again. Its
  author deletes it at any time, a member or not; the owner deletes any; and
  any live member deletes one once its goal is gone as the commit leaves it
  (`!existsAfter(goal)`), which is what lets a goal take its contributions
  with it (below).
- **Only live members read**, in the live generation. A list must filter on
  `gen`, as every household list does. A live member asking for a missing id
  hears not-found; anyone else is refused either way, so a stranger cannot
  tell which ids exist.
- **The app refuses first what the rules would refuse**: a delete by anyone
  but the maker, the author or the owner is refused before it is sent.
- **Every plan write needs the network, and is never queued.** Plans,
  contributions and goal links commit through
  `FirestoreService.commitOnline`: the ops of one commit, all or none, in a
  `runTransaction` that only writes, so nothing enters the persistent
  mutation queue. A plan write kept on the device would land days later over
  what the household changed meanwhile, or be refused then, unseen. Offline
  a write is refused before anything is sent; a connection that drops on
  the way fails it, and the app says so. Only the sweep of a deleted goal's
  contributions goes through the queue (below), since deleting one already
  gone does nothing.
- **A create is safe to send again.** The plans section takes an id for
  each create (`newId`, a Firestore auto-id) before the dialog's first save,
  and every save of that dialog writes under it. A second delivery, whether
  the transaction's runner sending again after a lost answer or another
  save of the dialog, is judged as an edit of what the first made and
  refused over its creation time: the refusal
  [0156](0156-a-dissolve-that-finds-its-household-already-gone-finishes-instead-of-failing.md)
  found in a household's `create()`. The writer reads the document back from
  the server, and one this member made in this generation under that id
  means the write landed. A create whose connection dropped before the
  answer says it may already be saved (`household.errors.unconfirmed`);
  saved again, it is recognised, not made twice.

The rules bound what every member's browser renders: a plan's name, and each
of up to ten category ids, a string of 1 to 64 characters. Rules cannot loop,
so each place in `categoryIds` is checked by its own `planCategoryAt` call,
and `ledger:check` fails when the calls and `HOUSEHOLD_PLAN_CATEGORY_MAX`
disagree. A plan's currency is held to three capital letters
(`matches('^[A-Z]{3}$')`), the pattern `HouseholdPlansService` tests it
with, and `ledger:check` fails when the two differ: every member's page
formats and converts with it, and no edit can correct it once the plan is
made. A code the rate table lacks is well formed and passes. The app goes
further than the rules: a budget's categories must be expense built-ins,
each once, and the dialog offers only the currencies it supports.

Lookups, as the rules file counts them: a plan read, create or edit, two (the
household and the member's own member document); the owner's delete, one; the
maker's, two. A contribution's read, two; its create, three (the goal as
well); its author's delete, none; the owner's, one; a live member's under a
goal that is gone, three.

### A budget counts copies by bucket, folded as it is read

A household budget names built-in expense categories: groups, subcategories,
or both. A copy counts when it is an expense, dated inside the budget's
current window, and its `bucket` or its `bucketGroup` is one of them
(`budgetSpent`). A group therefore takes in every subcategory under it, and a
member's custom category counts under its nearest built-in ancestor, or the
row type's catch-all when it has none: the `bucket` its author's projection
wrote (0157). The built-ins are the one catalogue every member holds alike,
so no mapping table and no household categories are needed.

- **The window** is `householdBudgetWindow`: the budget period containing
  today, anchored on the start date by `budgetPeriodWindow` exactly as a
  personal budget's is, cut short by an end date inside it, and closed on the
  last millisecond of its final local day. It is judged in the viewer's own
  time zone.
- **Nothing is stored.** The spending is folded from the copies the page
  already holds, every time they change, offline from the cache too. No
  figure can fall behind its copies, no member overwrites another's, and no
  function sits on any write path.
- **A private row has no copy**, so no household budget can count one. A
  shared row still counts in its member's own personal budgets, as before.

### Two windows, two listeners

A budget's window need not lie inside the period the page shows: a past
month can be viewed while the budget's month runs on. The period and the
budgets' span (`planWindow`: the earliest start to the latest end of the
active budgets' current windows) are therefore read by two listeners on the
ledger, each filtered to the live generation and capped at `LEDGER_VIEW_CAP`
(2,000) copies, asking for one more so a window that holds more is known to.
The second opens only when the period does not hold the budgets' span;
otherwise the period's listener serves the plans too. These and every list
the plans read open through one helper (`openCappedFeed`, which caps those
that are capped), so a budget, a goal and the ledger agree on when a list is
cut and when it is incomplete.

One listener over both spans would be read newest first up to one cap, so
the copies of a later budget window, and of the weeks between, could crowd
the viewed period's own rows out of it. A budget whose window reaches past
the oldest copy kept, or whose listener failed before the server answered,
says it may be incomplete; while its copies have not answered it reads
*Counting…*, never 0. Only live members' copies count, as only theirs are
shown.

### A goal counts linked copies and contributions

A goal's progress is the copies linked to it, of either type as a personal
goal's links are, each in the goal's currency, plus its live members'
contributions, which are entered in that currency (`goalProgress`). The
fraction is uncapped, as a personal goal's is. Nothing is stored.

- **Linked copies are read by their own listeners**: the live generation's
  copies whose `goalId` is one of the active goals, thirty goal ids per query
  (Firestore's `in` limit), whatever their dates. Each goal's contributions
  have a listener of their own, newest first. Both kinds are capped as the
  ledger's are; the lists of active budgets and goals are not.
- ***Count toward…* is the author's alone.** A flag on the viewer's own rows
  in the household's list, offered while the household has an active goal,
  sets or clears `goalId` on the viewer's own copy and nothing else. The rules
  let an update touch only `goalId` and the stamp, and only to name a goal of
  the copy's own generation: the goal is looked up in place of the row,
  three lookups in all (the household, the author's member document, the
  goal), and clearing a link reads no goal. Copies are written with `merge`,
  so a projection that follows the row never drops a link, and the journal
  and the sweeps of
  [0159](0159-a-copy-follows-its-row-in-a-commit-of-its-own-and-a-sweep-repairs-what-the-follow-ups-miss.md)
  leave `goalId` alone. Stopping sharing deletes the copy, and its link with
  it.
- **Linking needs the network, and waits for this device's earlier
  writes.** A link commits as a plan write does, never queued: one kept on
  the device and refused when it landed, its goal deleted meanwhile, would
  roll back unseen, and nothing repairs a link later, since the repairs
  never touch `goalId`. A row just shared has its copy written through the
  device's queue, which a transaction does not wait behind, so the link
  would find no copy on the server and call it gone. `linkCopy` therefore
  waits until the server has answered every write this device issued
  before it (`waitForPendingWrites`, which waits on the whole queue, not
  one write), and going offline meanwhile refuses the link as offline.
- **A departed member's contributions stay with the goal, and stop
  counting.** A leave or a removal leaves them stored under the goal; only
  live members' contributions count or are listed, so they count and are
  listed again if the member rejoins the same generation. They go with the goal or the household, and
  at the account's erasure while it is still a member: `deleteAll` deletes
  the account's own contributions in each household it belongs to without
  owning it, listed from the server under every goal of the generation,
  before it ends the membership. The leave and remove confirmations, and the
  delete-account warning, say what stays.
- **Personal goals are untouched.** A row's personal goal link, and a
  personal goal's `contributedAmount` and `linkedAmount` (0027), are never
  copied. A shared row can count toward a personal goal and, in each
  household it is shared into, a household goal.

### Deleting a goal takes its contributions

A goal's delete does not reach its subcollection. `deleteGoal` lists the
goal's contributions from the server and commits the goal's delete with the
first six of them, in a transaction as every plan write is; once the goal is
gone, the rules let a live member delete anyone's, so the rest go in commits
of six, listed afresh, any added in the meantime with them, through the
queue. `HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK` is six because a
non-owner maker's goal delete costs two lookups and each contribution's
delete three (the household, the goal as the commit leaves it and the
member's own member document): 2 + 6 × 3 = 20, counted per write, the most a
commit can be charged. The call rejects when the contributions could not be
listed or the goal's own commit failed; otherwise it resolves once the rest
of the sweep has run, been kept or been dropped, and the sweep itself never
makes it fail. A sweep that did not finish leaves the contributions it did
not reach on the server, counted by no goal; it is kept for the page's life
and run again when the device is back online or the page reads a household
afresh, and a refused one is dropped. Copies linked to the goal keep their
`goalId`, which only their authors can change, and count nothing.

A dissolve deletes the plans before its final commit: the budgets, then each
goal's contributions and the goal, as owner deletes, ten to a commit
(`LEDGER_PURGE_CHUNK`). Whatever it leaves, the server's backstop reaches
([0161](0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)).

### Each plan's currency, and each viewer's base

- **The household has no currency.** A plan's is chosen when it is made, the
  maker's base unless they pick another, and never changes: the rules refuse
  an edit that touches it, the app never sends one, and the dialog shows the
  control disabled with *The currency is fixed once the plan is made.* A
  budget's limit and every contribution to a goal were entered in it, and
  changing it would re-denominate them without a word.
- **A plan converts into its own currency.** A copy already in it counts
  exactly; any other converts through `CurrencyService.convert` at today's
  rate. A contribution is never converted.
- **Rows and member totals are in the viewer's base.** Each copy's `amount`
  converts from its `currency` into the base of whoever is looking, exactly
  when the two are equal. The combined totals fold every row.
- **Every converted figure says so.** *At today's rate*
  (`common.atTodaysRate`, the weekly recap's caption) sits under each
  converted row, each member line and the combined totals that include one,
  and each budget or goal whose figure converted something. Today's rate is
  the one every viewer's device holds; a copy carries no rate of its
  author's to trust instead.
- **Nothing converts through the placeholder table.** Until
  `CurrencyService` has settled on a source for its rates (live, cached, an
  expired cache or the built-in fallback), its table converts every
  currency 1:1. Meanwhile a copy that would convert is held out of the rows
  and the member totals, and the overview shows its loading state rather
  than figures short of it; a budget or goal whose figure converted
  something reads *Counting…*. A figure in one currency never waits on the
  rates.

## What was rejected

- **A stored `spent`, recomputed by a server trigger** (0154's road, step 3).
  A function on every shared write, a second write for each, and a figure
  judged in the server's zone. Folding from copies the page already holds
  costs no write.
- **A stored `spent` written by clients.** The last writer wins, in its own
  zone; 0154's stale 0 with a note came from exactly this.
- **A household currency**, fixed when the household was formed, with every
  copy carrying its amount converted into it. Every viewer would have seen
  one figure, but each converted amount would have been taken at its
  author's rates, a claim the rules cannot check. The user chose each
  viewer's base, and a currency per plan.
- **Household categories** (0154's road, step 1). The built-in buckets give
  group and subcategory budgets with nothing to seed or keep in step.
- **An aggregate query for a budget's spending.** A sum over the ledger
  filtered on bucket and dates needs a composite per shape, which the
  emulator never enforces, and fails offline; the listeners already hold the
  copies.
- **One listener for the period and the budgets**, above.
- **Plan writes through the persistent mutation queue**, guarded only by a
  check that the device is online. A connection that drops after the check,
  or a dead network the browser still calls online, leaves the write kept
  on the device past the app's own life: it lands days later over what the
  household changed meanwhile, a budget reverting to an older limit, or is
  refused then without a word, a contribution to a goal deleted meanwhile
  vanishing.
- **Linking offline**: a link refused on landing would roll back unseen
  (above).
- **Deleting a departed member's contributions at every ending.** A leave
  or a removal could take them with it, and a server sweep could reach those
  of an account removed before it erased itself. The user chose to keep
  them with their goal (2026-09-28): they stop counting, and leave the
  goal's list, when the membership ends, count and are listed again if the
  member rejoins the same generation, and go with the goal or the
  household. Erasure alone deletes them, and only where the
  account is still a member to list them.

## Consequences

- Three kinds of document under each household, and six new composites:
  `budgets` and `goals` on `gen` and `isActive`, `contributions` on `gen`
  and `date` descending, and `ledger` on `gen` and `goalId`, for the plans'
  lists; `ledger` on `gen` and `date` descending, for the period's and the
  plans' listeners; and `ledger` on `gen` and `memberUid`, for the owner's
  purge after a removal (0158) and `onHouseholdMemberDeleted` (0161). The
  field lists and bounds are held equal to the rules by `ledger:check`. A
  composite is collection-scoped by name, so the `budgets` and `goals` ones
  also cover the personal `users/{uid}/budgets` and `goals`, whose documents
  hold no `gen`. The emulator never enforces a composite, so all six must
  read *Enabled* in production before the view, the plans and an owner's
  purge are relied on; until then they answer `failed-precondition`
  ([../household.md](../household.md#operator-runbook), *The indexes*;
  [0087](0087-the-deploy-is-not-green-until-its-indexes-are-built.md)).
- The page shows the household's plans and no member's personal ones. A
  household budget counts several categories and stores no spending, and a
  household goal has contributions and no checklist, so they have cards of
  their own; the personal cards lost the `readOnly` and `headingLevel`
  inputs they had gained under 0154.
- `household_action` gains `plan_create`, `plan_delete`, `contribute` and
  `goal_link`; editing a plan and deleting a contribution send nothing.
- One plan write runs at a time. While it is on its way, the section's
  buttons and each dialog's *Save* and *Cancel* say they are not offered
  (`disabledInteractive`, so `aria-disabled`) but keep focus, which never
  falls out of the section or the dialog; a press on one, or a second
  submit of a dialog, is refused rather than queued.
- Each figure follows the copies the moment they change, offline too, and
  two viewers on different bases see the same row in different currencies.

## Things that only became apparent while building

- **The emulator does not enforce the twenty-lookup ceiling.** Probes that
  deleted 10 and 40 contributions in one commit were allowed. The smoke case
  that deletes a goal holding thirteen contributions proves the sweep, not
  the ceiling: the chunk of six is reasoned from the rules' lookups, and
  nothing has tested it against production.
- **The goal's maker is not asked for once the goal is gone.** A member
  deleting another member's contribution in the goal's own commit needed a
  clause the rules could judge: once the goal is gone as the commit leaves
  it, nothing names its maker, so any live member may.
- **A write kept out of the queue can land while its caller hears it
  failed.** The server may take a transaction's commit before a dropped
  connection loses the answer, so a create cannot simply be sent again under
  a new id: the id is chosen once per dialog, and the failure says the plan
  may already be saved.
- **A transaction does not wait behind the device's queue.** A copy written
  by a share a moment earlier can still be queued when a link to it
  commits, which is why a link waits for the device's pending writes.

## Known gaps

- **The goal delete's chunk has no headroom.** 2 + 6 × 3 is exactly twenty;
  one more lookup on that path fails every goal delete by a member who is
  not the owner that holds other members' contributions (an author's delete
  of its own costs no lookup, the owner's one). Only such a delete on
  production would prove it: a goal holding more than six of other members'
  contributions, deleted by a member who is not the owner. Journey 78 is run
  by one account and makes no goal, so the chunk stays reasoned until
  then.
- **A departed member's contributions stay readable.** Kept with their goal
  (above), they are still downloaded by every member's device, amounts and
  dates included, though no figure counts them. An ex-member can delete
  only ids its app still holds, and nothing on the page says a goal's
  progress dropped.
- **Erasure reaches only the contributions it can list.** It deletes the
  account's own under the goals that stand, in each household it is still a
  live member of without owning it, before the membership ends; a failure
  stops the erasure there, and a retry finds the rest. Those of a household
  it was removed from, or left, before erasing itself stay: an ex-member can
  list neither them nor their goals. A dissolve has already taken them with
  the plans.
- **A bucket is its author's claim** (0157): a member can file a copy under
  any bucket and so count it toward any budget.
- **The rules take any category id** of 1 to 64 characters; only the app
  keeps a budget's to expense built-ins. An id no copy is bucketed under
  counts nothing.
- **A plan's currency need not be one the rates know.** The rules and the
  service hold only its shape, three capital letters, and only the dialog's
  picker keeps to supported codes; a code the rate table lacks converts at
  1.
- **A converted figure can wait a long time for the rates.** On a device
  whose cached rates have expired or never existed, the table settles only
  when the rates fetch answers or fails, and that fetch has no deadline of
  its own: on a network that silently drops traffic the overview stays
  loading and a converted budget or goal reads *Counting…* for as long as
  the browser waits.
- **A create saved again keeps what its first delivery sent.** When a save
  that reported it may already be saved did land, a second save of the same
  dialog is recognised as that create and changes nothing: fields edited
  between the two saves are not applied, and the plan is edited afterwards
  like any other.
- **A link waits on the whole queue.** `waitForPendingWrites` answers only
  once every write this device issued before the link is answered, so a
  device with a long offline backlog waits for all of it before linking.
- **Each device converts with its own rates**, so two members can read a
  converted figure a little differently.
- **Two viewers in different time zones** can put a budget's window on
  different days. Each judges its own; nothing is stored for either to be
  stale against.
- **Every list of copies or contributions stops at 2,000**, and a figure
  counted from a full one says it may be incomplete.
- **A goal sweep cut off is remembered only while the page lives.** A
  contribution left under a goal that is gone is under an id no listener and
  no dissolve's query of goals finds; the server's household trigger reaches
  it at a dissolve, through the ids it lists.
- **The join dialog and the invite mail name only transactions.** Neither
  says that every member can read the household's budgets and goals, who
  made each, and each member's contributions with their amounts and dates.
  The setup spec's ban on the phrase *budgets and goals*
  (`household-setup.component.spec.ts`), meant to keep out the personal
  plans, would also refuse a wording that names the household's own, so a
  change to the copy changes that spec with it.
