# 152. A household is a membership, and a member reads the others' records without owning them

**Status:** Accepted, implemented · **Date:** 2026-09-26 · **Issues:** #71

Reference documentation lives in [../household.md](../household.md),
[../account-deletion.md](../account-deletion.md), [../data.md](../data.md)
and [../backup-restore.md](../backup-restore.md).

Extends [0018](0018-account-deletion-is-a-client-side-cascade.md) (erasure
gains a household step and a guarded profile delete),
[0029](0029-every-stored-kind-has-one-door.md) (the membership is named
outside the record kinds, with its reason) and
[0143](0143-the-backup-carries-what-erasure-takes-except-what-it-must-not.md)
(the backup leaves it out, by decision). Records 0018's premise that "the
project deploys no Cloud Functions" as history: it was true on 2026-08-07,
and stopped being true on 2026-08-15, when `cda1b5f8` added the feedback
mail trigger ([0047](0047-feedback-is-a-stored-record-first-and-a-mail-second.md)).
The invite that forms a household is the subject of
[0153](0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md),
and the page that shows it of
[0154](0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md).

## Context

The app is called *home account*, and one person was the only reader of
anything in it. Every record lives under `users/{uid}/…`, and
every rule is `isOwner(userId)`. #71 asked for households: people who live
together forming one, and seeing their finances together. Its suggested
first version is a read-only aggregate — each member's own records, merged
on the client — ahead of a shared-write model.

Four facts about the existing code decided most of what follows.

**The profile is open-ended.** `userUpdateValid` checked the types of the
fields it knew and carried no `hasOnly`, and the profile's delete was a bare
`isOwner`. So a client can write any `householdId` it likes onto its own
profile, or delete the profile and create it again. The obvious design — a
`householdId` on the user document that the rules read to grant access —
would grant on a value the reader itself wrote.

**An id can be formed again.** A household's id is generated on the client,
so nothing stops a client from forming a new household under an id that
was dissolved. And nothing guarantees that every member document of the old
one was deleted: a dissolve reads the members, deletes them over several
commits and deletes the household only in its last, so a join that lands
between that read and the last commit — from an invite the owner sent on
another device after the dissolve withdrew theirs — outlives the household.
A member document left behind must not admit anyone to whatever is formed
under the same id later.

**A joiner cannot read the household it is joining.** Read access is what
joining grants, so the joiner cannot look up anything about the household —
its generation included — before the commit that makes it a member.

**A transaction carries links that open without the rules.** A receipt
photo's download URL is stored on the transaction, and it carries a token
that Cloud Storage honours without consulting `storage.rules`. Whoever can
read the document can open the photo.

The rules also have a budget: a read may make ten document lookups, a
commit twenty.

## Decision

**Membership is a document per member, written by the member itself, and
the rules grant on those documents — never on the profile. A member reads
the other members' transactions, categories, budgets and goals, and writes
nothing of theirs.**

### The model

| Path | What it holds | Written by |
|---|---|---|
| `households/{hid}` | `name` (1–60), `ownerId`, `createdAt`, `updatedAt` | the owner |
| `households/{hid}/members/{uid}` | `uid`, `displayName` (≤ 100), `photoURL`, `role` (`owner` \| `member`), `since`, `joinedAt`, and for a member `inviteId` | the member itself |
| `householdInvites/{hid}_{inviteeUid}` | the invite ([0153](0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md)) | the invite callable only |
| `users/{uid}.householdId` | the pointer: a non-empty id, or absent | the profile's owner, validated |

The pointer tells the account's own client, and the rules, where to look.
Nothing is granted on it alone: what grants is the member documents it leads
to.

### The generation stamp

A household's `createdAt` must equal `request.time`, so no client chooses
it, and every member document's `since` must equal the `createdAt` of the
household it joined. `memberOf(hid, uid)` holds only while the member
document exists **and** its `since` equals the live household's `createdAt`.
An orphan from an earlier household under the same id carries an earlier
stamp and grants nothing — not the household, not the member list, not
anyone's records. A member list must filter on `since == createdAt`, which is
how the rules prove of a list that it holds no orphan; an unfiltered query is
refused.

The joiner's problem is solved by the invite. The callable writes the
household's `createdAt` onto the invite as `householdCreatedAt`, and the join
copies it into `since` unchanged. The rules check it against both: `since`
must equal the invite's stamp and the live household's `createdAt`, so an
invite issued before a dissolve admits nobody to what is formed after it. The
invite is deleted in the join's commit, so it admits once.

### The pointer on create, and the guarded delete

Two rules keep an account to one household, and each closes a way around the
other.

- **A membership is created with its pointer.** A member document's create
  requires the profile, after the commit, to point at that household; the
  household's own create requires the owner's member document and the
  pointer in the same commit. A second membership cannot be created by simply
  not touching the pointer.
