# 124. The camera door names its step, and a status nobody could see is deleted

**Status:** Accepted, implemented · **Date:** 2026-09-12 · **Issues:** #419

Reference documentation lives in [../receipt-import.md](../receipt-import.md)
and [../i18n.md](../i18n.md).

Closes the first of the known gaps
[0118](0118-the-processing-step-names-its-step-and-the-write-owns-its-signals.md)
filed — the camera capture dialog's own English status line — by the shape
that record named for it. It applies
[0036](0036-a-user-facing-string-lives-in-the-catalog.md) to the last import
surface that had never obeyed it, and
[0048](0048-a-dead-capability-is-removed-not-guarded.md) to what was left
once the strings were gone.

## Context

0118 moved the wizard's processing line into the catalogs and named, as its
first follow-up, the same defect on the other door: "The camera capture
component keeps its own English status line … It is the same defect on a
different door, and closing it is the same shape of change."

`camera-capture.component.ts` held a `processingStatus` of its own — a
`WritableSignal<string>`, rendered untranslated through the loading
spinner's `[message]` — carrying *Optimizing image...*, *Saving for later
processing...* and two template literals, *Analyzing image (…)...* and
*Processing N images (…)...*. What went in the parentheses was
`getProcessingModeLabel()`, five more English literals: *offline mode*,
*native OCR*, *cloud AI*, *AI unavailable* and a bare *AI*. Two error
messages were English literals too, and so was the captured-photo
thumbnail's `alt`.

The dialog is a first-class door, not a corner: the Add menu's **Import from
Camera** opens it, and everything a receipt photo reaches on that path goes
through this component. So a Japanese account watched a translated dialog
heading above an English sentence, which is the arrangement 0118 called
worse than an untranslated string somewhere quiet.

The `alt` attributes had no gate at all. `scripts/check-i18n.mjs` rejects a
literal `aria-label` under `src/app` templates (0036), and an `<img>`'s alt
text reaches a screen reader exactly the way an `aria-label` does — but the
scan read one attribute name and not the other, so `alt="Captured photo
{{ i + 1 }}"` here and `alt="Profile"` on the settings avatar were both
English that nothing was watching.

## Decision

**The dialog names the step it is on in a type of its own, resolves that
name through the catalogs, and a status that could never reach a screen is
deleted rather than translated.**

### The capture steps are their own type

```ts
export type CaptureStatus =
  | { name: 'analyzing' }
  | { name: 'processingImages'; count: number }
  | { name: 'queueing' };
```

Three names beside `ProcessingStep` in `models/import-history.model.ts`,
not a widening of it. This door's steps are the dialog's own: it queues,
which no wizard door does, and it never converts, categorizes or checks for
duplicates. One shared union would have handed every wizard door three names
it can never set, and this one every name the wizard's doors use.

`processingStatusText` is a computed `switch` of literal `t()` calls, the
same shape as the wizard's `processingStepText` and for the same reason:
`check-i18n.mjs` walks the literal first argument of every `t(` call, so a
lookup table would take these keys out of the only gate that watches them.
The template binds the resolved computed.

Two keys are reused. `ai.scanning` is the single-image line, and
`import.processingMultipleImages` the multi-image one — the second was one
of three keys 0036 recorded as defined with no call site, and it now has
one.

**It stays a plain string**, which is 0036's own exception rather than a
lapse from its rule. The key carries `{{count}}`, and 0036 converts a count
key to a plural object when a count of 1 is reachable. Here it is not: the
call site chooses `processingImages` only under `files.length > 1`, and the
single-photo case is the other branch of that same ternary. A `one` member
would be unreachable by construction.

Three keys are new in all three catalogs — `import.savingForLater`,
`import.errorQueueWrite`, `import.noTransactionsInImages` — plus
`settings.profilePhotoAlt`. Two of them are new rather than reused, and the
near-miss in each case is a different sentence:

- `import.errorQueueWrite`, not `import.failureQueueWrite`. The second is a
  past-tense **label** in the history card's failure-class map, read on a
  record of something that already finished; this one is the live message a
  user reads at the moment the write fails.
- `import.noTransactionsInImages`, not `noTransactionsFoundDescription`.
  That one is worded for a file. This one declines in English, because a
  camera batch of one photo is reachable.

