# 114. The confirm step reads the write's progress from the service

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #381

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Extends
[0103](0103-the-review-step-adds-a-row-and-the-wizard-is-sealed-while-it-writes.md),
which sealed the stepper for the duration of the write and recorded, as a
follow-up, that the bar over that seal had never moved.

## Context

0103's own words: "The confirm step binds a determinate bar and a status line
to two of the wizard's own signals; one is only ever reset to zero and the
other is never written at all, while the figures that do move belong to the
service. A twenty-row import shows an empty status line and a bar at zero for
its whole duration."

That is the whole defect, and both halves of it were on the wizard.
`importProgress` was written exactly once — reset to 0 at the top of the
wizard's `confirmImport`, and never again; `importStatus` was declared and
never assigned at all. Meanwhile `confirmImport` on the service walked the
selected rows setting `processingProgress` to a real percentage on each pass
and `processingStatus` to `Importing ${i + 1} of
${selectedTransactions.length}...` — figures nobody was bound to, on the one
screen built to show them. So a write that takes as long as it takes, behind a
stepper that deliberately refuses every way out of it (0103's seal), reported
nothing at all.

The service's own status string could not simply be bound. It is English
assembled in a service, and a string the user reads lives in the catalogs
(0036) — `processingStatus` is a diagnostic that happens to be rendered on the
*processing* step, not a translated surface, and binding it on the confirm
step would have made it one.

## Decision

**The service publishes the write's progress as a structured fact, the wizard
renders it through the catalogs, and the wizard's own pair of signals is
deleted.**

### `processingRow` is `{ done, total } | null`

```ts
processingRow = signal<{ done: number; total: number } | null>(null);
```

It is set in `confirmImport`'s loop at exactly the point the English sentence
used to be assembled — one `set` per row, beside the `processingProgress`
percentage that was already there — and that sentence is gone. `null` is the
absence of a write, not a zeroth row: it is cleared in the `finally`, which
sits *before* the read-back of the completed record, so a read-back that fails
or hangs cannot leave a stale row on screen while the wizard renders its own
error.

The pair is the smallest thing that answers the question. A percentage alone
cannot say "3 of 20", and the translations disagree about the order the two
numbers appear in — the Japanese line puts the total first — so a number the
catalog can place is what a catalog needs.

### The wizard aliases both signals and renders one line

`processingProgress` and `processingRow` are aliases of the service's signals
on the component; `importProgress` and `importStatus` are deleted. The confirm
step's bar binds the percentage, and under it:

```html
@if (processingRow(); as row) {
  <p class="importing-status">{{ 'import.importingRow' | translate:{ done: row.done, total: row.total } }}</p>
}
```

`import.importingRow` is a new key in all three catalogs, placed beside
`importPartial`: `Importing {{done}} of {{total}}...` in English,
`{{total}}件中{{done}}件をインポート中...` in Japanese — the catalog's own
majority spelling, no space before 件 — and 正在匯入第 {{done}} 筆，共
{{total}} 筆... in traditional Chinese. It is not a plural key: `t()`
pluralises only on a parameter named exactly `count`, and neither number here
is a count of the sentence's subject.

The `@if` is what makes `null` meaningful: between the tap on Import and the
first row, and again after the last one, there is a bar and no line, rather
than a line claiming a row.

### What is proven, and where

Three levels, and they do not overlap as much as one would like:

- The **service spec** pins the set calls in order: one pair per row, then
  `null` — and, beside it, that `processingProgress` is written once per row
  after its one reset, never per file or per batch.
- The **wizard's unit spec** pins that both of its members *are* the service's
  signals, by identity, and nothing more. Its template is a stub
  (`'<div></div>'`), so no assertion about the confirm step's DOM is possible
  there at all.
- The **emulator smoke case** reads the real bar and the real line mid-write:
  `aria-valuenow` 50 then 100, and `.importing-status` present between them,
  from a macrotask scheduled by the row signal's own `set` and running inside
  the loop's first Firestore await.

### The alternatives that were rejected

- **Binding `processingStatus` on the confirm step.** It is the cheap version
  and it puts an untranslated English sentence on a user-facing surface. A new
  surface gets a key in all three catalogs; that is 0036's rule and it is what
  makes the Japanese word order above possible at all.
- **A callback from the service writing the wizard's own signals.** It keeps
  two sources for one fact and makes the service know about a component. The
  service already owns the figures; the wizard's copies were the problem, not
  the plumbing between them.

## Consequences

- **The bar and the line come from the same place**, so they cannot disagree:
  both are the service's own loop counter, one as a percentage and one as a
  pair.
- **The progress the CSV, PDF and image doors already published is unchanged.**
  `processingProgress` is written by every door on the processing step and by
  `confirmImport` on the confirm step; this adds a second reader, not a second
  writer.
- **One key in three catalogs, and no plural.** `translation-keys.spec.ts`
  checks placeholder parity across the three, which is what pins that all
  three carry both `{{done}}` and `{{total}}`.

## Things that only became apparent while building

- **Nothing end to end renders the interpolated numbers.** Karma loads no
  catalog, so under the emulator the line renders the bare key
  `import.importingRow`; the smoke case can prove the element is there and the
  bar moved, not that "3 of 20" appears. The interpolation is pinned by the
  placeholder-parity spec on one side and by nothing at all on the other,
  because no automated run presses Import against a real catalog — the browser
  journeys stop at the confirm step by design.
- **The clearing `finally` had to be read against the read-back.** Clearing
  after the read-back would have been the obvious place and would have left
  the last row's pair on screen for the whole of a slow or failing read.

## Known gaps

- **The processing step's status line is still the service's English.**
  `processingStatus()` is bound directly on that step, and the strings it
  carries — *Reading CSV...*, *Categorizing transactions...* — have never been
  in a catalog. This record moved the confirm step's line and deliberately did
  not widen to the other one. Tracked in #414. Closed by
  [ADR 0118](0118-the-processing-step-names-its-step-and-the-write-owns-its-signals.md),
  #414.
- **`isProcessing` is set for the whole write, so the processing step
  un-completes behind the seal.** `confirmImport` sets it true and the
  wizard's `processingComplete` is computed off it, so a step already passed
  reports itself incomplete for the duration. Nothing is visibly wrong because
  the seal refuses every move back to it, which is the only reason it does not
  matter. Tracked in #414. Closed by
  [ADR 0118](0118-the-processing-step-names-its-step-and-the-write-owns-its-signals.md),
  #414.
- **The service never resets `processingProgress` after a write.** It ends at
  100 and stays there; the next import's first `set` is what moves it. Between
  two imports in one session the confirm step's bar is a full bar describing
  the previous write — invisible today only because the bar renders under
  `isImporting()`. Closed by
  [ADR 0118](0118-the-processing-step-names-its-step-and-the-write-owns-its-signals.md),
  #414.
