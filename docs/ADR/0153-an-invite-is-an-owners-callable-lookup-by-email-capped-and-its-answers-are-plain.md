# 153. An invite is an owner's callable lookup by email, capped, and its answers are plain

**Status:** Accepted, implemented · **Date:** 2026-09-26 · **Issues:** #71

Reference documentation lives in [../household.md](../household.md),
[../deploy.md](../deploy.md) and [../feedback.md](../feedback.md).

Extends [0047](0047-feedback-is-a-stored-record-first-and-a-mail-second.md):
the mail seam it built, and four of its five secrets, serve a second
function. The membership an invite admits to is
[0152](0152-a-household-is-a-membership-and-a-member-reads-the-others-records-without-owning-them.md)'s.

## Context

An owner invites someone by the address they sign in with. Turning an
address into an account takes the Admin SDK — no client can look up another
user — so the invite needs server-side code, and the repo already has a
functions workspace ([0047](0047-feedback-is-a-stored-record-first-and-a-mail-second.md))
with an SMTP seam, pure modules under `node:test`, and a global region of
`asia-east1`, beside Firestore, that only the storage triggers override.

Five forces pulled on how that code answers.

**An answer about an address is an oracle.** "No account uses that address"
tells the owner the address holds no account; "already in a household" tells
them it holds one that is taken. Masking both costs the owner every way of
telling a typo from a pending invite.

**The mail leaves from the operator's own sender.** Invites would go out
through `FEEDBACK_SMTP_USER`, the Gmail account that also mails every
feedback entry to the operator. Anything that lets one owner send a lot of
mail, or mail that says anything they like, puts that account at risk — and a
suspended sender silences feedback too.

**A mail send has no deadline of its own.** Nodemailer's timeouts are per
phase — connect, greeting, idle socket, DNS — not a total, and a fake
transport in a test has none at all. A callable that waits on the send waits
as long as the transport does.

**The region is easy to miss.** `getFunctions()` defaults to `us-central1`.
A client that does not name `asia-east1` calls a function that does not
exist there, and the 404 comes back as `functions/not-found` — which, read
naively, is exactly the "no account" answer.

**A callable is public by an IAM binding the deploy makes.** A client calls
it through Cloud Run, and Cloud Run answers only if `allUsers` holds
`roles/run.invoker` on the service. The feedback trigger never needed one.

## Decision

**An invite is written only by a callable Cloud Function that looks the
address up for the household's owner. Its refusals are said plainly and
capped; its mail names only the inviter's verified address; the mail is
bounded per recipient, per day, and by the handler's own deadline; and a
mail that does not go never fails the invite.**

### The callable, and what only it writes

`inviteToHousehold({ householdId, email, locale })` is an `onCall` function
in `asia-east1`, from the global options, bound to the four
`FEEDBACK_SMTP_*` secrets it reads — not `FEEDBACK_EMAIL_TO`, since an invite
is mailed to the invitee. The rules refuse every client create and update of
an invite, and give the quota and budget documents (`inviteQuotas`,
`mailBudget`) no block at all, so the default deny is their rule. Each field
of an invite is therefore exactly as trustworthy as the callable: the
account it names, the generation it admits to, the expiry.

**Who invites is said by the verified address, not the name.** The invite
carries the inviter's sign-in name (`inviterName`), which the inviter chose,
and their sign-in address as their provider verified it (`inviterEmail`), or
null when it verified none. The invitee decides whether to share every
record on what the invite card and the join dialog show, so both show the
verified address beside the name, and say plainly when there is none. The
name is stripped of format characters — bidi overrides and isolates,
zero-width characters — that would let it read as someone else's, and its
control characters and line breaks become spaces.

Every decision is a pure module (`household-invite.ts`: normalising an
address, the ten-step plan, the three counters, the seat count), and the
handler (`household-invite-handler.ts`) takes every read, write, clock and
timer as an injected dependency. Those dependencies over the Admin SDK are
`household-invite-admin-deps.ts`, a factory taking the Firestore and Auth
handles, so a test can record how each write is made: the merges into the
quota document both counters share, the budget written whole, and the two
shape guards a stored value needs before a decision trusts it — a
household's `createdAt` must be a Timestamp, and a profile's client-written
pointer a possible household id. `index.ts` only wires it to the project's
handles, secrets and logger.

### Ten steps, in order

| # | Refused when | Code | `details.reason` |
|---|---|---|---|
| 1 | the caller is signed out | `unauthenticated` | `signed-out` |
| 2 | the address, the locale or the household id is malformed or unsupported, or the household is unknown | `invalid-argument` | `email`, `locale`, `household` |
| 3 | the caller does not own the household | `permission-denied` | `not-owner` |
| 4 | the address is the caller's own verified address | `failed-precondition` | `self` |
| 5 | the caller's lookup quota is spent | `resource-exhausted` | `quota` |
| 6 | no account uses the address, or it is disabled | `not-found` | `no-account` |
| 7 | the account is the caller's own | `failed-precondition` | `self` |
| 8 | the account is already a live member of this household | `already-exists` | `member` |
| 9 | members plus other pending invites fill all eight seats | `failed-precondition` | `full` |
| 10 | the account is a live member of another household | `failed-precondition` | `elsewhere` |

