import { MultiImageExtractedTransaction } from '../services/gemini.service';

/**
 * Format receipt line items as "name — CURRENCY amount", one per line.
 * JPY amounts are whole numbers; other currencies keep two decimals.
 * Items without a numeric amount (e.g. free or discount-label lines from
 * the AI) keep their name only; nameless items are dropped.
 *
 * An empty currency means the model could not read one and no caller has
 * substituted a base currency yet; the amount is then rendered bare rather
 * than prefixed with a code this code has no business inventing.
 */
export function formatReceiptItemLines(
  items: { name?: string; amount?: number }[],
  currency: string
): string {
  const fractionDigits = currency === 'JPY' ? 0 : 2;
  return items
    .filter(item => item?.name)
    .map(item => {
      if (!Number.isFinite(item.amount)) return String(item.name);
      const amount = (item.amount as number)
        .toLocaleString('en', { minimumFractionDigits: fractionDigits });
      return `${item.name} — ${currency ? `${currency} ${amount}` : amount}`;
    })
    .join('\n');
}

/**
 * Amount confidence for a consolidated row whose amount is a guess (item sum,
 * because the model reported no printed total) or a suspect read (the reported
 * total disagrees wildly with the item sum). Sits under VERIFY_FIELD_THRESHOLD
 * (0.7) so the preview table's needs-verify chip fires; deliberately not
 * written to the row's `confidence`, which gates engine fallback at 0.4.
 */
export const REVIEW_AMOUNT_CONFIDENCE = 0.5;

/** A reported total more than 50% of the larger figure away from the item sum. */
function totalDeviatesWildly(total: number, itemSum: number): boolean {
  const larger = Math.max(total, itemSum);
  return larger > 0 && Math.abs(total - itemSum) > 0.5 * larger;
}

function reportedTotalOf(groupItems: MultiImageExtractedTransaction[]): number | undefined {
  return groupItems
    .map(i => i.receiptTotal)
    .find((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

/** Amount plus optional review flag for one receipt group. */
function deriveAmount(
  groupItems: MultiImageExtractedTransaction[],
  itemSum: number
): { amount: number; amountConfidence?: number; receiptTotal?: number } {
  const total = reportedTotalOf(groupItems);
  if (total === undefined) {
    return { amount: itemSum, amountConfidence: REVIEW_AMOUNT_CONFIDENCE };
  }
  return totalDeviatesWildly(total, itemSum)
    ? { amount: total, amountConfidence: REVIEW_AMOUNT_CONFIDENCE, receiptTotal: total }
    : { amount: total, receiptTotal: total };
}

/**
 * Consolidate line items by receipt group.
 * Items sharing the same receiptId are merged into one transaction whose
 * details carry the itemized list (preferring the AI's full receiptDetails).
 * Items with unique receiptIds stay as standalone transactions.
 *
 * `noteCurrency` is used only to label the itemized note when the receipt
 * itself carried no readable currency. It is deliberately not written to the
 * merged row's `currency`: that stays empty so the caller's base-currency
 * fallback runs and the row is flagged for review.
 */
export function consolidateReceiptItems(
  items: MultiImageExtractedTransaction[],
  noteCurrency = ''
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
      const base = only.receiptDetails ? { ...only, details: only.receiptDetails } : only;
      result.push({ ...base, ...deriveAmount(groupItems, Math.abs(only.amount)) });
    } else {
      // Multiple items from same receipt — merge into one transaction.
      // Amounts are absolute values, so refund/credit lines (type 'income')
      // must reduce the total rather than inflate it
      const first = groupItems[0];
      // Never invent a currency here. A hardcoded default made `currency`
      // truthy, which switched off the caller's base-currency fallback and
      // its currencyFellBack flag, so an unreadable currency was committed
      // silently under whatever code this file happened to pick. Scan the
      // group like merchant and category do, and leave it empty if nothing
      // in the receipt carried one.
      const currency = first.currency || groupItems.find(i => i.currency)?.currency || '';
      const merchant = first.merchant || groupItems.find(i => i.merchant)?.merchant || 'Receipt';
      const category = first.category || groupItems.find(i => i.category)?.category;
      // Reported once per receipt, on whichever line the model chose to put it
      // — the same convention receiptDetails and receiptTotal use.
      const location = first.location ?? groupItems.find(i => i.location)?.location;
      const receiptCountry = first.receiptCountry ?? groupItems.find(i => i.receiptCountry)?.receiptCountry;
      const netAmount = groupItems.reduce(
        (sum, item) => sum + (item.type === 'income' ? -item.amount : item.amount),
        0
      );

      // Prefer full receipt details from AI, fall back to item list
      const receiptDetailsFromAI = groupItems.find(i => i.receiptDetails)?.receiptDetails;
      const details = receiptDetailsFromAI
        || formatReceiptItemLines(
          groupItems.map(item => ({ name: item.description, amount: item.amount })),
          currency || noteCurrency
        );

      result.push({
        date: first.date,
        description: merchant,
        ...deriveAmount(groupItems, Math.abs(netAmount)),
        type: netAmount < 0 ? 'income' : 'expense',
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
        ...(location ? { location } : {}),
        ...(receiptCountry ? { receiptCountry } : {}),
      });
    }
  }

  return result;
}
