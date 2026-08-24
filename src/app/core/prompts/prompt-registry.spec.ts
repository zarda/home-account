import {
  JSON_ONLY_PREAMBLE,
  PROMPTS,
  PROMPT_IDS,
  PromptId,
  renderPrompt,
} from './prompt-registry';
import { languageInstruction, optionalSection } from './prompt-inputs';
import {
  budgetStatusMarker,
  renderBudgetSection,
  renderCategoryBreakdown,
  renderGoalSection,
  renderLargestExpenses,
  renderPreviousPeriodSection,
} from './insights.prompts';
import { SearchQueryContext } from '../../models';

/**
 * A run of three or more bare two-letter codes, joined by a comma, a slash, a
 * pipe or the word "or" — the same separator set check-prompts.mjs uses for
 * its currency-code tripwire. check-prompts.mjs cannot see country codes at
 * all, so this is the only guard against a prompt listing them by hand.
 */
const COUNTRY_CODE_RUN = /\b[A-Z]{2}\b(?:\s*(?:,|\/|\||\bor\b)\s*\b[A-Z]{2}\b){2,}/;

/**
 * One rendering per prompt id, so every registered prompt is exercised and the
 * consistency check can require that this file names each of them.
 *
 * The assertions that used to live in the three provider specs live here
 * instead: prompt wording is now a property of the registry, and asserting it
 * once beats asserting it three times and still missing the drift.
 */
const SAMPLE_INPUT: { [K in PromptId]: Parameters<(typeof PROMPTS)[K]['render']>[0] } = {
  receiptParse: undefined,
  receiptSummary: undefined,
  receiptItems: undefined,
  statementTransactions: undefined,
  multiImageReceipts: { imageCount: 3 },
  categorizeTransactions: {
    categoryCatalog: 'food: Food\nfood_groceries: Food / Groceries',
    rows: [{ index: 0, description: 'STARBUCKS', amount: 4.5 }],
  },
  categorySuggestion: {
    description: 'STARBUCKS',
    categoryCatalog: 'food: Food',
  },
  csvMapping: {
    headers: ['Date', 'Description', 'Amount'],
    sampleRows: [['2026-01-01', 'COFFEE', '4.50']],
  },
  suggestTags: {
    vocabulary: '- coffee\n- work',
    rows: [{ index: 0, description: 'STARBUCKS' }],
  },
  spendingSummary: {
    period: 'July 2026',
    baseCurrency: 'JPY',
    totalIncome: '300,000',
    totalExpense: '210,000',
    net: '90,000',
    transactionCount: 42,
    categoryBreakdown: 'Food: 60,000 JPY (12 transactions)',
    largestExpenses: '- Rent: 90,000 JPY (Housing)',
    historicalSection: '',
    budgetSection: '',
    goalSection: '',
    languageInstruction: languageInstruction('ja'),
  },
  patternNarrative: {
    context: 'Groceries rose 12% against the previous three months.',
    locale: 'en',
    languageInstruction: languageInstruction('en'),
  },
  financialAdvice: {
    period: 'July 2026',
    baseCurrency: 'USD',
    income: '5,000.00',
    expense: '4,600.00',
    balance: '400.00',
    savingsRate: 8,
    balanceIsNegative: false,
    languageInstruction: languageInstruction('en'),
  },
  searchQuery: {
    query: 'coffee last month',
    context: {
      today: '2026-07-24',
      baseCurrency: 'USD',
      categories: [
        { id: 'food', name: 'Food & Drinks', type: 'expense' },
        { id: 'food_groceries', name: 'Food & Drinks / Groceries', type: 'expense' },
        { id: 'employment', name: 'Employment', type: 'income' },
      ],
      goals: [{ id: 'g1', name: 'Japan trip' }],
      budgets: [{
        id: 'b1',
        name: 'Groceries',
        categoryId: 'food_groceries',
        period: 'monthly',
        anchor: '2026-01-10',
      }],
    } satisfies SearchQueryContext,
  },
};

function render(id: PromptId): string {
  const input = SAMPLE_INPUT[id];
  return (input === undefined
    ? renderPrompt(id as 'receiptParse')
    : renderPrompt(id as 'multiImageReceipts', input as { imageCount: number })
  ).user;
}

