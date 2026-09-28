# 157. A transaction is private until its owner shares it, and a household sees a faithful copy

**Status:** Accepted, implemented · **Date:** 2026-09-28 · **Issues:** #71, #465

Reference documentation lives in [../household.md](../household.md).

Supersedes [0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)'s
peer reads (a member reading the other members' transactions, categories,
budgets and goals) and
[0154](0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md)'s
read-only aggregate of every member's records. Amends 0154's road to shared
writes: a household sees copies its members write of their own rows, not
rows moved into it, and keeps no categories of its own. The memberships a
row can be shared into are listed by
[0158](0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md);
how a copy is written, kept and repaired is
[0159](0159-a-copy-follows-its-row-in-a-commit-of-its-own-and-a-sweep-repairs-what-the-follow-ups-miss.md),
which also records the roads not taken; the household's own budgets and
goals are
[0160](0160-a-households-budgets-and-goals-are-its-own-counted-from-shared-copies-and-members-contributions.md)'s,
and the server's clean-up after a membership or a household is deleted is
[0161](0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)'s.

## Context

Under 0152 a membership opened a member's whole record to every other
member: every transaction, past ones included, with its note, tags, place,
receipt links and base-currency snapshot, and the member's categories,
budgets and goals. #462 shipped it and #463 fixed its dissolve, both merged
on 2026-09-26. The pipeline of #463's merge (`d0a44a51`) deployed hosting,
the rules and the indexes; #462's (`c0115fb3`) had failed in its smoke step
and deployed nothing, and #463 changed no file under `functions/`, so the
invite callable was never deployed. No household in production has ever
had a second member, so no member has ever read another's rows.

Formed in production to try it, a household showed its owner's whole
history on `/household`, which is what anyone who joined would have read.
What a household may see was then decided again: a transaction is private
until its owner chooses to share it, one account may belong to several
households, and no household figure may include a private row.

Four facts decided the shape of what follows.

**The rules grant documents, not fields.** A read rule on
`users/{uid}/transactions` gives the reader the whole row or nothing. A row
shared with its note, tags and place held back has to be another document.

**A receipt link opens without the rules.** A receipt's download URL
carries a token that Cloud Storage honours without consulting
`storage.rules` (0152). Whoever can read a document holding one can open
the photo, and keeps being able to after the membership ends.

**The author's rows are the only truth.** A copy written by its author is
the author's claim about a row no other member can read. Nothing on another
member's device can check it; only the rules can, and only at the moment it
is written.

**A household is several people's, and a row may be shared into some of an
account's households and not others** (0158). Whatever marks a row as
shared must name each household, and must survive being changed on two
devices.

## Decision

**A transaction is private. Its owner shares it into a household by naming
the household on the row, and the household then sees a copy of it, at
`households/{hid}/ledger/{uid}_{txId}`, which the owner writes and the
rules hold to the row: the same type, amount, currency, date, description
and category, and nothing else of it. No member reads another member's
records.**

### A row names the households it is shared into

`Transaction.sharedWith` holds one share key, `households/{hid}`, for each
household the row is shared into. Absent or empty, the row is private.

- **At most ten keys.** `txOptionalsValid` admits `sharedWith` only as a
  list of at most ten entries, one for each household an account can hold
  (`MAX_HOUSEHOLDS_PER_ACCOUNT`, 0158), and `npm run ledger:check` fails
  when the two numbers differ. The rules cannot iterate a list, so the keys
  are not checked one by one: a key naming a household the account does not
  belong to admits nothing, because a copy also needs a live membership.
- **Namespaced,** so that another kind of share target (the separate
  shared-costs feature planned after this one) can be added beside
  households without a migration.
- **Written whole only when the row is created,** by the transaction form's
  add mode, and inherited by each part of a split purchase. After that the
  keys change only through `arrayUnion` (a share) and `arrayRemove` (an
  unshare, or the end of a membership), so an edit made from a stale read
  cannot undo a share or an unshare made on another device.
  `updateTransaction` throws on an edit that carries `sharedWith`, and
  `addTransaction` refuses a merge write that carries it.
- **Every other door creates private rows.** Recurring occurrences, a CSV
  file, the import wizard, the receipt-scan queue and a backup restore never
  write the field. The export leaves it out, and a restore never sources it,
  so a backup cannot share a row into anyone's household; a merge onto a
  live row keeps the keys it holds.
