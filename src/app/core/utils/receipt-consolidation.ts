import { MultiImageExtractedTransaction } from '../services/gemini.service';

/**
 * Format receipt line items as "name — CURRENCY amount", one per line.
 * JPY amounts are whole numbers; other currencies keep two decimals.
 */
export function formatReceiptItemLines(
  items: { name: string; amount: number }[],
  currency: string
): string {
  const fractionDigits = currency === 'JPY' ? 0 : 2;
  return items
    .map(item => `${item.name} — ${currency} ${item.amount.toLocaleString('en', { minimumFractionDigits: fractionDigits })}`)
    .join('\n');
}

/**
 * Consolidate line items by receipt group.
 * Items sharing the same receiptId are merged into one transaction whose
 * details carry the itemized list (preferring the AI's full receiptDetails).
 * Items with unique receiptIds stay as standalone transactions.
 */
export function consolidateReceiptItems(
  items: MultiImageExtractedTransaction[]
): MultiImageExtractedTransaction[] {
  if (items.length === 0) return [];

  // Group items by receiptId (default to 1 if not set)
  const groups = new Map<number, MultiImageExtractedTransaction[]>();
  for (const item of items) {
    const rid = item.receiptId ?? 1;
    if (!groups.has(rid)) groups.set(rid, []);
    groups.get(rid)!.push(item);
  }

  const result: MultiImageExtractedTransaction[] = [];

  for (const [, groupItems] of groups) {
    if (groupItems.length === 1) {
      // Single item — keep as standalone transaction, surfacing the full
      // receipt content as its details when the AI provided it
      const only = groupItems[0];
      result.push(only.receiptDetails ? { ...only, details: only.receiptDetails } : only);
    } else {
      // Multiple items from same receipt — merge into one transaction
      const first = groupItems[0];
      const currency = first.currency || 'JPY';
      const merchant = first.merchant || groupItems.find(i => i.merchant)?.merchant || 'Receipt';
      const category = first.category || groupItems.find(i => i.category)?.category;
      const totalAmount = groupItems.reduce((sum, item) => sum + item.amount, 0);

      // Prefer full receipt details from AI, fall back to item list
      const receiptDetailsFromAI = groupItems.find(i => i.receiptDetails)?.receiptDetails;
      const details = receiptDetailsFromAI
        || formatReceiptItemLines(
          groupItems.map(item => ({ name: item.description, amount: item.amount })),
          currency
        );

      result.push({
        date: first.date,
        description: merchant,
        amount: totalAmount,
        type: 'expense',
        currency,
        category,
        merchant,
        details,
        imageIndex: 0,
        positionInImage: 'middle',
        confidence: groupItems.reduce((sum, i) => sum + i.confidence, 0) / groupItems.length,
        receiptId: first.receiptId,
        wasMerged: true,
        mergedFromImages: [...new Set(groupItems.map(i => i.imageIndex))],
      });
    }
  }

  return result;
}
