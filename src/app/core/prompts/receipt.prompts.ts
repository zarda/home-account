import { RenderedPrompt } from './prompt-inputs';

/**
 * The shared category vocabulary the extraction prompts offer. These are
 * free-text names rather than catalog ids: extraction runs before the catalog is
 * consulted, and `mapCategoryNameToId` resolves whatever comes back.
 */
const EXTRACTION_CATEGORY_NAMES =
  'Restaurants, Groceries, Coffee & Drinks, Fast Food, Delivery, Shopping, Fuel & Gas, Pharmacy & Medicine, Other';

/**
 * How every receipt prompt asks for the currency.
 *
 * Deliberately not a list. These prompts used to carry three different
 * hand-typed shortlists — none of which agreed with each other or with the
 * app's own catalog — so a receipt in a currency nobody had thought to type
 * out was steered towards one that had been. The code the model reads off the
 * receipt is checked against the ISO 4217 table on the way back instead, which
 * costs nothing per prompt and covers every currency there is.
 */
const CURRENCY_FIELD =
  'ISO 4217 code for the money on this receipt, read from the printed symbol, an explicit code, or the receipt\'s own language and country. Use "" when you genuinely cannot tell — never guess a default.';

/**
 * How the two item prompts ask for the receipt's printed grand total.
 *
 * Requested once per receiptId group on the LAST item, the same convention
 * receiptDetails already uses. Asked for as its own field because the item
 * rows deliberately exclude totals/tax/service-charge lines — summing the
 * items silently drops everything the receipt adds below the item list.
 */
const RECEIPT_TOTAL_FIELD =
  'On that same LAST item, ALSO include a "receiptTotal" field: the grand total the receipt itself prints — the amount actually paid, after tax, service charges and receipt-level discounts. Read it off the receipt; do NOT compute it by summing items, and do NOT use the cash tendered or change lines. Omit "receiptTotal" when no total is printed or legible.';

/**
 * How every receipt prompt asks where the receipt was issued.
 *
 * The printed branch or address and nothing inferred: a merchant name is not
 * a place, and a model asked to guess one will. Asked for as printed, in the
 * receipt's own script, for the same reason the body is — a translated address
 * is a different string from the one on the paper, and `location.name` is
 * what the user searches by. (#314)
 */
const LOCATION_FIELD =
  'the branch name and/or street address the receipt itself prints, exactly as printed and in the receipt\'s own script — never translated, never transliterated, never inferred from the merchant name. Use "" when no branch or address is printed or legible.';

/** The item prompts carry the location once per receipt group, on the LAST item, like the total. */
const RECEIPT_LOCATION_FIELD =
  `On that same LAST item, ALSO include a "location" field: ${LOCATION_FIELD}`;

/**
 * How every receipt prompt asks which country the receipt was issued in.
 *
 * CURRENCY_FIELD already asks the model to read the money from "the
 * receipt's own language and country" — the country was being inferred and
 * thrown away at the boundary. Asked for as a code and never as a name, and
 * no code is listed here (ADR 0008): `readCountryCode` checks the answer
 * against the runtime's region table on the way back. Empty is a real answer.
 */
const COUNTRY_FIELD =
  'ISO 3166-1 alpha-2 code of the country this receipt was issued in, concluded from the printed address, the tax or registration number, the phone number format, the currency symbol and the receipt\'s own language. Use "" when you cannot tell — never a default.';

/** The item prompts carry the country once per receipt group, on the LAST item, like the location. */
const RECEIPT_COUNTRY_FIELD =
  `On that same LAST item, ALSO include a "country" field: ${COUNTRY_FIELD}`;

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
  "currency": "ISO 4217 code, or empty when unreadable",
  "date": "YYYY-MM-DD format, or empty when no date is printed",
  "location": "<branch or address as printed, or empty>",
  "country": "<ISO 3166-1 alpha-2 of the issuing country, or empty>",
  "items": [{"name": "item name", "amount": item price as number}],
  "receiptDetails": "full receipt content line by line",
  "suggestedCategory": "one of: ${EXTRACTION_CATEGORY_NAMES}",
  "receiptCount": number of distinct receipts visible in the photo,
  "amountConfidence": how clearly the total was legible, 0.0 to 1.0,
  "dateConfidence": how clearly the date was legible, 0.0 to 1.0
}