- **Nothing shares a row automatically.** Every share is the owner's own
  act, on one row (the form's chips or the row menu) or on up to
  `MAX_BULK_SHARE` = 500 chosen in the Transactions list.

### The copy

| Field | What it holds |
|---|---|
| `memberUid` | the row's owner, the copy's only writer |
| `sourceId` | the row's id under `users/{memberUid}/transactions` |
| `gen` | the household's `createdAt` when the copy was written: its generation |
| `pv` | the projection version that wrote it (0159) |
| `type`, `amount`, `currency`, `date`, `description`, `categoryId` | the row's own values, unconverted |
| `category` | `{name, icon, color}` of the row's category, as the author's app held it |
| `bucket`, `bucketGroup` | the built-in category the row counts under, and its top-level group (0160) |
| `goalId` | optional: a household goal the author links the copy to (0160) |
| `updatedAt` | the server's time of the last write |

`LEDGER_COPY_FIELDS` and `LEDGER_REQUIRED_FIELDS` (every field but
`goalId`) in `household-ledger.model.ts` are the rules' `hasOnly` and
`hasAll` for a copy, and `ledger:check` fails when either pair differs.

- **The category is a snapshot.** A built-in's name stays its translation
  key, so each viewer reads it in their own language; a custom category's
  is the author's text. A category the author's list no longer holds shows
  as the built-in it counts under. Each string is bounded (name 100, icon
  64, colour 32) and cut to fit by the projection, never by the rules
  refusing the row.
- **The goal link is the copy's, not the row's.** Only the author sets it,
  on a copy that exists, and every member sees which of the household's
  goals the copy counts toward (0160). The row's personal goal link never
  reaches it.
- **The id is `{memberUid}_{sourceId}`.** A copy that does not exist has no
  `memberUid` for the rules to read, so they take its author from the part
  of the id before the first underscore. `ledgerCopyId` throws for an empty
  part, an account id that holds an underscore or a slash, or a row id that
  holds a slash, rather than name a copy the rules would judge as someone
  else's.

### What a copy withholds, and why

Everything else a transaction holds stays with its owner.

- **The note,** text written for oneself.
- **The receipts** (`receiptUrl`, `receiptUrls`, `receiptCount`). Their
  links open the photos without the rules; a copy holding one would hand
  every member a photo no leave could take back. This closes 0152's gap of
  receipt links reaching every member's device.
- **The tags,** the owner's own labels.
- **The place, its name included.** Where someone was says more than what
  they spent.
- **The recurring and split links** (`isRecurring`, `recurringId`,
  `splitGroupId`). They point into the author's own records, which no
  member can read. Each part of a split is shared as a row of its own, with
  a copy of its own. The fields are withheld, but the copy's `sourceId` is
  the row's id, and its own id (`{memberUid}_{sourceId}`) carries it too,
  so a recurring posting's id names its rule (see *Known gaps*).
- **The personal goal link** (`goalId`, `goalAmount`). Personal goals stay
  private; a copy counts toward a household goal only through its own
  `goalId`, which only its author sets.
- **The base-currency snapshot** (`amountInBaseCurrency`, `exchangeRate`,
  `baseCurrency`). It names the author's base currency, which 0152 let every
  member see, and no viewer needs it: each converts the copy's `amount` from
  its `currency` into their own base at today's rate (0160). Left out, it
  also means a base-currency re-snapshot of the author's rows never touches
  a copy.
- **The rest of the row's own bookkeeping,** `userId`, `period`,
  `createdAt`, `updatedAt` and `sharedWith` itself: a copy never names the
  other households its row is shared into.

### The rules hold a copy to its row

- **Create** needs the id `{auth.uid}_{sourceId}`, no `goalId` (a goal link
  is made only on a copy that exists), a live membership (`memberOf`, with
  0152's generation stamp), the closed shape (`copyShapeValid`: the author
  is the caller, `gen` is the live household's `createdAt`, `pv` a positive
  integer, `updatedAt == request.time`) and `copyFaithful`.
- **`copyFaithful`** reads the author's own row as the commit leaves it
  (`getAfter`), and requires that the row names the household and that the
  copy's type, amount, currency, date, description and category id equal
  the row's. A copy written beside the write that unshares, edits or deletes
  its row is judged against what that write makes of it. So a copy can be
  missing or behind its row, and never ahead of it, never for a row that no
  longer names the household, never for a row that is gone (invariant I3).
- **Update** is the author's alone: `memberUid`, `sourceId` and `gen` are
  fixed, the membership must be live, the shape closed, and either the
  change is only the goal link (0160) or the link is left alone and the copy
  is faithful.
- **What the rules do not compare.** The category snapshot, `bucket` and
  `bucketGroup` are derived from the author's categories, which no member
  reads: they are the author's claims, as a member's own rows are, bounded
  in length. The description and the currency are checked only as the
  row's own rules check them, strings of any length, since a tighter bound
  on the copy would leave a row its owner may keep unshareable.
- **Delete** passes for the author of an existing copy, at any time and
  whether or not still a member; for the author of a missing one, by the id
  prefix, so a delete sent again passes; and for the household's owner, any
  copy. A non-author asking after a missing copy is refused as for another's,
  so nobody learns whether a copy exists.
- **Read.** The author gets and lists its own copies at any time, a list
  filtering on `memberUid` alone, whatever became of the household: that is
  how a leave, a removal, a dissolve and erasure find them without a
  collection-group query. A live member reads the live generation's copies,
  and a list must filter on `gen == createdAt` for the rules to prove it.
- **Lookups.** The author's read or delete, none; a member's read, two; a
  copy create, or an update that follows its row, three (the household, the
  author's member document, the row); a goal link, three (the goal in place
  of the row), and removing one, two; a write that changes only the stamp,
  two on a copy with no link and three on a linked one (its goal); four at
  most, when that goal is gone or of another generation and the write falls
  through to `copyFaithful`, which reads the row as well; the owner's
  delete, one.

### A household sees a row only as a copy, and only while the row names it

That is invariant I1.

- **The peer grants are gone.** The reads of `users/{uid}/transactions`,
  `budgets`, `goals` and `categories` are `isOwner(userId)` again;
  `householdOf`, `householdPeer`, `formerMembershipGone` and
  `householdPointerValid` no longer exist (the pointer's end is 0158's).
  Personal budgets, goals and categories are read by nobody else.
- **A copy leaves with its share.** An unshare deletes the copy in the
  commit that removes the key; a row's delete takes its copy out of every
  household the account's index lists, in the row's own commit; a leave, a
  removal, a dissolve and erasure purge the member's copies (0158, 0161). A
  copy that outlives its row or its share, such as one whose row a client
  built before this change deleted, is found and taken out by the author's
  repair or sweep (0159).
- **No collection-group query** reads copies (invariant I6). Every list is
  scoped to one household or to one account.

### The clean cut

Nothing is migrated. No household in production ever had a second member,
so no row was ever read by anyone else, and there is nothing to carry over.
Before this change is merged, the households in production, each its
owner's own test, are dissolved from the app as it stands: the new client
lists memberships only from the index (0158) and would strand a household
formed under 0152, with no index entry to find it by. The rules deploy
ends `/household` on every client still running the earlier app: its peer
reads and pointer writes are refused, and its create and join commits carry
no index document. An installed PWA keeps the old shell until its service
worker updates.

## What was rejected

- **Reading the row where it is, under a rule that checks `sharedWith`.**
  The rules grant the whole document, so a member would read the note, the
  tags, the place and the receipt links of every shared row. And listing
  across members needs either one listener per member, 0154's four each, or
  a collection-group query.
- **Moving a shared row into the household**, 0154's road (a household
  subtree of transactions, with a migration carrying provenance). A moved
  row stops being its owner's: it leaves their own dashboard, budgets and
  reports, and anyone in the household could write it. A copy leaves the
  row where it is, counted in its owner's figures as before and edited by
  its owner alone.
