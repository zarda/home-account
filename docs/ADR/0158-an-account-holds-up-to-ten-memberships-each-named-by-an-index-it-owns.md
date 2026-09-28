# 158. An account holds up to ten memberships, each named by an index it owns

**Status:** Accepted, implemented · **Date:** 2026-09-28 · **Issues:** #71, #465

Reference documentation lives in [../household.md](../household.md).

Supersedes [0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)'s
profile pointer (`users/{uid}.householdId`) and its rule of one household
per account; 0152's member documents and generation stamp are kept, and
still decide who reads a household. Amends
[0153](0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md):
step 8 reads the invitee's member document directly, step 10 refuses
`too-many` at ten live memberships in place of `elsewhere`, and the mail's
disclosure line says a member sees only what each member shares. Closes
[0156](0156-a-dissolve-that-finds-its-household-already-gone-finishes-instead-of-failing.md)'s
two known gaps: a `create()` or an `accept()` whose first delivery landed
resolves. Extends
[0018](0018-account-deletion-is-a-client-side-cascade.md): erasure ends
every membership the index lists. The rows a membership shares, and the
clean cut from 0152, are
[0157](0157-a-transaction-is-private-until-its-owner-shares-it-and-a-household-sees-a-faithful-copy.md)'s;
the sharing code a membership's end calls is
[0159](0159-a-copy-follows-its-row-in-a-commit-of-its-own-and-a-sweep-repairs-what-the-follow-ups-miss.md)'s.

## Context

0152 kept an account to one household with a pointer on its profile. The
rules read it to find the household, and two rules held the line: a
membership was created only with its pointer, and the pointer moved, and
the profile could be deleted, only once the membership it named was gone.

An account may now belong to up to ten households, decided with 0157.
Whatever replaces the pointer has to do what the pointer did, and more.

- **The account's own client must find every membership it holds,** for
  the switcher, for a leave, and for erasure, without a query across
  households. A collection-group query over member documents needs a rule
  that matches every collection of that id, anywhere.
- **Erasure must find every membership,** including after a failed run
  deleted the profile. 0152 guarded the profile's delete for that reason.
- **The rules cannot count documents, nor iterate a list.** A list of
  households on the profile could not be checked entry by entry.
- **A joiner still cannot read the household before joining** (0152): what
  it records about the household must come from the invite.
- **Two known gaps of 0156:** a `create()` or an `accept()` sent twice
  answered with an error while the data said it had succeeded.

## Decision

**Each membership is named by a document in the account's own index,
`users/{uid}/households/{hid}`, written in the same commit as its member
document and deletable only once that membership is over. An account holds
at most ten live memberships: the client and the invite callable hold that
line; the rules do not count.**

### The index

| Field | What it holds |
|---|---|
| `since` | the member document's `since`: the generation joined |
| `role` | the member document's `role`: `owner` or `member` |
| `name` | the household's name when the account last saw it, 1–60 characters |
| `joinedAt` | when the account joined, as the server stamped it |
| `endedAt` | set once the membership's ending is under way; never at creation |

- **Read by its account alone, and it grants nothing.** Every grant is
  still a member document of the live generation. The name is a copy for
  listing, refreshed when the account next opens the household; the
  household document is the truth.
- **`households` is carved out of the `users/{uid}` catch-all,** since
  rules are additive: the index's own block is the whole of what may be
  written there.
- **The profile names no household.** `userCreateValid` refuses
  `householdId`, `userUpdateValid` lets it only be removed, and the
  profile's delete is plain `isOwner`: the index is a subcollection, so it
  outlives the profile for a retried erasure. `User.householdId` is gone
  from the model.

### The index and the member document are tied, both ways

- **A household is created with both.** `householdCreateValid` requires,
  in the same commit, the owner's member document and its index document,
  the index stamped `since == request.time` and `role == 'owner'` (two
  lookups).
- **A member document is created only beside its index document,** which
  must exist once the commit lands with the same `since` and `role`, for
  the founding owner and for a joiner alike. A member document the index
  did not list would be one erasure could miss.
- **An index document is written only beside a member document** of the
  same `since` and `role`, as the commit leaves it (one lookup). A rejoin
  writes the entry again whole, under the same rule.
- **An entry's ending is marked, and only when it is true.** A touch-up
  may change only `name` and `endedAt`. `endedAt` goes on only beside a
  membership that is over as the commit leaves it (its member document gone,
  or of another generation), so an ending decided before a rejoin cannot
  mark the live membership that rejoin made, and once set it stays.