IMPORTANT:
- "amount" is the TOTAL amount paid (bottom of receipt).
- If MORE THAN ONE receipt is visible, extract the LARGEST/primary receipt into the fields above and set receiptCount to how many receipts are visible.
- "currency": ${CURRENCY_FIELD}
- "location": ${LOCATION_FIELD}
- "country": ${COUNTRY_FIELD}
- "items" array: each purchased item with its individual price.
- "receiptDetails": Reproduce the FULL receipt content line by line. Include ALL items with prices, quantities, discounts, tax lines, subtotals, service charges, payment method, change, etc. Use newline to separate lines. Keep the receipt's own language and script exactly as printed — do not translate or transliterate.
- If fields cannot be extracted, use defaults: merchant="Unknown", currency="", date="", items=[], amount=0.
- Lower "amountConfidence" and "dateConfidence" when a figure is blurred, cut off, ambiguous or inferred rather than read. Use 0.0 for "dateConfidence" when no date is printed or legible — never invent today's date.
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
  "currency": "ISO 4217 code",
  "location": "<branch or address as printed, or empty>",
  "country": "<ISO 3166-1 alpha-2 of the issuing country, or empty>",
  "receiptDetails": "Full receipt content reproduced line by line",
  "suggestedCategory": "category name"
}

Rules:
- date: Receipt date (YYYY-MM-DD), use "" if not visible
- merchant: Store or restaurant name
- totalAmount: Total amount paid (positive number only)
- currency: ${CURRENCY_FIELD}
- location: ${LOCATION_FIELD}
- country: ${COUNTRY_FIELD}
- receiptDetails: Reproduce the FULL receipt content line by line, preserving all information visible on the receipt: every item with its price, quantity if shown, discounts, subtotals, tax lines, service charges, payment method, change, etc. Use newline to separate each line. Keep the receipt's own language and script exactly as printed — do not translate or transliterate. Shape: "<item> ×1 — 480\\n<item> ×2 — 760\\n<discount line> -100\\n<subtotal line> 1,140\\n<tax line> 104\\n<total line> 1,140\\nVISA ****1234"
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
- currency: ${CURRENCY_FIELD}
- merchant: store/business name (optional)
- location: ${LOCATION_FIELD} Here, instead of "", omit the key entirely on a row whose document prints no branch or address. (optional)
- country: ${COUNTRY_FIELD} (optional)
- details: for receipts, reproduce the FULL receipt content line by line — every item with its price, quantities, discounts, tax lines, subtotals, service charges, payment method, change, etc. Use newline to separate lines. Keep the receipt's own language and script exactly as printed. (optional)
- amountConfidence: how clearly the amount was legible, 0.0 to 1.0
- dateConfidence: how clearly the date was legible, 0.0 to 1.0

Lower the two confidence values when a figure is blurred, cut off, ambiguous or inferred rather than read.

