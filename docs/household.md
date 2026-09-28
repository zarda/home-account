# Households

A household is a small group of accounts — at most eight — that sees the
transactions its members choose to share, and keeps budgets and goals of its
own, on one page: **`/household`**, reached from the sidebar and from a link
card in Settings. Every transaction is private until its owner shares it, and
what a household sees of a shared one is a **copy** holding a few of its
fields, never the transaction itself. Nobody reads or writes another member's
records. Dashboard, Budgets, Reports and every personal budget and goal stay
the account's own; Transactions gains only the controls that share rows. One
account belongs to up to ten households and switches between them on the
page.

The decisions behind it are in ten records. The first five made the earlier
design for issue #71, merged in PRs #462 and #463, in which every member read
the others' whole records; the last five, for #465, make it what this page
describes, and where a later record replaces part of an earlier one, the line
says so.

- [ADR 0152](ADR/0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)
  — a household is a membership, counted in its generation. Its peer reads
  are superseded by 0157, and its profile pointer and one-household rule by
  0158.
- [ADR 0153](ADR/0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md)
  — the invite is the owner's callable lookup by email, capped, with plain
  answers. Amended by 0158: step 10 and the member check.
- [ADR 0154](ADR/0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md)
  — the household view on a page of its own, and its focus contract. Its
  read-only aggregate is superseded by 0157 and its road to shared writes
  amended by 0157; that road's step 3 and the stale-`spent` display are
  superseded by 0160, and 0161 narrowly revisits its rejection of a merge
  on the server.
- [ADR 0155](ADR/0155-journeys-that-need-two-accounts-run-against-the-emulators.md)
  — journeys that need several accounts run against the emulators.
- [ADR 0156](ADR/0156-a-dissolve-that-finds-its-household-already-gone-finishes-instead-of-failing.md)
  — a dissolve that finds its household already gone finishes. Its known
  gaps are closed by 0158.
- [ADR 0157](ADR/0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md)
  — a transaction is private until its owner shares it, and a household sees
  a faithful copy.
- [ADR 0158](ADR/0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md)
  — an account holds up to ten memberships, each named by an index it owns.
- [ADR 0159](ADR/0159-a-copy-follows-its-row-in-a-commit-of-its-own-and-a-sweep-repairs-what-the-follow-ups-miss.md)
  — a copy follows its row in a commit of its own, and a sweep repairs what
  the follow-ups miss.
- [ADR 0160](ADR/0160-a-households-budgets-and-goals-are-its-own-counted-from-shared-copies-and-members-contributions.md)
  — a household's budgets and goals are its own, counted from shared copies
  and members' contributions.
- [ADR 0161](ADR/0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)
  — a deleted membership or household is swept by server triggers, as a
  backstop.

## What members can and cannot see

A member sees one copy of each transaction a live member has shared into the
household, at `households/{hid}/ledger/{uid}_{txId}`. A copy holds, of its
row:

- the **type**, the **amount** and **currency** as entered, the **date** and
  the **description**;
- the **category**: its id, and a snapshot of its name, icon and colour as
  the author's app held them — a custom category shows by the name its author
  gave it, a built-in in the viewer's language;
- the **bucket** and **bucket group**: the built-in category, and that
  built-in's top-level group, the row counts under in a household budget;
- the **household goal** it counts toward, when its author chose one.

