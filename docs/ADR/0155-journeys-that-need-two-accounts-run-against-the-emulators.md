# 155. Journeys that need two accounts run against the emulators

**Status:** Accepted, implemented · **Date:** 2026-09-26 · **Issues:** #71

Reference documentation lives in [../e2e.md](../e2e.md),
[../ui-audit/tools/README.md](../ui-audit/tools/README.md) and
[../emulator-blind-spots.md](../emulator-blind-spots.md).

Extends [0098](0098-the-browser-journeys-are-a-driven-protocol-not-a-suite.md)'s
driven protocol to a second venue, and revisits the road 0098 rejected: it
takes up the committed emulator configuration and the seeded demo account.
The automated suite, the wire stub and the CI step stay rejected, and 0098's
conditions for revisiting them stand as it wrote them. It also answers the
hand-edit that [`docs/ui-audit/tools/README.md`](../ui-audit/tools/README.md)
has asked for since the harness was committed on 2026-07-04 (`e30e18bf`).

## Context

0098 made the browser journeys a protocol driven by hand against the running
app, and the running app is production: the dev server serves the checkout
with its own `.vscode/environment.ts`, which names the live project, and the
browser carries the developer's own session. Every write a run makes is
therefore enumerated and put back.

The household journeys cannot run that way. Each needs **two** accounts
signed in: one to form a household and invite, the other to receive the
invite, join, and read the first one's rows through the rules — and then to
be removed, to decline, and to see a dissolve. On production that means a
second real account: another person's real finances, or a throwaway Google
account on the live project. It means a real invite mail to a real inbox for
every step that invites, from the operator's own sender
([0153](0153-an-invite-is-an-owners-callable-lookup-by-email-capped-and-its-answers-are-plain.md)),
and membership writes laid over real rows. The callable also needs accounts
it can look up by a verified address.

The emulators could give all of that without touching anything real, but
the app could not be pointed at them without an edit nobody committed. The
screenshot harness under `docs/ui-audit/tools/` seeded a demo account into
the emulators and told its user to hand-write a demo `.vscode/environment.ts`
and hand-add three connect calls to `app.config.ts`, "until a permanent
`useEmulators` flag lands". 0098 had weighed exactly that — "a committed
environment file behind a `useEmulators` gate, the seeded demo account the
screenshot harness already builds, the model stubbed at the wire so the
answer is deterministic, and a CI step to run it" — and rejected it as a
whole, for reasons that were about automating the translation and preference
journeys.

## Decision

**A journey that needs two accounts is driven by hand, like every other
journey, against the local emulators: a committed serve configuration, two
seeded accounts, and the real callable in the functions emulator with a mail
server that is not there. Production keeps what only it can show, in one
live journey run once after the merge.**

### What is taken up, and what stays rejected

Taken up from 0098's rejected road: **the committed emulator configuration**,
and **the seeded demo account** — two of them. Neither was what 0098
objected to. Its three reasons were that stubbing the model at the wire
removes what the translation journeys exist to prove, that the demo account
has no deployed rules behind it, and that automating journeys one branch old
means maintaining a suite that mostly reports its own staleness. The first
does not arise: no household journey calls a model, and the emulator serve
carries no provider key. The second is why the live journey stays. The third
is why these journeys are driven, not automated.

Still rejected: **the automated suite, the wire stub, and the CI step.**
0098's conditions are restated unchanged: revisit when a journey has to gate
a merge without a person present, and take it on once the protocol has run a
few branches and its journeys have stopped moving.

### The machinery

- **The hosts file, not a flag.** `src/environments/emulators.ts` is
  committed and exports `EMULATOR_HOSTS = null`; every build compiles it
  except `emulators`, which swaps in `emulators.on.ts` with the four hosts
  from `firebase.json`. A `useEmulators` field on the environment cannot
  compile: `environment.ts` re-exports the gitignored `.vscode/environment.ts`,
  and neither it, the CI stubs nor the production secret declares one. The
  `EmulatorHosts` type lives apart, in `emulator-hosts.ts`, because a type
  imported from `./emulators` inside the replacement would resolve to the
  replacement itself.
- **The same configuration swaps the environment** for the committed
  `environment.emulators.ts`: the harness's `demo-home-account` project, no
  provider key, and a measurement id that is not a GA4 id, so the analytics
  providers are withheld and an opted-in demo account never reaches the live
  property.
- **Each Firebase service connects before its first use.** Auth, Firestore
  and Storage come from exported factories that take the hosts as a
  parameter: Auth connects right after the instance exists, before a restored
  session's token refresh can go to the live service, and the invite
  callable's seam connects to the functions emulator.
- **Remote Config is left out.** It has no emulator, and the build's demo
  API key would be refused by the live Installations and Remote Config
  endpoints on every start. With emulator hosts `provideAppRemoteConfig`
  registers nothing, and `RemoteConfigService`'s optional inject keeps the
  in-app defaults.
- **The guard.** `build-configurations.spec.ts` fails when production stops
  being the default build, when any configuration but `emulators` names an
  emulator file, when `emulators` stops swapping both files, when its output
  could land under the hosting directory, when its hosts drift from
  `firebase.json`'s ports, when it names anything but a demo project, or when
  it would configure analytics.
