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

## Summary

| Blind spot | What covers it | Where |
|---|---|---|
| Composite indexes not enforced | power-set check computed from the query builder | `npm run indexes:check`, in CI |
| Index entries not deployed | the merge deploy + the CI wait that holds the run until every index is built | `deploy-web` in CI, `scripts/wait-for-indexes.mjs` |
| Rules edits not deployed | the merge deploy + a browser pass against the live project (manual) | `deploy-web` in CI, checklist above |
| Rules accept ≠ services send | one smoke case through the owning service per collection | `*.service.smoke.spec.ts` |
| Storage `update` unreachable by upload | a metadata-update case, plus a named post-deploy check on the live project | `storage.service.smoke.spec.ts`, [receipt-quota.md](receipt-quota.md) |
| Query composes but needs an index | multi-equality cases note the limit in their doc block | `transaction-window.service.smoke.spec.ts` |

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