Beside them go who shared it, the row's id, the household's generation, the
version of the projection that wrote it and the server's time of its last
write. Nothing else of the row leaves the account: never its note, its
receipts (neither the photos nor their links), its tags, its location — not
even the place's name — its recurring or split links, the personal goal it
counts toward, or its base-currency snapshot (`baseCurrency`, `exchangeRate`,
`amountInBaseCurrency`). The row's id, though, is the copy's own id and its
`sourceId`, and some ids say more than which row: a recurring posting's is
`rec-{ruleId}-{occurrenceMs}`, and the rows of a scan queued offline are
`img_{queuedMs}_{random}-{index}`. So the copy data tells a member, though
no screen shows it, which shared rows one recurring rule posted — the
recurring link the fields leave out — and when a scan was queued and which
rows came from it ([Known gaps](#known-gaps)). The currency each shared row
was entered in shows; the member's base currency does not. The rules hold a
copy to exactly these fields ([below](#the-rules-and-what-they-cost)), and
`npm run ledger:check` fails when the app's list and the rules' differ.

- **The household's own budgets, goals and contributions.** Every live
  member reads all of them: who made each budget and goal, and each member's
  contributions to a goal, with its amount and date.
- **Nothing else.** Categories, personal budgets and goals, recurring rules,
  saved searches and answers, category and tag memory, import history,
  monthly snapshots, AI provider keys, the sign-in log, feedback and the
  profile stay the owner's alone. The profile is never shared, so a member's
  email address is not. The only addresses that pass between members are the
  one an owner types into an invite, which the invite holds for the two of
  them, and the inviter's own verified sign-in address, which the invite mail
  names and the invite shows the invitee in the app.
- **Who a member is**, to the others: their display name (at most 100
  characters) and their picture, which is kept only when it is served from
  Google's account-picture hosts (`https://lh3.googleusercontent.com/` to
  `lh6`). Any other host would learn every viewer's address each time the
  page loads. Both are copied from the member's profile when they join, and
  follow it after that: when the member's own page next opens, it rewrites
  them if the profile has changed, as the rules allow.
- **Anyone who joins later** sees every row already shared into the
  household, past dates included, and its budgets, goals and every member's
  contributions; nothing that was never shared. The join dialog tells
  everyone who joins that anyone joining later sees what was already
  shared; it names only transactions, and says nothing of the household's
  budgets, goals or contributions ([Known gaps](#known-gaps)).
- **Nobody writes anyone else's records.** A personal record is written only
  by its owner. Only its author writes a copy, and only as a faithful copy of
  a row that names the household. The household's budgets and goals are
  written by any live member and deleted by their maker or the owner; a
  contribution is written once, by the member it is from.
- **What a device keeps.** The app caches what it reads. A member removed
  while their device is offline keeps seeing the cached view until it
  reconnects, and a removed or departed member's device keeps the copies it
  cached until that cache is evicted or cleared. A row its author stops
  sharing while offline stays visible to the others until the author's
  device reconnects.

## Sharing

**Private** means a row whose `sharedWith` is absent or empty: no copy of it
exists in any household, and no household figure counts it. A row starts
private unless the transaction form's *Shared with* chips name a household as
it is made. Recurring occurrences, imported rows, rows posted from the
offline queue and restored rows all start private, and nothing shares a row
by rule.

A shared row names each household in `sharedWith` as a share key,
`households/{hid}`, at most ten of them: one for each household its account
can belong to. The keys are written with the row only when it is made (a
split's parts carry their purchase's). After that they change only by
`arrayUnion` and `arrayRemove`, through sharing and unsharing: an edit that
carries `sharedWith` is refused before it is sent, and so is a merge write
that carries one.

- **One row.** The transaction form shows *Shared with* — one chip per live
  membership, earliest joined first — whenever the account belongs to a
  household. A new row goes out with the households chosen. On an edit, a
  household taken off is unshared before the edit is written (queued ahead
  of it when offline), so it never receives the edited text; if one cannot
  be taken off, the save stops with the edit still in the form, and one
  taken off stays off even when the edit after it is refused. A household
  added is shared once the edit is written: after it lands when online,
  queued right behind it when offline. When a household is
  deselected the form says it will no longer see the row and none of its
  goals will count it, and offline, that it keeps seeing the row until the
  device reconnects. In the transactions list, a row's menu has *Share
  with…*, a dialog with one checkbox per household that adds and removes,
  and, on a shared row, *Stop sharing*, which names the households and asks
  first. A shared row wears *Shared · {name}* or *Shared · {name} +{count}*,
  whose accessible name lists every household. A key left by a membership
  that has ended names nobody, and no control touches it.
- **Many rows.** *Select* on the transactions list turns on a select mode,
  offered while the account belongs to a household and the list has rows. A
  click or Enter on a row chooses it instead of opening it, *Select all
  shown* takes the loaded rows up to the room left, and *Done* or Escape
  leaves. At most **500** rows (`MAX_BULK_SHARE`) are chosen at once; the
  count and any rows left out are announced together. *Share with…* and
  *Stop sharing* run one household after another over the same rows, show
  their progress, and report the result in one notification.
- **What a share does.** `LedgerShareService.share` reads the account's
  index again and refuses a household that is not a live membership
  (`notMember`). That read is answered by the index listener from what it
  last heard, and a household formed or joined in a transaction reaches the
  listener only once the server sends it on, so online a household the read
  does not list as live is looked up on the server, its one index document,
  before the share is refused; a server that does not answer rejects the
  share with its own failure rather than `notMember`. Offline the listed
  answer stands. `reconcile` and `purgeMember` judge the membership the same
  way ([one-shot-reads.md](one-shot-reads.md#memberships-and-shared-rows-71)).
  Online, the share reads the rows, ten at a time, and keys only those a copy
  can hold (income or expense, an amount above zero, a date, a description,
  a currency and a category): a key with no copy behind it would keep the
  sweep's counts apart. It answers the others as skipped, and when none is
  left to key it refuses (`unshareable`) with nothing written. One row's
  refusal reads `transactions.share.unshareable` (*This transaction can't be
  shared: …*); a bulk share with rows skipped reports
  `transactions.select.unshareable` with their count in place of its
  success message. It adds the key to each row kept, 450 rows a commit, then
  reads each row again and writes its copy. Offline, nothing is read first
  or skipped: one row's copy is written from the cached row, queued behind
  its key; several rows queue only their keys, and the household is marked
  for a full pass, which writes their copies once the device is back
  (*… will see … once your device is back online*) and takes the key off a
  row no copy can hold.
- **What an unshare does.** Each row's copy is deleted and its key removed in
  one commit, 225 pairs a commit. The rules refuse neither, member or not, so
  an unshare works offline and after a membership has ended. The copy goes,
  and with it any goal link on it.
- **Editing and deleting a shared row.** Its copies follow an edit ([the
  ledger contract](#the-ledger-contract-and-the-sweep)) and keep their goal
  link. A delete takes the row's copy out of every household the account's
  index lists — ended memberships included, whatever the row's `sharedWith`
  says, since a stale cache may not show the latest share — in the row's own
  commit, or in its own transaction for a row linked to a personal goal.
- **Delete all transactions** on the Data page deletes the rows, then takes
  the account's copies out of every household the index lists
  (`TransactionService.wipeTransactions`). When that purge fails after the
  rows are gone, the page does not say the delete failed, since the list is
  already empty: it says *{count} transactions deleted, but some households
  still show them. Try again to remove them.*
  (`settings.transactionsDeletedCopiesKept`), or, for a run that found no
  rows, *Some households still show transactions you deleted. Try again to
  remove them.* A run that finds no rows but takes copies out says
  *Households no longer show the transactions you deleted.*

## Several households, and the switcher

An account belongs to up to **ten** households
(`MAX_HOUSEHOLDS_PER_ACCOUNT`). Each membership has an entry in the account's
own index, `users/{uid}/households/{hid}`, written in the same commit as the
member document it lists. The index is how the account's app finds every
household it belongs to, and no other account reads it. Starting or joining
a household at ten live memberships is refused — *You already belong to 10
households, the most one account can. Leave or dissolve one before starting
or joining another.* — counted on the server. At the limit each unended
entry is judged on the server, and one whose membership ended without this
device (a removal, a dissolve) is ended on the way rather than counted. The
rules do not count memberships: the app does, and the invite callable reads
the invitee's index to refuse an account that already holds ten
([step 10](#the-invite-callables-answers)).

- **The address.** `/household` and `/household/:hid` are one page, so a
  switch keeps the page, its listeners and its focus. The page shows the
  household the address names; else the one last chosen on this device
  (`household.selected.{uid}`); else the earliest joined. An address naming a
  household the account is not in is replaced, in place, by that choice.
  The setup is a view of the page, not an address.
- **The switcher**, *Viewing household*, is in the page header whenever the
  account belongs to a household, the setup included. It lists each live
  membership by name, *Owner* beside those the account owns, then *Start or
  join another household*. Arrow keys and typing on the closed switcher open
  its list rather than stepping through the households one by one.
- **A switch** moves focus to the first heading of what came in: *Income and
  spending* for a household, *Invites for you* for the setup. A dialog
  opened for one household closes unanswered once another is shown.
- **Analytics** sees `/household/:hid`, never a household's id, on the
  app's own events and on the hits gtag logs by itself
  ([analytics.md](analytics.md)).

## Flows

**Start.** On `/household`, *Start a household* with a name of 1 to 60
characters. The creator is its owner. The household, the owner's member
document and the owner's index entry are written in one commit, their
generation stamped with the server's time. A create whose answer was lost,
sent again and refused, is read back from the server and taken as done when
the household it made is there.

**Invite** (owner only). *Invite by email* takes the address the other person
signs in with; they must have signed in to the app once. The invite goes
through the `inviteToHousehold` callable, which looks the address up, writes
the invite, and emails it. The mail names neither the household nor anyone's
display name, and says that household members see only the transactions each
member chooses to share. The pending list shows each invite's expiry — seven
days — and what became of its mail:

| Shown | Stored `mail` | Meaning |
|---|---|---|
| *Emailed* | `sent` | The mail server accepted it. |
| *Sending the email…* | `failed`, less than 40 seconds old | The callable is still sending; it writes `failed` first and corrects it when the send settles. |
| *Not emailed: the daily email limit was reached* | `held` | A mail cap was reached — three invite mails per recipient in 24 hours, or 100 per UTC day in all. Nothing was sent; the invite stands. |
| *Couldn't be emailed* | `failed` | No verified inviter address, the mail could not be counted against the caps, the send failed or passed its ten-second deadline, or the status could not be recorded. The invite stands. |

Either way the invite waits for the invitee in the app. *Revoke* withdraws
it. Inviting the same person again refreshes their invite rather than taking
a second seat.

**Join.** The invitee sees *Invites for you*, each with the name the inviter
signs in under, the address their provider verified — or, when it verified
none, *The sender's email address isn't verified* — and when it expires. The
name is the inviter's own choice, so the address is what says who sent it;
the callable strips the name of invisible format characters (bidi overrides,
zero-width characters) that could make it read as another. *Accept* opens a
confirmation that names the sender's address the same way and says, in plain
words, that everyone in the household sees only the transactions the joiner
chooses to share — of each only its type, amount and currency, date,
description and category, never its note, receipts, tags or place — that
anyone who joins later also sees what was already shared, that a
transaction whose sharing stops leaves the household, and that nobody can
change the joiner's records but them. Accepting then runs in this order:

1. At ten live memberships it is refused, before anything is written. A
   rejoin of a household whose entry is still listed is not one more.
2. What an earlier membership of the same household left behind is taken
   out: the account's copies there, and the household's key on its rows. A
   rejoin therefore shares nothing again by itself.
3. One transaction reads the invite, writes the member document with the
   generation the invite admits to, consumes the invite and writes the index
   entry.
4. When that transaction is refused, the member document is read back from
   the server, and the join is taken as done if it is there.

The message after joining names the household as it is called now, not as
the invite named it. *Decline* deletes the invite. An expired invite offers
only *Decline*. A join the rules refuse is explained as expired (judged with
fifteen minutes of margin for a slow device clock) or no longer available.

**Leave** (member only). The confirmation says the member's shared
transactions leave the household, and that *The contributions you recorded
on its goals stay with those goals, left out of the goals' totals and lists
unless you rejoin.* Then, in this order:

1. One commit deletes the member's own member document and marks its index
   entry ended.
2. The account's copies in the household are deleted, then the household's
   key is taken off its rows, 450 a commit each. The server is asked whether
   the account is a member before the first and again before the second, and
   either answer of *yes* stops the ending there: the account has rejoined.
3. This device's journal forgets the household, and the index entry is
   deleted last.

When a step after the first fails, the membership has still ended. The page
says *You left {name}. Some of the transactions you shared are still in it;
they'll be taken out automatically later.*, and the next visit's tidy
finishes it ([Losing access](#flows)). Everyone keeps their own records, and
the contributions stay where they are: counted by nobody while the account
is not a member, and counted again should it rejoin the same generation. To
come back the member needs a new invite.

**Remove** (owner only). The confirmation names the member, and says that
*The contributions they recorded on its goals stay with those goals, left
out of the goals' totals and lists unless {name} rejoins.* Their member
document is deleted, and then the transactions they shared are purged: the
owner's app lists the member's copies of this generation from the server and
deletes them ten a commit, asking the server before each commit whether the
member has rejoined, and stopping if so. A progress line shows meanwhile, and
a purge that fails leaves *Try again*. The page stops showing the member's
copies at once, and an owner's page that later hears, from the server, a
copy by an account no longer a member purges that account's copies too. The
removed member's own index entry and the key on their rows are theirs to
clear. If they have the page open, it shows *You're no longer in that
household. The owner removed you or dissolved it.* once the server confirms
it, and moves to their next household, or to the setup; their app then
deletes any copy left, strips the key, and deletes the entry. Nobody's
records are deleted. `onHouseholdMemberDeleted` also deletes any copy left
([the backstop](#the-backstop-triggers)).

**Rename** (owner only), 1 to 60 characters. Each member's index entry lists
the new name the next time that member opens the household.

**Dissolve** (owner only). A warning, then a second confirmation that asks for
the word `DELETE`, typed as it is in every language. Then, in this order:

1. The owner's pending invites into this household are withdrawn.
2. The other members' documents, listed from the server, are deleted, four a
   commit (`HOUSEHOLD_COMMIT_CHUNK`).
3. The household's budgets, then each goal's contributions followed by the
   goal, are deleted, ten a commit.
4. One commit deletes the household with the owner's member document, and
   marks the owner's index entry ended.
5. The owner's copies come out and the key comes off its rows, as for a
   leave, and the index entry goes last.

The other members' copies are taken out by `onHouseholdMemberDeleted`, which
each member document's delete sets off; `onHouseholdDissolved`, set off by the
household's delete, deletes whatever of that generation is left; and each
member's app deletes any copy of theirs left, and strips the key off their
rows, when it next tidies. Everyone keeps their own records. The owner cannot
leave; dissolving is how an owner goes. A dissolve that finds the household
already gone — its own final commit sent again after the answer was lost, or
another tab's dissolve — clears what is left of the owner's membership and
reports done, not an error
([ADR 0156](ADR/0156-a-dissolve-that-finds-its-household-already-gone-finishes-instead-of-failing.md)).

**Erasure** ends every membership the account's index lists
([below](#erasure-and-backup)).

**Offline.** The page says what is shown may be out of date. Every action on
it — the membership actions, the household's budgets, goals and
contributions, and *Count toward…* — is refused with *You're offline.
Household changes need a connection.* before it writes anything; *Accept*,
*Remove*, *Leave*, *Dissolve* and the plan actions refuse before their first
dialog. A plan, contribution or goal-link write whose connection drops on
the way fails rather than waiting on the device
([the plans](#the-households-own-budgets-and-goals)). Sharing and unsharing
from Transactions work offline
([above](#sharing)), and so do editing and deleting a shared row, as for a
private row, with two exceptions that need the network, since each runs in
a transaction: a write that touches a personal goal link (linking, unlinking
or switching the goal, or editing or deleting a row that has one;
[goals.md](goals.md)), and adding or removing a receipt image. With no copy
of the period on the device, the list says there is nothing to show offline
rather than showing an empty period, and a member with nothing cached is
marked *Not loaded on this device* instead of showing zeros. Only the
household shown has its member document listened to, so switching offline
to one never shown on this device finds that document, or the household's,
missing from the cache, which proves nothing. The page then shows *Not
loaded on this device — This household hasn't been loaded on this device
yet. Connect to see it.* (the status `notLoaded`), never the setup, which
would say the account is in no such household; the member view follows
once the connection brings it.

**Losing access.** A removal or a dissolve is reported only when the server
confirms the account's own member document is gone, never from the cache,
and only for the household shown. The page then says so — *You're no longer
in that household. The owner removed you or dissolved it.* — moves to the
next household, or to the setup, and tidies the ended membership: copies
deleted, key stripped, index entry deleted. The notice outlasts the tidy. It
lifts when the account's member document is next heard live, in the
household shown with the lost entry no longer listed live, or in the lost
household itself. The page moves on at once, and the household moved to is
usually heard live before the tidy lands, so the notice stays up over it
until that member document is heard again, another household is chosen, or
the page is left or the account changes; heard only after the tidy, it lifts
at once. With no household to move to, the notice stays over the setup until
the page is left or the account changes. The account's own leave or dissolve
answers the notices up as it began: each lifts once that ending has ended
the membership, even with its cleanup cut off, and the entry is no longer
listed live, in either order, so the view the ending moves to, the setup
included, shows none. One that fails before the membership ends lifts
nothing. A removal made while the device was offline
shows when it reconnects. No listener hears the end of a household not
shown, so each visit of the page asks for one tidy of the whole index
(`tidyEndedMemberships`), once the index has answered (the member view, no
membership, or the notice that the household could not be loaded) and the
page is online; an offline visit asks once the connection is back. Each
entry is judged by the server, and one whose membership is over is ended
as a leave would end it. Beyond that one, the page tidies again after a loss
it sees, and when it finds no membership to show for a household it has
neither seen live in the visit nor had judged. A household that ends later
in a visit, while another is shown, stays listed until the next visit. A
tidy skips a household this client is itself leaving or dissolving while
the page stays connected; the last disconnect forgets that, so the next
visit's tidy finishes an ending that was cut off, and can run beside one
still going from an earlier visit, which only repeats deletes the rules
admit. A repair that finds a membership over takes its copies and key out
first, and leaves the index entry for the tidy
([Known gaps](#known-gaps)).

**Focus.** No action leaves keyboard focus on the page itself. A button stays
focusable while its action runs, marked unavailable, and the action in flight
refuses a second press; a refused action leaves focus where it was. *Remove*
moves focus to the next member's *Remove* once the row goes — else the one
before, else the *Members* heading. *Revoke* moves it to the *Pending
invites* heading, never to another *Revoke*, since nothing asks before one;
*Decline* moves it to the *Invites for you* heading. Creating, joining,
leaving, dissolving, a lost membership and a switch swap one view for
another, and focus goes to the first heading of the view that came in; after
*Retry* it goes to whatever replaced the notice. A budget or goal made moves
focus to its card's heading, one deleted to *Budgets and goals*, and a
contribution deleted to its goal's heading. A first load, or a change made on
another device, moves nothing. *Show more* keeps focus and says how many
rows are shown and that the new ones are above it; the press that shows the
last of them moves focus to the first row it revealed.

## The invite callable's answers

`inviteToHousehold({ householdId, email, locale })` runs in `asia-east1`.
Every refusal carries a reason in `details.reason`, checked in this order,
and the page maps the reason — never the code alone:

| Step | Code | `details.reason` | The page says |
|---|---|---|---|
| 1 | `unauthenticated` | `signed-out` | You're signed out. Sign in again to send invites. |
| 2 | `invalid-argument` | `email` | That doesn't look like an email address. |
| 2 | `invalid-argument` | `locale` | Invites can't be sent from this version of the app. Update it and try again. |
| 2 | `invalid-argument` | `household` | This household no longer exists. |
| 3 | `permission-denied` | `not-owner` | Only the household's owner can do that. |
| 4 | `failed-precondition` | `self` | You can't invite yourself. (The caller's own verified address.) |
| 5 | `resource-exhausted` | `quota` | You've sent as many invites as allowed for now. Try again later. |
| 6 | `not-found` | `no-account` | No account uses that email address. Ask them to sign in to the app once, then invite them again. |
| 7 | `failed-precondition` | `self` | You can't invite yourself. (The caller's own account.) |
| 8 | `already-exists` | `member` | That person is already in this household. |
| 9 | `failed-precondition` | `full` | This household is full. Pending invites count toward the limit. |
| 10 | `failed-precondition` | `too-many` | That person already belongs to 10 households, the most one account can. |
| — | any code with no reason | — | *Something went wrong. Please try again.* — or the offline message when the device is offline |

A code with no reason is never read as a business answer. A function that is
missing, private or called in the wrong region answers `functions/not-found`,
`functions/internal` or similar with no reason, and must not read as "no
account uses that address". A Firestore `unavailable` or `deadline-exceeded`
reads as offline.

The quota at step 5 is **ten lookups per inviter per 24 hours**, the window
opening at the first lookup; a miss counts, and it is charged before the
lookup. Step 8 reads the invitee's member document in this household
directly, and refuses only one of the live generation. Step 9 counts the
household's members and its other pending, unexpired invites of the live
generation — eight seats in all, the invitee's own pending invite left out —
and is asked again, in a transaction, when the invite is written. Step 10
reads the invitee's index, at most 30 entries (`MEMBERSHIP_READ_BOUND`), and
counts its live memberships of other households: an entry not marked ended,
whose generation matches both its member document and that household. Ten
refuse; so does an index longer than 30, unread. A success returns
`{ inviteId, mail }` and never the invitee's name.

## The household's own budgets and goals

The page's *Budgets and goals* section, between the overview and the members,
holds the household's own plans. Any live member makes and edits them; the
member who made one, while still a member, or the owner deletes it. Personal
budgets and goals never appear here, and never count a shared row.

- **Currency.** Each budget and goal carries its own, chosen when it is made
  — the maker's base currency unless they pick another — and fixed after:
  *The currency is fixed once the plan is made.* The household has no
  currency. The rules hold a plan's currency to three capital letters, the
  pattern the app checks it with, since every member's page formats and
  converts with it and nothing can correct it once made.
- **A budget** counts 1 to 10 built-in expense categories or groups, a group
  taking in every category in it; it has a name of 1 to 100 characters, a
  limit, a weekly, monthly or yearly period from a start date, an optional
  end date and an optional alert threshold. It stores no spending. Each
  viewer's page folds it from the shared expense copies dated inside the
  budget's current window whose bucket or bucket group is one of its
  categories, each converted into the budget's currency at today's rate. A
  member's custom category counts under its nearest built-in ancestor. A
  private row never counts.
- **A goal** has a name, a target in its currency and an optional target
  date. Its progress is the shared copies linked to it, of either type,
  converted into its currency, plus the members' contributions, entered in
  it. The progress is stored nowhere.
- **Contributions.** Any live member records one on a goal: an amount in the
  goal's currency, and a date. It is written once and never edited; its
  member or the owner deletes it. The goal's card lists each one with who
  made it.
- **Count toward…** In *Shared transactions*, each of the viewer's own rows
  has a flag button, shown while the household has an active goal, whose
  menu lists the active goals and *None*. It sets the goal link on the
  viewer's own copy and nothing else. It commits online, as a plan write
  does (below): a link kept on the device and refused as it lands would roll
  back unseen, and nothing repairs a link later, since the journal and the
  sweeps leave it alone. A row shared a moment before has its copy written
  through the device's queue, which a transaction does not wait behind, so
  the link first waits for the server to answer this device's earlier
  writes; going offline meanwhile refuses it as offline. A copy keeps its
  link through its row's edits; an unshare deletes the copy and its link; a
  copy linked to a goal since deleted keeps the link and counts toward
  nothing.
- **Writes commit online.** Every plan, contribution and goal-link write
  commits in a transaction that only writes
  (`FirestoreService.commitOnline`), never through the device's persistent
  queue: a plan write kept on the device would land days later over what
  the household changed meanwhile, or be refused then unseen. One whose
  connection drops fails and says so, and nothing is kept to be sent once
  the page is gone; on a network that drops traffic silently it waits as
  long as the browser does. The server may have taken a create before the
  connection dropped, so a create that fails that way says *The connection
  dropped before this was confirmed, so it may already be saved. Save again
  once you're back online: it won't be saved twice.* Each dialog that makes
  a budget, a goal or a contribution draws one id for all its saves
  (`newId`); a create sent again under it, by the transaction's own retry
  or by another save, is refused by the rules as a change to what landed,
  read back from the server, and taken as done when this member made it in
  this generation. Only the sweep of a deleted goal's contributions goes
  through the queue, since deleting a contribution already gone does
  nothing. While a write runs, the section's buttons and the dialog's
  *Save* and *Cancel* stay focusable, marked unavailable, and a press is
  refused ([Focus](#flows)).
- **Deleting a goal** deletes its contributions with it. A goal's delete does
  not reach its subcollection, and the rules let a live member delete another
  member's contribution only once its goal is gone, so the goal goes in one
  commit with its first six contributions, and the rest follow six a commit
  (`HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK`; see [commit sizes](#commit-sizes)).
  A sweep cut short is resumed while the page lives; one it never finishes
  goes with the household.
- **When the page is empty.** *This household has no budgets or goals yet.*
  A list that failed says its figures may be incomplete rather than showing
  none, and offline, with nothing cached, the section says the plans haven't
  been loaded on this device.

## The ledger contract and the sweep

Six invariants hold the copies to their rows:

1. **A household sees a row only as a copy**, and only while the row's own
   `sharedWith` names the household.
2. **A personal write never shares a commit with a write a rule could
   refuse.** Only the author's deletes of its own copies go with it, which
   the rules judge without a lookup and never refuse. A shared row's edit is
   therefore as safe offline as a private row's.
3. **Every copy create or update is judged against its row as the commit
   leaves it.** A copy can be missing or behind, never ahead of its row, and
   never for a row that is unshared or deleted.
4. **Every copy write is journaled before it is issued**, and a count check
   and a weekly full pass repair whatever the follow-ups miss.
5. **A membership ends before its copies are purged**, and its index entry is
   deleted last.
6. **No collection-group query.** Every list is scoped to one household or to
   one account.

**Follow.** Every write path issues the personal write, then follows it,
then awaits it. `LedgerShareService.follow(txId, before, after)` is
synchronous and never throws. For each household the row names after the
change whose copy would change, it journals the copy and issues one `set` —
a merge, stamped with the server's time, so it never clears a goal link — in
a commit of its own. A household the row stopped naming is journaled for the
repair; follow never deletes. A copy is not written for a household that is
not a live membership, or for a row the rules would refuse; either is
journaled instead. Before the account's index and categories are loaded,
every household the row names is journaled at once and the follow waits for
them. A change a Firestore transaction commits — a row linked to a personal
goal, a split, receipts appended in a transaction — is journaled before the
commit (`intend`) and followed after it lands (`followMany`, up to five
copies a commit). A shared edit costs one commit for the row and one for each
household it names: 1 + N, with N at most ten.

**The journal** is device-local, in `localStorage` under
`ledger.journal.{uid}`: the copies whose last write has not been
acknowledged or whose repair is owed, and the households owed a full pass.
It holds at most 500 rows; a row past that marks its household for a full
pass instead. An entry clears when the last write in flight for it is
acknowledged with nothing owed since. A refused copy write schedules a repair
two seconds later. Each mark takes the next number of a journal-wide counter
(`seq`) that only grows, a household already marked included; a full pass
reads the counter before it reads anything else and clears only a mark
numbered at or below what it read, so a mark made while it runs, in this tab
or another, outlives it. The journal is kept once any mark has been made,
since a counter started again would let an older pass clear a newer mark.
The journal is lost with the site's data, in a private window, or when two
tabs write it at once, so the weekly full pass is the floor under it.

**The sweep** (`reconcileAll`) runs online and signed in only, one at a time:
at start-up, from an idle task (`requestIdleCallback` with a ten-second
timeout, or three seconds where there is none), once per account in an app
session; on each reconnect; once per visit of the household page; and at the
end of a restore. `LedgerShareService`, which holds the copies and runs the
sweep, is reached only by dynamic import, so it stays out of the initial
bundle; the transaction form's *Shared with* chips and the transaction
service's follow-up hook are in it
([performance.md](performance.md#the-budget)). A sweep re-reads the
categories, repairs the journal, re-reads the index, then takes each live
membership in turn:

- **The repair** waits for every earlier write to be answered, reads each
  journaled row and its copy from the server, ten at a time, and judges the
  membership from the server. An ended membership has its copies purged and
  its key stripped, as in a leave; its index entry is left for the household
  page's tidy. In a live one, orphans and copies of another generation are
  deleted first, then missing or different copies written.
- **The check** asks the server for two counts: the account's rows naming
  the household, and its copies there. Equal counts settle it; unequal or
  unanswered go on to a full pass. It counts only. A sum filtered on another
  field needs a composite index in production — for the rows, one over every
  account's transactions — which the emulator never enforces, so a copy
  behind in its amount alone, like one behind in any other field, waits for
  the journal or the full pass.
- **The full pass** lists both sides from the server, deletes orphans (the
  row gone, no longer naming the household, or of another generation), takes
  the household's key off each row naming it that no copy can hold (450 a
  commit, so the next check counts both sides alike), then writes the
  missing and the different. The index can still show a membership the
  owner removed or dissolved, whose copies the rules refuse, so the first
  commit of copies that fails (the pass cannot tell a refusal from any
  other failure) has the server judge the membership, once a pass: an ended
  one is cleaned up as in a leave and the pass ends; one the server cannot
  judge, or that became a membership again during the clean-up, ends the
  pass with the household still marked; a live one goes on. It runs instead
  of the check when the journal marks the household, when this device's
  last full pass for it is missing or a week old (`FULL_SWEEP_EVERY_MS`), and
  after a restore. Any copy not written or taken out, or key not taken off,
  keeps the household marked. Each pass stamps `ledger.sweep.{uid}.{hid}`.

`reconcile(householdId, mode)` runs one household's check or full pass for
the specs and the smoke; the app has no caller and reconciles through
`reconcileAll`. It holds the sweep's lock: it waits for a running sweep, and
a sweep asked for meanwhile runs after it.

**Reprojection.** A copy's category snapshot and buckets come from its
author's categories. A category edit that sets a name, icon, colour or parent
marks every live household for a full pass, then rewrites the copies of the
account's shared rows in that category that differ: one full pass per live
household at the next sweep. Once the category write lands, every live
household is marked again, so a full pass that read the categories before
the write reached the server leaves the mark for the next. A parent change
rewrites only that category's copies at once; the rows in the categories
below it wait for that full pass.
A soft delete is not handed on, since no copy shows the flag. After a hard
delete, the copies keep their snapshot until each row is next projected, then
show the built-in the row counts under.

**The projection version.** Every copy carries `pv`, the
`LEDGER_PROJECTION_VERSION` (1) of the app that wrote it. A projection is
corrected by raising it: every older copy then differs, and the next full
pass rewrites it. A copy a newer version wrote is compared only on the fields
its row decides, so two builds never rewrite each other's snapshots and
buckets; after a rollback, the newer version's copies keep theirs until a
newer build rewrites them. The version is never lowered.

**The contract check.** `npm run ledger:check`
(`scripts/check-ledger-contract.mjs`, its self-test first) runs in CI right
after *Check Firestore composite indexes*. It holds eight facts that live in
two files each, and nothing at run time compares:

1. The copy's fields: `LEDGER_COPY_FIELDS` and `LEDGER_REQUIRED_FIELDS`
   (`household-ledger.model.ts`) against `copyShapeValid`'s `hasOnly` and
   `hasAll` (`firestore.rules`).
2. Every `LEDGER_QUERY_SHAPES` entry has a `COLLECTION` composite in
   `firestore.indexes.json` with the same fields, order and directions.
3. Every file that writes a `transactions` path — through `commitBatch`,
   `commitOnline`, a single-document write, a transaction's handle or the
   SDK — is on its `WRITERS` list, with the reason:
   `transaction.service.ts`, `goal.service.ts`, `recurring.service.ts` and
   `ledger-share.service.ts`. A listed file that no longer writes fails too.
   A new writer joins the list, with its reason, in the commit that makes it
   one, once it carries a shared row's changes to its copies.
4. `txOptionalsValid`'s bound on `sharedWith` is
   `MAX_HOUSEHOLDS_PER_ACCOUNT`.
5. `copyShapeValid`'s bounds on the category snapshot are
   `LEDGER_SNAPSHOT_MAX_LENGTH`, which the projection cuts each string to.
6. The budget, goal and contribution field lists
   (`household-plans.model.ts`) against their `household*ShapeValid`.
7. `HOUSEHOLD_PLAN_NAME_LENGTH` and `HOUSEHOLD_PLAN_CATEGORY_ID_LENGTH`
   against the rules' bounds, and `HOUSEHOLD_PLAN_CATEGORY_MAX` against the
   `categoryIds` cap, with one `planCategoryAt` check for each place. The
   `matches('^[A-Z]{3}$')` on a budget's and a goal's currency is the
   pattern `HouseholdPlansService.currencyCode` tests with, which carries no
   flag: a wider rule keeps a code nothing corrects, and a narrower one
   refuses what the app offers.
8. `copyFaithful` holds a `d.X == row.X` term for exactly the copy fields
   its row decides: every field of `LEDGER_COPY_FIELDS` except those the
   script sets aside with their reasons (`memberUid`, `sourceId`, `gen`,
   `pv`, the category snapshot, the two buckets, `goalId` and `updatedAt`).
   A dropped term would let a copy show what its row does not hold, and a
   field the copy gains is compared or set aside before it ships; a
   set-aside field the copy no longer has fails too.

It cannot see a path passed in as a parameter, a path built in another file
or joined at run time, a path chosen by a conditional, a reference taken back
out of a list, or whether the rules and indexes are deployed. It reads a
`copyFaithful` term where it stands, so one negated or inside an `||` reads
as held. It does not compare the share-key prefix with the rules' literal,
which the rules smoke covers. And it checks that each declared shape has its
composite, not that every household query is built from a shape.

## Data model

| Path | Fields | Written by |
|---|---|---|
| `households/{hid}` | `name` (1–60, trimmed), `ownerId`, `createdAt` (the request time of the create: the household's *generation*), `updatedAt` on a rename | the owner |
| `households/{hid}/members/{uid}` | `uid`, `displayName` (≤ 100), `photoURL` (optional, Google's picture hosts, ≤ 2048), `role` (`owner` \| `member`), `since` (the household's `createdAt` when it joined), `joinedAt`, and for a member `inviteId` | the member itself (a leave may not be the owner's while the household survives); the live owner deletes another member's; anyone may delete one once the household is gone |
| `users/{uid}/households/{hid}` | `since` (the member document's), `role`, `name` (the household's name when last seen, for listing only), `joinedAt`, `endedAt` (once the ending is under way) | the account, in the same commit as the member document |
| `users/{uid}/transactions/{id}` | `sharedWith` (optional): up to 10 share keys `households/{hid}` | the account; after the create, the app writes it only by `arrayUnion`/`arrayRemove` (the rules check only a list of at most ten) |
| `households/{hid}/ledger/{uid}_{txId}` | `memberUid`, `sourceId`, `gen` (the household's `createdAt` when written), `pv`, `type`, `amount`, `currency`, `date`, `description`, `categoryId`, `category` {`name` ≤ 100, `icon` ≤ 64, `color` ≤ 32}, `bucket`, `bucketGroup`, `goalId` (optional), `updatedAt` (the server's time) | its author; the owner may delete any |
| `households/{hid}/budgets/{bid}` | `gen`, `name` (1–100), `categoryIds` (1–10), `amount`, `currency` (three capital letters), `period` (`weekly` \| `monthly` \| `yearly`), `startDate`, `endDate` (optional), `alertThreshold` (optional), `isActive`, `createdBy`, `createdAt`, `updatedAt`; no `spent` | any live member; deleted by its maker while a member, or the owner |
| `households/{hid}/goals/{gid}` | `gen`, `name` (1–100), `targetAmount`, `currency` (three capital letters), `targetDate` (optional), `isActive`, `createdBy`, `createdAt`, `updatedAt` | as a budget |
| `households/{hid}/goals/{gid}/contributions/{cid}` | `gen`, `memberUid`, `amount` (in the goal's currency), `date`, `createdAt` | its member, once; deleted by its member, the owner, or a live member once the goal is gone |
| `householdInvites/{hid}_{inviteeUid}` | `householdId`, `householdCreatedAt` (the generation it admits to), `householdName` (as it was when sent), `inviterUid`, `inviterName` (the inviter's sign-in name, shown in-app only), `inviterEmail` (the inviter's verified sign-in address, or null; shown to the invitee in-app), `inviteeUid`, `inviteeEmail`, `locale`, `createdAt`, `expiresAt`, `mail` | the callable only |
| `inviteQuotas/{uid}` | as inviter `windowStart`, `count`; as recipient `inboundWindowStart`, `inbound` | the callable only |
| `mailBudget/daily` | `day` (the UTC day, `YYYY-MM-DD`), `count` | the callable only |
| `users/{uid}.householdId` | retired: a profile may not be created with it, and an update may only remove it | the account's app removes a leftover once per account in a session, when `/household` runs its tidy, which it asks for once a visit ([Losing access](#flows)) |

The app offers a household budget only built-in expense categories and
groups; the rules check each entry only as a string of 1 to 64 characters,
and an id no copy is bucketed under counts nothing. The device keeps three
things in `localStorage`, each read in a `try`: the household last chosen
(`household.selected.{uid}`), the journal (`ledger.journal.{uid}`) and the
sweep stamps (`ledger.sweep.{uid}.{hid}`).

Every household list leads with `gen` by equality, which is what lets the
rules prove a member's list holds only the live generation. The six lists
are `LEDGER_QUERY_SHAPES`, each served by a `COLLECTION` composite:

| Shape | Collection | Fields | Used by |
|---|---|---|---|
| `ledgerByDate` | `ledger` | `gen` ↑, `date` ↓ | the view's period and the plans' window |
| `ledgerByGoal` | `ledger` | `gen` ↑, `goalId` ↑ | the copies linked to the goals, 30 goal ids a query |
| `ledgerByMember` | `ledger` | `gen` ↑, `memberUid` ↑ | the owner's purge after a removal, and `onHouseholdMemberDeleted` |
| `activeBudgets` | `budgets` | `gen` ↑, `isActive` ↑ | the plans section |
| `activeGoals` | `goals` | `gen` ↑, `isActive` ↑ | the plans section |
| `contributionsByDate` | `contributions` | `gen` ↑, `date` ↓ | each goal's contributions |

The `budgets` and `goals` composites also cover `users/{uid}/budgets` and
`goals`, harmlessly: those documents hold no `gen`. The author's own lists
(`memberUid ==` alone) and the account's rows naming a key (`sharedWith
array-contains`) are served by single-field indexes.

## The rules, and what they cost

- **A membership counts only in its generation.** A member document grants
  while it exists and its `since` equals the live household's `createdAt`.
  Anything left under an id from an earlier household grants nothing. A
  member's list of members, copies, budgets, goals or contributions must
  filter on the generation; an unfiltered one is refused.
- **Each membership is listed in its account's index.** A member document is
  created only with an index entry of the same generation and role, in the
  same commit, and a household only with its owner's. The account alone
  reads and writes its index: it may touch up an entry's name, mark it ended
  only once its membership is over as the commit leaves it, and delete it
  only then. The rules do not count memberships. `households` is carved out
  of the catch-all that lets an account write its other subcollections, so
  the index block is the whole of what may be written there. A profile
  cannot name a household, and its delete is the owner's alone.
- **Personal records are the owner's.** Transactions, categories, budgets
  and goals are read and written by their owner only. A row's `sharedWith` is
  a list of at most ten keys; the keys are not checked one by one, since the
  rules cannot iterate a list, and a copy is admitted only for a household
  the row names.
- **A copy is faithful.** Only a live member writes one, only as its author,
  under the id `{uid}_{sourceId}`, in the live generation, stamped with the
  request time, holding exactly the copy's fields. Its type, amount,
  currency, date, description and category id must equal its row's as the
  commit leaves it, and that row must name the household. A create carries
  no goal link. An update keeps `memberUid`, `sourceId` and `gen`, and either
  changes only the goal link, to a goal of the copy's generation, or leaves
  the link alone and passes the same comparison. The category snapshot and
  the buckets are not compared: they are the author's claims, bounded in
  length. The author reads, lists and deletes its copies at any time, member
  or not; the owner deletes any copy; a live member reads the live
  generation's. A copy that does not exist is judged by the author in its id,
  and anyone else asking after one is refused as for another's, so it cannot
  learn whether one exists.
- **The household's plans.** A live member reads them, makes one — named
  its maker, at the request time, its currency three capital letters — and
  edits any, keeping its generation, maker, creation time and currency. The
  owner deletes any, and the maker its own while a member; a delete of one
  already gone passes for a live member. A contribution holds exactly its
  five fields, is the writer's own, in the live generation, to a goal of
  that generation, and is never updated. Its author deletes it at any time,
  the owner any, and a live member one that is gone or whose goal is gone as
  the commit leaves it.
- **Writes of memberships.** A member creates and updates only its own member
  document, and may change only its display name and picture — which its
  page does, to follow the member's profile. The owner alone renames the
  household, deletes other members' documents, and deletes the household —
  only in a commit that deletes its own member document too. Once a
  household is gone, anyone may delete a member document left under it.
  Invites are never written by a client; either party may read or delete
  one. The quota and budget documents are refused to every client.

**Lookups.** A read may make ten document lookups and a commit twenty. The
rules' own comments count them:

| Operation | Lookups |
|---|---|
| A personal read or write; one's own member document, its update, or an index entry's name; an author's read, list or delete of its own copy; a rename; an invite's read or delete | 0 |
| Read the household | 1 (the reader's member document) |
| Create a household | 2 (the owner's member document and index entry) |
| Delete the household | 1 (the owner's member document as the commit leaves it) |
| Delete a member document | 1 or 2 (the household, before or after the commit) |
| A member's read or list of copies, plans or contributions, or of members | 2 (the household and the reader's member document) |
| Create or update a copy | 3 (the household, the author's member document, the row as the commit leaves it); a goal link, 3 (the goal in place of the row), and its removal 2; 4 at most, when a write that only restamps a linked copy whose goal is gone falls through to the row |
| The owner's delete of another's copy, a plan or a contribution | 1 (the household) |
| Create or edit a plan; its maker's delete | 2 |
| Create a contribution | 3 (the household, the member document, the goal) |
| A live member's delete of a contribution under a goal that is gone | 3 (the household, the goal as the commit leaves it, the member document) |
| Create a member document | 3 for the owner, 5 for a joiner (with the invite before and after) |
| Create, rewrite or delete an index entry; mark it ended | 1 (the member document as the commit leaves it) |

### Commit sizes

| Constant | Per commit | Why |
|---|---|---|
| `LEDGER_COMMIT_CHUNK` | 5 copy creates or updates | 3 lookups each, 4 at most |
| `LEDGER_PURGE_CHUNK` | 10 owner deletes of others' copies or plans; 10 of an erasure's deletes of its own contributions | 1 lookup each, and none for an author's own |
| `LEDGER_OWN_WRITE_CHUNK` | 450 own copy deletes, or `arrayUnion`/`arrayRemove` on own rows | no lookup; under the 500 writes a commit holds |
| `LEDGER_UNSHARE_PAIRS_PER_COMMIT` | 225 copy delete and `arrayRemove` pairs | half of the above |
| `HOUSEHOLD_COMMIT_CHUNK` | 4 member documents or invites | the owner's delete of a member document looks up the household |
| `HOUSEHOLD_CONTRIBUTION_DELETE_CHUNK` | 6 contributions beside a goal's delete | 2 + 6 × 3 = 20 |

## Figures on the page

- **In the viewer's own base currency.** The overview's combined totals,
  each member's line and each row are in the viewer's base. A copy already in
  it counts exactly; any other is converted at today's rate, and every figure
  that converted something carries *At today's rate*
  (`common.atTodaysRate`): under the combined totals, under each member line
  and each row that converted, and on a budget or goal card whose figure
  converted something. A copy holds no base snapshot, so no figure uses one.
  Contributions are entered in their goal's currency and need no caption.
- **A household's plans in their own currency**, converted the same way and
  captioned the same way ([above](#the-households-own-budgets-and-goals)).
- **Converted figures wait for the rate table.** Until the rate table has
  settled on a source (live, this device's cache, or the compiled-in table;
  `CurrencyService.rateSource`), it converts every currency 1:1. So a copy
  in the period in another currency than the viewer's base is held out of
  the rows and every figure (`HouseholdLedgerService.ratesPending`), and the
  overview shows its loading state rather than figures short of it; a plan
  whose figure converted something reads *Counting…* in place of its
  figures. Nothing in one currency waits.
- **2,000 copies per household and window** (`LEDGER_VIEW_CAP`), across all
  its members. Past that, the newest 2,000 are shown and counted, and the
  page says that more were shared in the period than it shows; no member is
  named. The list shows 100 rows at a time, with *Show more*; the totals
  count every row kept.
- **Two listeners.** The period and the budgets' current windows each have
  a capped listener on the ledger; the second opens only when the period does
  not hold the budgets' window, so a later budget window cannot crowd the
  period's rows out of one cap. A page left open past midnight hands the
  plans the new day.
- **Only live members count.** A copy by an account no longer a member is
  neither shown nor counted, from the moment the members list stops naming
  it. A member who shared nothing shows zeros; one with nothing cached shows
  *Not loaded on this device*; a listener that failed says *Some shared
  transactions couldn't be loaded*, or, per member, *Their figures couldn't
  be loaded*.
- **A budget's window** is judged in the viewer's own time zone, so members
  in different zones can fold it over different days
  ([dates.md](dates.md)).
- **Recurring rows count once shared.** A recurring rule's occurrence is a
  private row like any other, and reaches a household only if its owner
  shares it; the household page posts no recurring rule.

## Where it lives

- **Models.** `models/household.model.ts` (the household, member, invite and
  index entry, and `MAX_HOUSEHOLDS_PER_ACCOUNT`), `household-ledger.model.ts`
  (the copy and its field lists, the commit and view constants,
  `LEDGER_PROJECTION_VERSION`, `LEDGER_QUERY_SHAPES`, `shareKey` and
  `ledgerCopyId`), `household-plans.model.ts` (budgets, goals, contributions
  and their bounds), and `sharedWith` on `transaction.model.ts`.
- **Pure helpers** in `core/utils/`: `ledger-projection.utils.ts`
  (`projectRow`, `bucketOf`, `copyDiffers`), `household-plans.utils.ts` (a
  budget's window and spending, a goal's progress, which categories a budget
  may count), `household-index.utils.ts` (an index entry read as a
  membership, the earliest-joined order, the `chunked` the household
  services split their commits with, and the `clampText` that cuts a
  member's display name and a copy's category snapshot to their bounds),
  `capped-feed.utils.ts` (`openCappedFeed`, the capped listener the ledger
  view and the plans both open, so they agree on when a list is cut and when
  it is incomplete) and `share-change.utils.ts` (what a control's choice adds
  and removes).
- **`HouseholdService`** (`core/services/household.service.ts`, root) lists
  every membership from the index. It opens no listener until a page calls
  `connect()`, and the last `disconnect()` closes them all. It exposes
  `memberships`, `liveMemberships` and `selectedHouseholdId`, and for the
  selected household `status` (`idle` before a connection, `loading`,
  `notLoaded` offline when this device has never cached the household or
  the account's member document in it, `none`, `member`, or `unavailable`
  when the household could not be read),
  `household`, `ownMember`, `members` (the owner first, then by joining
  order), `isOwner`, `receivedInvites`, `sentInvites`, and per household
  `lostHouseholds` and `lostAccess`. Its writes are `create`, `accept`,
  `decline`, `invite`, `revoke`, `rename`, `remove`, `purgeRemoved`, `leave`
  and `dissolve` — each on the household it is given, or else the selected
  one — `select`, `tidyEndedMemberships` for the page, and `deleteAll` for
  erasure. Every refusal is a `HouseholdError` whose message is already in the
  user's language. The writes nobody asks for keep the own member document's
  name and picture in line with the profile, and the index entry's name in
  line with the household, each asked for once.
- **`LedgerShareService`** (`ledger-share.service.ts`, root, reached only by
  dynamic import) holds the copies: `follow`, `intend` and `followMany` for
  the write paths, `share` (answering the rows it skipped) and `unshare`,
  `repairJournal` and `reconcileAll`, `cleanupMembership` for an ending,
  `purgeMember` for the owner, `purgeOwn` for *Delete all transactions*, and
  `reprojectCategory`; `prepare` and `reconcile` serve the specs and the
  smoke.
  `ledger-journal.ts` beside it is the journal and the sweep stamps.
  `app.config.ts` arms the start-up sweep (`armLedgerSweep`).
- **`RowSharingService`** (`row-sharing.service.ts`, root) is the share
  controls' seam: the live memberships to offer (`targets`), one row's
  change (`apply`) and many rows' (`applyToRows`). The targets follow the
  signed-in account for as long as they are subscribed: on a change of
  account the listener on the last account's index closes and re-opens on
  the new account's, with none of the last one's households offered
  meanwhile, and an index that could not be read ends only that account's
  listing, never the next one's.
- **`HouseholdLedgerService`** and **`HouseholdPlansService`**, provided by
  the page: the first holds the ledger's two listeners and exposes `rows`,
  `totalsByMember`, `combined`, `truncated`, `loading`, `fromCache`,
  `incomplete`, `ratesPending` and the plans' window; the second holds the
  budgets, goals, contributions and linked copies, their figures, every plan
  write, `newId` and `linkCopy`.
- **The Firestore seam** (`firestore.service.ts`): `commitBatch`, which
  issues every write of a batch before it returns; `commitOnline`, which
  commits the same ops in a transaction that only writes, so nothing enters
  the persistent queue; `getDocumentFromServer`,
  which reads inside a transaction abandoned before it commits, because a
  plain get can be answered by an attached listener; `aggregateFromServer`;
  and `waitForPendingWrites`.
- **The invite seam** (`core/services/household-invite-callable.ts`) builds
  the callable on the first invite, with the Functions SDK loaded by a
  dynamic import, in `HOUSEHOLD_FUNCTIONS_REGION`, and against the functions
  emulator only in the `emulators` build.
- **The page** is `features/household/`: the shell with its switcher, the
  setup, the overview (with *Count toward…*), the plans and their dialogs,
  the members, and `household-focus.ts` — where a section hands focus to the
  page when an action swaps the view, and the one idiom every section moves
  focus with. The share controls are in `features/transactions/`: the form's
  chips, the list's row menu and select mode, and `sharing/share-dialog`. The
  transaction row takes `interactive`, `member` and `householdNames`, the last
  for its share chip.
- **The functions**: `household-invite.ts` (every decision of the invite, no
  I/O), `household-invite-handler.ts` (its body, its I/O injected),
  `household-invite-admin-deps.ts` (that I/O over the Admin SDK, with the two
  shape guards a stored value needs before a decision trusts it: a
  household's `createdAt` must be a Timestamp, and an index entry's id a
  possible household id), `compose-household-invite-email.ts` (the mail);
  `household-ledger-cleanup.ts`, `-events.ts` (what a delete event hands
  the cleanup: the path's wildcards and the document as stored),
  `-handler.ts` and `-admin-deps.ts` (the backstop triggers, in the same
  layout); and their wiring in `index.ts`, pinned by `index-wiring.test.ts`.
- **Analytics.** `household_action` sends only its action: `create`,
  `invite`, `revoke`, `accept`, `decline`, `leave`, `remove`, `dissolve`,
  `rename`, `share`, `unshare`, `switch`, `plan_create`, `plan_delete`,
  `goal_link` and `contribute` ([analytics.md](analytics.md)).

## The backstop triggers

Two Firestore triggers delete what the clients leave behind. Neither is on
any write path, and no reader depends on them: each member's app takes its
own copies out when its membership ends, an owner's removal purges the
removed member's, and once a household is gone nobody but a copy's author
can read it. The triggers take out what a purge cut off part-way, an offline
device or a member who never returns leaves behind.

- **`onHouseholdMemberDeleted`**, on `households/{hid}/members/{uid}`,
  deletes that member's copies of the deleted document's generation (`gen ==`
  its `since`, `memberUid ==` the member: the `ledgerByMember` composite).
  Before each page's delete it reads the member document again, and stops if
  the member is back in the same generation. It never touches the member's
  own rows, whose keys are their app's to strip, or the household's plans.
- **`onHouseholdDissolved`**, on `households/{hid}`, deletes what is left of
  the deleted household's generation, in this order: its copies, its
  budgets, each goal's contributions (every goal id listed, a goal already
  deleted included), its goals, and last its member documents of that
  generation — each of whose deletes sets off the first trigger, which finds
  its copies already gone. It is scoped to the generation rather than a
  recursive delete, so nothing of another generation under the same id is
  touched.

Each lists and deletes 500 documents a commit. A second delivery deletes only
what is left. A transient failure (gRPC codes 1, 2, 4, 8, 10, 13 and 14) is
thrown again, so the event is delivered again; any other failure is logged
and the event let go, since a retry would meet the same answer. Both run in
`asia-east1` with `retry: true`, one instance at most and no secrets: they
write only Firestore. Neither is part of the smoke run
([ADR 0155](ADR/0155-journeys-that-need-two-accounts-run-against-the-emulators.md));
node:test covers their planner, handler, Admin SDK deps and event mapping,
and their wiring as deployed: each export's delete event, document path and
`retry: true`, and, checked by `tsc`, that each trigger's event fits its own
mapper and not the other's. Journeys 74 and 75 drive them in the functions
emulator.

## Erasure and backup

Deleting an account ends every membership its index lists, in the first of
the cascade's cloud steps ([account-deletion.md](account-deletion.md)): a
household it owns is dissolved, a live membership is left, and one already
ended is closed, each taking the account's copies out and its key off its
rows before the index entry goes. Before a live membership of a household
it does not own is left, the account's own contributions there are deleted:
every goal of the generation, active or not, has its contributions listed
from the server and kept to the account's own, and they go ten a commit as
their author's deletes. It is the last moment the account can list them,
since an ex-member reads neither the goals nor their contributions, and
whatever stops it stops the erasure before the membership ends, so a retry
finds the rest. Then every invite addressed to or sent by the account is
deleted, the device forgets the household it last chose, and the journal and
sweep stamps are cleared. The step runs again just before the sign-in
account itself is deleted, and the transactions step purges any copy still
left in a household the index names; when that purge fails, the step fails
and the sign-in account stays for a retry. What stays is what belongs to a
household the account did not own: the budgets and goals it made there, and
the contributions it recorded in a household it had already left or been
removed from, which count for nobody and go when their goal or the
household does. The deletion warning names both. The membership is not one
of the Data hub's record kinds ([data.md](data.md)).

The JSON backup carries no share keys: rows are written out without
`sharedWith`, and every restored row is private — a restore merged onto a row
that still exists keeps that row's keys. A restore marks every live household
for a full pass before it writes anything, marks them again as each category
and row write lands, and ends with a sweep that runs it, so the copies follow
what it wrote. The memberships, the household's plans and anyone's copies
are not in the file
([backup-restore.md](backup-restore.md)). Both dialogs say so: the
restore's confirmation that a restored transaction not already in the
account comes back private, to be shared again from Transactions, while one
that is keeps its sharing; and the deletion's backup offer that the file
carries neither which households the transactions are shared with nor
anything that belongs to a household.

## Operator runbook

**The cut-over from the earlier design.** The design of PRs #462 and #463
(ADRs 0152–0156) is live in production: its rules and hosting deployed with
the merge of #463. Its invite callable was never deployed — the merge run of
#462 failed its checks and deployed nothing, and #463 changed no function —
and only the callable can write an invite, so every household it formed has
one member. The move to this design is a clean cut, with no data migration:

1. **Before the merge**, dissolve every household in production from the
   app, then confirm in the Firestore console that `households` holds no
   documents and that no `users/{uid}` profile holds `householdId`. The new
   app never adopts a household formed by the earlier one into the index, so
   one left standing is unreachable from it, its household and owner
   documents stranded. (A leftover `householdId` alone is harmless: the app
   removes it the next time the account opens `/household` online.)
2. **The merge** deploys the rules, indexes and hosting (`deploy-web`) and
   the functions (`deploy-functions`) in parallel, with no order between
   them ([deploy.md](deploy.md)). Once the rules land, an installed app of
   the earlier design loses `/household` — its reads of other members'
   records, its pointer writes and its household commits without an index
   entry are all refused — until its service worker takes the new app.
   Until `deploy-functions` finishes, an invite answers with no reason, which
   the page shows as *Something went wrong*, and the triggers are not there.

**Deploy and region.** `inviteToHousehold` and the two triggers ship with the
functions: a merge touching `functions/` or `firebase.json` runs
`deploy-functions` ([deploy.md](deploy.md)). All three run in `asia-east1`
from the functions' global options, and the client names the same region
(`HOUSEHOLD_FUNCTIONS_REGION` in `household-invite-callable.ts`).

**The invoker grant.** A callable answers the app only if Cloud Run lets
`allUsers` invoke it, and the deploy binds that when it first **creates** the
function — which needs `run.services.setIamPolicy`, a permission the CLI's
preflight never checks ([deploy.md](deploy.md#a-callables-public-invoker)
says why). Before the first deploy, read what the deploy account holds:

```bash
gcloud iam roles describe roles/cloudfunctions.admin \
  --format='value(includedPermissions)' | tr ';' '\n' | grep -c '^run.services.setIamPolicy$'
gcloud projects get-iam-policy home-accounter --flatten=bindings \
  --filter='bindings.members:github-deploy@' --format='value(bindings.role)'
```

If no role it holds carries the permission, give `github-deploy` a custom
role that holds that one permission, before merging:

```bash
gcloud iam roles create deployRunInvokerBinder --project home-accounter \
  --title 'Deploy: bind a Cloud Run invoker' --permissions run.services.setIamPolicy
gcloud projects add-iam-policy-binding home-accounter \
  --member serviceAccount:github-deploy@home-accounter.iam.gserviceaccount.com \
  --role projects/home-accounter/roles/deployRunInvokerBinder
```

A create needs nothing more. `run.services.getIamPolicy` is read only on an
update that sets an invoker — an HTTPS function that names one, or a
task-queue, blocking or scheduled function — and the project has none of
those. Even this role lets a leaked deploy key make any Cloud Run
service in the project public; `roles/run.admin` would do the same job and
add creating, updating and deleting every service on top, so it is the
fallback, not the answer. An update never sets a callable's invoker, so the
custom role can be removed once the first callable exists, and granted again
before the next one is created.

After the first deploy, confirm the binding whatever the job said:

```bash
gcloud run services get-iam-policy invitetohousehold --region=asia-east1 --project home-accounter
```

It must show `allUsers` on `roles/run.invoker`. A deploy whose binding failed
logs *Unable to set the invoker for the IAM policy* or *Failed to set the IAM
Policy on the Service*, and leaves the function **private**. Re-running the
deploy does not repair it: an update never sets a callable's invoker. The
repair, once the permission is granted, is one of:

```bash
gcloud functions add-invoker-policy-binding inviteToHousehold \
  --region=asia-east1 --member=allUsers --project home-accounter
# or delete it, and let the next deploy create it again
npx firebase functions:delete inviteToHousehold --region asia-east1 --project home-accounter
```

Then read the binding back as above. In the app, a private function shows as
the generic *Something went wrong* on every invite, with a CORS error in the
console and `functions/internal` as the code.

**The triggers' first deploy.** `onHouseholdMemberDeleted` and
`onHouseholdDissolved` are 2nd-gen Firestore triggers delivered through
Eventarc, like `onFeedbackCreated`, which is already deployed
([feedback.md](feedback.md)). They need no invoker binding — firebase-tools
binds none for an event-triggered function — and no new project IAM:
firebase-tools adds service-agent bindings only for a trigger service new to
the project, and the Firestore one is already there (read at 15.28.2, in
`lib/deploy/functions/checkIam.js`). They are, though, the project's first
Firestore delete triggers and its first functions with `retry: true`, and
the deploy that creates them creates their Eventarc triggers too, so it can
take longer than an update. If it stops on *Permission denied while using
the Eventarc Service Agent*, wait five minutes and run it again, as the first
2nd-gen deploy needed
([feedback.md](feedback.md#troubleshooting-from-the-first-deploy)). The
Eventarc trigger is placed in the database's own location, which
firebase-tools reads from the live database at deploy; the repo states that
location as `asia-east1` (`firebase.json`), but that value is used only to
create a missing database, so read it back once, and list the triggers after
the deploy:

```bash
gcloud firestore databases describe --database='(default)' --project home-accounter \
  --format='value(locationId)'                      # asia-east1
gcloud eventarc triggers list --location=asia-east1 --project home-accounter
```

The list should show `onFeedbackCreated`'s trigger and the two new ones.

**The indexes.** `deploy-web` releases the six household composites with the
rules, then waits for them (`scripts/wait-for-indexes.mjs`); a red wait means
shipped but unverified ([deploy.md](deploy.md#the-index-wait)). The console's
Firestore → Indexes must list each *Enabled* before the page is relied on:
until then the household view, the plans and an owner's purge answer
`failed-precondition`, which the emulator never shows.

**The live journey.** Journey 78 in [e2e.md](e2e.md) runs once, on
production, after both deploy jobs have finished, the indexes read *Enabled*
and the invoker binding reads back public.

**Secrets.** The callable binds four of the five feedback secrets —
`FEEDBACK_SMTP_HOST`, `_PORT`, `_USER` and `_PASS`, not `FEEDBACK_EMAIL_TO` —
and mails from `FEEDBACK_SMTP_USER`. Rotating one of them affects both
functions, and a full `--only functions` deploy re-pins both
([feedback.md](feedback.md)). The triggers bind none.

**Logs.** A 2nd-gen function logs under Cloud Run: Cloud console → Functions →
the function → Logs. The callable logs *household invite not mailed: the
inviter has no verified email*, *… mail could not be charged*, *… mail passed
its deadline*, *… mail failed*, *… gone before its mail status was recorded*
and *… mail status not recorded*. The triggers log *household cleanup swept
what was left* (only when they deleted something), *household cleanup
stopped: the member is back in the same generation*, *household cleanup
skipped: the deleted document names no generation*, *household cleanup
interrupted; it runs again on the next delivery* (a transient failure,
delivered again) and *household cleanup failed* (let go; the clients' own
endings and sweeps remain).

**The quota and budget documents.** `inviteQuotas/{uid}` and
`mailBudget/daily` are readable in the Firestore console only; no client can
read or write them. A count reaches its limit and waits out its window: 24
hours from an inviter's first lookup, or from a recipient's first mail, and
the UTC day for the daily budget. Deleting an inviter's quota document
releases them early, and resets their inbound counter with it.

**Reading `mail`.** `held` is a cap, not a fault: see which in the two
documents above. `failed` means no verified inviter address, a charge against
the caps that failed, a send that failed or passed its ten-second deadline, a
status write that failed after a send, or a call that ended before it could
correct the `failed` it writes first. The log line names which. A send
abandoned at the deadline may still deliver.

**The mailbox.** Invites leave from the same Gmail account as feedback mail.
If invite volume got that sender suspended, feedback mail would stop too. The
caps bound invites to 100 mails a day; watch the account's Sent folder and
Gmail's daily sending limit, and treat a run of `held` or `failed` invites as
the first sign.

## Testing

- `npm --prefix functions test` — the invite's ten-step plan (step 10's ten
  memberships and its read bound included), the three counters, the mail
  composer in all three languages with its disclosure line, the handler over
  fakes (the hand-driven deadline, `held` and the no-verified-address
  branch), and the Admin SDK deps over a recording fake. The cleanup
  triggers' planner (each generation's sweeps, contributions before goals),
  handler (paging, the member-back stop, a second delivery, transient errors
  thrown again), Admin deps (the composite's field order, 500 writes a
  commit) and event mapping (`household-ledger-cleanup-events.test.ts`: the
  wildcards and the stored document each event hands the cleanup, and an
  event with no snapshot). `index-wiring.test.ts` loads `index.ts` and reads
  each trigger's endpoint as the CLI deploys it: the delete event, the exact
  document path and `retry: true`; a type check makes handing either
  trigger's event to the other's mapper fail to compile.
  `household-client-mirrors.test.ts` fails when the functions' copy
  of `MAX_HOUSEHOLDS_PER_ACCOUNT`, the mail deadline or the address limit
  differs from the app's, when a trigger's query differs from the app's
  shape, or when a generation field stops being a Timestamp.
- `npm run ledger:check` — the eight facts of
  [the contract check](#the-ledger-contract-and-the-sweep).
- `npm run test:ci` — the services (every membership flow, the limit of ten
  and a second delivery; `follow`, `intend` and `followMany`, share, unshare,
  the repair, the check and the full pass, the endings and the reprojection;
  the ledger view and the plans), every `TransactionService` write path in
  the order issue, follow, await, the category, restore and export paths,
  the start-up sweep's arming, the routes, the page and its sections, and
  the share controls. The accept disclosure is pinned to
  `LEDGER_COPY_FIELDS`: each field a copy carries is named by the word the
  dialog uses for it or marked as showing none of the row's content (who
  shared it, the stamps and the goal link), except the row's id, which for a
  recurring posting or a queued scan says more and which the dialog does not
  mention ([Known gaps](#known-gaps), #466); the note, receipts, tags and
  place are named as never shown.
- `npm run smoke` — the rules matrix for households (the index, the copies,
  the share keys, the plans and contributions; three accounts signed in at
  once), `HouseholdService`, the ledger view and the plans against the real
  rules, sharing, editing, unsharing and deleting as another member sees it,
  a stale second device refused, the repair and the check, and the erasure
  cascade across memberships. The walkthrough forms two households, shares a
  seeded row into one, makes a household budget and goal with a
  contribution, and the axe pass sweeps the setup, the member view before
  and after the plans, and the switcher's open panel. No smoke case takes a
  client offline, since a client whose network is off with a write queued
  stalls every other client's emulator traffic. The unit specs' call-order
  log pins that a copy's commit is issued behind its row's; that the two
  land in that order after an offline spell rests on the SDK's persistent
  mutation queue, which no suite proves, and journey 71 shows only which
  path the app takes offline and what it says. The callable and the
  triggers are not part of the smoke run: the specs write invites the way the
  callable does.
- The driven journeys 68 to 77 in [e2e.md](e2e.md) run on the emulators, with
  the real callable and the triggers in the functions emulator.
  `docs/ui-audit/tools/seed-household.mjs` seeds three accounts — Alex Chen
  (USD), Sam Lee (JPY) and Kai Moreau (EUR) — and two households, *Chen home*
  (Alex's, with Sam) and *Trip fund* (Sam's, with Kai), so Sam sees the
  switcher. Some of this month's rows are shared, one of Sam's into both, and
  every account keeps a private row in a category *Chen home*'s food budget
  covers, which no household figure may count. *Chen home* has that budget
  and a *Holiday* goal in USD with a contribution by Sam; *Trip fund* a
  *Summer trip* goal in JPY with one by Kai. Journey 78 runs once on
  production after the merge. Journeys 58 to 67 drove the earlier design and
  are superseded.

## Known gaps

- **Copies are eventually consistent.** A copy can lag its row after a
  refused or lost follow-up. The next check catches a missing or an extra
  copy, unless one of each in the same household leaves the counts equal,
  which the journal or the weekly full pass settles; a copy behind in its
  amount, date, description or category waits for the journal or the weekly
  full pass. So does the edit of a row whose cache does not yet show a share
  made on another device, which follows nothing.
- **A share made offline can key a row no copy can hold,** since nothing is
  read before its keys queue. The counts stay apart until the next full pass
  takes that key off.
- **The journal is device-local.** It is lost with the site's data, in a
  private window, or when two tabs write it at once; the weekly full pass,
  also stamped per device, is the floor.
- **The removal read window.** For the seconds between a member document's
  delete and the purge, a hand-written query by a live member could still
  list the removed member's copies. The view hides them. The owner's purge or
  the backstop normally ends the window; if both fail, it stays open until the
  owner's page hears one of those copies from the server, or the removed
  member's app notices the ending, and either may never happen
  ([ADR 0161](ADR/0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)).
- **Author claims.** The category snapshot, the bucket and the bucket group
  are the author's, as its own rows are: a modified client could show any
  name, icon or colour within the snapshot's length bounds, and file a copy
  under any bucket and bucket-group strings, which the rules tie neither to
  each other nor to the built-in list; a budget counts it when either is one
  of its category ids. A copy's description is bounded only as its row's
  is. A plan's currency is held to three capital letters, not to a code the
  rate table knows.
- **Composites the emulator ignores.** The six composites are enforced only
  in production. `ledger:check` and the deploy's index wait cover all six;
  journey 78 runs three of them live (the ledger by date and the active
  budget and goal lists). A goal's contributions, the copies by goal and the
  owner's by-member purge first run live on a production goal or removal
  ([emulator-blind-spots.md](emulator-blind-spots.md#the-households-lists-71)).
- **Write amplification.** A shared edit costs 1 + N commits, N at most ten.
- **An unshare made offline** stays visible to the household until the
  author's device reconnects, and other members' caches keep copies until
  they are evicted.
- **The twenty-lookup ceiling is untested.** The emulator does not enforce
  it — commits of 10 and of 40 contribution deletes beside a goal's delete
  were both allowed — so the goal delete's chunk of six is reasoned from the
  rules' own count, not tested. Only a production delete, by a member who is
  not the owner, of a goal holding more than six of the other members'
  contributions would prove it, and journey 78 makes no goal. The copy
  commit's chunk of five is reasoned the same way.
- **A category's parent change** rewrites its own copies at once; copies in
  the categories below it wait for the full pass the next sweep runs. After
  a hard delete, the copies keep their snapshot until each row is next
  projected.
- **A rollback** leaves the copies a newer projection wrote with their
  snapshots and buckets until a newer build rewrites them.
- **Limits the rules do not hold.** The ten memberships are counted by the
  app and the callable, the eight seats by the callable alone; the rules
  count neither: a modified client, or joins racing on two devices, could
  pass ten. A row still names at most ten households. The rules accept a
  whole-list `sharedWith` write; only the app keeps to
  `arrayUnion`/`arrayRemove`, so a stale whole-list write from another
  writer could undo a share or an unshare. A budget's category ids are
  checked only as strings of 1 to 64 characters; only the app keeps them to
  expense built-ins. An invitee whose index is longer than 30 entries is
  refused as though they belonged to ten households.
- **A departed member's contributions stay.** A leave or a removal deletes
  none: they stay stored under their goals, counted by nobody and shown to
  nobody, until their goal or the household is deleted, and a rejoin of the
  same generation counts them again. Every live member's device still
  downloads them with the goal's contributions, amounts and dates included,
  since the list is filtered by generation alone. The leave and remove
  confirmations say they stay, left out of the goals' totals and lists
  unless the member rejoins. Erasure deletes the
  account's own only in a household it is still a live member of; in one it
  left or was removed from before, an ex-member can list none of them, and
  the deletion warning says those stay. Budgets and goals a departed member
  made stay.
- **Lost access is reported only for the household shown.** One that ends
  while another is shown keeps its index entry until the page's next tidy:
  the next visit's, or sooner if the page sees a loss or finds no
  membership to show ([Losing access](#flows)).
- **A removed member's entry stays until their own tidy; their keys go at
  their next online sweep once their copies are gone.** Neither
  grants anything, but until the household page's next visit tidies the
  index, the share controls away from it still offer that household: a
  share lands its key and reports success, the rules refuse the copy, and
  the next repair, or the full pass a bulk share owes, judges the membership
  over and takes the key off again, without a word to the member. Sharing
  asks the server about the membership only when the index does not list it
  live, so an entry still listed live is taken at its word: asking every
  time would cost a read per share and cannot work offline. The same holds
  for a household dissolved while another is shown
  ([ADR 0158](ADR/0158-an-account-holds-up-to-ten-memberships-each-named-by-an-index-it-owns.md)).
- **A row deleted right after its share into a household just formed or
  joined can leave its copy there.** A delete takes the row's copy out of
  every household the index lists (`TransactionService.copyPathsOf`), and
  that read is answered by the index listener, which hears a membership
  formed or joined in a transaction only once the server sends it on. A
  copy the delete misses stays until the household's next full pass takes
  it out. When this device has no full pass stamped for the household in
  the last week, the first sweep over it is a full pass straight away; a
  household just formed here, or joined here for the first time, always
  starts that way. Otherwise a sweep's check that finds the counts apart
  starts the full pass. *Delete all transactions* reads the index the same
  way before its purge, with the same outcome. The app cannot reach either:
  a household is offered as a share target only once a listener on
  the same index query lists it, and the SDK answers every listener and read
  of that query from one view, so from then on the delete's read lists it
  too.
- **The switcher's other names can be stale.** An entry's name is refreshed
  only when its household is opened.
- **An address can be judged from the cache.** One naming a household joined
  on another device, which this device's cache has not heard of, can be
  replaced by the selection before the server answers.
- **The join dialog and the invite mail name only transactions.** Neither
  says that every member can read the household's budgets and goals, who
  made each, and each member's contributions with their amounts and dates.
  Whether the copy should say so is open. The setup spec's ban on the phrase
  *budgets and goals*, meant to keep out the personal plans, would also
  refuse a wording that names the household's own, so a change to the copy
  changes that spec with it.
- **Each device converts with its own rates** and judges a budget's window in
  its own time zone, so two members can read a figure a little differently.
- **Every list of copies or contributions stops at 2,000,** and a figure
  counted from a full one says it may be incomplete.
- **A goal's contribution sweep cut short** is resumed only while the page
  lives; what it leaves goes with the household.
- **The triggers' retries are bounded.** Firebase stops retrying a 2nd-gen
  event function after 24 hours, a permanent failure is let go at once, and
  nothing on the server sweeps again later: what a failed trigger leaves
  stays for the client paths.
- **The triggers do not sweep invites.** A dissolve's own client deletes the
  household's pending invites; one it missed admits nobody, since a joiner's
  `since` must equal a live household's `createdAt`.
- **A household deleted by hand** in the console sweeps its generation,
  member documents included; each member's index entry waits for that
  member's next tidy.
- **The region is recorded, not read back.** Nothing checks that the live
  database is in `asia-east1`; one elsewhere would cost each trigger delivery
  a cross-region hop, not a failed deploy.
- **An account id holding an underscore could share nothing,** since no copy
  can be named for it. Nothing in the repository shows whether every
  production account id is free of one.
- **A sweep has no timeout of its own.** On a network that drops traffic
  silently it waits, and a restore, which awaits its sweep, waits with it.
- **Converted figures wait for the rates with no timeout of their own.**
  On a device whose cached rates have expired or never existed (a cache
  under 12 hours old settles the table at once, with no fetch), the rate
  table settles only once its fetch answers, or fails and falls back to
  this device's expired cache or the compiled-in table, and that fetch has
  no timeout: on a network that drops traffic silently, a household view
  holding a copy in another currency shows its loading state, and a plan
  that converts reads *Counting…*, for as long as the browser waits.
- **An old installed app** of the earlier design loses `/household` when the
  rules deploy, until its service worker updates. An edit or a delete of a
  shared row made in it leaves the row's copy as it was until a sweep on an
  updated device: the next check for a delete, the weekly full pass for an
  edit.
- **Delete all transactions** takes the copies out after the rows; if that
  purge fails, the page says the households still show them, and copies of
  rows that no longer exist stay until it is run again or the next full
  pass ([Sharing](#sharing)).
- **A copy's id carries its row's id** (#466). A copy is named
  `{uid}_{txId}` and holds the row id as `sourceId`, since the rules judge a
  copy against the row that id names. A recurring posting's id is
  `rec-{ruleId}-{occurrenceMs}`, so a member reading the copy data (the
  cache, or a hand-written query) can tell, though no screen shows it, which
  shared rows one recurring rule posted and when each was due: the recurring
  link the copy's fields leave out. The rows of a scan queued offline are
  `img_{queuedMs}_{random}-{index}`, which tells when the scan was queued
  and which shared rows came from it. The join disclosure describes what the
  page shows and does not mention it.
- A member's new name or picture reaches the others only once that member's
  own page opens after the change; a member who never opens it again stays as
  they were. The picture is the profile's, which takes it from the sign-in
  provider only at the first sign-in, so a picture the provider later moves
  is not followed.
- An invite shows the household's name as it was when sent; a rename reaches
  it only if the owner invites again.
- The invite mail's link, opened signed out, leads through sign-in to the
  Dashboard rather than back to `/household`: the login page does not carry
  the page it was asked for.
- An invite sent to an account in the moments between its erasure's last
  invite sweep and the deletion of its sign-in account stays behind.
- An abandoned send may deliver after the invite says *Couldn't be emailed*.
- There is no ownership transfer; an owner who wants to go dissolves.
