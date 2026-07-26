# Detail-Grounded AI Insights (RAG)

The dashboard's AI Insights card can ground its spending summary in real, notable
activity from your own transactions — largest expenses, unusual amounts, and
category changes — instead of only aggregate totals. How much detail is shared
with your configured AI provider is controlled by the **Detail level** setting in
**Settings → AI → AI Insights**.

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

## Preference storage and migration

The level is stored in the user profile as `preferences.ragInsightsLevel`
(`'off' | 'light' | 'standard' | 'deep'`). Earlier releases used a boolean
`preferences.enableRagInsights`; it is still written on every save
(`level !== 'off'`) so older installed clients keep working, and it is used as
a fallback when no level is stored (`true` → Standard, otherwise Off). Read the
effective level via `effectiveRagLevel()` in `src/app/models/user.model.ts` —
never read either field directly. Tier contents live in `RAG_TIER_CONFIGS` in
the same file.

## Amount formatting

All amounts placed in AI prompts (grounding block, totals, budgets) are
formatted with `CurrencyService.formatAmount()`: plain digits with two decimals,
except zero-decimal currencies (JPY, KRW, TWD, VND, IDR — see
`ZERO_DECIMAL_CURRENCIES` in `src/app/models/currency.model.ts`), which are
written as whole numbers ("1500 JPY", never "1500.00 JPY"). Grounding amounts
convert through `CurrencyService.amountInBase()`, preferring each transaction's
write-time exchange-rate snapshot so the numbers match the rest of the app and
stay correct even before live rates finish loading.
