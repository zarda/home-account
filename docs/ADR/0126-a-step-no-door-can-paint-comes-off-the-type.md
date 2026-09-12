# 126. A step no door can paint comes off the type

**Status:** Accepted, implemented · **Date:** 2026-09-12 · **Issues:** #419

Reference documentation lives in [../receipt-import.md](../receipt-import.md).

Closes the second of the known gaps
[0118](0118-the-processing-step-names-its-step-and-the-write-owns-its-signals.md)
filed — the `converting` step that never reaches the screen on either door.
The decision **rests on** 0118's third gap, the percentage-keyed step
indicators, which is not closed here and is the reason this step could not
simply be given a moment of its own.

## Context

0118 named the choice and left it open: "`importFromCSV` sets it and
overwrites it with `categorizing` a couple of lines later; `importFromJSON`
sets it and overwrites it with `duplicates` after a synchronous
`data.transactions.map(...)` — no `await`, no async callback, either way …
Either door's conversion needs a moment of its own, or the step comes off
both."

Angular renders between tasks, not between statements. Neither door yields
anywhere between the two writes, so `import.convertingRows` is set and
replaced inside one synchronous block on both — the value exists in the
signal for no frame at all. `i18n:check` cannot see this: the wizard's
literal `t('import.convertingRows')` call site satisfies a checker that
proves a key is *referenced*, not that it is *reachable*.

## Decision

**It comes off both.** `'converting'` is removed from the `ProcessingStep`
union in `models/import-history.model.ts`, which leaves five names.

The compiler then refused three things, and each was deleted where it
stood: the CSV door's write, the JSON door's write, and the wizard's
`case 'converting'` arm in `processingStepText`.

Two more came out that the compiler could not see: the progress writes that
shared the same synchronous block as each deleted step — the CSV door's 30,
overwritten by 50 two lines later, and the JSON door's 50, overwritten by 80
across a synchronous `map`. They are unobservable for exactly the reason the
step was, and nothing complains about a percentage nobody sees, because a
percentage is only a number. They came out because each was the *step's*
figure: a bar position chosen to sit under a line that no longer exists, and
the next reader has no way to tell that from a position the door means.

What the two doors now say and show:

| door | steps, in order | bar |
|---|---|---|
| `importFromCSV` | reading → categorizing → duplicates | 10 → 50 → 80 → 100 |
| `importFromJSON` | reading → duplicates | 20 → 80 → 100 |

Three catalog keys are deleted from all three locales: `import.convertingRows`,
and two orphans found beside it — `import.multiImageSuccess` and
`import.cameraNotAvailable`, neither referenced from anywhere.
`i18n:check` does not flag an orphaned key, so each removal was verified by
grep rather than by the gate.
[0036](0036-a-user-facing-string-lives-in-the-catalog.md)'s *Known gaps*
names `import.multiImageSuccess` among the three keys it left defined and
unreferenced; that record states what was true when it was written and is
not edited.

### Why `converting` was not given a moment instead

Two reasons, and the second is the binding one.

**Nothing between the two writes yields.** Giving the step a real moment
means *introducing* one — a scheduled task whose only job is to let a word
be read — which slows a door down so that it can narrate itself. On the
JSON door the work between the writes is a synchronous
`data.transactions.map(...)`; there is no await to move the write across.

**The step indicators would then disagree with the line.** 0118's third
gap: the three indicators under the status line render
`import.extractingData`, `import.categorizingTransactions` and
`import.checkingDuplicates`, and they key on `processingProgress()` — active
at 10, 30 and 60 respectively, complete at the next threshold up — three of
the step keys, selected by percentage rather than by name. A `converting`
step with a genuine moment at 30 would mark *Extracting data* complete and
light *Categorizing transactions* as the current one, while the line beside
them read *Converting rows*: two statements about what the door is doing,
visibly contradicting each other, where today they agree by construction.

So the cheap fix is blocked by an open gap, and the decision records that
dependency rather than hiding it. Any future step that needs a moment of
its own has to answer the indicators first.

### What was rejected

- **A moment of its own for `converting`.** Above: it costs a scheduled
  task on a hot path, and it makes the line and the indicators disagree
  until 0118's third gap is closed.
- **Keeping the step name but deleting only the key.** `t()` returns the
  key on a miss, so the step would render `import.convertingRows` as raw
  text the first time anything did make it visible.
- **Keeping `import.convertingRows` in the catalogs for a future reader.**
  A key no call site names is invisible to `i18n:check` in both directions:
  it cannot fail, and it cannot be trusted to still say the right thing
  when someone reaches for it.
- **Keeping the two progress writes.** They are the same defect in a
  different type, and they would have outlived the only thing that
  explained them.

## Consequences

- **`ProcessingStep` carries five names**, all of which at least one door
  can hold long enough to render.
- **Both doors have an exhaustive step spec.** The CSV door asserts
  `['reading', 'categorizing', 'duplicates', null]` and the JSON door
  `['reading', 'duplicates', null]` — every set in order, nothing else. The
  trailing `null` is `endRun`'s clear
  ([0125](0125-a-run-that-has-ended-owns-no-bar.md)), so one sequence per
  door pins this decision and that one together.
- **Nothing on screen moves.** The step and the two percentages that came
  out were never rendered, which is why they came out; what a user sees on
  either door is what they already saw.

## Things that only became apparent while building

- **The compiler found three of the five things that had to go.** Removing a
  member of a union is a good way to find its readers, and a useless way to
  find the statements that merely sat beside them. The two progress writes
  were found by reading the block, and nothing would have raised them.
- **The observable sequence is short enough to record exactly.** Driving the
  JSON door through the browser protocol ([../e2e.md](../e2e.md), journey
  20) with a mutation observer armed on the processing card before
  **Process with AI** recorded the line and bar as *Reading the file…* at 20,
  then *Checking for duplicates…* at 80, then the card gone — no gap where
  `converting` was, and no English sentence from the service.

## Known gaps

- **0118's third gap stands.** The three step indicators still key on
  percentages rather than on the step name, so the agreement between the
  line and the indicators is by construction and nothing keeps it.
- **Only three of the five step names have an indicator at all.** `reading`
  and `readingImage` appear in the line and nowhere below it.
- **Nothing gates reachability.** The next step added to the union can be
  set and overwritten in one block exactly as this one was, and both the
  compiler and `i18n:check` will be satisfied.
