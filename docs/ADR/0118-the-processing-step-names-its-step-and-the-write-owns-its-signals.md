# 118. The processing step names its step, and the write owns its signals

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #414

Reference documentation lives in [../receipt-import.md](../receipt-import.md)
and [../i18n.md](../i18n.md).

Extends
[0114](0114-the-confirm-step-reads-the-writes-progress-from-the-service.md)
and closes all three of the gaps it filed as follow-ups — the processing
step's English line, the write borrowing the extraction's flag, and the bar
left at 100 after a write. It applies
[0036](0036-a-user-facing-string-lives-in-the-catalog.md) to the one surface
in the wizard that had never obeyed it.

## Context

0114 moved the *confirm* step's line into the catalogs and said in the same
breath what it had deliberately not touched: "The processing step's status
line is still the service's English." That line is
`{{ processingStatus() }}`, bound with no pipe, and everything the service
ever put in it was an English literal — 27 `processingStatus.set(...)` calls,
twenty-six of them across the six doors and one in the confirm-time write,
spelling *Reading PDF...*, *Categorizing transactions...*, *Checking for
duplicates...*, *Reading image 2 of 5...*, *Saving transactions...*.

What made it worse than an untranslated string somewhere quiet is where it
sits. Directly above it the card's own heading renders `ai.processing`
through the catalogs; directly below it three step indicators render
`import.extractingData`, `import.categorizingTransactions` and
`import.checkingDuplicates` — three of the sentences the service was
setting, already in all three catalogs, already translated. So a Japanese
account watched a translated heading, an English sentence, and the Japanese
for that same sentence, stacked. And one step later the confirm step's line
is a catalog key with numbers placed by the catalog, because 0114 put it
there.

The second half is the flag. `confirmImport` opened with
`this.isProcessing.set(true)` and cleared it in its `finally` — the
extraction's flag, borrowed by a write that is not an extraction. The
wizard's `processingComplete` is `!isProcessing() && rows.length > 0` and
drives `[completed]` on the processing step, so for the whole of a write a
step the user had already passed reported itself incomplete. Nothing looked
wrong, because 0103's seal refuses every move back to that step while
`isImporting` holds — the flag was a lie that only the seal made harmless.

And the third: nothing ever put the bar back. `processingProgress` ended a
write at 100 and stayed there, so the next write in the same session had a
full bar describing the previous one until its first `set` landed.

## Decision

**The service names the step it is on and the wizard resolves the name
through the catalogs; the write touches only the two signals that are its
own — zeroing the bar where it begins, clearing the row where it ends.**

### A step is a name, not a sentence

```ts
export type ProcessingStep =
  | { name: 'reading' | 'extracting' | 'converting' | 'categorizing' | 'duplicates' }
  | { name: 'readingImage'; done: number; total: number };
```

Six names, one of which carries the two figures its line interpolates —
the same shape 0114 gave `processingRow`, and for the same reason: the
Japanese line puts the total first, so a number the catalog can place is
what a catalog needs. `processingStep` replaces `processingStatus` on the
service, and the 27 literals become 26 sets of a name (the twenty-seventh,
*Saving transactions...*, belonged to the write and is deleted outright with
the signal it was written to).

Which door says what:

| door | steps, in order |
|---|---|
| `importFromImage` | reading once, then extracting → categorizing → duplicates on the strategy path and again on the fallback |
| `importFromStatementImages` | reading → categorizing → duplicates |
| `importFromMultipleImages` | reading → readingImage (per file, with `done`/`total`) → extracting → categorizing → duplicates |
| `importFromPDF` | reading → extracting → categorizing → duplicates |
| `importFromCSV` | reading → converting → categorizing → duplicates |
| `importFromJSON` | reading → converting → duplicates |

Twenty-six sets — reading 6, readingImage 1, extracting 4, converting 2,
categorizing 6, duplicates 7 — each one a literal-for-literal replacement of
the sentence that stood there. The JSON door names no categorization because
it does none: a backup carries the categories it recorded. Six `finally`
blocks set the step to `null` beside the `isProcessing.set(false)` they
already had, so the absence of a door is `null` rather than the last thing
one was doing.

### The wizard renders it through literal `t()` calls

```ts
processingStepText = computed(() => {
  const step = this.processingStep();
  switch (step?.name) {
    case 'reading': return this.t('import.readingFile');
    case 'readingImage': return this.t('import.readingImageOf', { done: step.done, total: step.total });
    …
  }
});
```

A `switch` and not a lookup table, and that is the whole reason it is a
`switch`: `scripts/check-i18n.mjs` walks the literal first argument of every
`t(` call, and a key held in a variable or read out of a map is invisible to
it. A table would have been shorter and would have taken these six keys out
of the only gate that watches them. Three keys are new —
`import.readingFile`, `import.readingImageOf` with `{{done}}`/`{{total}}`,
and `import.convertingRows` — in all three catalogs; the other three the
step indicators below the line were already rendering.

### The write's signals are its own

