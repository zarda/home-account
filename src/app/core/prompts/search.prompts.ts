import { SearchQueryContext } from '../../models';
import { RenderedPrompt } from './prompt-inputs';

export interface SearchQueryInputs {
  query: string;
  context: SearchQueryContext;
}

/**
 * Turn a natural-language question about the user's transactions into a
 * structured command.
 *
 * The model only ever returns a scope and an operation; it is never asked for
 * (and must never produce) a numeric answer — every figure the user sees is
 * computed locally from real transaction data.
 *
 * This one was already provider-agnostic before the registry existed, as
 * `buildSearchPrompt` in `nl-search.utils.ts`. The response parser
 * (`parseSearchIntent`) stays there: it validates a model answer, which is the
 * opposite direction of travel.
 */
export function renderSearchQuery({ query, context }: SearchQueryInputs): RenderedPrompt {
  const catalog = context.categories.map(c => `${c.id}: ${c.name}`).join('\n');

  return {
    user: `You convert a user's natural-language question about their personal finance transactions into a JSON command. Today is ${context.today}. The base currency is ${context.baseCurrency}. The question may be in English, Japanese, or Traditional Chinese.

Valid categoryId values (id: name):
${catalog}

Decide the kind:
- "filter" when the user wants to FIND or LIST transactions.
- "aggregate" when the user asks for a computed value: total spent -> "sum", how many -> "count", average -> "average", biggest/most expensive -> "max", smallest/cheapest -> "min", top/biggest categories -> "topCategories".

Rules:
- Resolve relative ranges ("last month", "this year") against today; dates are YYYY-MM-DD.
- Only use categoryId values from the list above. If no listed category clearly matches, omit categoryId and put the term in searchQuery instead.
- "type" is "expense" or "income". Amounts are plain numbers. Omit every field the question does not imply. Never invent amounts or dates.
- "limit" (topCategories only) is how many categories to return.

Return ONLY one JSON object, no other text, in one of these shapes:
{"kind":"filter","filters":{"type":"expense","categoryId":"food","startDate":"2026-06-01","endDate":"2026-06-30","minAmount":50,"maxAmount":200,"currency":"USD","searchQuery":"starbucks"}}
{"kind":"aggregate","operation":"sum","filters":{"categoryId":"food","startDate":"2026-06-01","endDate":"2026-06-30"},"limit":3}

The question: "${query}"`,
    expects: 'json',
    maxOutputTokens: 400,
    temperature: 0.05,
    topP: 0.5,
  };
}
