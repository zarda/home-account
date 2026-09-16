# 134. An emulator run carries no provider key

**Status:** Accepted, implemented · **Date:** 2026-09-16 · **Issues:** #424

Corrects a gap of
[0131](0131-a-rung-a-boot-cannot-reach-is-reached-by-re-entering-the-ladder.md).

## Context

`GeminiService`'s constructor fires `initializeGemini()` unawaited, reading
`environment.geminiApiKey` when no explicit key is passed
(`gemini.service.ts:73`). On a developer machine, `.vscode/environment.ts` —
gitignored, never committed — carries a real key, so every smoke spec that
constructs the façade anywhere in its chain logs two `[GeminiService]` lines
under that developer's own key, whether the spec has anything to do with AI
or not. CI's stub environment never has that field, so the same run is silent
there. That divergence is #424: a local `npm run smoke` looks noisier than
CI's, for a reason that has nothing to do with what either run is testing —
and a key printed into a terminal is a key exposed to anyone who reads that
terminal's scrollback.

0131 had already named this as a known gap, attributing it to "seven
pre-existing smoke specs" — `app`, `period-totals`, `weekly-recap`,
`period-window`, `backup-restore`, `nl-search` and `budget-recalc`. That list
was never verified against an isolated run of each file, and it turned out to
be wrong in both directions: three of the four real emitters were not on it,
and it named several files that print no `[GeminiService]` line at all.

## Decision

**A single helper strips the environment key at module scope, with no
restore — because restoring was the actual bug.**

### The helper, and why there is no restore

`provider-keys.ts` exports `stripProviderKeys()`: one function, added at
module scope beside each file's existing `silenceFirebaseWarnings()` call,
that deletes `environment.geminiApiKey` for the run and returns nothing to
put back. Every smoke spec loads as an ES module into one shared Karma
bundle before Jasmine starts, so whichever file's module body runs first
strips the key for every spec that follows in that bundle — deleting an
absent field is a no-op, so calling it from more than one file costs
nothing. Three files already had a hand-rolled version of this —
`cloud-llm-provider.smoke.spec.ts`, `app-lock.smoke.spec.ts`,
`note-translation.smoke.spec.ts`, `receipt-viewer.smoke.spec.ts` — each
stripping the key in its own `beforeAll` and **restoring it in `afterAll`**.

That restore was not neutral. Karma runs every spec file in one shared
bundle, and a file that restores the real key in its `afterAll` hands it
back to whichever spec constructs a `GeminiService` next in the same run —
which is exactly the cross-file leakage measured below. `stripProviderKeys()`
has no restore precisely because a real key, once removed from the run, has
nothing to gain by coming back before the run ends.

### The per-file measurement table

Every smoke file that can reach a real (non-doubled) `GeminiService`
construction was found by reading, then run in isolation under the
emulators to attribute its lines exactly:

| File | `[GeminiService]` lines (isolated) | Real key (length 39) or deliberate fake (length 22)? |
|---|---|---|
| `cloud-llm-provider.smoke.spec.ts` | 12 | fake — three tests pass `'fake-key-for-the-smoke'` as an explicit argument, never reading `environment.geminiApiKey` |
| `app.smoke.spec.ts` | 4 | real |
| `add-entrypoints.smoke.spec.ts` | 8 | real |
| `transaction-overflow.smoke.spec.ts` | 4 | real |
| `transaction-form.smoke.spec.ts` | 8 | real |
| `app-lock.smoke.spec.ts` | 0 | n/a (already stripping) |
| `note-translation.smoke.spec.ts` | 0 | n/a (already stripping) |
| `receipt-viewer.smoke.spec.ts` | 0 | n/a (already stripping) |

The four real emitters sum to 24, isolated and run together as one batch.
The whole-features baseline before any fix was 36 (all real-key lines). The
gap between 24 and 36 is not attributed to a ninth file: it reproduces only
when the full eleven-file features batch runs together, and it goes away
entirely once the fix removes the three old restores — which is itself
strong evidence that the extra 12 were the three restoring files re-opening
the key for whichever spec ran next after them in that same bundle, not a
fourth or fifth emitter this table missed. **The measured per-file sum (24)
is smaller than the whole-run count it explains (36) for that reason, stated
here rather than left to look like an oversight in the table.**

