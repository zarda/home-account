# 41. A retired model id migrates once, and the catalog keeps the choice

**Status:** Accepted, implemented · **Date:** 2026-08-14

Reference documentation lives in [../ai-models.md](../ai-models.md).

## Context

`src/app/core/config/ai-models.ts` is the single source of truth for which
cloud models the app offers and which one it picks by default. Its ids are
hand-maintained against the vendors' published lists, and nothing in the
codebase can validate them: an id is a string until a request carries it, and
only the provider's servers know whether it still answers.

Checked against <https://ai.google.dev/gemini-api/docs/models>,
`gemini-3.1-flash-lite-preview` had moved into that page's "Previous models"
section, marked shut down. It was `DEFAULT_TEXT_MODEL` **and**
`DEFAULT_VISION_MODEL`, so every Gemini request the app made under untouched
settings named a model that no longer existed. Nothing reported it. The unit
specs pass model ids in as fixtures, so all of them stayed green; the settings
dropdown rendered its stale entry happily; the failure only surfaced as a
request error at the moment a user tried to read a receipt.

Correcting the catalog is not enough on its own. `loadPreferences` spreads the
stored blob over the defaults, so storage outranks the catalog by design —
that is what makes a model choice stick. Anyone who has ever opened **Settings
→ AI** has all four model ids written to `localStorage`, including the retired
one, and moving `DEFAULT_TEXT_MODEL` on would leave every one of them exactly
where they were.

So the fix needs to reach into stored state. The difficulty is that a stored
id and a chosen id are the same bytes. A preference reading
`gemini-3.1-flash-lite-preview` may be a default nobody ever looked at, or a
model the user picked on purpose — and the app cannot tell which by looking.

## Decision

**The catalog names live models, and the retired one stays selectable.** 3.5
Flash-Lite becomes the recommended default for text and vision. 3.1 Flash-Lite
keeps a place in both lists rather than being deleted: it is still a coherent
thing to ask for, and a catalog that silently drops entries makes every stored
preference a possible orphan.

**A stored blob carries a schema version, and the rewrite runs once.**
`ai-model-migrations.ts` holds `AI_PREFERENCES_SCHEMA_VERSION`, a map from
superseded ids to their successors, and a pure `migrateModelPreferences`. A
blob already stamped with the current version is returned untouched. An
unstamped blob — every blob written before this existed — has its four model
fields moved forward and gains the stamp. Because the pass is one-time, the
stale default gets corrected and a later deliberate pick of the same id
survives every reload after it.

The migration therefore does not mean "this id is not offered". It means "move
this id forward, once". 3.1 Flash-Lite is deliberately both a catalog entry and
a map key.

**The migration runs on the parsed blob, before the merge with the defaults.**
`DEFAULT_PREFERENCES` carries the current stamp so a fresh install is born
current. That makes the order load-bearing in a way no error would report:
merging first hands a legacy blob a version it never had, the migration
declines to run, and the retired id survives untouched with lint, types and
every other spec still green. `ai-strategy.service.spec.ts` pins the order with
a case that fails under the inverted one.

**Two invariants hold the catalog and the map together**, in the new
`ai-models.spec.ts`: no default id may be a key in the replacement map — a
default that migrates away from itself is a loop handed to every new install —
and every replacement value must be an id the catalog actually offers, since a
silent rewrite must not land a preference somewhere the dropdown cannot show.
A third assertion, that no default is a Gemma model, backs the shared constant
`gemini.service.spec.ts` now uses to name the other side of that service's
`includes('gemma')` filtering branch.

Rejected: **validating every stored id against the catalog on load**. It is
strictly more general — it would also catch hand-edited storage and future
retirements with no map entry — but it cannot coexist with keeping 3.1
Flash-Lite selectable. The entry is still in the catalog, so validation passes
it through and the retired default is never corrected; drop the entry to make
validation bite and the deliberate choice disappears with it.

Rejected: **a separate `localStorage` key for the schema version**. Two keys
can be written apart and read apart; a field inside the blob moves with it
through every existing read, write and reset path, and its absence is exactly
the signal the migration needs.

Rejected: **deleting 3.1 Flash-Lite from the lists**, which would make the
whole problem disappear — no orphan ids, migration on every load, nothing able
to name a retired model. It also removes a choice for the sake of the
implementation.

Rejected: **putting the map inline in `AIStrategyService`**. The knowledge that
one model replaced another belongs beside the list that made it true; in the
service it would need `TestBed` and a `localStorage` stub to test, and the next
retirement would be an edit split across two directories.

## Consequences

- Existing installs are corrected on their next launch, with one extra
  `localStorage` write and no user-visible step.
- The next retirement is one map entry and one catalog edit, in one file. The
  schema version only moves when the blob's *shape* changes, not when an id
  does.
- A preference can now hold an id the catalog does not list — 3.1 Pro's, for
  users who chose it — for exactly as long as it takes the migration to run.
- `ai-models.ts` gained its first spec. It was the only file in
  `src/app/core/config/` without one.
- `gemini.service.spec.ts` no longer names a model id where what it means is
  "either side of the Gemma branch", so the next retirement touches one line
  there instead of eight.

## Known gaps

- Nothing detects a retirement. The ids are still checked by a person reading
  the vendors' pages; this ADR makes the correction cheap, not automatic. The
  procedure is written down in [../ai-models.md](../ai-models.md).
- The invariants bind the catalog to the replacement map, not to reality. A
  default that is live, listed and simply wrong for the job passes all three.
- OpenAI and Claude ids go through the same migration path but have no entries
  in the map, and no equivalent check has been made against their vendors'
  lists in this change.
- A blob stamped at the current version is trusted completely. A hand-edited
  or corrupted id that carries a valid stamp is never examined again.
