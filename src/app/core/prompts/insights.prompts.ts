import {
  BaseCurrencyInput,
  GroundingInput,
  LanguageInput,
  RenderedPrompt,
} from './prompt-inputs';

/**
 * The blocks the spending summary is assembled from.
 *
 * These are prompt text too, and they were triplicated across the three
 * provider services exactly like the prompts were — same wording, same emoji
 * status markers, three copies. They take pre-formatted amounts for the same
 * reason the prompts do: currency formatting is a service concern.
 */
export interface CategoryBreakdownRow {
  name: string;
  /** Already formatted for the base currency. */
  total: string;
  count: number;
}

export function renderCategoryBreakdown(
  rows: CategoryBreakdownRow[],
  baseCurrency: string
): string {
  return rows
    .map(r => `${r.name}: ${r.total} ${baseCurrency} (${r.count} transactions)`)
    .join('\n');
}

export interface LargestExpenseRow {
  description: string;
  /** Already formatted for the base currency. */
  amount: string;
  categoryName: string;
}

export function renderLargestExpenses(
  rows: LargestExpenseRow[],
  baseCurrency: string
): string {
  return rows
    .map(r => `- ${r.description}: ${r.amount} ${baseCurrency} (${r.categoryName})`)
    .join('\n');
}

export interface PreviousPeriodSectionInputs {
  /** Already formatted for the base currency. */
  previousIncome: string;
  previousExpense: string;
  /** One decimal place, or 'N/A' when the previous period had none. */
  incomeChangePercent: string;
  expenseChangePercent: string;
  baseCurrency: string;
}

export function renderPreviousPeriodSection(i: PreviousPeriodSectionInputs): string {
  return `
Previous period comparison:
- Previous income: ${i.previousIncome} ${i.baseCurrency}
- Previous expenses: ${i.previousExpense} ${i.baseCurrency}
- Income change: ${i.incomeChangePercent}%
- Expense change: ${i.expenseChangePercent}%
`;
}

export interface BudgetStatusRow {
  name: string;
  /** Already formatted for the base currency. */
  spent: string;
  limit: string;
  percentUsed: number;
}

/** Marker the model reads to decide whether a budget needs calling out. */
export function budgetStatusMarker(percentUsed: number): string {
  if (percentUsed >= 100) return '⚠️ EXCEEDED';
  return percentUsed >= 80 ? '⚠️ Near limit' : '✓';
}

export function renderBudgetSection(rows: BudgetStatusRow[], baseCurrency: string): string {
  const lines = rows
    .map(
      r =>
        `- ${r.name}: ${r.spent}/${r.limit} ${baseCurrency} (${r.percentUsed.toFixed(0)}%) ${budgetStatusMarker(r.percentUsed)}`
    )
    .join('\n');
  return `
Active budgets status:
${lines}
`;
}

export interface GoalStatusRow {
  name: string;
  /** Already formatted for the base currency. */
  saved: string;
  target: string;
  percentSaved: number;
}

/**
 * Budgets cap spending, goals accumulate toward it — so no exceeded/near-limit
 * markers here: passing 100% is the point.
 */
export function renderGoalSection(rows: GoalStatusRow[], baseCurrency: string): string {
  if (rows.length === 0) return '';
  const lines = rows
    .map(
      r =>
        `- ${r.name}: ${r.saved}/${r.target} ${baseCurrency} (${r.percentSaved.toFixed(0)}% saved)`
    )
    .join('\n');
  return `
Savings goals status:
${lines}
`;
}

export type SpendingSummaryInputs = BaseCurrencyInput &
  GroundingInput &
  LanguageInput & {
    period: string;
    /** Already formatted for the base currency by `CurrencyService.formatAmount`. */
    totalIncome: string;
    totalExpense: string;
    net: string;
    transactionCount: number;
    categoryBreakdown: string;
    largestExpenses: string;
    /** Pre-built comparison, budget and goal blocks, empty when there is nothing to say. */
    historicalSection: string;
    budgetSection: string;
    goalSection: string;
  };

/**
 * The dashboard's period insights.
 *
 * Canonical text is Gemini's. OpenAI and Claude opened with "Generate a brief,
 * helpful spending summary" and asked only that headings be "in the same
 * language", while Gemini asked for structured insights and demanded every
 * heading start its own line with "## ". The renderer needs those headings, so
 * the stricter instruction is the one that matches what the app does with the
 * answer.
 */