`confirmImport` no longer sets `isProcessing` at all, and
`processingStatus` no longer exists. What the write touches is what the
write owns: `processingProgress`, zeroed in its first statement and moved
once per row, and `processingRow`, set per row and cleared in the `finally`.
The wizard's own `isImporting` is what says a write is running, it is what
seals the stepper, and it is what gates the section the bar renders in —
there was never a second flag needed, only a borrowed one.

`processingComplete` is untouched. Once `confirmImport` stops writing
`isProcessing`, the computed reads exactly what it was always meant to read:
whether an extraction is running.

### The bar is zeroed where the write begins, not where it ends

The reset that closes 0114's third gap is the one at the **head** of
`confirmImport`. It runs in the same synchronous block as the wizard's
`isImporting.set(true)`, so Angular never renders between the seal going on
and the bar being zeroed: a second write in one session cannot paint the
first one's full bar, and nothing flickers.

A reset in the `finally` was written first and taken back out. `finally`
runs *before* the method's trailing read-back of the completed record, while
`isImporting` — the only gate on the importing section — stays true until
that read-back resolves. So every successful confirm showed the bar reach
100 and then sit visibly empty for the length of the read-back, with the
section still on screen. It bought nothing the head reset had not already
bought, and it cost a flicker on every import.

### The alternatives that were rejected

- **Translating the 27 strings where they stand.** A sentence per door per
  catalog, three of which the catalogs already carried under keys the
  template below was already using — the same string twice, in two places,
  free to drift.
- **A lookup table from step name to key.** The obvious shape, and it hides
  every one of these keys from `i18n:check`, which is the gate that would
  notice the day one of them is renamed or dropped.
- **A separate `isWriting` flag on the service.** It answers the borrowed
  flag with a second flag. The wizard's `isImporting` already is one, it
  already drives the seal, and adding another would mean two things to keep
  agreed.

## Consequences

- **The service writes no English a user can read.** What is left on it is
  the step name, the percentage and the row pair — three structured facts,
  all resolved by the wizard.
- **`i18n:check` counts three more literal keys**, one per new step, and
  `translation-keys.spec.ts` is what pins that `readingImageOf` carries both
  `{{done}}` and `{{total}}` in all three catalogs.
- **Deleting `processingStatus` deletes a reader nobody had.** A grep across
  `src/app/core` and `src/app/features/ai/import` comes back empty; the
  camera capture component's same-named signal is its own, and is not this
  one.

## Things that only became apparent while building

- **The proof of the binding had to be the emulator's.** The wizard's unit
  spec template is a stub (`'<div></div>'`), so nothing about the wizard's
  DOM is provable there — the unit spec can only pin that
  `processingStepText()` returns the key for a given step. The smoke case
  reads `.processing-status` under emulators and finds
  `import.categorizingTransactions`. That it finds the *key* rather than a
  sentence is what makes it non-vacuous: Karma loads no catalog, so `t()`
  answers with the bare key, and the old code would have answered with an
  English sentence.
- **The `converting` step can be set and overwritten in the same tick.**
  `importFromCSV` sets it and then sets `categorizing` with no `await`
  between them, so `import.convertingRows` never reaches the screen on that
  door. It is byte-identical to how the two English sentences behaved before
  — the same pair, overwritten the same way — so it is carried, not
  introduced. See *Known gaps*.
- **The four `mat-step` bodies are eager.** The processing card is in the
  DOM without navigating to it, which is what let the smoke case read the
  line at all.

## Known gaps

- **The camera capture component keeps its own English status line.**
  `camera-capture.component.ts` has a `processingStatus` signal of its own,
  set to *Optimizing image...*, *Saving for later processing...* and two
  template literals naming a file count, and rendered untranslated through
  `[message]`. It is the same defect on a different door, and closing it is
  the same shape of change: a step signal resolved through literal `t()`
  calls. Not filed as its own issue at the time of writing.
- **The `converting` step never reaches the screen on either door.**
  `importFromCSV` sets it and overwrites it with `categorizing` a couple
  of lines later; `importFromJSON` sets it and overwrites it with
  `duplicates` after a synchronous `data.transactions.map(...)` — no
  `await`, no async callback, either way. The English sentences these
  steps replaced sat in the same adjacent pairs, so this is carried, not
  introduced. `i18n:check` cannot catch it: the wizard's literal
  `t('import.convertingRows')` call site satisfies a checker that proves
  a key is referenced, not that it is reachable on screen. Either door's
  conversion needs a moment of its own, or the step comes off both.
- **The three step indicators still key on the percentage.** They read
  `processingProgress() >= 10`, `>= 30`, `>= 60`, which is a second,
  independent statement about what the door is doing, in thresholds rather
  than in names. It agrees with the step today by construction; nothing
  makes it agree tomorrow.
- **Every extraction door still leaves its bar at 100.** Each of the six
  clears `isProcessing` in its `finally` and never puts `processingProgress`
  back — 0114's third gap, on the processing step's bar rather than the
  confirm step's. Invisible for the same reason the write's was: the bar
  renders under `isProcessing()` and each door's first act is to set a low
  percentage, inside the same synchronous block. A uniform rule would be
  better than six coincidences.
