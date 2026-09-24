# What the emulator suite cannot check

The smoke suite runs the real services against the Firebase emulators, and for
what it covers — rules verdicts, query semantics, real reads and writes — it is
the strongest evidence the repo produces. But two properties of the deployed
project are invisible to it, and both have shipped defects that every local
gate waved through.

**Composite indexes are not enforced.** The emulator serves any query it is
asked, indexed or not. A filter combination with no entry in
`firestore.indexes.json` passes every smoke test and throws
`failed-precondition` on its first real use — which is how ten of the fifteen
transaction filter combinations shipped broken (#249).

**The rules and indexes that matter are the deployed ones.** The emulator
loads the repo's `firestore.rules` and ignores the index file entirely.
Editing either file changes nothing in production until it is deployed, so a
fix that looks green locally can stay broken for every real user — and a rules
tightening that was never deployed protects nothing.

**The storage emulator does not split create from update.** Production routes
an overwrite through `update`; the emulator routes *every* upload through
`create` ([below](#the-storage-emulators-create-only-uploads-137)).

The reasoning and the rejected alternatives are in
[ADR 0035](ADR/0035-what-the-emulator-cannot-see-is-checked-from-the-files.md).

## The index contract (#249)

`buildTransactionWhere` (`src/app/core/utils/transaction-query.utils.ts`) is
the only place server-side transaction filters are composed. Its equality
fields — currently `type`, `categoryId`, `currency`, `goalId` — can be combined
freely by the filter panel, and both consumers order by `date` in either
direction. Firestore therefore needs a composite index for **every non-empty
subset of the equality fields, twice** (date ascending and descending):
fifteen subsets, thirty entries.

`npm run indexes:check` (`scripts/check-firestore-indexes.mjs`) computes that
requirement from the source itself — it greps the equality pushes out of
`buildTransactionWhere`, takes the power set, and fails CI listing the exact
missing JSON entries. Because the field list is extracted rather than copied,
a new server-side filter cannot ship without its indexes; a shape guard fails
the check loudly if the extraction regex ever stops matching the source.

The file is mechanical, so regenerate rather than splice. Adding a fifth
equality field doubles the set to 62 entries — Firestore caps a project at 200
composite indexes and each one amplifies every document write, so weigh that
before adding one (`applyClientTransactionFilters` exists precisely to keep
amount, tags and text search off this contract).

A missing index is a deploy defect, not a transient fault, so
`TransactionWindowService.fetchPage` does not retry `failed-precondition` —
the error surfaces on the first attempt instead of after three rounds of
backoff behind the same banner.

## Deploying

Neither file does anything until deployed. Since
[ADR 0077](ADR/0077-merges-deploy-what-they-changed.md) the deploy rides CI:
every merge to `main` that touches either file (or anything else the web
build serves) ships `--only hosting,firestore,storage` once the full
pipeline passes — [deploy.md](deploy.md) is the runbook. The local commands
remain as the fallback, and as the only path that deletes:

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules
```

Index builds on a populated collection are not instant — the deploy returns
before they finish, and every entry must be built before the queries it serves
stop erroring. CI does that waiting: `deploy-web` runs
`scripts/wait-for-indexes.mjs` after the deploy and fails when its bound is
hit, so a red there means shipped but unverified rather than not shipped
([deploy.md](deploy.md),
[ADR 0087](ADR/0087-the-deploy-is-not-green-until-its-indexes-are-built.md)).
The Firebase console (Firestore → Indexes) shows each entry's build state and
is the fallback for reading it when that step is the one that failed. The CLI
may also offer to delete indexes that exist in the project but not in the
file; the CI deploy declines that offer and continues, so a deletion only ever
happens locally, with `--force`, after reading the list.

## The storage emulator's create-only uploads (#137)

Cloud Storage decides between the `create` and `update` rule branches on
whether an object already exists at the path. The storage emulator does not:
`StorageLayer.uploadObject` validates every upload as
`RulesetOperationMethod.CREATE`
(`node_modules/firebase-tools/lib/emulator/storage/files.js:154`), and hands
the object being replaced in as `resource`. So in the emulator, an overwrite is
a `create` with a non-null `resource`; in production it is an `update`.

That is one blind spot with two faces, and the receipt quota
([receipt-quota.md](receipt-quota.md),
[ADR 0094](ADR/0094-the-receipt-quota-is-recounted-from-the-bucket-it-limits.md))
hit both.

**The `create` branch needs a clause that is inert in production.** The quota
must not be consulted for an overwrite — replacing a blurred photo does not
grow the count — so the rule reads:

```
allow create: if …
  && (resource != null || underReceiptQuota(userId));
```

In production `create` implies `resource == null`, so that first clause can
never be what decides the verdict. It is there so the emulator agrees with
production about overwrites, and so the exemption is reachable by a test at
all. Deleting it as dead code would break every overwrite case in the smoke
suite while changing nothing about what ships.

**The `update` branch cannot be reached by an upload at all.** No test that
uploads bytes will ever exercise the branch production takes for every
overwrite. `storage.service.smoke.spec.ts` covers it indirectly through
`updateMetadata()` — which the emulator does route through `update` — proving
that the branch exists and is still scoped to the owner. That is deliberate,
not an oversight, and it is why the quota's runbook carries a named post-deploy
check that an overwrite at the limit succeeds against the live project.

The denial half of the metadata case needs a **second signed-in account**, not
a second path: the rule is only reached with a full `resource` when the object
exists, so a write aimed at a stranger's empty path would be denied for the
object being absent and would prove nothing about the owner check.

## Drive the real call site (#250)

The rules smoke suite hand-builds its documents, which proves what the rules
accept — not what the services actually send. The two can disagree: every
hand-built filter record carried both scope dates, so the unconditional bounds
requirement in `answerScopeValid` looked correct while the one write
`recordFilter` actually issues — a dateless scope — was rejected in production
only (#250).

The rule that closes the class: **every collection door gets at least one
smoke case that goes through the service that owns it**, not only hand-built
payloads. `search-answer-history.service.smoke.spec.ts` ("records a dateless
filter interpretation through the real rules") is the pattern — real service,
real serialization, real server stamps, live rules verdict.

## The browser, the session and the wire

The suite renders nothing and crosses no page boundary. It proves what the
rules accept and what a query returns; it cannot show a person walking from
the list into a dialog into a form, with the real overlay stack on top of it,
under a real signed-in session against real rows.

Four things only a driven browser pass sees:

- **the router crossing**, with the dialogs and menus that ride on top of it —
  a control that exists at one width and not another, focus landing where it
  should, a panel that fits a 390px dialog or does not;
- **a real session**, rather than a hand-built uid: the deployed rules
  deciding a write the app actually issues, read back on the next load;
- **real data** — the account's own rows, in the scripts and currencies they
  were written in, at whatever length they happen to be;
- **the wire** — a real prompt to a real provider under a real key, and the
  answer parsed by the real client. Every layer in this repo is built to avoid
  exactly that.

That pass is a **protocol, not a gate**. The journeys are written down in
[e2e.md](e2e.md) and driven by hand twice per branch, with screenshots
attached to the pull request; nothing runs in CI and nothing goes red.
[ADR 0098](ADR/0098-the-browser-journeys-are-a-driven-protocol-not-a-suite.md)
records why it is not automated and the conditions under which it should be.
A step that could be a spec belongs in a spec — cheaper, repeatable, and it
actually runs.

## The state that cannot be arranged (#432, #431)

The blind spots above are about what the suite does not see. This one is
about what it cannot be shown: the guard is sound and the suite is willing,
but there is no way to hand it the document, or the interleaving, that the
guard exists for.

**A NaN timestamp is not a document any client can write.** The recurring
engine reads every stored date through one seam and treats an unreadable
pointer as one to recompute, and an invalid date looks like the obvious way
to ask for that. It cannot be stored. `Timestamp.fromDate(new Date(NaN))`
builds a value happily (the constructor's range checks are `<` and `>=`, and
NaN satisfies neither, so `seconds` and `nanoseconds` both come out NaN) but
the write never reaches the wire: the web SDK encodes a timestamp as
proto3 JSON through `new Date(1000 * seconds).toISOString()`, which throws
`RangeError: Invalid time value`. So the emulator case writes the rule whole
through the SDK and only then breaks `nextOccurrence` to an integer through
the owner REST route (`recurring.service.smoke.spec.ts`, "a rule whose
pointer is malformed is repaired on the next catch-up and posts nothing"),
and the NaN branch of the seam is pinned by unit fixtures that hand the
reader a `toDate()` answering an invalid date (`recurring.service.spec.ts`).

**A rule missing its pointer is returned by nothing at all.** Every read that
could repair one orders by `nextOccurrence`: the live listener, the one-shot
list, the backup export and the catch-up work list all pass the same
`recurringQueryOptions()`, and Firestore omits a document that lacks the
field a query orders by. The one enumeration that passes no ordering is
`deleteAll`, the account-deletion sweep, and what that one finds it deletes.
No suite can therefore demonstrate such a rule being repaired — there is
nothing to repair it from, and no surface in the app can select it either,
since the edit dialog and the delete control open from a list ordered by the
same missing field, so the only route back is a restore from a backup taken
while the rule still held a pointer
([ADR 0141](ADR/0141-a-recurring-rule-in-a-bad-state-is-repaired-where-its-data-allows-and-refused-where-it-does-not.md),
[recurring.md](recurring.md)). It is worth separating from the blind spots
above: those have something else standing in for them, and this one has
nothing, because there is nothing to stand in for.

**An in-flight read cannot be held across a session swap.** The profile retry
re-arms when its own read is abandoned for an account that took the session
over while the read was out, so the proof needs that read still in flight at
the moment the swap lands. Against the emulator a read answers when Firestore
answers; the only lever on where it lands is a delay, and a case whose result
depends on one is a flake, not a proof. The emulator suite covers the shape
it can arrange — sign out first, then arm the retry
(`auth.service.smoke.spec.ts`, "a retry that resolves after sign-out does not
resurrect the session") — and the orderings themselves are driven by hand in
`auth.service.spec.ts`, where the profile read is a promise the spec resolves
where it chooses.

## The fixture that invents its input (#431)

Every blind spot above is about the server. This one is about the suite
itself, and no emulator can catch it, because the emulator is downstream of
it: a fixture is free to hand the code under test a shape nothing in the app
produces, and both suites will then agree the code handles it.

The drained receipt's photo is the case that shipped. The drain plans the
attachment off each row's own placement fields, and the fixture feeding it
stamped `imageIndex: 0` on those rows. Nothing the drain can reach stamps
it: the native read structures one transaction and places it nowhere, the
single-image cloud read converts one parsed receipt, and the reader that does
number its rows answers a door the drain never opens. So every drained
receipt on a real device lost its photo while a suite that connected the real
storage emulator, uploaded real objects and read them back stayed green. It
was proving the handling of an input that does not exist. A driven browser
pass found it on the first drain.

The check is to read the producer, not the type. A field the type marks
optional is a claim about the shape, not about who fills it, and the question
a fixture has to answer is which call site writes it on the path under test.
Where the answer is "none of them", the fixture specifies a reader that does
not exist yet, which is a legitimate thing to pin — as long as it says so
beside itself instead of passing for what the door receives today.

## What the axe pass can and cannot see

`app.smoke.spec.ts`'s `expectPage()` runs axe-core over every page it opens,
WCAG 2.1 A and AA, scoped to the routed element. Five properties of the
harness bound what that can honestly mean, and none of them is about axe:

- **i18n is not served.** Karma's asset config does not publish the catalogs,
  so `| translate` renders the raw key. Every accessible name on screen is a
  non-empty string like `transactions.title` — which is what a presence rule
  needs and useless to a rule about content. Contrast is unaffected: the real
  stylesheets compile.
- **Karma's window is 756px**, so this is a phone and small-tablet audit. A
  rule that only fires on a desktop layout is never reached.
- **Only the top 413px of a page is measured.** The frame the specs render
  in is 413px tall where it was measured and scrolls inside its own body,
  and `color-contrast` does not apply to a node below that fold: the node is
  neither a pass nor a violation, and scrolled into the frame it is measured
  like any other. On `/transactions` both seeded rows sit inside the frame.
  On `/budgets` the budget card's chip starts 445px down, and on
  `/dashboard` the two recent-transaction chips start at 591px and 675px,
  the spending chart's legend at 1426px and the budget card's icon at
  1602px. So the category chip's orange tile, which failed in light at
  1.95:1 on `/transactions` and at 1.78:1 on `/dashboard` and `/budgets` —
  its tint mixed there over the Material card's `#f4f2fc` — was reported
  on `/transactions` only. And two failures on the walkthrough's own orange
  category go unreported in light: the legend's white glyph at 2.16:1 and
  the budget card's orange icon on `--surface-subtle` at 2.06:1, two of the
  sites [accessibility.md](accessibility.md) lists as painting a category's
  colour without the chip.
- **The run is scoped to the routed element**, because Karma's `debug.html`
  owns the `<html>` element, a banner and its own headings. Eight page-level
  rules are therefore disabled by name (`html-has-lang`, `document-title`,
  `landmark-one-main`, `landmark-unique`, `landmark-banner-is-top-level`,
  `page-has-heading-one`, `bypass`, `region`) — a landmark rule has no meaning
  when the thing being audited is a fragment.
- **It renders one theme per run, and the host picks it.** The walkthrough's
  account keeps the default `theme: 'system'`, and nothing in the harness pins
  a colour scheme, so `ThemeService` follows the `prefers-color-scheme` of the
  machine running Chrome: light on the CI runner, dark on a Mac in dark mode.
  A run sees light or dark, never both, and nothing it prints says which. A
  contrast failure that exists in only one theme is seen only where that
  theme renders. The category chip's orange tile, 1.95:1 on its own tint in
  light, passed every run on a Mac in dark mode and failed CI's. The chip
  failed in dark too — `#9C27B0`, `#E91E63`, `#3F51B5` and `#795548` on
  their dark tints — but orange is the one category the walkthrough seeds,
  so no run of either theme rendered a colour that failed there. The
  dashboard's subtitle, gray-500 on the light page background at 4.43:1,
  passes in dark; the runs that emptied the contrast freeze rendered dark —
  axe reported the page background as `#121212` — and CI's light run had
  `color-contrast` frozen on `/dashboard`, so it was found by reading the
  pairs
  ([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
  The pass's first runs had rendered light, which is how
  [ADR 0145](ADR/0145-a-class-found-by-reading-becomes-a-gate.md) came to
  record two failures in light mode. Where a finding depends on the theme,
  measure both in a browser — journeys 45 and 57 in [e2e.md](e2e.md) do.

And it sweeps only the routes the walkthrough visits: `/dashboard`,
`/transactions`, `/budgets`, `/reports`, `/settings`, `/data` and `/about`.
**`/ai`, `/search-history`, `/import/file` and `/import/history` are
unswept** — no spec opens them, so nothing here says anything about their
accessibility. `wcag22aa` is left out on purpose: its headline rule,
`target-size`, measures the 800×600 headless viewport rather than the markup
on a mobile-first layout, and the 40px hit boxes are pinned by the component
specs at the widths they were designed for.

The freeze table in `core/services/testing/axe.ts` is empty. The violations
that stood when the pass was wired in were frozen per route, each with its
reason, and all of them are fixed
([ADR 0151](ADR/0151-the-frozen-accessibility-findings-are-fixed-and-the-freezes-stay-empty.md)).
The table stays: a new violation fails the run on any route, and the only way
past is a row with its reason.

**Running the walkthrough in the other theme.** The repo commits no Karma
config — the builder supplies its own defaults — so nothing pins the scheme,
and a local run on a Mac in dark mode can pass what CI fails. To pin it, write
a Karma config of your own outside the tree: a copy of `getBuiltInKarmaConfig`
in `node_modules/@angular/build/src/builders/karma/karma-config.js`, its
plugins required from the workspace, with a custom launcher on
`ChromeHeadless` that adds `--blink-settings=preferredColorScheme=1` for light
or `=0` for dark. Hand it to the builder with `--karma-config` and name the
launcher in `--browsers`:

```bash
npx firebase emulators:exec --only auth,storage,firestore --project demo-home-account \
  "npx ng test --watch=false --karma-config=<config> --browsers=<launcher> --include='**/app.smoke.spec.ts'"
```

Without one, plain `ChromeHeadless` follows the machine's appearance, so
switching the Mac to light before the run has the same effect for that run.

## A rule that tightens, and the data already stored (#454)

The emulator proves what a new rule *accepts and refuses*. It cannot tell you
whether anything **already in a real account** would now be refused, because
its data is whatever the spec just seeded.

Tightening `categoryId is string` to also demand `size() > 0` on transactions,
budgets and recurring rules had exactly that shape. Nine smoke cases proved the
clause; none of them could say whether a row somewhere carried `''` and would
become unwritable on its next edit. Two things closed it:

- **A live read before the rule shipped.** From the authed session:
  `countDocuments(path, { where: [{ field: 'categoryId', op: '==', value: '' }] })`
  against each of the three collections. 131 rows, zero empties — and zero
  whitespace-only, missing, non-string or dangling ids, which the clause would
  not have caught anyway.
- **The clause written inside the `touched()` guard**, so that even an unseen
  row stays editable for every other field and is refused only if a write tries
  to keep the id empty. That is the part that does not depend on the probe
  being complete.

The probe covers one account. Rules grant no collection-group read and no
service-account credential is configured here, so nothing in this project can
count such rows across every account — which is why the guarded form is load
bearing rather than belt-and-braces.

## Summary

| Blind spot | What covers it | Where |
|---|---|---|
| Composite indexes not enforced | power-set check computed from the query builder | `npm run indexes:check`, in CI |
| Index entries not deployed | the merge deploy + the CI wait that holds the run until every index is built | `deploy-web` in CI, `scripts/wait-for-indexes.mjs` |
| Rules edits not deployed | the merge deploy + a browser pass against the live project (manual) | `deploy-web` in CI, checklist above |
| Rules accept ≠ services send | one smoke case through the owning service per collection | `*.service.smoke.spec.ts` |
| Storage `update` unreachable by upload | a metadata-update case, plus a named post-deploy check on the live project | `storage.service.smoke.spec.ts`, [receipt-quota.md](receipt-quota.md) |
| Query composes but needs an index | multi-equality cases note the limit in their doc block | `transaction-window.service.smoke.spec.ts` |
| Nothing renders, and no journey crosses a page | the driven browser journeys — a protocol, not a gate | [e2e.md](e2e.md), by hand, twice per branch |
| The iOS App Group container and the widget extension | a signed simulator build, its file cross-checked against the app's own screens by hand | [widget.md](widget.md) |
| A stored shape no client write can produce | a unit fixture standing in for the value; the emulator seeds the nearest shape it can hold | `recurring.service.spec.ts`, `recurring.service.smoke.spec.ts` |
| A document missing the field every read orders by | nothing, and nothing can — it is invisible until the form rewrites it | [ADR 0141](ADR/0141-a-recurring-rule-in-a-bad-state-is-repaired-where-its-data-allows-and-refused-where-it-does-not.md) |
| An interleaving the server cannot be asked for | the orderings driven by hand, with the read replaced by a promise the spec resolves | `auth.service.spec.ts` |
| A fixture asserting a shape no producer emits | nothing local — the producing call site is read by hand, and the driven browser pass is what meets the real one | [e2e.md](e2e.md), above |
| A tightened rule meeting data that already exists | a live owner-scoped read before the rule ships, and the clause written inside the `touched()` guard so a legacy row stays editable | above, [ADR 0146](ADR/0146-an-icon-that-carries-a-label-is-not-hidden-and-a-category-id-is-never-empty.md) |
| An accessibility defect nobody wrote a spec for | an axe-core pass inside `expectPage`, over every route the walkthrough opens, at 756px and above the frame's fold, with unserved i18n, in the one theme the host resolves (light on CI) | `app.smoke.spec.ts`, `core/services/testing/axe.ts`, above |

## When you add another one

**A new server-side filter field?** Add it inside `buildTransactionWhere` and
run `npm run indexes:check` — it will print the entries the file now needs.
Regenerate the file — merging deploys it, and CI waits for the build, so the
console is only there to read if that step goes red. If the check passes
without new entries, the regex did not see your field; fix the extraction
before trusting the green.

**A new collection door, or a new predicate on an existing one?** Hand-built
emulator cases first — accept and deny both sides — and then one case through
the service that owns the write, with the payload the service really builds.
If the service's payload cannot satisfy the rule you wrote, the rule is wrong
in a way only that case will ever show.

**A new predicate on a storage path?** Decide which branch production takes
before writing the rule, because the emulator will tell you `create` whatever
the answer is. If the predicate should differ between a new object and an
overwrite, the `create` branch needs the `resource != null` exemption to stay
honest locally, the `update` branch needs a metadata case standing in for it,
and the real behaviour needs a written post-deploy check.

**A new correctness-bearing query anywhere else?** The emulator will serve it
unindexed. If it composes more than one equality filter with an order-by, it
either goes through `buildTransactionWhere`'s contract or it needs its own
hand-listed entry — and the entry is reviewed, not tested, so say so in a
comment next to the query.

**A fixture for a door someone else's code feeds?** Find the producer on that
door's own path and copy the shape it returns, field by field, rather than
the shape the type permits. A fixture assembled from the type agrees with
code that agrees with it and says nothing about the code that does not.

**A guard against a stored value?** Work out what can actually be written
there before deciding where its proof lives. A shape no client write can
produce belongs in a unit fixture, with the nearest storable shape carrying
the emulator case. And if the bad value is the absence of a field the reads
order by, the guard has nothing to run against at all: write the gap down
rather than a test that cannot exist.