describe('prompt registry', () => {
  it('registers every prompt with a version and a feature', () => {
    expect(PROMPT_IDS.length).toBeGreaterThan(0);
    for (const id of PROMPT_IDS) {
      expect(PROMPTS[id].since).toMatch(/^\d+\.\d+\.\d+$/);
      expect(PROMPTS[id].feature).toMatch(/^(receiptScanning|categorization|insights|search)$/);
    }
  });

  it('renders every prompt into a non-empty user turn with sane generation settings', () => {
    for (const id of PROMPT_IDS) {
      const input = SAMPLE_INPUT[id];
      const rendered =
        input === undefined
          ? renderPrompt(id as 'receiptParse')
          : renderPrompt(id as 'multiImageReceipts', input as { imageCount: number });

      expect(rendered.user.trim().length)
        .withContext(`${id} rendered an empty prompt`)
        .toBeGreaterThan(0);
      expect(rendered.expects).toMatch(/^(json|markdown|plainText)$/);
      expect(rendered.maxOutputTokens).toBeGreaterThan(0);
      expect(rendered.temperature).toBeGreaterThanOrEqual(0);
      expect(rendered.temperature).toBeLessThanOrEqual(1);
    }
  });

  it('never bakes the Gemini JSON preamble into a prompt', () => {
    // It belongs to the Gemini adapter. A prompt carrying it would send the
    // warning to OpenAI and Claude too, which is how the copies diverged before.
    for (const id of PROMPT_IDS) {
      expect(render(id))
        .withContext(`${id} inlines the JSON-only preamble`)
        .not.toContain(JSON_ONLY_PREAMBLE);
    }
  });

  it('never lists a run of country codes, in any prompt', () => {
    // Covers all thirteen registered prompts, the five receipt ones
    // included — their own describe blocks below assert the country field
    // exists, not this tripwire, so this loop is the only place a
    // categorization, search or insights prompt growing the same mistake
    // would be caught.
    for (const id of PROMPT_IDS) {
      expect(render(id))
        .withContext(`${id} lists a run of two-letter codes`)
        .not.toMatch(COUNTRY_CODE_RUN);
    }
  });

  describe('receiptParse', () => {
    it('asks for receiptCount, which drives the multi-receipt review flow', () => {
      // Only Gemini's copy asked for this before the registry, so the flow
      // could never trigger on OpenAI or Claude.
      const prompt = render('receiptParse');
      expect(prompt).toContain('"receiptCount"');
      expect(prompt).toContain('set receiptCount to how many receipts are visible');
    });

    it('asks for the total paid and the full receipt body', () => {
      const prompt = render('receiptParse');
      expect(prompt).toContain('"amount" is the TOTAL amount paid');
      expect(prompt).toContain('"receiptDetails"');
    });

    it('asks for the printed location, as printed and never translated', () => {
      // A merchant name is not a place, and a translated address is not the
      // string the receipt printed — the row is searched by what it says.
      const prompt = render('receiptParse');
      expect(prompt).toContain('"location"');
      expect(prompt).toContain('never translated');
      expect(prompt).toContain('inferred from the merchant name');
    });

    it('asks for the issuing country as a code, never a default', () => {
      // The country is concluded from what the receipt prints, reported as a
      // code the reader checks against the runtime's region table — so the
      // prompt names no country, the same rule CURRENCY_FIELD follows.
      const prompt = render('receiptParse');
      expect(prompt).toContain('"country"');
      expect(prompt).toContain('ISO 3166-1 alpha-2');
      expect(prompt).toContain('never a default');
    });
  });

  describe('categorizeTransactions', () => {
    it('embeds the catalog and one line per row', () => {
      const prompt = render('categorizeTransactions');
      expect(prompt).toContain('food_groceries: Food / Groceries');
      expect(prompt).toContain('0: "STARBUCKS" (4.5)');
    });

    it('asks for index, categoryId and confidence as JSON', () => {
      const prompt = render('categorizeTransactions');
      expect(prompt).toContain('"index", "categoryId" and "confidence"');
      expect(prompt).toContain('Return ONLY a valid JSON array');
    });

    it('renders identically with grounding absent or empty', () => {
      // Grounding is opt-in. With it off the prompt must be exactly what it was
      // before the grounding feature existed.
      const base = renderPrompt('categorizeTransactions', {
        categoryCatalog: 'food: Food',
        rows: [{ index: 0, description: 'X', amount: 1 }],
      }).user;
      const withEmpty = renderPrompt('categorizeTransactions', {
        categoryCatalog: 'food: Food',
        rows: [{ index: 0, description: 'X', amount: 1 }],
        grounding: '   ',
      }).user;
      expect(withEmpty).toBe(base);
      expect(base).toContain('food: Food\n\nTransactions:');
    });

    it('inserts grounding between the catalog and the rows when present', () => {
      const prompt = renderPrompt('categorizeTransactions', {
        categoryCatalog: 'food: Food',
        rows: [{ index: 0, description: 'X', amount: 1 }],
        grounding: 'This user files STARBUCKS under food_coffee.',
      }).user;
      expect(prompt).toContain('This user files STARBUCKS under food_coffee.');
      expect(prompt.indexOf('food: Food')).toBeLessThan(
        prompt.indexOf('This user files')
      );
      expect(prompt.indexOf('This user files')).toBeLessThan(prompt.indexOf('Transactions:'));
    });
  });

  describe('suggestTags', () => {
    const oneRow = { index: 0, description: 'X' };

    it('embeds the account\'s own vocabulary and one line per row', () => {
      const prompt = render('suggestTags');
      expect(prompt).toContain('- coffee\n- work');
      expect(prompt).toContain('0: "STARBUCKS"');
    });

    it('names the merchant and the details when the row carries them', () => {
      const prompt = renderPrompt('suggestTags', {
        vocabulary: '- coffee',
        rows: [
          { index: 0, description: 'SQ *BLUE BOTTLE', merchant: 'Blue Bottle', details: '2x latte' },
          // A merchant that only repeats the description is not worth a
          // second copy of the same words.
          { index: 1, description: 'CINEMA', merchant: 'CINEMA' },
        ],
      }).user;

      expect(prompt).toContain('0: "SQ *BLUE BOTTLE" (Blue Bottle) — 2x latte');
      expect(prompt).toContain('1: "CINEMA"');
      expect(prompt).not.toContain('"CINEMA" (CINEMA)');
    });

    it('asks for index and tags as JSON', () => {
      const prompt = render('suggestTags');
      expect(prompt).toContain('"index" and "tags"');
      expect(prompt).toContain('Return ONLY a valid JSON array');
    });

    it('confines the answer to the tags the account already uses', () => {
      // The whole feature: no taxonomy of the prompt's own, and no tag the
      // user has never typed.
      const prompt = render('suggestTags');
      expect(prompt).toContain('only from the list');
      expect(prompt).toContain('Never invent');
    });

    it('renders identically with grounding absent or empty', () => {
      const base = renderPrompt('suggestTags', {
        vocabulary: '- coffee',
        rows: [oneRow],
      }).user;
      const withEmpty = renderPrompt('suggestTags', {
        vocabulary: '- coffee',
        rows: [oneRow],
        grounding: '   ',
      }).user;

      expect(withEmpty).toBe(base);
      expect(base).toContain('- coffee\n\nTransactions:');
    });

    it('inserts grounding between the vocabulary and the rows when present', () => {
      const prompt = renderPrompt('suggestTags', {
        vocabulary: '- coffee',
        rows: [oneRow],
        grounding: 'How this user usually tags these merchants:\n- STARBUCKS → coffee',
      }).user;

      expect(prompt).toContain('- STARBUCKS → coffee');
      expect(prompt.indexOf('- coffee\n')).toBeLessThan(prompt.indexOf('How this user usually tags'));
      expect(prompt.indexOf('How this user usually tags')).toBeLessThan(prompt.indexOf('Transactions:'));
    });
  });

  describe('spendingSummary', () => {
    it('demands every heading start its own line with "## "', () => {
      // The markdown renderer depends on it. OpenAI and Claude were only asked
      // to write headings "in the same language", which is not the same promise.
      const prompt = render('spendingSummary');
      expect(prompt).toContain('Format EVERY section heading — including the first one — as its own line starting with "## ".');
      expect(prompt).toContain('## Spending Pattern');
      expect(prompt).toContain('## Actionable Insights');
    });

    it('carries the amounts already formatted for the base currency', () => {
      const prompt = render('spendingSummary');
      expect(prompt).toContain('- Total Income: 300,000 JPY');
      expect(prompt).toContain('- Transaction count: 42');
    });

    it('omits the grounding section and its instruction when RAG is off', () => {
      const prompt = render('spendingSummary');
      expect(prompt).not.toContain('Notable activity');
      expect(prompt).not.toContain('Ground your insights');
    });

    it('adds the grounding section and its instruction when RAG is on', () => {
      const prompt = renderPrompt('spendingSummary', {
        ...SAMPLE_INPUT.spendingSummary,
        grounding: 'Unusual: 12,000 JPY at a new merchant.',
      }).user;
      expect(prompt).toContain('Notable activity (retrieved from your transactions):');
      expect(prompt).toContain('Unusual: 12,000 JPY at a new merchant.');
      expect(prompt).toContain('Ground your insights in the Notable activity section');
    });
  });

  describe('patternNarrative', () => {
    it('carries the language instruction', () => {
      // Gemini's copy had it and the other two did not, so OpenAI and Claude
      // answered in English regardless of the app's locale.
      const prompt = renderPrompt('patternNarrative', {
        context: 'x',
        locale: 'ja',
        languageInstruction: languageInstruction('ja'),
      }).user;
      expect(prompt).toContain('Respond in Japanese (日本語).');
      expect(prompt).toContain('Locale: ja');
    });

    it('forbids recalculating the pre-computed figures', () => {
      const prompt = render('patternNarrative');
      expect(prompt).toContain('do not recalculate');
      expect(prompt).toContain('invent nothing');
    });
  });

  describe('financialAdvice', () => {
    it('switches guidance on a low savings rate', () => {
      const prompt = renderPrompt('financialAdvice', {
        ...SAMPLE_INPUT.financialAdvice,
        savingsRate: 8,
      }).user;
      expect(prompt).toContain('Address the low savings rate');
      expect(prompt).not.toContain('Acknowledge positive progress');
    });

    it('switches guidance on a healthy savings rate', () => {
      const prompt = renderPrompt('financialAdvice', {
        ...SAMPLE_INPUT.financialAdvice,
        savingsRate: 35,
      }).user;
      expect(prompt).toContain('Acknowledge positive progress');
      expect(prompt).not.toContain('Address the low savings rate');
    });

    it('switches priority on a negative balance', () => {
      const prompt = renderPrompt('financialAdvice', {
        ...SAMPLE_INPUT.financialAdvice,
        balanceIsNegative: true,
      }).user;
      expect(prompt).toContain('stop deficit spending');
    });

    it('suppresses preamble in the output', () => {
      expect(render('financialAdvice')).toContain(
        'OUTPUT: Only the advice sentences themselves'
      );
    });
  });

  describe('searchQuery', () => {
    it('embeds today, the base currency, the catalog and the query', () => {
      const prompt = render('searchQuery');
      expect(prompt).toContain('Today is 2026-07-24');
      expect(prompt).toContain('base currency is USD');
      expect(prompt).toContain('food_groceries: Food & Drinks / Groceries');
      expect(prompt).toContain('"coffee last month"');
    });

    it('instructs the model to only return JSON with the two shapes', () => {
      const prompt = render('searchQuery');
      expect(prompt).toContain('"kind":"filter"');
      expect(prompt).toContain('"kind":"aggregate"');
      expect(prompt).toContain('Return ONLY one JSON object');
    });

    it('never asks the model for a computed figure', () => {
      // Every number the user sees is computed locally; the model only returns
      // a scope and an operation.
      expect(render('searchQuery')).toContain('Never invent amounts or dates');
    });

    it('lists the goal and budget catalogs the query may name', () => {
      const prompt = render('searchQuery');
      expect(prompt).toContain('g1: Japan trip');
      expect(prompt).toContain('b1: Groceries');
      expect(prompt).toContain('Use goalId when the question names a goal');
      expect(prompt).toContain('Use budgetId when the question names a budget');
    });

    it('omits a catalog heading the account cannot fill', () => {
      // An empty heading is an invitation to invent an id.
      const prompt = renderPrompt('searchQuery', {
        query: 'coffee',
        context: {
          today: '2026-07-24',
          baseCurrency: 'USD',
          categories: [{ id: 'food', name: 'Food', type: 'expense' }],
          goals: [],
          budgets: [],
        },
      }).user;

      expect(prompt).not.toContain('Valid goalId values');
      expect(prompt).not.toContain('Valid budgetId values');
    });
  });

  describe('csvMapping', () => {
    it('describes what each column means rather than just naming them', () => {
      const prompt = render('csvMapping');
      expect(prompt).toContain('- dateColumn: column name containing transaction dates');
      expect(prompt).toContain('- debitColumn: column name for debit/expense amounts (or null)');
      expect(prompt).toContain('"Date"');
    });

    it('samples at most three rows', () => {
      const prompt = renderPrompt('csvMapping', {
        headers: ['a'],
        sampleRows: [['1'], ['2'], ['3'], ['4']],
      }).user;
      expect(prompt).toContain('[["1"],["2"],["3"]]');
      expect(prompt).not.toContain('"4"');
    });
  });

  describe('multiImageReceipts', () => {
    it('states the photo count and explains the overlap', () => {
      const prompt = render('multiImageReceipts');
      expect(prompt).toContain('You are analyzing 3 photos');
      expect(prompt).toContain('BOTTOM portion of Image N likely overlaps');
    });

    it('asks for the fields the consolidation pass reads back', () => {
      const prompt = render('multiImageReceipts');
      for (const field of ['receiptId', 'imageIndex', 'positionInImage', 'confidence', 'wasMerged', 'mergedFromImages']) {
        expect(prompt).withContext(`missing ${field}`).toContain(`- ${field}`);
      }
    });

    it('asks for the printed grand total once per receipt group', () => {
      const prompt = render('multiImageReceipts');
      expect(prompt).toContain('"receiptTotal"');
      expect(prompt).toContain('do NOT compute it by summing items');
      expect(prompt).toContain('do NOT use the cash tendered or change lines');
    });

    it('asks for the printed location, as printed and never translated', () => {
      const prompt = render('multiImageReceipts');
      expect(prompt).toContain('"location"');
      expect(prompt).toContain('never translated');
      expect(prompt).toContain('inferred from the merchant name');
    });

    it('asks for the issuing country as a code, never a default', () => {
      // The country is concluded from what the receipt prints, reported as a
      // code the reader checks against the runtime's region table — so the
      // prompt names no country, the same rule CURRENCY_FIELD follows.
      const prompt = render('multiImageReceipts');
      expect(prompt).toContain('"country"');
      expect(prompt).toContain('ISO 3166-1 alpha-2');
      expect(prompt).toContain('never a default');
    });
  });

  describe('statementTransactions', () => {
    it('asks for an array with one entry per transaction', () => {
      const prompt = render('statementTransactions');
      expect(prompt).toContain('extract ALL transactions');
      expect(prompt).toContain('Return ONLY a valid JSON array');
      expect(prompt).toContain('return an empty array: []');
    });

    it('asks for the printed location, as printed and never translated', () => {
      const prompt = render('statementTransactions');
      expect(prompt).toContain('"location"');
      expect(prompt).toContain('never translated');
      expect(prompt).toContain('inferred from the merchant name');
    });

    it('asks for the issuing country as a code, never a default', () => {
      // The country is concluded from what the receipt prints, reported as a
      // code the reader checks against the runtime's region table — so the
      // prompt names no country, the same rule CURRENCY_FIELD follows.
      const prompt = render('statementTransactions');
      expect(prompt).toContain('"country"');
      expect(prompt).toContain('ISO 3166-1 alpha-2');
      expect(prompt).toContain('never a default');
    });
  });

  describe('receiptSummary', () => {
    it('asks for one object, not an array, with the full receipt body', () => {
      const prompt = render('receiptSummary');
      expect(prompt).toContain('Return ONLY a JSON object (not an array)');
      expect(prompt).toContain('Capture EVERYTHING on the receipt.');
    });

    it('asks for the printed location, as printed and never translated', () => {
      const prompt = render('receiptSummary');
      expect(prompt).toContain('"location"');
      expect(prompt).toContain('never translated');
      expect(prompt).toContain('inferred from the merchant name');
    });

    it('asks for the issuing country as a code, never a default', () => {
      // The country is concluded from what the receipt prints, reported as a
      // code the reader checks against the runtime's region table — so the
      // prompt names no country, the same rule CURRENCY_FIELD follows.
      const prompt = render('receiptSummary');
      expect(prompt).toContain('"country"');
      expect(prompt).toContain('ISO 3166-1 alpha-2');
      expect(prompt).toContain('never a default');
    });
  });

  describe('receiptItems', () => {
    it('asks for one row per item and excludes the totals', () => {
      const prompt = render('receiptItems');
      expect(prompt).toContain('Return each item as a SEPARATE JSON object');
      expect(prompt).toContain('Do NOT include total, subtotal, tax, or service charge as items.');
    });

    it('asks for the position metadata the overlap pass reads', () => {
      expect(render('receiptItems')).toContain('- positionInImage: "top", "middle", "bottom"');
    });

    it('asks for the printed grand total once per receipt group', () => {
      const prompt = render('receiptItems');
      expect(prompt).toContain('"receiptTotal"');
      expect(prompt).toContain('do NOT compute it by summing items');
      expect(prompt).toContain('do NOT use the cash tendered or change lines');
    });

    it('asks for the printed location, as printed and never translated', () => {
      const prompt = render('receiptItems');
      expect(prompt).toContain('"location"');
      expect(prompt).toContain('never translated');
      expect(prompt).toContain('inferred from the merchant name');
    });

    it('asks for the issuing country as a code, never a default', () => {
      // The country is concluded from what the receipt prints, reported as a
      // code the reader checks against the runtime's region table — so the
      // prompt names no country, the same rule CURRENCY_FIELD follows.
      const prompt = render('receiptItems');
      expect(prompt).toContain('"country"');
      expect(prompt).toContain('ISO 3166-1 alpha-2');
      expect(prompt).toContain('never a default');
    });
  });

  describe('categorySuggestion', () => {
    it('embeds the description and the catalog, and asks for a bare id', () => {
      const prompt = render('categorySuggestion');
      expect(prompt).toContain('"STARBUCKS"');
      expect(prompt).toContain('food: Food');
      expect(prompt).toContain('Just the ID, nothing else.');
    });
  });

  describe('spending summary sections', () => {
    it('renders the category breakdown one line per category', () => {
      expect(
        renderCategoryBreakdown(
          [
            { name: 'Food', total: '60,000', count: 12 },
            { name: 'Transport', total: '8,000', count: 3 },
          ],
          'JPY'
        )
      ).toBe('Food: 60,000 JPY (12 transactions)\nTransport: 8,000 JPY (3 transactions)');
    });

    it('renders largest expenses with their category', () => {
      expect(
        renderLargestExpenses(
          [{ description: 'Rent', amount: '90,000', categoryName: 'Housing' }],
          'JPY'
        )
      ).toBe('- Rent: 90,000 JPY (Housing)');
    });

    it('renders the previous-period block with both change percentages', () => {
      const section = renderPreviousPeriodSection({
        baseCurrency: 'JPY',
        previousIncome: '280,000',
        previousExpense: '190,000',
        incomeChangePercent: '7.1',
        expenseChangePercent: '10.5',
      });
      expect(section).toContain('- Previous income: 280,000 JPY');
      expect(section).toContain('- Income change: 7.1%');
      expect(section).toContain('- Expense change: 10.5%');
    });

    it('marks budget status by how much of the limit is used', () => {
      expect(budgetStatusMarker(0)).toBe('✓');
      expect(budgetStatusMarker(79.9)).toBe('✓');
      expect(budgetStatusMarker(80)).toBe('⚠️ Near limit');
      expect(budgetStatusMarker(99.9)).toBe('⚠️ Near limit');
      expect(budgetStatusMarker(100)).toBe('⚠️ EXCEEDED');
      expect(budgetStatusMarker(140)).toBe('⚠️ EXCEEDED');
    });

    it('renders a budget line with spent, limit and rounded percentage', () => {
      expect(
        renderBudgetSection(
          [{ name: 'Food', spent: '55,000', limit: '50,000', percentUsed: 110.4 }],
          'JPY'
        )
      ).toContain('- Food: 55,000/50,000 JPY (110%) ⚠️ EXCEEDED');
    });

    it('renders a goal line with saved, target and rounded percentage', () => {
      expect(
        renderGoalSection(
          [{ name: 'Japan trip', saved: '30,000', target: '200,000', percentSaved: 15.4 }],
          'JPY'
        )
      ).toContain('- Japan trip: 30,000/200,000 JPY (15% saved)');
    });

    it('renders no goal section at all when there are no goals', () => {
      expect(renderGoalSection([], 'JPY')).toBe('');
    });
  });

  describe('languageInstruction', () => {
    it('maps each supported locale', () => {
      expect(languageInstruction('en')).toBe('Respond in English.');
      expect(languageInstruction('ja')).toBe('Respond in Japanese (日本語).');
      expect(languageInstruction('tc')).toBe('Respond in Traditional Chinese (繁體中文).');
    });

    it('falls back to English for an unknown locale', () => {
      expect(languageInstruction('de')).toBe('Respond in English.');
    });
  });

  describe('optionalSection', () => {
    it('is empty for absent, blank and whitespace-only bodies', () => {
      expect(optionalSection(undefined)).toBe('');
      expect(optionalSection('')).toBe('');
      expect(optionalSection('  \n ')).toBe('');
    });

    it('surrounds a present body with single newlines', () => {
      expect(optionalSection(' body ')).toBe('\nbody\n');
    });
  });
});
