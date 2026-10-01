/**
 * The device's record of household copies it may have left behind, and of
 * when each household's copies were last compared with the rows they
 * follow. LedgerShareService writes a row's key here before it issues a copy
 * write and removes it once the server has acknowledged that write, so a
 * copy whose follow-up was refused, or never reached the server because the
 * app stopped first, is found again and repaired.
 *
 * A household marked for a full pass keeps the number its latest mark took,
 * from a counter that only grows. A pass reads the counter before it reads
 * anything else and clears only a mark it outnumbers or equals, so a mark
 * made while it runs (in this tab or another, whose storage is this one)
 * outlives it: the pass may have read the rows or categories before the
 * change that mark stands for. A counter, not the clock, which another tab's
 * device time or a clock set back would put out of order.
 *
 * It lives in localStorage and is a convenience, never the only guard: a
 * private window, cleared site data or a second tab writing at the same
 * moment can lose it. Every access is caught, and a journal that cannot be
 * read behaves as an empty one. The weekly full pass over each household
 * (FULL_SWEEP_EVERY_MS) is what bounds a copy's drift when the journal is
 * gone.
 */

/** One copy to look at again: the household's and the row's ids. */
export interface LedgerJournalRow {
  hid: string;
  txId: string;
}

/** What the journal holds for one account. */
export interface LedgerJournal {
  /** Copies whose last write has not been acknowledged, or whose repair is owed. */
  rows: LedgerJournalRow[];
  /**
   * Households owed a full pass (a row that did not fit, a share made
   * offline, a category or restore write), each with the number of its
   * latest mark.
   */
  full: Record<string, number>;
  /** The number the latest mark took. */
  seq: number;
}

/** When each pass over one household's copies last completed, in epoch milliseconds. */
export interface LedgerSweepStamps {
  check?: number;
  full?: number;
}

/**
 * The most rows the journal holds. A row past it is not written; its
 * household is marked for a full pass instead, which compares every copy
 * the row could have left.
 */
export const LEDGER_JOURNAL_CAP = 500;

export function ledgerJournalKey(uid: string): string {
  return `ledger.journal.${uid}`;
}

