# 123. The unit sweep is silent on a normal path

**Status:** Accepted, implemented · **Date:** 2026-09-11 · **Issues:** #416

Reference documentation lives in [../dates.md](../dates.md).

Corrects [0088](0088-the-smoke-harness-owns-the-noise-it-makes.md), which
opens by saying "the unit sweep is pristine, and `npm run smoke` was not".
That was true of the sweep's *failures* and never of its output. It applies
[0037](0037-an-error-body-is-a-failed-fetch.md), whose rule — the failure is
carried by the rejection and by what the cache does next — is exactly why
the loudest of these lines had nothing to report.

## Context

A green unit run printed, measured on a full sweep on 2026-09-11:

- **480 `ERROR:` lines**, a pair of *Failed to refresh exchange rates* /
  *Failed to initialize exchange rates* per construction of `CurrencyService`
  under a stubbed network. Three spec files stub `fetch` to reject with
  *network disabled in specs* — `currency.service.spec.ts`,
  `transaction.service.spec.ts` and `export.service.spec.ts` — and every
  construction in them lands in both catches on the way down.
- **141 `WARN:` lines**, all *[GeminiService] No valid API key found*, from
  a provider constructed without a key in a suite that blanks the key on
  purpose for the whole file.
- **About 500 `LOG:` lines**: 136 *[AIStrategy] Applying stored model
  selection on app start*, 132 *[OfflineQueue] Cleared all items*, 72
  *[OfflineQueue] Database initialized*, 18 *[Camera] Processed on web*, and
  around 40 Gemini model-detection lines.

Every one is a `console.*` call on a path the spec deliberately chose. None
of them is a failure: the offline start is arranged by the specs themselves —
one of those three files is about the rate service and the other two stub the
network so that nothing reaches it — the missing key is what the provider
suite arranges for the whole file, and the rest are constructors and cleanups
announcing that they ran.

The cost is not the volume, it is what the volume does to a real line. A
`console.error` from code under test, in a run that already prints four
hundred and eighty of them, has nowhere to stand out — and 0088's whole
argument for cleaning the smoke harness was that noise nobody reads is noise
nobody reads when it matters.

## Decision

**A line that narrates a path the spec chose is removed. A line that reports
a real failure stays.**

Eleven `console.*` call sites go, across five files:

- `currency.service.ts` — the `catch` logs in `initializeRates` and
  `refreshRates`. This is 0037's rule applied to its own service: the caller
  gets a rejected promise, the cache decides what the app shows, and the
  console line was a third statement of a fact already carried twice.
- `gemini.service.ts` — the no-key warning at construction, and the four
  model-detection and filtering traces (the Gemma-4 marker line, the light-
  filtering line, the deduplication line and the header-strip line).
- `ai-strategy.service.ts` — the constructor's *Applying stored model
  selection on app start*.
- `offline-queue.service.ts` — *Database initialized* and *Cleared all
  items*.
- `camera-capture.component.ts` — *Processed on web*.

What stays: `console.warn` where a real caught error precedes a fallback —
the camera's strategy failure, the queue's dropped legacy rows and blocked
upgrades — and the lines two other provider specs **assert**:
`claude.service.spec.ts` and `openai.service.spec.ts` each pin their
model-switch reporting, six expectations between them (two positive, four
negative), all still green and untouched.

Each removal is paired with a spec that says the line is not printed: one
`console` spy per touched file, asserting the absence. So the silence is a
fact under test, not a state the next edit can quietly undo.

## Departures from the issues

**Part 1 is declined.** The issue asks for `import-dto.utils.spec.ts` to
join the `test:dates` include list, on the grounds that its
`resolveImportDate` cases read the runner's zone and CI runs at UTC only.
They do not read the zone.

The file freezes the clock — `jasmine.clock().mockDate(now)` in a
`beforeEach`, uninstalled after — because `now` reaches the function only
through a default parameter, and every case then asserts either an instant
(`+result.date` against a millisecond arithmetic on that frozen `now`) or a
delegation (`+result.date` against `parseDateInput`'s own answer for the
same string). The one piece of calendar arithmetic in the function,
`setFullYear(now.getFullYear() - 10)`, is local on both sides of the
comparison: the bound and the value under test are built in the same zone,
so shifting the zone shifts both.

[0080](0080-an-impossible-date-lands-on-today-however-well-it-was-read.md)
already recorded this, in the same words and for the same file: "its
assertions are instant- and offset-based against a mocked clock, the same
shape ADR 0050 already exempted; a plausibility window built from `now` and
calendar arithmetic does not change that." Adding the file to the list would
not make a green run more meaningful — the two hand runs under
`America/New_York` and `Asia/Tokyo` were green because nothing reads the
zone, not because the zones happened to agree — and it would put a
maintenance claim in `package.json` that the file does not support.

