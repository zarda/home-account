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

Neither file does anything until deployed:

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules
```

Index builds on a populated collection are not instant — the Firebase console
(Firestore → Indexes) shows each entry's build state, and every entry must
read **Enabled** before the queries it serves stop erroring. The CLI may also
offer to delete indexes that exist in the project but not in the file; read
that list before accepting it.

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
| Index entries not deployed | deploy + console shows every entry Enabled | release checklist above |
| Rules edits not deployed | deploy + a browser pass against the live project | release checklist above |
| Rules accept ≠ services send | one smoke case through the owning service per collection | `*.service.smoke.spec.ts` |
| Query composes but needs an index | multi-equality cases note the limit in their doc block | `transaction-window.service.smoke.spec.ts` |

## When you add another one

**A new server-side filter field?** Add it inside `buildTransactionWhere` and
run `npm run indexes:check` — it will print the entries the file now needs.
Regenerate the file, deploy, and watch the console until every entry is
Enabled. If the check passes without new entries, the regex did not see your
field; fix the extraction before trusting the green.

**A new collection door, or a new predicate on an existing one?** Hand-built
emulator cases first — accept and deny both sides — and then one case through
the service that owns the write, with the payload the service really builds.
If the service's payload cannot satisfy the rule you wrote, the rule is wrong
in a way only that case will ever show.

**A new correctness-bearing query anywhere else?** The emulator will serve it
unindexed. If it composes more than one equality filter with an order-by, it
either goes through `buildTransactionWhere`'s contract or it needs its own
hand-listed entry — and the entry is reviewed, not tested, so say so in a
comment next to the query.
