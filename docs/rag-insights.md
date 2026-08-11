# Detail-Grounded AI Insights (RAG)

The dashboard's AI Insights card can ground its spending summary in real, notable
activity from your own transactions — largest expenses, unusual amounts, and
category changes — instead of only aggregate totals. How much detail is shared
with your configured AI provider is controlled by the **Detail level** setting in
**Settings → AI → AI Insights**.

The reasoning behind the tier design is in
[ADR/0001](ADR/0001-tiered-rag-levels.md).

## Levels

More detail produces a richer, more specific analysis, but shares more data with
the AI provider, uses more prompt tokens, and takes slightly longer to generate.

| Level | Grounding sent with the summary prompt | History queried |
|-------|----------------------------------------|-----------------|
| **Off** | Nothing — insights stay generic (aggregate totals only). | None |
| **Light** | Top 3 expenses and the top 5 category changes vs. the previous period. No unusual-amount scan. | None |
| **Standard** | Top 10 expenses, up to 5 unusual amounts, top 5 category changes. | Trailing 6 months |
| **Deep** | Top 20 expenses, up to 10 unusual amounts, top 10 category changes. | Trailing 12 months |

Unusual amounts are detected per category: a current-period expense is flagged
when it exceeds the category's mean by more than two standard deviations, using
a trailing history window (which includes the current period) as the baseline.
Categories need at least four baseline samples before anything is flagged.

At Off and Light the app skips the trailing-window Firestore query entirely, so
those levels are also cheaper on reads and faster to load.

The "Financial Tip" half of the card is intentionally not grounded — only the
spending summary receives transaction details.

The same anomaly / category-delta / top-expense computations (extracted into
`src/app/core/utils/spending-insight.utils.ts`) also power the insight
quick-filter chips above the transaction list. The chips run entirely on
device with no model call, so they are always available and are **not**
affected by the detail-level setting — that setting only controls what is
shared with the AI provider for the dashboard summary.

## The level also gates the spending-pattern narrative

The Insights tab (see [insights.md](insights.md)) has an optional written
description of its detected patterns, and it is gated on this setting as well as
on having a provider configured. Detector output is grounding data — aggregates
derived from the user's transactions — so sending it while the level is **Off**
would contradict what the setting means to the person who chose it. What gets
sent scales with the tier: Light and Standard send totals, trend directions and
shares, and rhythm flags; Deep additionally sends the per-month series.

The rule-based cards themselves are pure local computation, like the quick-filter
chips, so they are unaffected by this setting and always available. Nothing a
person typed is ever included — no descriptions, notes, merchant strings,
transaction ids or individual dates — and the prose is never stored.

## Preference storage and migration

The level is stored in the user profile as `preferences.ragInsightsLevel`
(`'off' | 'light' | 'standard' | 'deep'`). Earlier releases used a boolean
`preferences.enableRagInsights`; it is still written on every save
(`level !== 'off'`) so older installed clients keep working, and it is used as
a fallback when no level is stored (`true` → Standard, otherwise Off). Read the
effective level via `effectiveRagLevel()` in `src/app/models/user.model.ts` —
never read either field directly. Tier contents live in `RAG_TIER_CONFIGS` in
the same file.

## Date formatting

Dates in the grounding block — the "Top expenses" lines are the only ones that
carry a transaction's own day — are **local day keys**, built with `dayKey` from
the same local parts the transaction list displays. So a date the model cites
back in its prose can be checked against the row it came from.

Rendering them with `toISOString` handed the model UTC days instead: the day
before for an evening row west of UTC, the day after for a midnight row east of
it. The prompt asks the model to cite these specifics, so the shifted day was
repeated to the user as advice — sometimes naming a date outside the period the
summary claimed to cover — and cached for an hour (#266). See
[dates.md](dates.md).

## Amount formatting

All amounts placed in AI prompts (grounding block, totals, budgets) are
formatted with `CurrencyService.formatAmount()`: plain digits with two decimals,
except currencies written without sub-units (JPY, KRW, VND and the rest — the
digit count comes from `currencyDecimalPlaces()` in
`src/app/models/currency.model.ts`, which reads Intl's own currency data rather
than a maintained list), which are written as whole numbers ("1500 JPY", never "1500.00 JPY"). Grounding amounts
convert through `CurrencyService.amountInBase()`, preferring each transaction's
write-time exchange-rate snapshot so the numbers match the rest of the app and
stay correct even before live rates finish loading.
