# Households

A household is a small group of accounts — at most eight — whose members see
each other's finances together on one page, **`/household`**, reached from
the sidebar and from a link card in Settings. It is read-only: every member
keeps their own records, writes only their own, and reads the others'.
Dashboard, Transactions, Budgets and Reports stay personal and unchanged.

The decisions behind it are in four records:
[ADR 0152](ADR/0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)
(the membership and the rules),
[ADR 0153](ADR/0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md)
(the invite callable and its mail),
[ADR 0154](ADR/0154-the-household-view-is-a-read-only-aggregate-on-its-own-page-and-the-road-to-shared-writes-is-written-down.md)
(the page, and the road to shared writes) and
[ADR 0155](ADR/0155-journeys-that-need-two-accounts-run-against-the-emulators.md)
(how the two-account journeys are driven). The issue is #71.

## What members can and cannot see

A member reads the other members' **transactions, categories, budgets and
goals** — the whole documents, so a transaction's note, tags and place
included, and its base-currency stamp and converted amount. The page shows each member's rows for the chosen period, their
active budgets and active goals, and resolves each row's category through its
own member's categories, so a custom one shows by name.

- **Receipt photos.** The page never shows another member's receipt: it
  strips the receipt fields before it shows a peer's row. The app still
  downloads them, and the device caches them with the row. A transaction
  stores its photos' download links, and those links carry a token that opens
  them without the storage rules, so every member's app holds the others'
  receipt links just by opening `/household`. The links keep opening the
  photos after a leave, a removal or a dissolve, until the receipt is deleted.
  The join dialog says so before anyone accepts.
- **Nothing else.** Recurring rules, saved searches and answers, category and
  tag memory, import history, monthly snapshots, AI provider keys, the sign-in
  log, feedback and the profile stay the owner's alone. The profile itself is
  never shared, so a member's email address is not. Their base currency is:
  every row written since stamping carries it as `baseCurrency`, and an older
  converted row still implies it through `exchangeRate` and
  `amountInBaseCurrency`. The only addresses that pass between members are
  the one an owner types into an invite, which the invite holds for the two
  of them, and the inviter's own verified sign-in address, which the invite
  mail names and the invite shows the invitee in the app.
- **Who a member is**, to the others: their display name (at most 100
  characters) and their picture, which is kept only when it is served from
  Google's account-picture hosts (`https://lh3.googleusercontent.com/` to
  `lh6`). Any other host would learn every viewer's address each time the
  page loads. Both are copied from the member's profile when they join, and
  follow it after that: when the member's own page next opens, it rewrites
  them if the profile has changed, as the rules allow.
- **Anyone who joins later** reads every existing member's records, past
  ones included, from the moment they join. Nobody else is asked or told; the
  join dialog says so to everyone who joins.
- **Nobody writes anyone else's records.** The rules refuse it, the page has
  no control that would try, and a member's budget whose `spent` belongs to
  another period is shown as 0 with a note, because only its owner can
  recompute it.
- **What a device keeps.** The app caches what it reads. A member removed
  while their device is offline keeps seeing the cached view until it
  reconnects, and a removed member's device keeps its copy of the others'
  rows, their receipt links included, until that cache is evicted or
  cleared.

## Flows

**Start.** On `/household`, *Start a household* with a name of 1 to 60
characters. The creator is its owner. One account belongs to at most one
household.

**Invite** (owner only). *Invite by email* takes the address the other person
signs in with; they must have signed in to the app once. The invite goes
through the `inviteToHousehold` callable, which looks the address up, writes
the invite, and emails it. The pending list shows each invite's expiry — seven
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
words, that every member, and anyone who joins later, will see all their
transactions, past and future — notes and places included — and their
categories, budgets and goals; that the members' devices receive their
receipt photos' links, which keep opening the photos after they leave until
the receipt is deleted; and that nobody can change their records but them.
The message after joining names the household as it is called now, not as
the invite named it. *Decline* deletes the invite. An expired invite offers
only *Decline*. A join the rules refuse is explained as best the page can:
already in a household, expired (judged with fifteen minutes of margin for a
slow device clock), or no longer available.

**Leave** (member only). The member's own membership ends; everyone keeps
their records. To come back they need a new invite.