export function ledgerSweepKey(uid: string, hid: string): string {
  return `ledger.sweep.${uid}.${hid}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    const store = storage();
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    // Unwritable storage loses the entry; the weekly full pass is the floor.
  }
}

function isRow(value: unknown): value is LedgerJournalRow {
  const row = value as Partial<LedgerJournalRow> | null;
  return !!row && typeof row === 'object' && typeof row.hid === 'string' && typeof row.txId === 'string';
}

const sameRow = (a: LedgerJournalRow, b: LedgerJournalRow) => a.hid === b.hid && a.txId === b.txId;

/** The account's journal, with anything malformed in it left out. */
export function readLedgerJournal(uid: string): LedgerJournal {
  const stored = readJson(ledgerJournalKey(uid)) as Partial<Record<keyof LedgerJournal, unknown>> | null;
  const rows = Array.isArray(stored?.rows) ? stored.rows.filter(isRow).map(({ hid, txId }) => ({ hid, txId })) : [];
  const full: Record<string, number> = {};
  if (Array.isArray(stored?.full)) {
    // A plain list of households, as an earlier journal stored its marks:
    // each reads as marked before any pass began, so the next pass clears it.
    for (const hid of stored.full) if (typeof hid === 'string') full[hid] = 0;
  } else if (stored?.full && typeof stored.full === 'object') {
    for (const [hid, at] of Object.entries(stored.full)) if (isMark(at)) full[hid] = at;
  }
  const seq = Math.max(isMark(stored?.seq) ? stored.seq : 0, ...Object.values(full));
  return { rows, full, seq };
}

function isMark(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isMarked(journal: LedgerJournal, hid: string): boolean {
  return Object.prototype.hasOwnProperty.call(journal.full, hid);
}

function writeJournal(uid: string, journal: LedgerJournal): void {
  // Kept for its number once any mark was made, with nothing else left in
  // it: a pass that read the number before the last mark was cleared must
  // still be outnumbered by the next mark.
  const empty = journal.rows.length === 0 && Object.keys(journal.full).length === 0 && journal.seq === 0;
  writeJson(ledgerJournalKey(uid), empty ? null : journal);
}

/** Marks a household in a journal read, with the next number: a pass begun before it keeps it. */
function mark(journal: LedgerJournal, hid: string): void {
  journal.seq += 1;
  journal.full[hid] = journal.seq;
}

/**
 * Adds the rows the journal does not hold yet. Once it holds
 * LEDGER_JOURNAL_CAP rows, a row that does not fit marks its household for
 * a full pass instead.
 */
export function journalRows(uid: string, rows: readonly LedgerJournalRow[]): void {
  const journal = readLedgerJournal(uid);
  const unfit = new Set<string>();
  for (const row of rows) {
    if (journal.rows.some(held => sameRow(held, row))) continue;
    if (journal.rows.length < LEDGER_JOURNAL_CAP) journal.rows.push({ hid: row.hid, txId: row.txId });
    else unfit.add(row.hid);
  }
  for (const hid of unfit) mark(journal, hid);
  writeJournal(uid, journal);
}

/** Removes the rows named; a row the journal does not hold is ignored. */
export function settleJournalRows(uid: string, rows: readonly LedgerJournalRow[]): void {
  const journal = readLedgerJournal(uid);
  const kept = journal.rows.filter(held => !rows.some(row => sameRow(held, row)));
  if (kept.length === journal.rows.length) return;
  writeJournal(uid, { ...journal, rows: kept });
}

/**
 * Marks a household for a full pass at the next sweep, with the next
 * number, a household already marked included.
 */
export function markFullPass(uid: string, hid: string): void {
  const journal = readLedgerJournal(uid);
  mark(journal, hid);
  writeJournal(uid, journal);
}

/** The number the latest mark took: what a full pass reads before it reads anything else. */
export function fullPassSeq(uid: string): number {
  return readLedgerJournal(uid).seq;
}

/**
 * Clears a household's full-pass mark once a full pass over it has
 * completed, unless the mark is later than `seen`, the number that pass
 * read (fullPassSeq) before it read anything else.
 */
export function clearFullPass(uid: string, hid: string, seen: number): void {
  const journal = readLedgerJournal(uid);
  if (!isMarked(journal, hid) || journal.full[hid] > seen) return;
  delete journal.full[hid];
  writeJournal(uid, journal);
}

/** Everything held for one household: for a membership whose copies are gone with it. */
export function forgetJournalHousehold(uid: string, hid: string): void {
  const journal = readLedgerJournal(uid);
  delete journal.full[hid];
  writeJournal(uid, { ...journal, rows: journal.rows.filter(row => row.hid !== hid) });
  writeJson(ledgerSweepKey(uid, hid), null);
}

/**
 * Everything this device holds for one account: its journal, and the sweep
 * stamps of every household, including those the journal and the index no
 * longer name. For an erased account, whose household and row ids would
 * otherwise stay on the device.
 */
export function clearLedgerDeviceState(uid: string): void {
  writeJson(ledgerJournalKey(uid), null);
  const prefix = ledgerSweepKey(uid, '');
  const keys: string[] = [];
  try {
    const store = storage();
    // Collected first: removing while walking the keys shifts their indices.
    for (let i = 0; store && i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // Storage that cannot be listed cannot be searched either; the stamps stay.
  }
  for (const key of keys) writeJson(key, null);
}

export function readSweepStamps(uid: string, hid: string): LedgerSweepStamps {
  const stored = readJson(ledgerSweepKey(uid, hid)) as Record<string, unknown> | null;
  const stamps: LedgerSweepStamps = {};
  if (typeof stored?.['check'] === 'number') stamps.check = stored['check'];
  if (typeof stored?.['full'] === 'number') stamps.full = stored['full'];
  return stamps;
}

/** Records when a pass over one household's copies completed. */
export function stampSweep(uid: string, hid: string, pass: keyof LedgerSweepStamps, at: number): void {
  writeJson(ledgerSweepKey(uid, hid), { ...readSweepStamps(uid, hid), [pass]: at });
}