`import.capturedPhotoAlt` was written for the thumbnail and then deleted
again: `receiptImages.imageNumber` already reads *Receipt image {{index}} of
{{total}}* in all three catalogs, and the thumbnails are receipt images. A
second key for the same sentence is two strings free to drift.

### Deleted, not translated

*Optimizing image...* and its clearing write are gone. The overlay renders
under `isProcessing()`, which is raised in `processImage` and nowhere else,
and both writes sat in the file-selection handler that runs before it — the
string could not paint on any path. Translating it would have put three
catalog entries behind a line that cannot appear.

`getProcessingModeLabel()` went with it, and `processingMode` went with
that: the label method was the computed's only reader and the computed was
the method's only input, so once the English sentence that interpolated the
label was gone the whole chain had nothing above it. The spec that pinned
the computed went too. That is 0048's rule — a dead capability is removed,
not guarded — and the alternative was five English literals kept alive
behind a translated line.

### An `alt` is bound or it is rejected

`check-i18n.mjs` gains `STATIC_ALT` beside `STATIC_ARIA`, run through the
same offence walk, so a literal `alt="…"` under `src/app` templates fails
the gate and `[alt]="'k.k' | translate"` passes.

The one difference between the two patterns is deliberate: the alt scan
matches `([^"]+)` where the aria scan matches `([^"]*)`. An empty
`alt=""` is WCAG's idiom for a decorative image — the way to say "this
picture carries no information, skip it" — and a gate that rejected it
would push decorative images towards a translated string that should not
be announced at all. An empty `aria-label`, by contrast, is only ever a
mistake. Both spellings are pinned in `--self-test`, which now runs 26
cases.

### What was rejected

- **Widening `ProcessingStep` to carry the capture steps.** One union for
  two producers that share no step; every consumer would then have to
  handle names its own door cannot set.
- **A lookup table from capture step to key.** Shorter, and invisible to
  `i18n:check` — 0118 rejected the same shape for the same reason.
- **Translating *Optimizing image...*.** One key in three catalogs, kept
  forever, for a line no path can render.
- **Keeping `processingMode` against a future reader.** It had none, and
  0048 exists because a guarded dead capability reads exactly like a live
  one.

## Consequences

- **`i18n:check` now fails a literal `alt` as well as a literal
  `aria-label`.** Writing the scan is what found the two offenders; nothing
  standing before it had an opinion on either.
- **The dialog's DOM is under test for the first time.** The spec file's
  main `describe` blanks the template, so nothing about this component's
  rendering was provable there. A second sibling `describe` renders the
  real template, pushes a captured image and raises the processing flag,
  and asserts that the overlay's `<p>` carries the key for the set status,
  is absent for `null`, and that the thumbnail's `alt` resolves through
  `receiptImages.imageNumber`.
- **Neither import door composes English for the user to read.** 0118 took
  the wizard's; what is left on this component is a step name and a count.
  A raw provider message can still surface on either door outside what each
  composes — `describeError`'s fallback here is the surface the gaps below
  name; the wizard's `parsed.message` fallback is the same shape.

## Things that only became apparent while building

- **The multi-image line needed a real count, not a flag.**
  `handleImportResult`'s second parameter was a derived boolean saying only
  whether the batch held more than one photo. A plural key places a number,
  so the parameter became `imageCount: number` and the boolean is derived
  where it is actually needed.
- **The two offenders the `alt` scan found were in different features.**
  One is the camera thumbnail this change was about; the other is the
  settings avatar, which nothing in this door touches. A gate written for
  one surface immediately paid for itself on another.

## Known gaps

- **The scan is static, like every other key check.** A bound
  `[alt]="expression"` whose right-hand side is not an adjacent literal
  pipe is dynamic and unverifiable, exactly as a dynamic `t()` key is.
- **Hardcoded *visible* English text is still caught by nothing.** 0036
  recorded that and it stands: the attribute scans cover attributes.
- **`describeError()` still decides what the user reads on a camera
  failure**, as [0065](0065-an-attempt-is-recorded-where-it-runs.md)
  recorded. The status line is translated; the error mapper beside it is a
  separate surface and was not folded in here.
- **One of 0036's three unreferenced keys is still unreferenced.**
  `reports.transactionsLabel` has no call site in any locale;
  `import.processingMultipleImages` gained one here, and
  `import.multiImageSuccess` is deleted by
  [0126](0126-a-step-no-door-can-paint-comes-off-the-type.md).
