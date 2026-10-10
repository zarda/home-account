import { PromptResponseKind, RenderedPrompt } from './prompt-inputs';
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
import { renderTranslateNote, renderTranslateReceiptImage } from './translation.prompts';

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
  /**
   * How the model answers — the same value the render puts on its prompt, held
   * here as a literal so the type system can see it. A render's `expects` is
   * only known once it runs; this one is what `ProsePromptId` is derived from.
   * The registry spec holds the two equal.
   */
  expects: PromptResponseKind;
  render: (input: I) => RenderedPrompt;
}

export const PROMPTS = {
  receiptParse: {
    since: '1.17.93',
    feature: 'receiptScanning',
    expects: 'json',
    render: renderReceiptParse,
  },
  receiptSummary: {
    since: '1.17.93',
    feature: 'receiptScanning',
    expects: 'json',
    render: renderReceiptSummary,
  },
  receiptItems: {
    since: '1.17.93',
    feature: 'receiptScanning',
    expects: 'json',
    render: renderReceiptItems,
  },
  statementTransactions: {
    since: '1.17.93',
    feature: 'receiptScanning',
    expects: 'json',
    render: renderStatementTransactions,
  },
  multiImageReceipts: {
    since: '1.17.93',
    feature: 'receiptScanning',
    expects: 'json',
    render: renderMultiImageReceipts,
  },
  categorizeTransactions: {
    since: '1.17.93',
    feature: 'categorization',
    expects: 'json',
    render: renderCategorizeTransactions,
  },
  categorySuggestion: {
    since: '1.17.93',
    feature: 'categorization',
    expects: 'plainText',
    render: renderCategorySuggestion,
  },
  csvMapping: {
    since: '1.17.93',
    feature: 'categorization',
    expects: 'json',
    render: renderCsvMapping,
  },
  suggestTags: {
    since: '1.26.138',
    feature: 'categorization',
    expects: 'json',
    render: renderSuggestTags,
  },
  spendingSummary: {
    since: '1.17.93',
    feature: 'insights',
    expects: 'markdown',
    render: renderSpendingSummary,
  },
  patternNarrative: {
    since: '1.17.93',
    feature: 'insights',
    expects: 'plainText',
    render: renderPatternNarrative,
  },
  financialAdvice: {
    since: '1.17.93',
    feature: 'insights',
    expects: 'plainText',
    render: renderFinancialAdvice,
  },
  searchQuery: {
    since: '1.17.93',
    feature: 'search',
    expects: 'json',
    render: renderSearchQuery,
  },
  translateNote: {
    since: '26.9.152',
    feature: 'translation',
    expects: 'json',
    render: renderTranslateNote,
  },
  translateReceiptImage: {
    since: '26.9.160',
    feature: 'translation',
    expects: 'json',
    render: renderTranslateReceiptImage,
  },
} as const satisfies Record<string, PromptDefinition>;

export type PromptId = keyof typeof PROMPTS;

/**
 * The prompts answered in prose rather than JSON, read off each entry's
 * `expects`.
 *
 * A provider that cleans up prose answers keys its table by this, so a new
 * prose prompt is a compile error there until it says what happens to its
 * answer — even when that is nothing.
 */
export type ProsePromptId = {
  [K in PromptId]: (typeof PROMPTS)[K]['expects'] extends 'json' ? never : K;
}[PromptId];

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