**Remove** (owner only). The confirmation names the member. Their membership
ends; nobody's records are deleted. If the removed member has the page open,
it shows *You're no longer in that household* once the server confirms it;
opened later, it shows the setup. Either way their page clears the pointer on
their profile — only an account may write its own profile, so the owner
cannot.

**Rename** (owner only), 1 to 60 characters.

**Dissolve** (owner only). A warning, then a second confirmation that asks for
the word `DELETE`, typed as it is in every language. The owner's pending
invites are withdrawn first, then the other members' memberships, then the
household with the owner's own. Everyone keeps their records. The owner
cannot leave; dissolving is how an owner goes.

**Offline.** The page says what is shown may be out of date. Every action is
refused with *You're offline. Household changes need a connection.* before it
writes anything; *Accept*, *Remove*, *Leave* and *Dissolve* refuse before
their first dialog. With no other member's rows on the device, the list says there is
nothing to show offline rather than showing an empty period, and a member
with nothing cached is marked *Not loaded on this device* instead of showing
zeros.

**Losing access.** A removal or a dissolve is reported only when the server
confirms the account's own member document is gone, never from the cache. A
removal made while the device was offline shows when it reconnects.

**Focus.** No action leaves keyboard focus on the page itself. A button stays
focusable while its action runs, marked unavailable, and the action in flight
refuses a second press; a refused action leaves focus where it was. *Remove*
moves focus to the next member's *Remove* once the row goes — else the one
before, else the *Members* heading. *Revoke* moves it to the *Pending
invites* heading, never to another *Revoke*, since nothing asks before one;
*Decline* moves it to the *Invites for you* heading. Creating, joining,
leaving, dissolving and a lost membership swap one view for the other, and
focus goes to the first heading of the view that came in; after *Retry* it
goes to whatever replaced the notice. A first load, or a change made on
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
| 10 | `failed-precondition` | `elsewhere` | That person already belongs to another household. |
| — | any code with no reason | — | *Something went wrong. Please try again.* — or the offline message when the device is offline |

A code with no reason is never read as a business answer. A function that is
missing, private or called in the wrong region answers `functions/not-found`,
`functions/internal` or similar with no reason, and must not read as "no
account uses that address". A Firestore `unavailable` or `deadline-exceeded`
reads as offline.

The quota at step 5 is **ten lookups per inviter per 24 hours**, the window
opening at the first lookup; a miss counts, and it is charged before the
lookup. Steps 8 to 10 count only live memberships of the household's current
generation, and step 9 leaves out the invitee's own pending invite and is
asked again when the invite is written. A success returns `{ inviteId, mail }`
and never the invitee's name.

## Data model