- **Its own origin.** `npm run start:emulators` serves the configuration on
  port 4300, so its origin — and the IndexedDB that holds a session and the
  Firestore cache — is never the production serve's on 4200.
- **The seed.** `docs/ui-audit/tools/seed-household.mjs` creates two
  Google-linked, verified users in the Auth emulator, Alex (USD) and Sam
  (JPY), runs `seed.mjs` for each, then corrects each profile's identity and
  base currency in one REST patch — `seed.mjs` writes Alex's onto every
  profile it seeds — and gives each one custom category, one current budget,
  one goal and two rows in the current month. One of Alex's rows is a
  converted yen row with no base stamp, the one kind the household ledger has
  to normalise. The session records go to a file only its owner can read,
  outside the repository: the script refuses a path inside its own checkout
  or the main one.
- **The session is injected, not signed in.** The run writes a seeded
  account's record into the Auth SDK's IndexedDB store at the page's exact
  origin and loads the app, as the screenshot harness does.
- **A mail server that is not there.** `functions/.secret.local`
  (gitignored) gives the five feedback secrets emulator-only values, because
  the feedback trigger declares all five and the invite callable four of
  them, and the functions emulator loads neither while a secret either
  declares has no value. The SMTP host is `127.0.0.1` port `1`, where nothing
  listens, so every send fails fast: an invite reads *Couldn't be emailed*,
  or is `held` once a recipient's cap is reached, since a mail is counted before
  it is sent. The emulator's log is read for `Unable to access secret` and `No
  value found for secret parameter`: either means the callable is missing a
  secret it reads. `functions.ignore` keeps the file out of a deploy's upload.
- **The venue is checked like the other one.** 0098's bundle check reads
  the project id out of every script the page loaded; in this venue it must
  be `demo-home-account`, and no script may carry `home-accounter`.

### The live run is kept for after the merge

Journey 67 runs once on production, after the merge has deployed the rules
and the callable, with one account: form a household, check its totals
against the Transactions page, dissolve it, and read it back absent. It sends
one real invite mail only if the account's owner names a recipient at that
moment. What it shows is what the emulators cannot: the deployed rules, the
callable's public invoker, its deployed region, and a mail that arrives.

## What was rejected

- **Two real accounts on production.** A second person's real records, or a
  throwaway account on the live project, and a real mail for every invite.
- **The callable inside `npm run smoke`.** Starting the functions emulator
  in CI means secrets plumbing for a mail sink, which
  [feedback.md](../feedback.md) already judged not worth it at this scale.
  The decisions are pinned by the functions tests over fakes, the services'
  smoke specs write invites the way the callable writes them, and the real
  callable meets real Auth and Firestore in the driven journeys.
- **A `useEmulators` flag**, above.

## Consequences

- `docs/ui-audit/tools/README.md` loses its hand-edit: the screenshot harness
  can serve the same configuration.
- Every branch that touches a two-account surface owes its emulator journeys
  twice, like every other journey, and a live journey once after merge where
  the deployed rules or the callable are what changed.
- The committed configuration is one more thing a production build must never
  pick up, which is what the guard spec is for.

## Things that only became apparent while building

- **The port's origin held a stale production cache.** `localhost:4300` had
  been used before, and its IndexedDB still held a Firestore cache named for
  `home-accounter`. Every database on the origin is deleted before a session
  is injected.
- **The session write cannot be awaited in the call that makes it.** A pane
  script that awaits the IndexedDB transaction can hang the call; the write
  is started, sets a flag on the window when it completes, and a second call
  reads the flag.
- **The first load after an injection can miss it.** The Auth SDK's first
  read races the write, so the run navigates twice.
- **One origin holds one session at a time.** Alex's removal of Sam lands
  while Alex's session is the one loaded, and the two share the origin's
  Firestore cache, so when Sam's session is injected his page has never seen
  the membership live. It takes the path for a membership that ended while no
  page listened — the setup, the pointer cleared quietly, no notice. The
  notice for a removal seen live is pinned by the service's smoke spec, where
  two accounts run side by side, and its rendering by the page's unit spec.
- **A seeded account has not finished the welcome**, so its first boot opens
  it.
- **Remote Config reached the live service.** The first emulator run logged
  a refused Installations request — *400, API key not valid* — on every boot,
  from Remote Config fetching with the demo key. That is why the build
  withholds the provider.
- **A seeded account's recurring rules run.** Sam's first visit to the
  dashboard posted his rules' rows for the month, and they reached the
  household view through its listeners like any other row.
- **The pane cannot take the network away.** The offline journey dispatches
  the window's `offline` event, which is what the app's online signal is built
  from — diagnostic-grade, and recorded as such.

## Known gaps

- **Nothing enforces that either venue ran.** As 0098 says of the protocol,
  it is a reviewer's expectation, not a gate.
- **The emulators load the repository's rules**, not the deployed ones.
- **The functions emulator has no IAM**, so a private callable looks public
  there; only journey 67 and the read-only binding check see it.
- **No mail is delivered** in this venue, by design.
- **The emulator build is not the production build** — unoptimised, with
  source maps — so a defect only an optimised bundle has is journey 67's to
  find.
