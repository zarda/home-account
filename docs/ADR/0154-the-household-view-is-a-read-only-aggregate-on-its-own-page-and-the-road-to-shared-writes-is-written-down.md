# 154. The household view is a read-only aggregate on its own page, and the road to shared writes is written down

**Status:** Accepted, implemented · **Date:** 2026-09-26 · **Issues:** #71

Reference documentation lives in [../household.md](../household.md).

Applies [0009](0009-shared-state-publishing-and-lifecycle.md): the household's
listeners are held by the page that shows them. Builds on the membership of
[0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md),
and meets #71's third acceptance criterion — *a documented path from v1
(aggregate) to shared-write* — in its last section.

## Context

Once the rules let a member read the others' transactions, categories,
budgets and goals, something has to show them. #71 suggested a read-only
aggregate first: each member's records merged on the client, to deliver value
before a shared-write model.

Every surface the app already has is built for one owner. The Transactions
list edits and deletes what it shows; the budget service zeroes a stale
`spent` and queues a recalculation write; the dashboard's figures and the
Reports tabs sum one account's rows in that account's base currency. Other
people's rows cannot simply be poured into any of them.

And another member's rows are not the viewer's rows with a different owner.

- **Their snapshots are in their base currency.** `amountInBase` trusts a
  stored snapshot unless it is stamped against another base, has no snapshot,
  or looks unconverted. A converted row written before rows carried a stamp
  has none of those marks, so a peer's genuine USD snapshot would be counted
  as yen by a viewer whose base is JPY.
- **Their category ids are theirs.** A custom category's id means nothing in
  anyone else's catalogue.
- **Their budgets' `spent` is theirs to recompute.** The viewer cannot write
  it, and the rules refuse the attempt.

## Decision

**The household is shown on its own page, `/household`, as a read-only
aggregate merged on the viewer's device. Dashboard, Transactions, Budgets and
Reports stay personal and unchanged.**

### A page, not a toggle

