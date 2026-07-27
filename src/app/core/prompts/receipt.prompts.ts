import { RenderedPrompt } from './prompt-inputs';

/**
 * The shared category vocabulary the extraction prompts offer. These are
 * free-text names rather than catalog ids: extraction runs before the catalog is
 * consulted, and `mapCategoryNameToId` resolves whatever comes back.
 */
const EXTRACTION_CATEGORY_NAMES =
  'Restaurants, Groceries, Coffee & Drinks, Fast Food, Delivery, Shopping, Fuel & Gas, Pharmacy & Medicine, Other';

/**
 * Summarize one receipt photo into a single transaction.
 *
 * Canonical text is Gemini's. It is the only variant that asks for
 * `receiptCount`, which `transaction-form.component.ts` reads to offer the
 * multi-receipt review flow — so with OpenAI or Claude configured that flow
 * could never trigger, because the field was never requested.
 */
export function renderReceiptParse(): RenderedPrompt {
  return {
    user: `Analyze this receipt image and extract into this JSON structure (no markdown, no code blocks):
{
  "merchant": "store/restaurant name",
  "amount": total amount as number,
  "currency": "detected currency code (USD, EUR, JPY, CNY, TWD, THB, etc.)",
  "date": "YYYY-MM-DD format",
  "items": [{"name": "item name", "amount": item price as number}],
  "receiptDetails": "full receipt content line by line",
  "suggestedCategory": "one of: ${EXTRACTION_CATEGORY_NAMES}",
  "receiptCount": number of distinct receipts visible in the photo
}

IMPORTANT:
- "amount" is the TOTAL amount paid (bottom of receipt).
- If MORE THAN ONE receipt is visible, extract the LARGEST/primary receipt into the fields above and set receiptCount to how many receipts are visible.
- "items" array: each purchased item with its individual price.
- "receiptDetails": Reproduce the FULL receipt content line by line. Include ALL items with prices, quantities, discounts, tax lines, subtotals, service charges, payment method, change, etc. Use newline to separate lines. Keep original language.
- If fields cannot be extracted, use defaults: merchant="Unknown", currency="USD", date=today, items=[], amount=0.
Return ONLY the JSON, nothing else.`,
    expects: 'json',
    maxOutputTokens: 2000,
    temperature: 0.05,
    topP: 0.6,
  };
}

/**
 * Reduce one receipt photo to a single summary row with the full receipt body
 * carried as notes. Distinct from `receiptParse` in that it returns the flat
 * transaction shape rather than the parsed-receipt shape.
 */
export function renderReceiptSummary(): RenderedPrompt {
  return {
    user: `Extract key information from this receipt:

Return ONLY a JSON object (not an array):
{
  "date": "YYYY-MM-DD",
  "merchant": "Store/Restaurant Name",
  "totalAmount": 123.45,
  "currency": "CNY",
  "receiptDetails": "Full receipt content reproduced line by line",
  "suggestedCategory": "category name"
}

Rules:
- date: Receipt date (YYYY-MM-DD), use today if not visible
- merchant: Store or restaurant name
- totalAmount: Total amount paid (positive number only)
- currency: Currency code (TWD for Taiwan, CNY for Chinese, JPY for Japanese, etc.)
- receiptDetails: Reproduce the FULL receipt content line by line, preserving all information visible on the receipt: every item with its price, quantity if shown, discounts, subtotals, tax lines, service charges, payment method, change, etc. Use newline to separate each line. Keep the original language. Example: "コーヒー L ×1 — 480\\nサンドイッチ ×2 — 760\\n割引 -100\\n小計 1,140\\n内税(10%) 104\\n合計 1,140\\nVISA ****1234"
- suggestedCategory: One of: ${EXTRACTION_CATEGORY_NAMES}

Capture EVERYTHING on the receipt.`,
    expects: 'json',
    maxOutputTokens: 1000,
    temperature: 0.1,
    topP: 0.85,
  };
}

/**
 * Read a bank statement or multi-row financial document into one row per line
 * item. Array-returning, unlike the two single-receipt prompts above.
 */
export function renderStatementTransactions(): RenderedPrompt {
  return {
    user: `Analyze this image (bank statement, receipt, or financial document) and extract ALL transactions.

For each transaction found, extract:
- date: in YYYY-MM-DD format
- description: merchant/payee name or transaction description
- amount: as a positive number
- type: "income" for credits/deposits, "expense" for debits/withdrawals
- currency: detected currency code (default to USD if unclear)
- merchant: store/business name (optional)
- details: for receipts, reproduce the FULL receipt content line by line — every item with its price, quantities, discounts, tax lines, subtotals, service charges, payment method, change, etc. Use newline to separate lines. Keep the original language. (optional)

Return ONLY a valid JSON array with this structure (no markdown, no explanation):
[
  {
    "date": "2024-01-15",
    "description": "AMAZON.COM",
    "amount": 45.99,
    "type": "expense",
    "currency": "USD",
    "merchant": "AMAZON.COM",
    "details": "USB Cable — 12.99\\nBook — 32.00\\nSubtotal 44.99\\nTax 1.00\\nTotal 45.99"
  }
]

If no transactions can be extracted, return an empty array: []
Only include confirmed transactions, not pending ones.`,
    expects: 'json',
    maxOutputTokens: 2000,
    temperature: 0.1,
    topP: 0.8,
  };
}

