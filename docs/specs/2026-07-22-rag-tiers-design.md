# Design: Tiered RAG levels for AI insights

Date: 2026-07-22
Status: implemented

## Problem

The detail-grounded insights feature was a single on/off toggle
(`enableRagInsights`). Grounding depth is a time and token trade-off — more
retrieved detail gives richer analysis but shares more data, costs more prompt
tokens, and generates slower — and a boolean cannot express that. Two currency
defects also degraded the grounding numbers: amounts were converted with live
rates (which silently fall back 1:1 before rates load) instead of the
snapshot-preferring `amountInBase()`, and every amount was rendered with two
decimals even for zero-decimal currencies such as JPY and TWD.

## Decision

Replace the boolean with a four-level preference `ragInsightsLevel`:

| Level | Top expenses | Unusual amounts | Category deltas | Baseline window |
|-------|-------------|-----------------|-----------------|-----------------|
| off | — | — | — | none |
| light | 3 | none (section skipped) | 5 | none |
| standard | 10 | 5 | 5 | 6 months |
| deep | 20 | 10 | 10 | 12 months |

Standard reproduces the previous toggle-on behavior exactly.

Key decisions:

- **Single source of truth in `user.model.ts`** — `RagInsightsLevel`,
  `RAG_TIER_CONFIGS`, and `effectiveRagLevel()` live next to the other
  preference constants so the context service, dashboard, ai-summary component,
  and settings page share one definition with no service-to-service imports.
- **`RagContextService` stays a pure transformer** — it takes an optional
  resolved `RagTierConfig` (default: standard) and never reads preferences.
- **Migration by dual-write** — effective level =
  `ragInsightsLevel ?? (enableRagInsights ? 'standard' : 'off')`; saves write
  both fields so older installed clients that only read the boolean keep
  working. Unknown stored strings fall back to the boolean path.
- **Dashboard baseline via effect** — the trailing-window query moved from
  `loadData()` into a constructor effect tracking the period and the tier's
  window size; off/light skip the Firestore query entirely and a mid-session
  tier change refetches the right span. The ai-summary session cache key
  includes the level, so tier changes regenerate immediately.
- **Reactivity invariant** — the ai-summary effect tracks the level through the
  synchronous `cacheKey()` read that happens before any `await`; the
  `ensureRatesLoaded()` await sits inside `generateInsights` after the cache
  check so this tracking is preserved.
- **Currency correctness rides along** — grounding converts via
  `amountInBase()` (snapshot-preferring), `generateInsights` awaits
  `ensureRatesLoaded()`, and all prompt amounts go through the new
  `CurrencyService.formatAmount()`, which writes zero-decimal currencies
  (`ZERO_DECIMAL_CURRENCIES`: JPY, KRW, TWD, VND, IDR) as whole numbers.
  `formatCurrency()` now uses the same set, so TWD/VND/IDR display without
  decimals throughout the UI as well.
- **Settings UI** — the slide-toggle became a `mat-select` over the four levels
  with a per-level description, matching the page's existing model/provider
  select idiom. New i18n keys exist in en/tc/ja.

Out of scope (deliberately): grounding the financial-advice prompt, and
per-transaction detail lines (notes/tags/merchant) in the grounding block.

## Testing

Test-first throughout: `user.model.spec.ts` (migration + tier table),
`currency.service.spec.ts` (`formatAmount`, zero-decimal `formatCurrency`),
`rag-context.service.spec.ts` (per-tier caps, baseline overlap with the current
period, snapshot preference, zero-decimal output), `ai-summary.component.spec.ts`
(config threading, migration, off-path, rates-await ordering, cache-key tier
sensitivity), `dashboard.component.spec.ts` (per-tier windows, query skipping,
mid-session tier change), `ai-settings-page.component.spec.ts` (load/dual-write/
validation), and provider specs (whole-amount prompts for zero-decimal bases).
