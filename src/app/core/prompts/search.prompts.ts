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
  // Both catalogs are omitted entirely when the account has none, rather
  // than sent as an empty heading the model might try to satisfy.
  const goalCatalog = context.goals.length
    ? `\nValid goalId values (id: name) — money put toward a savings goal or project:\n${
      context.goals.map(g => `${g.id}: ${g.name}`).join('\n')}\n`
    : '';
  const budgetCatalog = context.budgets.length
    ? `\nValid budgetId values (id: name) — spending limits on a category:\n${
      context.budgets.map(b => `${b.id}: ${b.name}`).join('\n')}\n`
    : '';

  return {
    user: `You convert a user's natural-language question about their personal finance transactions into a JSON command. Today is ${context.today}. The base currency is ${context.baseCurrency}. The question may be in English, Japanese, or Traditional Chinese.

Valid categoryId values (id: name):
${catalog}
${goalCatalog}${budgetCatalog}
Decide the kind:
- "filter" when the user wants to FIND or LIST transactions.
- "aggregate" when the user asks for a computed value: total spent -> "sum", how many -> "count", average -> "average", biggest/most expensive -> "max", smallest/cheapest -> "min", top/biggest categories -> "topCategories".

Rules:
- Resolve relative ranges ("last month", "this year") against today; dates are YYYY-MM-DD.
- Only use categoryId values from the list above. If no listed category clearly matches, omit categoryId and put the term in searchQuery instead.
- Use goalId when the question names a goal above ("how much toward the Japan trip"). Same rule as categoryId: only listed ids, otherwise omit it.
- Use budgetId when the question names a budget above ("against my groceries budget"). Only listed ids. Omit dates when asking about a budget's current period — its window is filled in for you.
- "type" is "expense" or "income". Amounts are plain numbers. Omit every field the question does not imply. Never invent amounts or dates.
- "limit" (topCategories only) is how many categories to return.

Return ONLY one JSON object, no other text, in one of these shapes:
{"kind":"filter","filters":{"type":"expense","categoryId":"food","startDate":"2026-06-01","endDate":"2026-06-30","minAmount":50,"maxAmount":200,"currency":"USD","searchQuery":"starbucks","goalId":"g1"}}
{"kind":"aggregate","operation":"sum","filters":{"budgetId":"b1"},"limit":3}

The question: "${query}"`,
    expects: 'json',
    maxOutputTokens: 400,
    temperature: 0.05,
    topP: 0.5,
  };
}