The cost of declining is that the same question comes back — it has now been
asked twice — so [../dates.md](../dates.md) names the exemption where it
names the two lists, rather than leaving it to be rediscovered from a record
about something else.

## Consequences

- **`refreshRates` has no `catch` at all.** With the log gone the clause was
  `catch (error) { throw error; }`, which `no-useless-catch` flags and which
  a `try { … } finally { … }` does identically — an uncaught rejection
  propagates through a `finally` exactly as a catch-and-rethrow would. The
  reason lives in the method's doc comment now: the rejection is the report.
- **Two write-only locals went with their logs.** `adviceMarkerFound` in the
  Gemini filter and `platform` in the camera component existed only to be
  interpolated into a line nobody reads; each had no other reader, so each
  came out with it.
- **The comments that narrated a log went; the comments that explain code
  stayed.** A `// Log deduplication results` label above a deleted log is
  deleted with it; a comment explaining why a branch does nothing is about
  the branch, and stands.

## Things that only became apparent while building

- **The case that looked vacuous was not.** The offline queue's "degrades
  gracefully on reads and clears" case nulls the database in its own nested
  `beforeEach`, and `clearAll` short-circuits on a null database before it
  would ever reach the log — so the absence assertion should have passed
  before the change. It failed. The outer shared `beforeEach` runs its own
  two-account `clearAll()` cleanup against a real database first, so the spy
  sees the line from setup whatever the case body does. All four of that
  file's assertions are genuine reds.
- **How far a single line reaches is wildly uneven.** Read off the specs'
  structure rather than instrumented, and so estimates: the currency pair
  fired in about 61 and 62 of that file's 63 cases; the Gemini no-key
  warning in all 116, because the suite blanks the key in the outer
  `beforeEach` and the two cases that restore one do it in a nested block
  that runs after the first construction; the strategy constructor line in
  all 69; the queue's two in all 32, the `clearAll` one at least twice per
  case; the camera line in about 9 of 34. Four lines account for nearly all
  of the volume.
- **The reporter's own spelling defeats the obvious count.** Under a plain
  `ng test --include=…` the lines come out as `LOG:` with no leading space,
  while a full run prefixes them with the browser's name. A count keyed on
  `" LOG: "` therefore reads zero on a single-file run; both spellings have
  to be counted or the measurement lies in the safe direction.

## Known gaps

- **The residue is real failure logs, whole-suite and per file.** The
  before figures above are a whole-run count off the previous wave's
  ladder against this same tree — exact for `ERROR:`/`WARN:`, approximate
  for `LOG:`, said here rather than presented as exact. The same recipe
  run on the finished branch is the after figure this record owes:
  **40 `ERROR:`**, **38 `WARN:`** and **26 `LOG:`**, with `npm run test:ci`
  at **5632 SUCCESS**. The recipe is `grep -cE "(^| )ERROR: "` (the same
  pattern with `WARN:`/`LOG:` swapped in): `test:ci` prefixes every
  captured line with the browser string, but a plain
  `ng test --include=…` emits `LOG:` with no leading space at all, so a
  single-spelling grep reads zero on a per-file run. The whole-suite
  residue is genuine: 12 reclaimed-item warnings, 12 Gemini initialization
  logs from a spec that supplies a key, 8 font 404s, and the simulated
  failures specs deliberately raise (`Error: boom`). Measured after the
  change, on the five touched files alone: `currency.service.spec.ts` 0
  LOG / 0 WARN / 0 ERROR; `gemini.service.spec.ts` 28 / 0 / 32;
  `ai-strategy.service.spec.ts` 2 / 4 / 2;
  `offline-queue.service.spec.ts` 0 / 14 / 0;
  `camera-capture.component.spec.ts` 0 / 6 / 2 — each traced to a
  deliberately simulated failure in a case that is about the failure, a
  provider rejecting or a database refusing, rather than to leftover
  narration.
- **Lines of exactly the same shape stand in the same files.** The queue
  still logs *Cleared completed items*, *Cleared failed items*, a queued
  image and a completed sync; the strategy service still logs *Models
  updated successfully*; Gemini still warns on each of its two rate-limit
  retries. Each narrates a chosen path the way the removed ones did, and
  each was left because it was outside what this pass named.
- **There is no gate on `console` at all.** No lint rule, no logger, no
  debug helper, no level — so the next narration line is added exactly as
  easily as these were, and only a reader counting output will notice. The
  spies added here defend five files and say nothing about the sixth.