The order is what the facts allow. The quota is charged at step 5, **before**
the lookup, in a transaction, so a miss counts as much as a hit. Steps 8 to 10
need the invitee's uid, which only the lookup yields. `self` is asked twice:
step 4 catches the caller's own address before it costs a lookup, and step 7
catches a caller whose token carries no email at all. Step 9 leaves out the
invitee's own pending invite, so re-inviting someone refreshes their seat
rather than taking a second; it is asked again inside the transaction that
writes the invite, so two invites racing for the last seat cannot both land.
Step 10 counts only a membership that is live and generation-checked — a
pointer left behind by a dissolved household is not *elsewhere*.

### The answers are plain, and the oracles are capped

"No account uses that address" and "already belongs to another household"
are said as they are. Masking them buys little: an invite is written only
for an address that resolves, and the owner's pending list shows it, so the
list is the same oracle one step later. What bounds both is the inviter's
quota: **ten lookups per inviter per 24-hour window**, the window opening at
the first lookup, misses included. The quota is keyed by the inviter's uid,
not the household, so dissolving and forming a new household does not reset
it. The residue — an owner can learn, for ten addresses a day, whether each
holds an account and whether that account is in a household — is accepted
risk. The callable never returns the invitee's display name; the owner does
see the invitee's uid, inside `inviteId = {hid}_{inviteeUid}`, which the join
rule needs.

### Every refusal carries its reason, and a code without one is not an answer

Each refusal is an `HttpsError` whose `details.reason` is one of the eleven
names above, and the client maps the reason, never the code. A code with no
reason — a function missing or private, one called in the wrong region,
`internal`, `unavailable`, `deadline-exceeded` — gets the generic *try again*
copy, never a business message; offline, or a Firestore `unavailable` or
`deadline-exceeded`, gets the offline one. The client names the region
itself, in one exported constant (`HOUSEHOLD_FUNCTIONS_REGION`), and loads
the Functions SDK with a dynamic import on the first invite, so nothing in
the initial bundle carries it.

### The mail

- **The invite is written before the mail**, so the link in it never leads to
  nothing, and it is written with `mail: 'failed'` — the claim that stays true
  if the call dies mid-send. Once the send settles the field is corrected to
  `sent` or `held`. The page reads a `failed` younger than the settle window
  (the deadline plus a 30-second margin) as *sending*, and the callable's own
  answer overrides it for the document the call wrote.
- **The mail carries no text the owner typed.** It names the inviter only by
  the sign-in address their provider verified, gives the expiry as a UTC day
  and the fixed link `https://home-accounter.web.app/household`, and is written
  in the inviter's app language — English, Japanese or Traditional Chinese.
  The household's name and every display name stay in the app, where the
  invitee sees them after signing in. A caller with no verified address gets
  the invite written and not mailed (`failed`, logged): there is nothing the
  mail may say about who is inviting. The invite then shows the invitee, in
  the app, that its sender's address is not verified.
- **A mail that does not go never fails the invite.** Every mail failure is
  logged and reported as the invite's `mail`; the invite stands and is shown
  in the app.
- **The handler owns the deadline.** The send is raced against an injected
  ten-second timer (`INVITE_MAIL_DEADLINE_MS`), cleared when either settles.
  The transport is given the same ten seconds for each connection phase, which
  is not a total but is what eventually releases an abandoned socket. An
  abandoned send is not cancelled, and may still deliver after the record says
  `failed`. The feedback trigger passes no timeout and is unchanged.
- **Mail volume is bounded two ways, and neither refuses the invite.** At most
  **three invite mails per recipient per 24-hour window**, from every
  household together, and at most **100 invite mails per UTC day** overall.
  Past either, the invite is still written and shown in the app with
  `mail: 'held'`, and nothing is sent: refusing it would let a stream of junk
  invites lock a person out of a real one. The two counters are charged in one
  transaction, both or neither, so a recipient at their cap does not drain the
  day's budget. Re-inviting refreshes the invite and counts against the
  inviter's quota like any other call.
- **The blast radius is the operator's mailbox.** Invite abuse that got the
  `FEEDBACK_SMTP_USER` sender suspended would silence feedback mail as well.
  The caps bound it to a hundred invite mails a day, and the operator watches
  the account's Gmail sending limit ([household.md](../household.md),
  [feedback.md](../feedback.md)).

### The first public invoker

firebase-tools 15.28.2 makes a callable public when it **creates** it, by
setting the Cloud Run service's IAM policy — which needs
`run.services.setIamPolicy` — and its deploy preflight never checks that
permission: it tests `cloudfunctions.functions.setIamPolicy`, and only for a
new HTTPS function, which a callable is not
(`lib/deploy/functions/checkIam.js`). The deploy account's role list in
[deploy.md](../deploy.md) grants no `run.*` role; whether
`roles/cloudfunctions.admin` carries the permission is read, not assumed,
before the first deploy.