- **The pointer moves only once the membership it named is gone.** A new
  profile may not carry `householdId` at all. An update that touches it must
  leave the old membership gone after the write — no old pointer, or its
  member document gone, or its household gone — and a new value must name a
  member document that exists after the write. The profile's **delete** takes
  the same condition, so deleting the profile and creating it again cannot
  shed a live membership either. A profile that is already gone may still be
  deleted, so a retried erasure succeeds.

### What a member reads

The four read rules become `isOwner(userId) || householdPeer(userId)`.
`householdPeer` reads the data owner's pointer and checks both memberships
against the one household's generation: the owner's profile, the household
and the two member documents — four lookups of the ten a read may make. The
owner's own read short-circuits before any of them, so it costs what it did.

What is readable is the whole document of those four kinds: a transaction's
note, tags, place and receipt fields included. Everything else an account
stores stays owner-only: recurring rules, saved searches and answers, both
memories, import history, snapshots, provider keys, the sign-in log,
feedback, and the profile itself — so a member never learns another's email
from the rules. A transaction's `baseCurrency` stamp and its converted
snapshot are part of the readable document, so the members' base currencies
are visible to one another. Every write stays the owner's alone.

**Receipt photos open through their stored links.** The household page never
shows another member's receipt: the ledger strips the receipt fields before
it shows a peer's row
([0154](0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md)).
But the listener reads the whole transaction document, so every member's app
fetches the others' token-bearing receipt URLs just by opening `/household`,
and the device caches them with the row. Those URLs open without
`storage.rules`, which is unchanged — an SDK read of another member's receipt
object is still refused — and they keep opening the photos after a leave, a
removal or a dissolve, until the receipt is deleted. The join dialog says so
in plain words before anyone accepts: the members' devices *receive your
receipt photos' links, which keep opening the photos after you leave, until
you delete the receipt*.

**A member reads what is already there.** Joining opens every existing
member's records to the newcomer, past ones included, and nobody else is
asked or told. Only the owner invites, so each member's consent at their own
join is to the household as the owner will grow it; the join dialog says so
— *everyone in the household, and anyone who joins it later, will see all
your transactions, past and future*.

**A member's picture comes only from Google's account-picture hosts.** Every
member's browser loads every other member's picture, so whoever serves it
learns each viewer's address and when they open the page. `memberPhotoValid`
in the rules and `isMemberPhotoUrl` in the model hold the same pattern,
`https://lh[3-6].googleusercontent.com/`; the app signs in with Google only,
so no genuine picture comes from anywhere else, and one that would be refused
is left out of the member document rather than failing the write.

**The device keeps what it read.** The app runs Firestore with a persistent
local cache, so the rows a member read are on their device, receipt links
included. A member removed while offline keeps showing the cached view until
the device reconnects, and a removed member's device holds its copy of the
others' rows until the cache is evicted or cleared. The rules end the
sharing; they cannot reach into a device.

**A member's name and picture follow their profile.** The member document
copies both from the profile at joining, and the rules let a member change
exactly those two fields of its own document. The door to that permission
([0056](0056-a-permission-the-rules-grant-has-a-door-in-the-ui.md)) is
the member's own page: while it is connected and the server has confirmed
the member document, `HouseholdService` rewrites the two when the profile
shows the account otherwise — a rename in Settings, or a picture the rules
would refuse, which it removes. It asks once per identity and membership, so
a refused write is not retried at every answer.

### The rules of membership

- **One household per account**, by the pair above.
- **The owner manages; a member can only leave.** Only the owner renames
  (`name` and `updatedAt` only), removes another member's document, and
  dissolves. Inviting is the callable's check. The owner may not delete its
  own member document while the household survives, so the owner cannot leave
  — it dissolves. There is no ownership transfer.
- **Eight members, pending invites included.** The rules cannot count
  documents, so the cap lives in the callable, which refuses the ninth seat
  and asks again inside the transaction that writes the invite. A member can
  only join through an invite, and only the callable writes one, so the cap
  at invite time bounds the household.
- **An invite expires after seven days**, judged by the rules against the
  server's clock at the join.
- **Removal and dissolve go in small commits.** The owner's delete of another
  member's document looks up only the household, and a dissolve deletes the
  owner's sent invites first — so nobody can join mid-sweep — then the other
  member documents four to a commit (`HOUSEHOLD_COMMIT_CHUNK`), then the
  household, the owner's own member document and the owner's pointer in one
  final commit. At the eight-member cap that is two chunk commits and the
  final one. The other members' pointers are theirs to clear: the rules let
  only an account write its own profile, so the household page clears a
  pointer whose membership is gone the next time it opens.

### Erasure

- **The household goes first of the cloud steps.** While a membership is
  live, the other members still read the account's rows. `deleteAll` has an
  owner dissolve and a member leave, clears a stale pointer, and deletes every
  invite addressed to or sent by the account. It reads with one-shot reads,
  never a listener's first value, so it works with no page connected.
- **A failed household step keeps the account for the retry.** The rules
  refuse the profile's delete while the membership its pointer names is live,
  so a household step that fails before its leave or dissolve commits leaves
  the profile, the pointer and the auth user in place, and the next run
  starts where this one stopped.