/** Same task as `statementTransactions`, against a PDF rather than an image. */
export function renderPdfStatement(): RenderedPrompt {
  return {
    user: `Extract ALL transactions from this PDF bank statement.

For each transaction: date (YYYY-MM-DD), description, amount (positive number), type (income/expense), currency.

Return ONLY valid JSON array (no markdown, no explanation, no thinking):
[
  {
    "date": "2024-01-15",
    "description": "DIRECT DEPOSIT - EMPLOYER",
    "amount": 3500.00,
    "type": "income",
    "currency": "USD"
  },
  {
    "date": "2024-01-16",
    "description": "WALMART",
    "amount": 125.43,
    "type": "expense",
    "currency": "USD"
  }
]

Empty array [] if no transactions found. Only posted/confirmed transactions.`,
    expects: 'json',
    maxOutputTokens: 1000,
    temperature: 0.05,
    topP: 0.65,
  };
}

export interface MultiImageInputs {
  imageCount: number;
}

/**
 * Read several photos at once, grouping line items by `receiptId` so
 * `consolidateReceiptItems` can merge each group into one transaction.
 *
 * Canonical text is the OpenAI/Claude variant, which spells out why photos
 * overlap and what to do about it; Gemini's said only "deduplicate". The
 * `mergedFromImages` field line is kept from Gemini's, because all three
 * services read `t.mergedFromImages` off the response but only Gemini's prompt
 * ever asked for it.
 */
export function renderMultiImageReceipts(i: MultiImageInputs): RenderedPrompt {
  return {
    user: `You are analyzing ${i.imageCount} photos of receipts or financial documents. They may be:
- Multiple photos of ONE receipt (overlapping pages, ordered top to bottom) → items share the same receiptId
- Photos of DIFFERENT receipts → each receipt gets a different receiptId
- A mix of both
A single photo may also show SEVERAL receipts side by side → give each its own receiptId.

FIRST: Determine which photos belong to the same receipt (same merchant, date, style) vs different receipts.

IMPORTANT: Photos of the same receipt likely have OVERLAPPING content at the edges.
- The BOTTOM portion of Image N likely overlaps with the TOP portion of Image N+1
- You MUST identify and DEDUPLICATE overlapping items
- Return each unique item ONLY ONCE, preferring the clearer/more complete instance

For each UNIQUE transaction/line item found, extract:
- date: in YYYY-MM-DD format (use the receipt date if individual items don't have dates)
- description: item name or transaction description
- amount: FINAL amount after any discounts applied (as a positive number)
- type: "income" for credits/refunds, "expense" for purchases/debits
- currency: detected currency code (default to USD if unclear)
- receiptId: integer grouping items from the same receipt (1, 2, 3...)
- imageIndex: which image this item appears in (0-based)
- positionInImage: "top", "middle", or "bottom" based on vertical position
- confidence: your confidence in the extraction accuracy (0.0 to 1.0)
- merchant: store name (optional)
- category: transaction category like Restaurants, Groceries, Shopping (optional)
- details: full context for this item — quantity, size, flavor, discount, tax info (optional)
- wasMerged: true if this item appeared in multiple images and was deduplicated
- mergedFromImages: [0,1] if from multiple images (optional)

For the LAST item of each receipt (receiptId group), include a "receiptDetails" field with the full receipt content reproduced line by line: all items with prices, discounts, subtotals, tax, service charges, payment method, change, etc. Keep the original language.

Return ONLY a valid JSON array (no markdown):
[
  {
    "date": "2024-01-15",
    "description": "Item name",
    "amount": 10.99,
    "type": "expense",
    "currency": "USD",
    "receiptId": 1,
    "imageIndex": 0,
    "positionInImage": "middle",
    "confidence": 0.95,
    "merchant": "Store name",
    "details": "×1",
    "wasMerged": false,
    "receiptDetails": "Item name ×1 — 10.99\\nSubtotal 10.99\\nTax 0.88\\nTotal 11.87"
  }
]

If no transactions can be extracted, return an empty array: []`,
    expects: 'json',
    maxOutputTokens: 4000,
    temperature: 0.1,
    topP: 0.8,
  };
}

/**
 * Break a single receipt photo into one row per purchased item, with the
 * position metadata the consolidation pass uses to detect overlap.
 */
export function renderReceiptItems(): RenderedPrompt {
  return {
    user: `Extract EVERY individual product/item from this receipt image.

The photo may contain MORE THAN ONE receipt (e.g. several laid side by side). Give the items of each receipt their own receiptId (1, 2, 3...).

Return each item as a SEPARATE JSON object in an array.
Do NOT include total, subtotal, tax, or service charge as items.

FIELDS PER ITEM:
- date: YYYY-MM-DD
- description: product name
- amount: individual item price
- type: "expense"
- currency: JPY, USD, TWD, CNY, etc
- receiptId: Integer grouping items from the same receipt (1, 2, 3...)
- positionInImage: "top", "middle", "bottom"
- confidence: 0.0-1.0
- category: Restaurants, Groceries, Coffee & Drinks, Fast Food, Shopping, Other (optional)
- merchant: store name (optional)
- details: quantity, size, flavor, discount if any (optional)

For the LAST item of each receipt (receiptId group), include a "receiptDetails" field: reproduce the FULL receipt content line by line — all items with prices, discounts, tax, subtotals, service charges, payment method, change, etc. Keep original language.

Example:
[
  {"date":"2024-04-11","description":"おにぎり","amount":151,"type":"expense","currency":"JPY","receiptId":1,"positionInImage":"middle","confidence":0.95,"merchant":"セブン"},
  {"date":"2024-04-11","description":"コーヒー L","amount":330,"type":"expense","currency":"JPY","receiptId":1,"positionInImage":"bottom","confidence":0.90,"merchant":"セブン","receiptDetails":"おにぎり ×1 — 151\\nコーヒー L ×1 — 330\\n小計 481\\n内税(8%) 36\\n合計 481\\n現金 500\\nお釣り 19"}
]

Output ONLY JSON array. Nothing else.`,
    expects: 'json',
    maxOutputTokens: 3000,
    temperature: 0.1,
    topP: 0.8,
  };
}