- **An entry goes only once its membership is over,** judged the same way;
  a missing entry passes, so a delete sent again passes.

### A membership ends before its copies go, and its entry goes last

That is invariant I5. Every ending of the account's own membership (a
leave, a dissolve, a tidy of one that ended elsewhere, erasure) runs:

1. **One commit that ends it:** the member document deleted (for a
   dissolve, the household with it, as 0152 and 0156 do) and `endedAt` set
   on the entry. The commit reads the entry first. For an ending a server
   judgement decided (a tidy, erasure), an entry that has since become
   another join, or is gone, leaves the commit unwritten.
2. **`cleanupMembership`** (0159): the server is asked whether the account
   is a member; if not, its copies in the household are purged; the server
   is asked again; if still not, the household's key is taken off the
   account's rows and the device's journal forgets the household.
3. **The entry's delete.** The entry is how a later tidy or erasure finds
   the household again, so it goes only once the rows are out.

Once the member document is gone no copy can land, since every copy write
needs a live membership (0157), so the purge is final. A step that fails
after the first commit rejects with a clean-up error: the account is out,
and the next tidy finishes the rest. A removal is the owner's: the removed
member's document goes, then the owner purges that member's copies; the
removed member's entry is theirs to clear at their own next tidy. Their
keys come off then, or sooner: once their copies are gone, the full pass of
their next online sweep is refused, the server judges the membership ended,
and the keys are taken off. Whatever a cut-off purge leaves is swept by the server's backstop
([0161](0161-a-deleted-membership-or-household-is-swept-by-server-triggers-as-a-backstop.md)).

No list reaches across households (invariant I6). The index is how an
account finds its households; every other list is scoped to one household,
and the rules hold no collection-group match, so such a query is refused.

### Ten, and where it is held

`MAX_HOUSEHOLDS_PER_ACCOUNT = 10`, in `household.model.ts`, with a copy in
the functions workspace that `household-client-mirrors.test.ts` holds equal.

- **The rules do not count memberships.** They cap a row's `sharedWith` at
  the same ten (0157), so no row is shared into more households than that,
  whatever an account holds.
- **The app refuses a create or a join at ten.** It counts first with two
  server aggregations, every entry and those marked ended, rather than a
  listing. Only an account the count puts at the limit pays for more: its
  unended entries are listed and each is judged on the server, and one
  whose membership ended without this device (a removal, a dissolve) is not
  counted and is ended on the way. A rejoin of a listed household is not one
  more. The refusal is `household.errors.tooMany`.
- **The invite callable refuses `too-many`** (step 10) when the invitee
  holds ten live memberships in other households: an entry is live when it
  is not ended, its `since` equals its member document's, and that equals
  the household's `createdAt`. This household's own entry never counts, so
  nine elsewhere are admitted. The callable reads at most
  `MEMBERSHIP_READ_BOUND` = 30 entries: the index is written by its
  account, so without a bound one call could be made to read any number of
  documents, and a longer index is refused as `too-many` unread.

### Which household the page shows

- **The address names it.** `/household/:hid` selects that household when
  it is one of the account's live memberships, and the device remembers the
  choice (`household.selected.{uid}`); `/household` shows the household last
  selected on this device while it is live, else the earliest joined. An
  address naming a household the account holds no live membership in is
  replaced in place once the index has answered. `:hid` is a child route
  with nothing of its own, so a switch keeps the page, its listeners and its
  focus. Analytics sends the address as `/household/:hid`, never the id: the
  app's own events merge it in, and the hits gtag sends by itself carry it
  as a default event parameter, set before the Analytics token is first read
  and again before each screen view.
- **The switcher** is a select in the page header whenever the account has
  a live membership: one option per live membership not lost in this
  session, then *Start or join another household*, which opens the setup
  without an address. Arrow keys and typing on the closed switcher open its
  list rather than switch household after household. A switch lands focus
  on the view that came in, following 0154's swap contract, and closes the
  dialogs opened for the household left; every action the members section
  confirms carries the household it was opened for.
- **Only the selected household is followed**, with 0152's listeners: the
  account's own member document (reporting whether an answer came from the
  cache), the household, the generation-filtered members, and for its owner
  the invites the account sent, shown for that household alone.
- **A membership this device has never loaded is not a missing one.** Only
  the selected household's member document is ever listened to, so offline
  a switch to a membership never shown on this device reads null from the
  cache. Only the server says a member document is gone: online the page
  waits for its answer, and offline it shows that the household is not
  loaded on this device (`notLoaded`), never the setup, which would say the
  account is in no such household. The connection brings the member view.