- **Household categories**, the same road's first step. A snapshot of the
  row's category, and the built-in it counts under, give each viewer a
  name, an icon and a colour, and a household budget a key to count by,
  with no catalogue to keep in step.
- **Revealing more of a row.** The place name and the base-currency
  snapshot were weighed and left out, for the reasons above.
- **A household currency**, with each copy carrying its amount converted
  into it at the author's rate. Each viewer converts into their own base at
  today's rate instead, and a household budget or goal carries its own
  currency (0160); nothing on a copy depends on the author's rates.
- **A time the row was shared, stored on the copy.** A create whose answer
  was lost and is sent again would carry a new one and be refused. With the
  stamp pinned to `request.time` and nothing else chosen by the client, the
  second delivery is judged as an update that changes the stamp alone, and
  passes as a goal-link-only write that sets no goal.
- **Automatic sharing**, by category or through a recurring rule. Not
  built: every share is the owner's own act, and a row that arrives by any
  other door starts private.
- **Writing the copy in the row's own commit, or from the server.** Both
  are roads 0159 weighed and rejected.

## Consequences

- A member's read of a copy costs two lookups; 0152's peer read cost four.
- The household page reads one ledger per household, through the capped,
  generation-filtered listeners of 0160, instead of four listeners per
  member.
- Every write of a shared row costs its copies too: one commit for the row
  and one for each household whose copy changes (0159).
