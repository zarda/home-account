/**
 * A transaction as a control names it: the description its row shows,
 * trimmed, or the catalog's words for an untitled transaction when that is
 * blank, so a name such as "Remove all images of …" never ends on "of".
 * Every control that names the transaction it acts on reads this one rule
 * (ADR 0171). The parameter is named `t` so the i18n gate sees the key.
 */
export function transactionDisplayName(description: string, t: (key: string) => string): string {
  return description.trim() || t('transactions.untitledRow');
}

/**
 * A transaction as a name that only some catalogs quote names it: the
 * display name, in the reader's own quotation marks when it is the
 * description (`common.quotedName`: none in en and ja, 「」 in tc), and bare
 * when it is the catalog's words for an untitled transaction, which in
 * quotes would read as its name. The keys it fills hold no quotation marks
 * of their own; a sentence every catalog quotes keeps its marks and reads
 * isUntitled for a sentence of its own. The list's note and receipt buttons
 * and the receipt manager's image controls read it. The parameter is named
 * `t` so the i18n gate sees the key.
 */
export function quotedTransactionName(
  description: string,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const name = transactionDisplayName(description, t);
  return description.trim() === '' ? name : t('common.quotedName', { name });
}