- **Lost access and endings are kept per household.** `lostHouseholds`
  holds each household whose own member document, seen live in this
  session, the server confirmed gone; `lostAccess` is whether it holds any.
  `endingMembership` marks each household the account is ending itself
  (a leave, a dissolve, a tidy, erasure), so its own delete is never
  reported as a loss, and a tidy leaves it alone (below); the mark goes
  when the work fails before the membership ended, once the index no longer
  lists the household, when a join of it begins, or at the page's last
  disconnect. A loss of the selected household moves the selection to the
  next live membership, or to the setup.

### Tidying, and the pointer left from before

`tidyEndedMemberships` lists every entry from the server and judges each by
server reads (the account's member document of the entry's generation, then
the household's live generation): an entry whose membership is not live is
ended in the order above. Once per account in a session it also reads the
profile from the server and removes a `householdId` left from before, which
the rules allow. It does not adopt the household the pointer named into the
index: under the clean cut no such household is left standing.

- **The page asks for one tidy per visit,** once the index has answered (the
  member view, no membership to show, or the household that could not be
  loaded) and the device is online. No listener hears a removal from, or a
  dissolve of, a household the page is not showing, and an entry left there
  stays in the switcher and among the households a row can be shared into.
  An offline visit waits for the connection; an offline member view does
  not spend the visit's tidy.
- **And again when there is a reason:** after a loss it saw, once per lost
  household, and when it finds no membership to show for a household it has
  neither seen live nor had judged in this visit. The visit's own tidy
  counts as judging only a selected household it found no membership in: a
  membership it found live can end later in the visit.
- **A tidy leaves alone a household this client is ending itself** (a leave
  or a dissolve under way, or one cut off after the membership ended), so
  the two never take the same rows out and delete the same entry side by
  side. The set of such households lasts while the page stays connected:
  the last disconnect clears it, so the next visit's tidy finishes a cut-off
  ending, and can run beside one still running from an earlier visit. That
  costs repeated work, not harm: the clean-up asks the server again, and the
  rules pass a delete of a copy or an entry already gone.

### A create or a join sent twice is answered once

These close 0156's two gaps. Each membership commit is a `runTransaction`,
which the SDK sends again after an answer it lost.

- **`create()`** writes the household, the owner's member document and the
  index entry in one commit. A refusal is answered with reads from the
  server: the create landed when the household of that id is live and the
  caller's owner document is of its generation.
- **`accept()`** is refused at the limit, then runs `cleanupMembership` for
  the household: an earlier membership of it whose ending was cut off can
  have left copies of the account's rows and its key on them, and once
  joined, the next sweep would share those rows again. The clean-up acts
  only when the server says the account is not a member. Then one
  transaction reads the invite, writes the member document with `since`
  copied from the invite's `householdCreatedAt`, deletes the invite, and
  writes the entry under the invite's `householdName`. A refusal, or an
  invite read as gone, is answered with a server read of the account's own
  member document: the join landed when it is of the invite's generation,
  or, when no invite was read, of the household's live one. The answer is
  the household's current name, read once joined.

### The invite callable

| # | Refused when | Code | `details.reason` |
|---|---|---|---|
| 8 | the invitee's member document in this household holds its current `createdAt` | `already-exists` | `member` |
| 10 | the invitee holds ten live memberships in other households, or an index longer than thirty entries | `failed-precondition` | `too-many` |

- **Step 8 is a direct get** of `households/{hid}/members/{inviteeUid}`,
  compared to the nanosecond. A missing member document, one of an earlier
  generation, and an index entry naming this household all pass.
- **No profile pointer is read anywhere.** `'elsewhere'` is gone from the
  reasons; the client shows `too-many` to the inviting owner as
  `household.errors.inviteeTooMany`.
- **The mail's disclosure line** reads, in each of the three languages,
  *Household members see only the transactions each member chooses to
  share*; a `node:test` case pins each and checks the earlier wording is
  gone. The mail still carries no household name and no display name.

## What was rejected

- **A list of households on the profile.** The rules cannot iterate it, so
  no entry could be tied to its member document, and erasure would trust a
  field the account writes on a document it deletes.
- **Finding memberships by a collection-group query over member
  documents.** It needs a rule matching every `members` collection
  anywhere, and reaches every household's members to find one account's.
- **Counting in the rules.** They cannot count documents. A counter the
  account writes would be no stronger than the client's check, and would
  need a tie of its own to every create, join and ending.
- **Granting on the index.** It is written by its own account; a grant on
  it would repeat the grant on the profile's pointer that 0152 rejected.
  Grants stay on member documents and the generation stamp.
- **Adopting the pointer's household into the index.** The rules would
  admit the entry, but no household in production needs it once the test
  households are dissolved before the merge (0157), and adopting one would
  carry a household formed under 0152's rules into these. A household left
  standing has no entry in its owner's index, so the app cannot show it,
  dissolve it or find it in an erasure.
- **Five memberships.** Ten was chosen with 0157, and a row's share keys
  and the callable's read bound follow from it.

## Consequences

- **Erasure walks the index.** `HouseholdService.deleteAll` lists every
  entry from the server: a live owner dissolves; a live member first deletes
  its own contributions to the household's goals (0160), then ends the
  membership as its own; anything else is ended as the account's own. Then
  every invite addressed to or sent by the account goes, the device forgets
  its selection, and the device's ledger journal and sweep stamps are
  cleared last. The household step stays the first cloud step and runs
  again just before the auth user is deleted.
- Every ending makes several commits and several server reads, and every
  membership action is refused offline before it writes anything.
- `household.errors.alreadyMember` and `household.errors.elsewhere` are
  gone; `household.errors.tooMany` (the caller's own limit) and
  `household.errors.inviteeTooMany` (the invitee's, shown to the owner) take
  `{{max}}`.
- The invite callable's first production deploy comes with this change,
  with 0153's check of the invoker binding.

## Things that only became apparent while building

- **The rules and the service could not change apart.** The new rules
  refuse the earlier service's pointer writes, and the earlier rules refuse
  a service that writes none, so they landed as one change.
- **A rejoin can land between a judgement and its clean-up.** A tidy, or a
  join's own clean-up, judges a membership over from the server, and a join
  of the same household can land before it acts. The ending commit reads
  the entry and is abandoned when it reads as another join; the clean-up
  asks the server again before it takes the key off the rows, which would
  otherwise undo the new membership's shares for good; and the index rule
  puts `endedAt` on only beside a membership that is over.
- **A confirmation could act on another household.** A dialog confirmed
  after the selection moved (a loss seen while a *Dissolve* confirm was
  open) would have acted on the household selected at that moment. Each
  members-section action carries the household it was opened for, is
  checked on the server when that household is no longer the one shown, and
  its dialog closes on a switch.

## Known gaps

- **Ten is the client's number and the callable's.** A modified client can
  create or join more, and two devices joining at once can both pass the
  count; the callable counts outside the transaction that writes the invite,
  which asks again only for a seat. Any one row is still shared into at
  most ten.
- **An index longer than thirty entries** answers `too-many`, and the owner
  reads that the invitee already belongs to ten households, which is not so
  when the entries are ended or stale.
- **A loss is reported only for the selected household.** Only it has a
  member-document listener; a removal from, or a dissolve of, another
  membership is found by the visit's tidy, or by a repair or a full pass
  that judges it ended (which clean up the copies and keys but leave the
  entry to the tidy). One that ends after the visit's tidy, while another
  household is shown, waits for the next visit unless the page sees it
  lost.
- **The switcher's other names can be stale.** An entry's name is refreshed
  only when its household is opened; the shown household's option reads the
  household document.
- **An address can be judged from the cache.** The index listener answers
  from the device's cache first, so an address naming a household joined on
  another device, which the cache has not heard of, can be replaced by the
  selection before the server's answer arrives.
- **A removed member's entry stays until their own tidy,** which runs only
  on the household page, at their next visit with a connection. Their keys
  usually go sooner. Once the owner's purge, or the backstop, has taken
  their copies out, their next online sweep counts rows against no copies.
  Its full pass is refused, the server judges the membership over, and the
  keys come off. Neither the entry nor a key grants anything, but until the
  tidy the share controls elsewhere in the app still offer that household:
  a share lands its key, the rules refuse the copy, and the next repair
  judges the membership over and takes the key off again, without a word
  to the viewer. Judging the membership on
  the server before each share was weighed and not built: it costs a read
  per share and cannot work offline.
- **gtag's own hits can name the page a screen behind.** The SDK holds the
  first default page until it has finished starting up and only then
  replays it, so a navigation in that window leaves the older page on
  gtag's own hits until the next screen view. The value is always the
  template, so the lag misreports a page and never sends an id.
- **The member cap is unchanged**: eight seats, members plus pending
  invites, held by the callable alone (0152, 0153).