- A shared row still counts in its owner's own dashboard, budgets and goals,
  exactly as a private one does.
- The join dialog, the share hint in the form and the invite mail say what a
  member sees, in English, Japanese and Traditional Chinese. The setup
  component's spec holds the English join dialog to `LEDGER_COPY_FIELDS`:
  each field is named by the word the dialog uses for it, or marked as
  showing nothing of the row but its id, which for a recurring posting or
  a queued scan says more (see *Known gaps* below, #466), and the note,
  receipts, tags and place are named as never shown. A field added to a copy does not compile there
  until it is classified.
- `ledger:check` holds the copy's field lists to the rules, the share-key
  cap to `MAX_HOUSEHOLDS_PER_ACCOUNT` and the snapshot's bounds to the
  projection's, and lists every file that writes transactions. It also
  reads `copyFaithful`'s `d.X == row.X` terms: one for every copy field the
  row decides, and none for the fields it sets aside with a reason (the
  author, the row id, the generation, the projection version, the
  snapshot, the bucket and its group, the goal link and the stamp). A term
  dropped from the rules, or a field the model gains without one, fails the
  check.

## Things that only became apparent while building

- **A category's own strings are unbounded.** A restored backup writes them
  as the file holds them, so a rule bounding the snapshot would refuse every
  copy of a row in a long-named category. The projection cuts each string to
  the rules' bound (`clampText`, shared with the member's display name),
  never ending the cut on a high surrogate, so a surrogate pair is never
  split and every projection of a row cuts alike.
- **A bound on the copy's description would make rows unshareable.** The
  row's own rules leave the description unbounded, so the copy's do too.
- **A missing copy's author can come only from its id.** The rules smoke
  therefore runs as accounts whose ids hold no underscore, and the model
  refuses to name a copy for an account id that holds one.

## Known gaps

- **Only six fields are held to the row.** The category snapshot, `bucket`
  and `bucketGroup` are the author's claims: a member can show any name,
  icon or colour within the bounds, and file a copy under any `bucket` and
  `bucketGroup` strings, which the rules tie neither to each other nor to
  the built-in list. A budget counts a copy when either string is one of its
  category ids, so the claim decides which household budget it counts
  toward, and a string no budget lists counts toward none.
- **The rules accept a whole-list `sharedWith` write.** Only the client
  keeps to `arrayUnion` and `arrayRemove`; a stale whole-list write from any
  other writer could undo a share or an unshare.
- **Faithfulness is judged only when a copy is written.** A copy whose row
  was unshared or deleted without its paired delete (by a client built
  before this change, or a delete-all whose purge failed or was cut off;
  the Data page reports a failed one, and running it again finishes it)
  stays readable to the members until the author's repair, sweep or second
  run takes it out (0159). An unshare or a delete made offline reaches the
  household only when the device reconnects.
- **A device keeps what it read.** A member's device holds a copy in its
  cache until its listener hears the delete; one that never reconnects
  keeps it.
- **A departing member's copies stay listable, normally for seconds.**
  Between the member document's delete and the purge, a live member's
  hand-written query can still list them. The page hides them, and 0161's
  triggers normally close the window but do not promise to (see 0161's
  known gaps).
- **A copy's id says where some rows came from.** The copy's id and its
  `sourceId` carry the row's id, which `copyFaithful` reads the row by, so
  a different id would cost a lookup on every copy write. Most row ids are
  random, but two kinds encode their origin. A recurring posting's id is
  `rec-{ruleId}-{occurrenceMs}`, so the copies tell a member which shared
  rows are postings of one recurring rule, and when each was due: the
  recurring link the copy's fields withhold. A row from the offline receipt
  queue has the id `img_{queuedMs}_{random}-{index}`, which tells a member
  that it came from a scanned image, when the scan was queued, and which
  rows came from the same image. No screen shows either id; the copy's data
  holds it, for developer tools, the device's cache or the API to read.
  Opaque ids for rows written later are #466; rows already written keep
  theirs, and a backup restore keeps the ids the file holds.
- **Anyone who joins later sees what was already shared.** The join dialog
  says so before anyone accepts. It names only transactions; the
  household's budgets, goals and contributions go unmentioned (0160).
- **An account id holding an underscore could share nothing.** No copy can
  be named for it. Nothing in the repository shows whether every production
  account id is free of one.
