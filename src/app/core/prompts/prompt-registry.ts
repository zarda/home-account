import { RenderedPrompt } from './prompt-inputs';
import {
  renderCategorizeTransactions,
  renderCategorySuggestion,
  renderCsvMapping,
  renderSuggestTags,
} from './categorization.prompts';
import {
  renderFinancialAdvice,
  renderPatternNarrative,
  renderSpendingSummary,
} from './insights.prompts';
import {
  renderMultiImageReceipts,
  renderReceiptItems,
  renderReceiptParse,
  renderReceiptSummary,
  renderStatementTransactions,
} from './receipt.prompts';
import { renderSearchQuery } from './search.prompts';
import { renderTranslateNote } from './translation.prompts';

/**
 * Every prompt the app sends to a model, in one place.
 *
 * Before this existed each of the three provider services carried its own copy
 * of every prompt, and nothing checked that the copies agreed. They had already
 * drifted in six places — most consequentially, only Gemini's receipt prompt
 * asked for `receiptCount` (which the transaction form reads to offer the
 * multi-receipt review) and only Gemini's narrative prompt carried the language
 * instruction (so the other two answered in English whatever the app's locale).
 *
 * `docs/prompts.md` lists what each prompt is for and which providers send it;
 * `scripts/check-prompts.mjs` fails the build when the two disagree, when a
 * prompt is registered but unsent, or when a provider service grows a new inline
 * prompt literal instead of registering one.
 *
 * Why TypeScript and not JSON, when `analytics-events.json` deliberately went
 * the other way: that file is JSON because its consistency check has to read the
 * taxonomy's *values* — parameter names, allowed values — and compare them to a
 * markdown table, which needs `JSON.parse` from Node. This check only needs
 * prompt *ids* and call sites, which a regex finds in `.ts` just as well. And a
 * prompt in JSON is a `\n`-escaped single line whose diff is unreadable, which
 * would defeat the point: prompt wording is the thing reviewers most need to see
 * change.
 */
export interface PromptDefinition<I = never> {
  /** Version this prompt id first shipped in. Mirrored in docs/prompts.md. */
  since: string;
  /** Which capability the prompt belongs to, matching AIFeatureType. */
  feature: 'receiptScanning' | 'categorization' | 'insights' | 'search' | 'translation';
  render: (input: I) => RenderedPrompt;
}

export const PROMPTS = {
  receiptParse: {
    since: '1.17.93',
    feature: 'receiptScanning',
    render: renderReceiptParse,
  },
  receiptSummary: {
    since: '1.17.93',
    feature: 'receiptScanning',
    render: renderReceiptSummary,
  },
  receiptItems: {
    since: '1.17.93',
    feature: 'receiptScanning',
    render: renderReceiptItems,
  },
  statementTransactions: {
    since: '1.17.93',
    feature: 'receiptScanning',
    render: renderStatementTransactions,
  },
  multiImageReceipts: {
    since: '1.17.93',
    feature: 'receiptScanning',
    render: renderMultiImageReceipts,
  },
  categorizeTransactions: {
    since: '1.17.93',
    feature: 'categorization',
    render: renderCategorizeTransactions,
  },
  categorySuggestion: {
    since: '1.17.93',
    feature: 'categorization',
    render: renderCategorySuggestion,
  },
  csvMapping: {
    since: '1.17.93',
    feature: 'categorization',
    render: renderCsvMapping,
  },
  suggestTags: {
    since: '1.26.138',
    feature: 'categorization',
    render: renderSuggestTags,
  },
  spendingSummary: {
    since: '1.17.93',
    feature: 'insights',
    render: renderSpendingSummary,
  },
  patternNarrative: {
    since: '1.17.93',
    feature: 'insights',
    render: renderPatternNarrative,
  },
  financialAdvice: {
    since: '1.17.93',
    feature: 'insights',
    render: renderFinancialAdvice,
  },
  searchQuery: {
    since: '1.17.93',
    feature: 'search',
    render: renderSearchQuery,
  },
  translateNote: {
    since: '26.9.152',
    feature: 'translation',
    render: renderTranslateNote,
  },
} as const;

export type PromptId = keyof typeof PROMPTS;

/**
 * The input a prompt requires, read off its own render function.
 *
 * Deriving rather than declaring is what makes the contract impossible to get
 * out of step: adding a field to `SpendingSummaryInputs` immediately makes every
 * call site that does not pass it a compile error.
 */
export type PromptInput<K extends PromptId> = Parameters<(typeof PROMPTS)[K]['render']>[0];

export const PROMPT_IDS = Object.keys(PROMPTS) as PromptId[];

/**
 * Render a prompt by id.
 *
 * `K` narrows to the literal id at the call site, so the input is checked
 * against that one prompt rather than a union of all of them. The rest tuple is
 * what lets a prompt that needs no input be called as `renderPrompt('receiptParse')`
 * while one that does still cannot be called without it.
 */
export function renderPrompt<K extends PromptId>(
  id: K,
  ...args: Parameters<(typeof PROMPTS)[K]['render']>
): RenderedPrompt {
  const render = PROMPTS[id].render as (...a: typeof args) => RenderedPrompt;
  return render(...args);
}

/**
 * Prepended by the Gemini adapter for `expects: 'json'`.
 *
 * Only Gemini needs it — its models otherwise narrate their reasoning before the
 * JSON and the parse fails. It used to be hand-written into the top of each
 * Gemini prompt, which is one of the reasons those prompts diverged from their
 * OpenAI and Claude twins.
 */
export const JSON_ONLY_PREAMBLE =
  'Do NOT include any thinking, reasoning, or analysis in your response. Output ONLY valid JSON.';