If the binding fails, the function exists and is **private**, and redeploying
does not repair it: on an update the CLI sets an invoker for HTTPS, task-queue,
blocking and scheduled functions, and not for a callable
(`lib/deploy/functions/release/fabricator.js`). The repair is the operator's —
bind `allUsers` as the invoker by hand, or delete the function and deploy it
again — and the proof is the Cloud Run service's IAM policy showing `allUsers`
on `roles/run.invoker`. The commands, with the read-only checks before the
first deploy and the permission to grant, are kept in one place:
[household.md](../household.md#operator-runbook)'s runbook. The client's
symptom of a private function is `functions/internal` with a CORS error,
which the page reads as the generic *try again*.

## What was rejected

- **A client-written invite matched by the rules against the verified email,
  with a trigger that only mails.** The rules would admit a join when the
  token's verified email equals the invite's address. But the rules cannot
  count documents, so neither the member cap nor any quota could be enforced
  on a client-written invite; the trigger would mail whatever address an owner
  typed, with no lookup to bound it, from the operator's sender; and a client
  that writes an invite names its own generation stamp.
- **Invite codes** — a code or link the owner passes on themselves. No lookup
  and no mail, but a code is a bearer credential: whoever holds it joins,
  through whatever channel carried it. Invites by email were the requirement.
- **Masking the answers.** The pending list gives the same answer a step
  later, and a masked answer cannot tell an owner they mistyped.
- **Refusing an invite past the mail caps.** The caps protect the sender, not
  the invitee; the invite itself costs nothing to hold.
- **Relaying the household's name, or a note from the owner, in the mail.**
  Anyone who can form a household could then send any words from the
  operator's sender.
- **Refusing an inviter with no verified address.** The app signs in with
  Google, which verifies the address, so the case is rare. Such an invite is
  kept, unmailed, and tells the invitee in plain words that its sender's
  address is not verified, which leaves the decision with the person it
  concerns.

## Consequences

- The functions workspace ships a callable, and a merge that touches
  `functions/` or `firebase.json` deploys it. The first deploy needs the
  invoker permission checked, and the binding read back afterwards.
- `functions.ignore` gains `"*.local"`. A configured ignore list replaces the
  CLI's defaults rather than adding to them, which is why the list already
  names `node_modules`, `.git` and `*.log`; the new entry keeps
  `functions/.secret.local` out of a manual deploy's upload.
- Rotating an SMTP secret affects both functions, and a full `--only
  functions` deploy re-pins both.
- The client keeps copies of two function constants — the mail deadline and
  the longest address — and `functions/src/household-client-mirrors.test.ts`,
  which runs in CI's `npm --prefix functions test`, fails when either differs.
- `household_action` records a successful `invite`, and never the address.

## Things that only became apparent while building

- **A fake `sendMail` bypasses every nodemailer timeout**, so a deadline left
  to the transport is untestable and, for a fake, absent. The handler's own
  timer is what the tests drive by hand.
- **Step 9 alone could hand out the last seat twice.** It reads outside any
  transaction, so the write asks `hasSeat` again inside its own; a write that
  finds the seat gone refuses as `full` and writes nothing.
- **Correcting the mail status can find the invite gone.** An accept or a
  revoke that lands during the send deletes the invite, and an update must not
  recreate it. A `NOT_FOUND` there is logged as expected; any other failure
  leaves the provisional `failed` while the callable's answer still says what
  became of the mail.
- **A quota document with a count and no window opens a fresh window.** Only
  the callable writes these documents, so an unreadable one is treated as a
  first use. Seeding a spent quota in the emulators takes a `windowStart` too.
- **A failed send still spends the recipient's count.** The count is charged
  before the send, so in the emulator runs, where every send fails fast, the
  fourth invite to one person within a day came back `held`.

## Known gaps

- **An abandoned send may deliver** after the invite says `failed`.
- **A status write that fails after a real send** leaves the invite reading
  `failed` in the app although the mail went.
- **The two oracles stand**, capped at ten lookups per inviter per window.
- **The inviter's name is theirs to choose.** Stripped of invisible
  characters, it can still read as anyone; the verified address beside it is
  what says who sent the invite, and an invite with none says that instead.
- **An invite keeps the household's name as it was when sent.** Invites are
  written only by the callable, so the owner's rename cannot reach one; a new
  invite to the same person refreshes it.
- **The owner sees the invitee's uid** inside the invite id.
- **The `held` copy names the daily limit** whichever of the two caps held it.
- **Nothing retries a mail.** A re-invite is the only way to send one again,
  and it spends a lookup.
- **Nothing local sees the invoker binding.** The functions emulator has no
  IAM, so the binding is proved only against the live project, by the
  read-only check above.