Fixed: `environment` imports and the strip/restore blocks removed from the
four files that had them; `stripProviderKeys()` calls added to those same
four plus the four real emitters above. Post-fix, both halves of the smoke
suite carry **zero** length-39 (real-key) lines — the actual #424 bug is
gone. A follow-up fix wave then silenced `cloud-llm-provider.smoke.spec.ts`'s
own three deliberate fake-key lines too (`silenceGeminiInitLogs()`, a local
`console.log` spy scoped to those three tests, not a stripping of any key),
closing the run's `[GeminiService]` count to a literal zero rather than
leaving 12 lines that were correct but still present.

### The correction of 0131's seven-spec attribution

0131's "Known gaps" named `app`, `period-totals`, `weekly-recap`,
`period-window`, `backup-restore`, `nl-search` and `budget-recalc` as the
sources. Measured directly, that list is wrong on both ends: `period-totals`,
`weekly-recap`, `period-window`, `backup-restore`, `nl-search` and
`budget-recalc` print no `[GeminiService]` line in isolation at all — none of
them construct a real `GeminiService` on their tested paths — and
`add-entrypoints.smoke.spec.ts` and `transaction-overflow.smoke.spec.ts` and
`transaction-form.smoke.spec.ts`, three real emitters, were not on the list.
Only `app` was named correctly. Per the wave's own rule that an earlier
ADR's gap is closed or corrected by a new record rather than edited in
place, this record replaces that list with the measured one above. 0131's
own text stands as it was written; this is the correction it pointed at
without yet having.

## What was rejected

- **Changing `cloud-llm-provider.smoke.spec.ts`'s test bodies** to avoid the
  fake key entirely — rejected because those three tests deliberately drive
  the real reinitialize-with-an-explicit-key path, and rewriting them to
  dodge a log line would weaken what they prove for the sake of a number.
- **A restore, kept but ordered to run last.** Any restore reopens the
  window a later spec in the same bundle can walk through; removing it
  entirely removes the failure mode instead of narrowing it.

## Consequences

- **`provider-keys.ts`** (the helper) **and `provider-keys.smoke.spec.ts`**
  (its own TDD spec, 2 cases) are new. Eight existing files changed: four
  lost their hand-rolled strip/restore block in favor of the call, four
  gained the call for the first time.
- **Whole smoke suite: 495 SUCCESS** (core 442 + features/app 53), **zero**
  `[GeminiService]` lines across the run — the first criterion #424 asked
  for, met exactly rather than approximately.
- **No app code changed.** `gemini.service.ts`'s constructor behavior is
  exactly what it was; this is a test-harness fix for a local/CI divergence,
  not a product change.

## Departures from the issues

None. #424 asked for a smoke run with no provider-key lines and the fix
reaches literally zero, once the deliberate fake-key lines are silenced
alongside the real ones the issue was actually about.

## Things that only became apparent while building

- **Two different string lengths were hiding inside one grep.** `grep -c
  '\[GeminiService\]'` counts a line regardless of what key produced it; only
  reading the reported key's length (39 for the real key, 22 for the literal
  `'fake-key-for-the-smoke'`) separated the actual bug from a same-file
  test's deliberate, correct behavior. The plan's own baseline figure (48)
  turned out to have been counted the same unguarded way this task started
  with.
- **Karma's terminal reporter prints every `LOG:` line twice** — once inside
  a cursor-reset escape sequence, once plain — so a `tee`-captured log's raw
  `grep -c` count is always double the number of actual `console.log` calls.
  Consistent across every measurement above, so the arithmetic holds either
  way, but worth knowing before doubling anything by hand.

## Known gaps

None. The measured count matches the criterion exactly, and the corrected
attribution above closes 0131's open one.