export function renderSpendingSummary(i: SpendingSummaryInputs): RenderedPrompt {
  const grounding = i.grounding?.trim();
  const ragSection = grounding
    ? `\nNotable activity (retrieved from your transactions):\n${grounding}\n`
    : '';
  const groundingInstruction = grounding
    ? 'Ground your insights in the Notable activity section — cite its specific transactions, amounts, and changes where relevant.\n'
    : '';

  return {
    user: `Generate structured AI Insights for ${i.period}.

Financial data (all amounts in ${i.baseCurrency}):
- Total Income: ${i.totalIncome} ${i.baseCurrency}
- Total Expenses: ${i.totalExpense} ${i.baseCurrency}
- Net: ${i.net} ${i.baseCurrency}
- Transaction count: ${i.transactionCount}

Top spending categories:
${i.categoryBreakdown}

Largest individual expenses:
${i.largestExpenses || 'No expenses recorded'}
${i.historicalSection}${i.budgetSection}${i.goalSection}${ragSection}
Return AI Insights in this exact format (use markdown):

## Spending Pattern
[1-2 sentences about main spending categories with specific amounts and percentages]

## Changes & Trends
[1-2 sentences about significant changes from previous period with impact assessment]

## Budget Status
[1-2 sentences about budget limits - warnings if any are near limit, or confirmation if all good. When savings goals are listed, note their pace toward the target here too]

## Actionable Insights
- [Specific, practical insight #1]
- [Specific, practical insight #2]
- [Specific, practical insight #3]

Be detailed, encouraging, and practical. Include specific numbers and examples. Use ${i.baseCurrency} for amounts.
${groundingInstruction}Output ONLY the final insights in the exact format above — no reasoning, no drafts, no commentary.

${i.languageInstruction}
Write the section headings in the same language as the response. Format EVERY section heading — including the first one — as its own line starting with "## ".`,
    expects: 'markdown',
    maxOutputTokens: 2048,
    temperature: 0.3,
    topP: 0.7,
  };
}

export type PatternNarrativeInputs = LanguageInput & {
  /** Pre-computed pattern facts. Numbers and category names only. */
  context: string;
  locale: string;
};

/**
 * Describe an already-detected spending pattern in prose.
 *
 * Canonical text is Gemini's, which is the only variant that included the
 * language instruction — OpenAI and Claude answered in English no matter which
 * locale the app was in.
 */
export function renderPatternNarrative(i: PatternNarrativeInputs): RenderedPrompt {
  return {
    user: `You are describing a person's own spending patterns back to them.

PATTERNS ALREADY DETECTED (all figures pre-computed, do not recalculate):
${i.context}

INSTRUCTION: Write 3-4 sentences describing what these patterns show.
- Describe, never judge. Say what changed, not whether it was wise.
- Use the exact figures above; invent nothing.
- Compare the person only to their own history.
- No preamble, no headings, no bullet list.
${i.languageInstruction}
Locale: ${i.locale}`,
    expects: 'plainText',
    maxOutputTokens: 1024,
    temperature: 0.3,
    topP: 0.7,
  };
}

export type FinancialAdviceInputs = BaseCurrencyInput &
  LanguageInput & {
    period: string;
    /** Already formatted for the base currency. */
    income: string;
    expense: string;
    balance: string;
    /** Drives the two conditional guidance lines. */
    savingsRate: number;
    balanceIsNegative: boolean;
  };

/**
 * Two or three sentences of advice over the period totals.
 *
 * Canonical text is Gemini's: it states the facts as a labelled block, adapts
 * its guidance to the savings rate and balance, and pins the tone. OpenAI's
 * variant listed the same conditions as things to "consider" and Claude's was
 * missing the closing instruction that suppresses preamble entirely.
 */
export function renderFinancialAdvice(i: FinancialAdviceInputs): RenderedPrompt {
  const savingsLine =
    i.savingsRate < 20
      ? '- Address the low savings rate with concrete, actionable steps.'
      : '- Acknowledge positive progress and suggest next steps.';
  const balanceLine = i.balanceIsNegative
    ? '- Prioritize: stop deficit spending and find income.'
    : '- Prioritize: maintain momentum and increase savings.';

  return {
    user: `You are a financial advisor giving brief, specific financial advice.

FACTS:
- Income: ${i.income} ${i.baseCurrency}
- Expenses: ${i.expense} ${i.baseCurrency}
- Balance: ${i.balance} ${i.baseCurrency}
- Period: ${i.period}

INSTRUCTION: Write ONLY 2-3 sentences of financial advice. No introduction, no reasoning, no metadata.

${savingsLine}
${balanceLine}

TONE: Practical, specific, supportive. Use exact numbers from above.
${i.languageInstruction}
OUTPUT: Only the advice sentences themselves — no preamble, no labels, no quotation marks.`,
    expects: 'plainText',
    maxOutputTokens: 1024,
    temperature: 0.2,
    topP: 0.7,
  };
}
