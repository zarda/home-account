import {
  CategoryCatalogInput,
  GroundingInput,
  RenderedPrompt,
  optionalSection,
} from './prompt-inputs';

/** One row offered to the batch categorizer. */
export interface CategorizeRow {
  index: number;
  description: string;
  amount: number;
}

export type CategorizeInputs = CategoryCatalogInput &
  GroundingInput & {
    rows: CategorizeRow[];
  };

/**
 * Assign a catalog category to each extracted row.
 *
 * The response contract is enforced downstream by `applyCategorizations`, which
 * validates every returned id against the live catalog and derives the
 * confidence — so a hallucinated id costs a fallback, not a bad write.
 */
export function renderCategorizeTransactions(i: CategorizeInputs): RenderedPrompt {
  const transactionList = i.rows
    .map(row => `${row.index}: "${row.description}" (${row.amount})`)
    .join('\n');

  return {
    user: `Categorize these transactions into the most appropriate category.

Available categories:
${i.categoryCatalog}
${optionalSection(i.grounding)}
Transactions:
${transactionList}

Pick the most specific category that fits (a "Parent / Child" entry when one matches). "confidence" is your certainty from 0 to 1.

Return ONLY a valid JSON array with objects containing "index", "categoryId" and "confidence":
[{"index": 0, "categoryId": "food_groceries", "confidence": 0.9}, {"index": 1, "categoryId": "transport", "confidence": 0.6}]`,
    expects: 'json',
    maxOutputTokens: 800,
    temperature: 0.05,
    topP: 0.6,
  };
}

export type CategorySuggestionInputs = CategoryCatalogInput & {
  description: string;
};

/** Single-description category lookup, used outside the import flow. */
export function renderCategorySuggestion(i: CategorySuggestionInputs): RenderedPrompt {
  return {
    user: `Given this transaction description: "${i.description}"

Available categories:
${i.categoryCatalog}

Return ONLY the category ID that best matches this transaction. Just the ID, nothing else.`,
    expects: 'plainText',
    maxOutputTokens: 50,
    temperature: 0.05,
    topP: 0.5,
  };
}

/** One row offered to the tag suggester. */
export interface SuggestTagsRow {
  index: number;
  description: string;
  merchant?: string;
  details?: string;
}

export type SuggestTagsInputs = GroundingInput & {
  rows: SuggestTagsRow[];
  /** Pre-rendered, one `- tag` per line: the tags this account already uses. */
  vocabulary: string;
};

/**
 * Tag each row from the account's own vocabulary, or not at all.
 *
 * The vocabulary is rendered by the caller from the user's history, never
 * listed here, so the prompt carries no taxonomy of its own. The response is
 * validated by `applyTagSuggestions`: a tag outside the vocabulary is dropped
 * the way an unrecognized category name is (ADR 0046).
 */
export function renderSuggestTags(i: SuggestTagsInputs): RenderedPrompt {
  const rowList = i.rows
    .map(row => {
      const merchant = row.merchant && row.merchant !== row.description ? ` (${row.merchant})` : '';
      const details = row.details ? ` — ${row.details}` : '';
      return `${row.index}: "${row.description}"${merchant}${details}`;
    })
    .join('\n');

  return {
    user: `Suggest tags for these transactions, using ONLY the tags this user already uses.

Tags this user already uses:
${i.vocabulary}
${optionalSection(i.grounding)}
Transactions:
${rowList}

Pick at most three tags per transaction, only from the list above, and only when one clearly applies. A transaction that fits none gets an empty array. Never invent, translate or respell a tag.

Return ONLY a valid JSON array with objects containing "index" and "tags":
[{"index": 0, "tags": ["<a tag from the list>"]}, {"index": 1, "tags": []}]`,
    expects: 'json',
    maxOutputTokens: 600,
    temperature: 0.05,
    topP: 0.6,
  };
}

export interface CsvMappingInputs {
  headers: string[];
  sampleRows: string[][];
}

/**
 * Map a bank export's columns onto the transaction fields.
 *
 * Canonical text is the OpenAI/Claude variant. Gemini carried a compressed
 * rewrite that named the same nine fields without saying what any of them meant,
 * which is a lossy copy rather than a deliberate difference.
 */
export function renderCsvMapping(i: CsvMappingInputs): RenderedPrompt {
  return {
    user: `Analyze these CSV headers and sample data to determine the best column mapping for financial transaction data.

Headers: ${JSON.stringify(i.headers)}
Sample rows (first 3): ${JSON.stringify(i.sampleRows.slice(0, 3))}

Identify which columns contain:
- dateColumn: column name containing transaction dates
- descriptionColumn: column name containing merchant/payee description
- amountColumn: column name for single amount field (or null if separate debit/credit)
- debitColumn: column name for debit/expense amounts (or null)
- creditColumn: column name for credit/income amounts (or null)
- typeColumn: column name indicating transaction type (or null)
- categoryColumn: column name for category (or null)
- dateFormat: detected date format (e.g., "MM/DD/YYYY", "YYYY-MM-DD")
- hasHeader: true if first row is headers

Return ONLY valid JSON with this structure:
{
  "dateColumn": "Date",
  "descriptionColumn": "Description",
  "amountColumn": "Amount",
  "debitColumn": null,
  "creditColumn": null,
  "typeColumn": null,
  "categoryColumn": null,
  "dateFormat": "MM/DD/YYYY",
  "hasHeader": true
}`,
    expects: 'json',
    maxOutputTokens: 500,
    temperature: 0.05,
    topP: 0.65,
  };
}