Return ONLY a valid JSON array with this structure (no markdown, no explanation):
[
  {
    "date": "2024-01-15",
    "description": "AMAZON.COM",
    "amount": 45.99,
    "type": "expense",
    "currency": "<ISO 4217 code>",
    "merchant": "AMAZON.COM",
    "location": "<branch or address as printed, or empty>",
    "country": "<ISO 3166-1 alpha-2 of the issuing country, or empty>",
    "details": "USB Cable — 12.99\\nBook — 32.00\\nSubtotal 44.99\\nTax 1.00\\nTotal 45.99",
    "amountConfidence": 0.98,
    "dateConfidence": 0.95
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

export interface MultiImageInputs {
  imageCount: number;
}

/**
 * Output budget for a multi-photo receipt read, in tokens.
 *
 * The binding constraint is the answer, and the answer grows with the photos:
 * one JSON object per line item across every photo, plus one full
 * `receiptDetails` reproduction per receipt group. Measured against the row
 * this prompt's own example declares, one row costs about 69 tokens in ASCII
 * and about 92 in Japanese — a 40-item Japanese receipt is roughly 4260 tokens
 * of answer on its own, before a second photo is considered. A flat 4000 was
 * therefore a single-photo, single-language assumption, and past it the array
 * truncates mid-row and the parse takes the whole import down with it (#331).
 *
 * The figures come from a live read rather than from arithmetic: two
 * overlapping photos of that 34-item receipt cost **5272 output tokens** on
 * gemini-3.5-flash-lite (2026-08-24). So the old 4000 could not have held it,
 * and neither could a one-photo budget of 4000 — the answer's size follows
 * the receipt, and the photo count is only a proxy for how long the receipt
 * is. Hence a 4000 floor, 2000 a photo, and the ceiling reached by the second
 * one.
 *
 * A budget is not a bill: providers charge for the tokens generated, not the
 * ones reserved, so the only cost of asking high is the ceiling itself. That
 * ceiling is deliberately conservative — nothing here knows any model's real
 * output limit (`config/ai-models.ts` records sampling support and nothing
 * else), and a `max_tokens` above a model's own cap is a 400 on the OpenAI
 * and Claude transports, which would turn a truncated answer into no answer
 * at all. 8000 was accepted by the lowest-cap configured model with four
 * images attached; ADR 0066 records what that does and does not prove.
 */
export function multiImageAnswerBudget(imageCount: number): number {
  return Math.min(8000, 4000 + 2000 * imageCount);
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
- currency: ${CURRENCY_FIELD}
- receiptId: integer grouping items from the same receipt (1, 2, 3...)
- imageIndex: which image this item appears in (0-based)
- positionInImage: "top", "middle", or "bottom" based on vertical position
- confidence: your confidence in the extraction accuracy (0.0 to 1.0)
- merchant: store name (optional)
- category: transaction category like Restaurants, Groceries, Shopping (optional)
- details: full context for this item — quantity, size, flavor, discount, tax info (optional)
- wasMerged: true if this item appeared in multiple images and was deduplicated
- mergedFromImages: [0,1] if from multiple images (optional)

For the LAST item of each receipt (receiptId group), include a "receiptDetails" field with the full receipt content reproduced line by line: all items with prices, discounts, subtotals, tax, service charges, payment method, change, etc. Keep the receipt's own language and script exactly as printed.
${RECEIPT_TOTAL_FIELD}
${RECEIPT_LOCATION_FIELD}
${RECEIPT_COUNTRY_FIELD}

Return ONLY a valid JSON array (no markdown):
[
  {
    "date": "2024-01-15",
    "description": "Item name",
    "amount": 10.99,
    "type": "expense",
    "currency": "<ISO 4217 code>",
    "receiptId": 1,
    "imageIndex": 0,
    "positionInImage": "middle",
    "confidence": 0.95,
    "merchant": "Store name",
    "details": "×1",
    "wasMerged": false,
    "receiptDetails": "Item name ×1 — 10.99\\nSubtotal 10.99\\nTax 0.88\\nTotal 11.87",
    "receiptTotal": 11.87,
    "location": "<branch or address as printed, or empty>",
    "country": "<ISO 3166-1 alpha-2 of the issuing country, or empty>"
  }
]

If no transactions can be extracted, return an empty array: []`,
    expects: 'json',
    maxOutputTokens: multiImageAnswerBudget(i.imageCount),
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
- currency: ${CURRENCY_FIELD}
- receiptId: Integer grouping items from the same receipt (1, 2, 3...)
- positionInImage: "top", "middle", "bottom"
- confidence: 0.0-1.0
- category: Restaurants, Groceries, Coffee & Drinks, Fast Food, Shopping, Other (optional)
- merchant: store name (optional)
- details: quantity, size, flavor, discount if any (optional)

For the LAST item of each receipt (receiptId group), include a "receiptDetails" field: reproduce the FULL receipt content line by line — all items with prices, discounts, tax, subtotals, service charges, payment method, change, etc. Keep the receipt's own language and script exactly as printed.
${RECEIPT_TOTAL_FIELD}
${RECEIPT_LOCATION_FIELD}
${RECEIPT_COUNTRY_FIELD}

Example:
[
  {"date":"2024-04-11","description":"<item name as printed>","amount":151,"type":"expense","currency":"<ISO 4217 code>","receiptId":1,"positionInImage":"middle","confidence":0.95,"merchant":"<store name as printed>"},
  {"date":"2024-04-11","description":"<item name as printed>","amount":330,"type":"expense","currency":"<ISO 4217 code>","receiptId":1,"positionInImage":"bottom","confidence":0.90,"merchant":"<store name as printed>","receiptDetails":"<item> ×1 — 151\\n<item> ×1 — 330\\n<subtotal line> 481\\n<tax line> 36\\n<total line> 481\\n<paid line> 500\\n<change line> 19","receiptTotal":481,"location":"<branch or address as printed, or empty>","country":"<ISO 3166-1 alpha-2 of the issuing country, or empty>"}
]

Output ONLY JSON array. Nothing else.`,
    expects: 'json',
    // Same answer shape as multiImageReceipts — a row per item plus the full
    // receipt reproduced once — so the same measurement binds: 5272 output
    // tokens for a 34-item receipt. One photo is no guarantee of a short
    // answer, since a photo can hold a long receipt or several side by side.
    maxOutputTokens: 6000,
    temperature: 0.1,
    topP: 0.8,
  };
}
