# 38. A dead guard reads exactly like a live one

**Status:** Accepted, implemented · **Date:** 2026-08-13 · **Issues:** #262, #276

Reference documentation lives in [../analytics.md](../analytics.md) and
[../ui-overflow.md](../ui-overflow.md).

## Context

Two guards documented themselves as enforced while enforcing nothing, and in
both cases every artifact a reader would consult said otherwise.

The analytics import ban died to a flat-config property. ESLint resolves a
rule key to the last matching config object's options, replaced wholesale —
never merged. `eslint.config.js` had two blocks that both matched
`src/app/**/*.ts` and both set `@typescript-eslint/no-restricted-imports`:
the first banned the analytics SDKs (exempting the analytics owners), the
second banned the model SDKs (exempting the three provider services). Both
were correct when written; the later one disabled the earlier as a side
effect of reusing the rule key. The result was not merely a lost ban but an
inverted one: ordinary files and the analytics service itself carried only
the model ban, while the analytics ban survived only on the three provider
files — the one population that would never import an analytics SDK. A
direct `logEvent()` in a component, bypassing the consent gate, the no-op
paths and the parameter allowlist at once, linted clean. Meanwhile
`docs/analytics.md` stated "an ESLint rule enforces that", ADR 0003 recorded
the rule as the closing of exactly this hole, `check-analytics-registry.mjs`
named the rule as the reason it does not look for direct SDK use, and
`docs/prompts.md` leaned the prompt check's coverage claim on the same rule.
Nothing checked the assertion; the config text was unchanged and lint stayed
green.

The truncation check was never run. `scripts/check-truncation.mjs` holds G3
from `docs/ui-overflow.md` — nothing in the app truncates — and its header
says it is "wired into CI so it runs whether or not anybody remembers it".
The commit that introduced it never touched the workflow, so the only
invocations were a manual npm alias and a fenced command in the doc. The
script worked perfectly on every tree nobody ran it against; the next
`text-overflow:` declaration to land would have shipped unchecked, found by
a user with a clipped goal name.

## Decision

**Each ban is declared once, and every population's last block states its
full set.** The two SDK ban lists live in named consts at the top of
`eslint.config.js`. A union block applies both bans to `src/app/**/*.ts`;
a narrower block for the analytics owners restates the model ban in full;
a narrower block for the three provider services restates the analytics ban
in full. The owner blocks match their files instead of being ignored by the
union block, so they resolve last, and — because replacement is wholesale —
they carry everything that still applies, not just their own exemption.

**A CI check asserts the resolved outcome.** `scripts/check-lint-guards.mjs`
(`npm run lint-guards:check`, in CI immediately after lint) resolves the real
config for representative files of each population through ESLint's own API
and verifies the ban set in both directions — a ban missing where it belongs
fails as loudly as a ban present where it must not be. It self-tests its
extraction and diff helpers first, the i18n/prompts convention.

**The truncation check runs in CI**, between the composite-index check and
the unit tests, making the script's own header true.

Rejected: **detecting overlapping-glob rule keys**, the check #262's
acceptance criteria literally describe. The fixed structure is itself three
overlapping blocks setting one key on purpose — the owner blocks override
the union block — so an overlap detector would flag the cure. Asserting
outcomes also catches what overlap detection cannot: a deleted block, a
mistyped glob, a renamed rule key. Rejected: **setting the rule to `"off"`
for the exempt globs** — that drops both families' bans for those files and
widens the hole. Rejected: **per-path exemptions inside one block** — the
rule's options carry no per-file scoping, which is why the population blocks
exist at all. Rejected: **skipping `*.spec.ts` in the truncation walk**
(#276 floated it as defensive) — every `text-overflow` mention under `src/`
today sits in a comment the masker already blanks, and scanning specs is
strictly wider; a spec asserting on the literal string would be the first
legitimate reason to revisit.

## Consequences

- The ban messages live once. A fourth SDK family is one const, entries in
  the union block, an owner block, and a population row in the checker.
- A lint-config change that kills a ban now fails a named CI step instead of
  passing silently. CI grows by roughly three seconds.
- The truncation header's claim is true for the first time, and the next
  `text-overflow:` declaration fails the build naming its file and line.
- `docs/ui-overflow.md`'s enforcement table now states which rows run in CI
  through which command — it previously undercounted even the rows that did.

## Departures from the issues

- #262 asked for a check that fails "when a rule key is set by two config
  objects whose files globs overlap". The shipped check asserts resolved
  outcomes instead, for the reason above. Re-introducing the old collision
  still fails it — through the ordinary population, which is the only
  population the collision actually broke: under the bug the two owner
  populations happened to resolve their intended sets, just from the wrong
  blocks.
- The checker probes one spec file per exempt population rather than every
  spec — representative, not exhaustive, and stated as such in its header.
- #276's spec-skip tweak was considered and rejected rather than shipped.

## Known gaps

- The representative files are pinned by name. A rename fails the check
  loudly with an instruction to update the population table, but the update
  itself is manual.
- A dynamic `import('firebase/analytics')` is invisible to the rule (probed
  and confirmed) and to the registry check. Closing that needs
  `no-restricted-syntax` shapes, out of this change's scope.
- The check proves a ban resolves for a file, not that ESLint would fire on
  a banned import.
- The class of failure — a checker exists and nothing runs it — is fixed for
  one instance. The README's CI enumeration and review are still what guard
  the class.