| Path | Fields | Written by |
|---|---|---|
| `households/{hid}` | `name` (1–60, trimmed), `ownerId`, `createdAt` (the request time of the create: the household's *generation*), `updatedAt` on a rename | the owner |
| `households/{hid}/members/{uid}` | `uid`, `displayName` (≤ 100), `photoURL` (optional, Google's picture hosts, ≤ 2048), `role` (`owner` \| `member`), `since` (the household's `createdAt` when it joined), `joinedAt`, and for a member `inviteId` | the member itself |
| `householdInvites/{hid}_{inviteeUid}` | `householdId`, `householdCreatedAt` (the generation it admits to), `householdName` (as it was when sent), `inviterUid`, `inviterName` (the inviter's sign-in name, shown in-app only), `inviterEmail` (the inviter's verified sign-in address, or null; shown to the invitee in-app), `inviteeUid`, `inviteeEmail`, `locale`, `createdAt`, `expiresAt`, `mail` | the callable only |
| `inviteQuotas/{uid}` | as inviter `windowStart`, `count`; as recipient `inboundWindowStart`, `inbound` | the callable only |
| `mailBudget/daily` | `day` (the UTC day, `YYYY-MM-DD`), `count` | the callable only |
| `users/{uid}.householdId` | the household the account belongs to, or absent | the account, validated |

The pointer on the profile is a hint the account's own client follows. The
rules never grant on it: what grants is the member documents.

## The rules, and what they cost

- **A membership counts only in its generation.** A member document grants
  while it exists and its `since` equals the live household's `createdAt`.
  Anything left under an id from an earlier household grants nothing. A
  member-list query must filter on `since == createdAt`; an unfiltered one is
  refused.
- **One household per account.** A membership is created in the same commit
  as the pointer that names it, the pointer may move only once the old
  membership is gone, and the profile cannot be deleted while it names a live
  one.
- **Reads.** Transactions, categories, budgets and goals are readable by the
  owner or a live member of the owner's household. A peer's read costs four
  document lookups — the owner's profile, the household and the two member
  documents — of the ten a read may make; the owner's own read costs none.
- **Writes.** A member creates and updates only its own member document, and
  may change only its display name and picture — which its page does, to
  follow the member's profile. The owner alone renames the
  household, deletes other members' documents, and deletes the household —
  only in a commit that deletes its own member document too. Once a household
  is gone, anyone may delete a member document left under it. Invites are
  never written by a client; either party may read or delete one. The quota
  and budget documents are refused to every client.
- **Commit sizes.** A commit may make twenty lookups. The owner's delete of
  another member's document looks up only the household, and removal and
  dissolve delete at most four member documents per commit
  (`HOUSEHOLD_COMMIT_CHUNK`).

## Figures on the page

- In the **viewer's** base currency. Another member's row with no base stamp
  is converted at today's rate rather than trusting a snapshot in that
  member's currency; so is any row stamped against another base.
- **500 rows per member per period.** Past that, the newest 500 are shown and
  counted, and the page names the member. The list shows 100 rows at a time,
  with *Show more*; the totals count every row.
- **A budget's `spent`** shows only when it was computed for the current
  period, judged in the viewer's time zone. A viewer in another zone than the
  budget's owner can see a current figure as stale — 0, with the note — and it
  stays so for them.
- A member whose records the rules refuse is named as no longer readable, and
  one whose records only partly loaded is named as possibly incomplete.
- **Recurring rules post from their owner's app.** A member's recurring rule
  becomes a transaction only when that member's own app catches it up, as the
  Dashboard does. Until then that member's line, and the household's totals,
  are short of it. The page catches up the viewer's own rules as it opens, so
  the viewer's line is right even reached straight from the invite mail's
  link; nobody's app can post another member's, which the rules refuse.

## Where it lives

- **`HouseholdService`** (`core/services/household.service.ts`, root) holds
  the account's own membership. It opens no listener until a page calls
  `connect()`, and the last `disconnect()` closes them all. Its `status` is
  `idle` before a connection, `loading`, `none` with no live membership,
  `member` with one, or `unavailable` when the household could not be read.
  Beside it: `household`, `ownMember`, `members` (the owner first, then by
  joining order), `isOwner`, `receivedInvites`, `sentInvites` and
  `lostAccess`. Its writes are `create`, `accept`, `decline`, `invite`,
  `revoke`, `rename`, `remove`, `leave` and `dissolve`, plus
  `clearStalePointer` for the page and `deleteAll` for erasure. `accept`
  answers the household's name as the new member reads it. Every refusal
  is a `HouseholdError` whose message is already in the user's language.
  Its one write nobody asks for keeps the own member document's name and
  picture in line with the profile, while a page is connected and the
  server has confirmed the document; the same identity is asked for once per
  membership, so a refused write is not retried at every answer.
- **`HouseholdLedgerService`** (`core/services/household-ledger.service.ts`)
  is provided by the page, which hands it the members (`setMembers`) and the
  period (`setPeriod`). It exposes `rows` (every shown member's rows, newest
  first), `totalsByMember`, `combined`, `categoriesByMember`,
  `budgetsByMember`, `goalsByMember`, `unavailable` (members the rules
  refused), `truncated` (members past the 500-row cap), `incomplete` (by kind:
  members whose listener of that kind failed before answering), `loading` and
  `plansLoading`.
- **The invite seam** (`core/services/household-invite-callable.ts`) builds
  the callable on the first invite, with the Functions SDK loaded by a dynamic
  import, in `HOUSEHOLD_FUNCTIONS_REGION`, and against the functions emulator
  only in the `emulators` build.
- **The page** is `features/household/`: the shell and its setup, overview,
  plans and members sections, and `household-focus.ts` — where a section
  hands focus to the page when an action swaps the view, and the one idiom
  every section moves focus with. The member chip is a shared component, and the
  transaction row and the budget and goal cards take `interactive`, `member`
  and `readOnly`.
- **The callable** is `functions/src/household-invite.ts` (every decision,
  no I/O), `household-invite-handler.ts` (the body, its I/O injected),
  `household-invite-admin-deps.ts` (that I/O over the Admin SDK, with the two
  shape guards a stored value needs before a decision trusts it: a household's
  `createdAt` must be a Timestamp, and a profile's pointer a possible
  household id), `compose-household-invite-email.ts` (the mail), and its
  wiring in `index.ts`.

## Erasure and backup

Deleting an account ends its household first: an owner's is dissolved, a
member leaves, and every invite addressed to or sent by the account is
deleted, again just before the sign-in account itself goes
([account-deletion.md](account-deletion.md)). The membership is not one of
the Data hub's record kinds ([data.md](data.md)), and the backup does not
carry it ([backup-restore.md](backup-restore.md)).

## Operator runbook

**Deploy and region.** `inviteToHousehold` ships with the functions: a merge
touching `functions/` or `firebase.json` runs `deploy-functions`
([deploy.md](deploy.md)). It runs in `asia-east1` from the functions'
global options, and the client names the same region
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

**Secrets.** The callable binds four of the five feedback secrets —
`FEEDBACK_SMTP_HOST`, `_PORT`, `_USER` and `_PASS`, not `FEEDBACK_EMAIL_TO` —
and mails from `FEEDBACK_SMTP_USER`. Rotating one of them affects both
functions, and a full `--only functions` deploy re-pins both
([feedback.md](feedback.md)).

**Logs.** A v2 function logs under Cloud Run: Cloud console → Functions →
`inviteToHousehold` → Logs. The callable logs *household invite not mailed:
the inviter has no verified email*, *… mail could not be charged*, *… mail
passed its deadline*, *… mail failed*, *… gone before its mail status was
recorded* and *… mail status not recorded*.

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

- `npm --prefix functions test` — the ten-step plan, the three counters, the
  mail composer in all three languages, the handler over fakes, including
  the hand-driven deadline, `held` and the no-verified-address branch, and
  the Admin SDK deps over a recording fake: the merges into the shared quota
  document, the whole-document budget, the two shape guards and the seat
  asked again at the write.
- `npm run test:ci` — the services, the invite seam's region, the page and its
  sections, and the read-only inputs of the shared row and cards.
- `npm run smoke` — the rules matrix for households (three accounts signed in
  at once), both household services against the real rules, the erasure
  cascade, and `/household` in the walkthrough, where the axe pass sweeps the
  setup and then, once the walkthrough's account forms a household, the
  member view with a pending invite. The callable is not part of the smoke
  run: the specs write invites the way it does.
- The driven journeys 58–66 in [e2e.md](e2e.md) run the real callable in the
  functions emulator with two seeded accounts; journey 67 runs once on
  production after the merge.

## Known gaps

- Every member's app downloads the others' receipt links by opening the
  page, and the links keep opening the photos after a leave, a removal or a
  dissolve, until the receipt is deleted.
- A removed member's device keeps its cached copy of the others' rows.
- A member's new name or picture reaches the others only once that member's
  own page opens after the change; a member who never opens it again stays as
  they were. The picture is the profile's, which takes it from the sign-in
  provider only at the first sign-in, so a picture the provider later moves
  is not followed.
- A member's recurring rules post only from their own app, so their figures
  can be short until they open it.
- An invite shows the household's name as it was when sent; a rename reaches
  it only if the owner invites again.
- The invite mail's link, opened signed out, leads through sign-in to the
  Dashboard rather than back to `/household`: the login page does not carry
  the page it was asked for.
- An invite sent to an account in the moments between its erasure's last
  invite sweep and the deletion of its sign-in account stays behind.
- A viewer in another time zone than a budget's owner can see that owner's
  current `spent` as stale.
- Members on different base currencies see each other's rows at today's rate,
  uncaptioned.
- An abandoned send may deliver after the invite says *Couldn't be emailed*.
- There is no ownership transfer; an owner who wants to go dissolves.