- **The invites are swept twice.** The callable finds an invitee through the
  auth user, which outlives every other step, so an invite can arrive after
  the household step. The sweep runs again just before the auth user is
  deleted, reported under the same step.
- **A member erased while others look drops out of their view.** Their member
  document goes in the household step, and the other members' views drop
  them through the member list — or first through the refusal their record
  listeners hear, which names them as no longer readable until the list
  catches up.
- **Membership is not a record kind, and not in the backup.**
  `NOT_A_RECORD_KIND` names it — *a membership shared with other accounts,
  managed on the Household page* — so the Data hub's parity with the cascade
  holds and the export's parity (fourteen, eleven, three) is unchanged. The
  backup cannot carry it: the household belongs to several accounts, the
  rules would refuse a member document restored without a live invite, and
  the pointer lives on the profile, which the file has never held.

## What was rejected

- **Granting on the profile's pointer**, or on a member list kept on the
  household document. The profile is written by its owner and was deletable
  without condition, and a list on the household would be written by one
  member on behalf of the others. Either grants on a value the reader can set.
- **Existence-only membership.** Checking that a member document exists, and
  not which household generation it belongs to, lets an orphan read a
  household formed again under its id — the members' names included.
- **The shared subtree now.** #71's full solution moves records into a
  household scope. v1 moves nothing: every record stays where it is and
  gains readers. The road to shared writes is written down in 0154.
- **Membership as a record kind**, with a door on the Data hub. A count of
  one membership says nothing a user needs, and its management — invite,
  leave, dissolve — is not a stored-record operation.

## Consequences

- A peer's read costs four lookups; an owner's costs none.
- Every client query of a member list carries `since == createdAt`, and a
  household listener refused by the rules means the membership ended, not a
  fault.
- A `get` of a household or an invite that is gone answers
  `permission-denied`, not an empty snapshot, because the rules read the
  document to decide. The service reads that refusal as *gone*.
- Account deletion gains a first cloud step, a second invite sweep, and a
  profile delete the rules can refuse.
- A profile write that does not touch `householdId` is validated exactly as
  before.

## Departures from the issue

- The issue says "No server backend exists (no `functions/`)". That had been
  out of date since `cda1b5f8` (2026-08-15), and the invite rides the
  workspace that commit added.
- It proposes "an active `householdId` on `User`". There is one, and it
  grants nothing.
- It lists `storage.rules` among the rules to change. They are unchanged:
  what a member can reach of another's receipts is the stored links, and
  that is disclosed rather than ruled.
- The shared data subtree and the data migration are not built. v1 moves
  nothing, so it needs no migration; 0154 specifies the one the shared model
  will need.

## Things that only became apparent while building

- **Every join was impossible in the first design.** The member document had
  to carry the household's generation, and the joiner could not read it. The
  invite carrying `householdCreatedAt` is the whole fix.
- **Two memberships were possible twice over** — by joining without touching
  the pointer, and by deleting and re-creating the profile. The pointer on
  create and the guarded delete each close one.
- **A picture URL is a beacon.** Any `https` URL on a member document would be
  fetched by every other member's browser; the host pattern went into the
  rules and the model together.
- **Three full clients in one smoke spec fill Chrome's connection pool.**
  Each keeps a listen and a write stream open and Chrome allows six
  connections per host, so the rules matrix signs its three accounts in
  through Firestore Lite, which the rules judge exactly as they judge a full
  client.

## Known gaps

- **Receipt links reach every member's device.** Opening `/household`
  downloads the others' token-bearing receipt URLs, and they keep opening the
  photos after a leave, a removal or a dissolve, until the receipt is
  deleted. Disclosed at the join, not closed.
- **A member's name and picture reach the others late.** Other members see a
  change only once the renamed member's own page next connects; a member who
  never opens it again stays as they were. The picture is the profile's,
  which takes it from the sign-in provider only at the first sign-in, so a
  picture the provider later moves is not followed.
- **The device cache keeps a removed member's copy** of the others' rows until
  it is evicted or cleared.
- **An invite written after the second sweep and before the auth user is
  deleted** stays behind. Only its inviter, a dissolve, or a server-side
  clean-up removes it.
- **A removed member's pointer stays until their page opens.** It grants
  nothing, and the callable treats a pointer whose membership is gone as no
  membership.
- **An interrupted dissolve leaves the household standing.** The household
  is deleted only in the final commit, so the members not yet removed stay
  members, and keep reading each other's records, until the owner runs
  *Dissolve* again or an erasure retries it. A member document that does
  outlive its household — a join landing between the dissolve's read of the
  members and its final commit, or one from an earlier generation under a
  re-formed id — is inert by generation, and anyone may delete one once the
  household is gone.
- **The member cap is enforced at invite time**, by the callable, not by the
  rules.
- **There is no ownership transfer.** An owner who wants to leave dissolves.