`/household` is a lazy child of the signed-in layout, like `/data`, reached
from the sidebar and from a Settings link card — an anchor, so it is
focusable, unlike the older `div` cards beside it. It has two states: the
setup (start a household, answer an invite) and the member view (the
period's figures and every member's rows, every member's budgets and goals,
and the members with the owner's management). A toggle on the personal
pages was the alternative, and every one of them would have needed a
household mode: edit and delete controls hidden for rows that are not the
viewer's, recalculations suppressed, figures re-denominated. One page where
nothing is a control keeps all of that in one place.

### The client merge

`HouseholdLedgerService` is provided by the page, not the root, so its
listeners live exactly as long as the page. The page hands it the members,
and it keeps four listeners per member, the viewer included: the period's
transactions, the categories, the active budgets and the active goals. A
member joining gains four, a member leaving loses them — at the eight-member
cap, thirty-two listeners.

- **Each member's period is capped at 500 rows.** The query asks for 501,
  so a period that holds more is known to, and the page says so and names
  the member. Only the newest 500 are shown and counted.
- **The list renders a hundred rows at a time**, with a *Show more* that names
  how many remain. Every row is a full transaction row with fitted amounts,
  and a household can hold four thousand; the totals are folded from every
  row, shown or not.
- **Budgets and goals are asked for by one equality**, `isActive == true`,
  and sorted on the client, and the transactions by the existing date range:
  no query needs a composite index, and `firestore.indexes.json` is
  unchanged.
- **A refusal is an answer, not a fault.** When the rules refuse a member's
  listener — typically a member removed before the list says so — that member
  is named as no longer readable and what they showed is dropped. Any other
  failure keeps what was last shown; a listener that never answered marks the
  member's figures of that kind as possibly incomplete.

### Another member's rows are normalised before they are counted

- **Figures are in the viewer's base currency**, through the same
  `amountInBase` the dashboard folds with. A peer's row with no base stamp is
  given one that matches no currency, so `amountInBase` converts it live
  rather than trusting a snapshot in the other member's base. A real stamp is
  left to decide.
- **The receipt fields are stripped** from a peer's row: another member's
  receipts are not shown here ([0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)
  records what the stored links still allow).
- **Each row resolves its category through its own member's catalogue** — the
  built-ins overlaid with that member's own — so a custom category renders by
  name wherever its row appears. Rather than being copied, the category merge
  moved out of `CategoryService` into `category-merge.utils.ts`, and the
  budget period check became the exported `isSpentCurrent` in
  `budget.service.ts`; both are stateless.
- **A budget whose `spent` belongs to another period shows 0, with a note.**
  Only its owner can recompute it; the viewer never tries.

### The surfaces are read-only by construction

`app-transaction-row` gains `interactive` — false renders line 1 as plain
text rather than the row button, answers no click or key and links no place —
and `member`, which names whose row it is on line 3. The budget and goal cards
gain `readOnly`, which drops the budget menu, the goal's actions, "View
transactions" and *contribute*, and disables the checklist's boxes, drawn in
the text's own colours rather than Material's faded disabled ones: the
checklist is the only way to read another member's items. The combined
totals reuse the dashboard's `FinancialSummaryComponent`, and a period is
read to the end of today, as the dashboard reads it, so a member's line
covers the same window as their own dashboard. The figures in it can still
differ: a member's recurring rules post only when that member's own app
catches them up, so the page catches up the viewer's own rules as it opens,
and nobody's app can post another member's.

The budget card stopped truncating on the way. On a read-only card there is
no dialog in which to read the rest of a cut name, so the name wraps, as
[0010](0010-nothing-truncates.md) asks of everything; the change shows on
`/budgets` too, where a long budget name wraps instead of ending in an
ellipsis.

### Offline, and losing access

- **The page holds the listeners** (`connect()` and `disconnect()`,
  reference-counted, closed with the page). `HouseholdService` is a root
  service that opens nothing until a page calls `connect()`. Its root effects
  act only while a connection is held — one re-opens the listeners for a new
  account, the other keeps the own member document's name and picture in line
  with the profile ([0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md))
  — so no household listener outlives the page into a sign-out, an account
  deletion, or the smoke walkthrough's app teardown. On connect it follows
  the profile's `householdId` pointer and the invites addressed to the
  account.
- **The account's own member document is the anchor.** It is the one
  household document always readable to its owner, so it is the first
  household document attached, once the pointer names a household, through a
  subscription that reports whether a value came from the cache
  (`subscribeToDocumentWithMetadata`); the household, the member list and the
  sent invites attach only while it is live.
- **Loss of access is server-confirmed.** A removal or a dissolve is reported
  only when the server says the member document is gone — never from a cache
  that reads `null` offline. The household and member listeners that the rules
  refuse after a removal tear down silently.
- **Offline, every action is refused before it writes anything**, with its
  own message; *Accept*, *Remove*, *Leave* and *Dissolve* refuse before their
  first dialog. The page says its figures may be out of date. With no other
  member's rows cached, the list shows an offline state rather than *no
  transactions*, and another member with nothing cached gets a line saying
  it has not been loaded on this device, not a line of zeros.
- **A member removed while offline keeps the cached view until reconnect**,
  and then sees the notice. A cold offline cache never reports a removal: it
  cannot tell one from a document it never held.
- **A pointer whose membership is gone is cleared by the page**, quietly: once
  when the page first finds no membership, and after a loss it saw live.
  Offline, the clear waits for the connection.

### Focus is never dropped on the page

Nearly every action on the page removes the element that held focus: *Remove*
and *Revoke* take their own row, *Decline* its invite, and creating, joining,
leaving, dissolving and a lost membership swap the whole view, as *Retry*
swaps its notice. The iOS build's VoiceOver starts again from the top when
focus falls to the document. So:

- **A button stays focusable while its action runs** — Material's
  `disabledInteractive`, marked unavailable — and the action in flight
  refuses a second press. A refused action leaves focus where it was.
- **A removed row hands focus on once it has gone**: *Remove* to the next
  member's *Remove*, else the one before, else the *Members* heading (a
  confirm stands in front of every *Remove*); *Revoke* to the *Pending
  invites* heading and *Decline* to the *Invites for you* heading, never to
  another button that acts without asking.
- **A swap hands focus to the view that came in.** The acting section names
  the status it waits for (`HouseholdPageFocus`, provided by the page), and
  the page focuses that view's first heading, or the retry that came back,
  once it renders. Only an action or the page's own lost-access notice sets
  it, so a first load or a change made on another device moves nothing.
- **Every move is made after the next render, and only from the document
  itself**: focus the viewer has put somewhere else stays there.

### The road to shared writes

v1 moves nothing and writes nothing of anyone else's. A household that wants
one record any member can write needs a different home for it. The road:

1. **A `households/{hid}/ledger` subtree** — transactions, categories,
   budgets and goals owned by the household, not by a member. A shared
   transaction cannot reference one member's categories, so the subtree
   carries household categories of its own, seeded from the built-ins.
2. **Membership write rules.** A live, generation-checked member
   (`memberOf`, [0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md))
   may write the ledger, through the same shape validators the per-user
   collections use; the owner keeps the household's own document. The
   predicate exists already, and a write rule is one more use of it.
3. **Budget figures recomputed on the server.** A shared budget's `spent`
   cannot be left to whichever member's client wrote last: two members write
   concurrently, and the period check reads the writer's time zone. A
   Firestore trigger on ledger writes, in `asia-east1` beside the database,
   recomputes it.
4. **A migration with provenance.** A member moves chosen personal rows into
   the ledger; nothing moves without the row's owner choosing it. Each moved
   row carries where it came from — the source account and document id — so a
   move can be traced, and undone by the account it came from.
5. **The trigger.** Take this road when a household needs one record that
   any member can write — a shared purchase entered once, a budget spent by
   two people — rather than each member's view of the others. Until then
   the aggregate is the whole feature, and every piece of v1's membership
   carries over unchanged.

## What was rejected

- **A household toggle on the personal pages**, above.
- **Merging on the server** — a function assembling an aggregate. It would
  read every member's rows on every change, store a second copy of them, and
  lag behind the listeners the page already has; a merge of at most eight
  members' listeners is within what a client does comfortably.
- **Recalculating a peer's budget on view.** The rules refuse the write, and
  a figure computed and not written would disagree with the owner's own card.
- **Rendering every row at once.** At the cap that is four thousand fitted
  rows; the list renders a hundred at a time.

## Consequences

- One new route, one new navigation item, one new Settings link card, and in
  the analytics registry one new screen row and one event,
  `household_action`, whose `action` names the step and never the household,
  an address or a member. `/household` joins the smoke walkthrough in its
  setup state and, once the walkthrough's account forms a household, its
  member view with a pending invite, so the axe pass sweeps eight routes and
  both of this one's states.
- Three shared components gain inputs (`interactive`, `member`, `readOnly`)
  whose defaults leave every existing caller as it was.
- The budget card wraps a long name on every page that shows it.
- `FirestoreService` gains a metadata-aware subscription, and the lint ban on
  taking a listener's first value covers it.

## Things that only became apparent while building

- **An unstamped peer row is the one `amountInBase` cannot catch.** The
  emulator run's seed carries one on purpose — a ¥3,200 row whose USD snapshot
  would have been counted as about ¥22 in a yen base — and the page counted it
  right.
- **The period check reads the caller's time zone.** `isSpentCurrent` decides
  in local time, and the stamp was written in the budget owner's.
- **"Offline and empty" is not "nothing this period".** The viewer's own rows
  are nearly always cached from their own pages, so they say nothing about
  anyone else's; the offline state is keyed on other members' rows.

## Known gaps

- **A viewer in another time zone than a budget's owner** can put the budget's
  period start on a neighbouring day and see every current figure of that
  owner's as stale — 0, with the note. Only the owner re-stamps, so for that
  viewer it stays 0. Households usually share a zone; accepted for v1.
- **A member on another base currency is counted at today's rate.**
  `amountInBase` converts any row stamped against another base live, as
  [0148](0148-every-figure-names-its-rate.md) records for a legacy row, so two
  members on different bases see each other at today's rate rather than the
  rate each row was written at, and the page does not caption it.
- **A period with more than 500 rows for one member** is counted from its
  newest 500, and says so.
- **Removal reaches a device only when it is online**; until then the cached
  view stays ([0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)).
- **Budgets and goals keep their own currency** on their cards; the page does
  not total them across members.
- **A member's recurring rules post only from their own app.** Until that
  member opens it, their line and the household's totals are short of what
  their rules have made due. The page runs the viewer's own catch-up; the
  rules refuse anyone posting another member's.
