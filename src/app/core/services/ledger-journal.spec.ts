import {
  LEDGER_JOURNAL_CAP,
  clearFullPass,
  clearLedgerDeviceState,
  forgetJournalHousehold,
  fullPassSeq,
  journalRows,
  ledgerJournalKey,
  ledgerSweepKey,
  markFullPass,
  readLedgerJournal,
  readSweepStamps,
  settleJournalRows,
  stampSweep
} from './ledger-journal';

describe('ledger journal', () => {
  const UID = 'journal-spec-account';
  const OTHER = 'journal-spec-other';

  const clear = () => {
    for (const uid of [UID, OTHER]) {
      localStorage.removeItem(ledgerJournalKey(uid));
      for (const hid of ['h1', 'h2', 'h3']) localStorage.removeItem(ledgerSweepKey(uid, hid));
    }
  };

  beforeEach(clear);
  afterEach(clear);

  /** The households marked for a full pass. */
  const marked = (uid = UID) => Object.keys(readLedgerJournal(uid).full);

  it('keys the journal and the sweep stamps by account, and the stamps by household too', () => {
    expect(ledgerJournalKey('u1')).toBe('ledger.journal.u1');
    expect(ledgerSweepKey('u1', 'h1')).toBe('ledger.sweep.u1.h1');
  });

  it('reads an account with nothing journaled as empty', () => {
    expect(readLedgerJournal(UID)).toEqual({ rows: [], full: {}, seq: 0 });
  });

  it('keeps the rows journaled, each once, in the order first journaled', () => {
    journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h2', txId: 't1' }]);
    journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h1', txId: 't2' }]);

    expect(readLedgerJournal(UID).rows).toEqual([
      { hid: 'h1', txId: 't1' },
      { hid: 'h2', txId: 't1' },
      { hid: 'h1', txId: 't2' }
    ]);
  });

  it('keeps one account\'s journal apart from another\'s', () => {
    journalRows(UID, [{ hid: 'h1', txId: 't1' }]);

    expect(readLedgerJournal(OTHER).rows).toEqual([]);
  });

  it('settles the rows named and keeps the rest', () => {
    journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h1', txId: 't2' }, { hid: 'h2', txId: 't1' }]);

    settleJournalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h3', txId: 't9' }]);

    expect(readLedgerJournal(UID).rows).toEqual([{ hid: 'h1', txId: 't2' }, { hid: 'h2', txId: 't1' }]);
  });

  it('removes the stored entry once nothing is left in it', () => {
    journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
    settleJournalRows(UID, [{ hid: 'h1', txId: 't1' }]);

    expect(localStorage.getItem(ledgerJournalKey(UID))).toBeNull();
  });

  it(`holds at most ${LEDGER_JOURNAL_CAP} rows, and marks a household whose row did not fit for a full pass`, () => {
    const rows = Array.from({ length: LEDGER_JOURNAL_CAP }, (_, i) => ({ hid: 'h1', txId: `t${i}` }));
    journalRows(UID, rows);

    journalRows(UID, [{ hid: 'h2', txId: 'late' }, { hid: 'h1', txId: 't0' }]);

    const journal = readLedgerJournal(UID);
    expect(journal.rows.length).toBe(LEDGER_JOURNAL_CAP);
    expect(journal.rows.some(row => row.txId === 'late')).toBeFalse();
    expect(Object.keys(journal.full)).toEqual(['h2']);
  });

  it('marks and clears a household\'s full pass, each household once', () => {
    markFullPass(UID, 'h1');
    markFullPass(UID, 'h2');
    markFullPass(UID, 'h1');
    expect(marked()).toEqual(['h1', 'h2']);

    clearFullPass(UID, 'h1', fullPassSeq(UID));
    expect(marked()).toEqual(['h2']);
  });

  describe('a mark made while a full pass runs', () => {
    // A pass reads the number before it reads anything else, and clears
    // with it: a mark that outnumbers what it read is one it may not have seen.
    it('outlives the pass: a household marked again after the pass began keeps its mark', () => {
      markFullPass(UID, 'h1');
      const seen = fullPassSeq(UID);
      markFullPass(UID, 'h1');

      clearFullPass(UID, 'h1', seen);

      expect(marked()).toEqual(['h1']);
    });

    it('is cleared when made before the pass began', () => {
      markFullPass(UID, 'h1');
      markFullPass(UID, 'h2');
      const seen = fullPassSeq(UID);

      clearFullPass(UID, 'h1', seen);

      expect(marked()).toEqual(['h2']);
    });

    it('outlives a pass begun before every mark was cleared, which keeps the number going', () => {
      markFullPass(UID, 'h1');
      const seen = fullPassSeq(UID);
      clearFullPass(UID, 'h1', seen);
      expect(marked()).toEqual([]);

      markFullPass(UID, 'h1');
      clearFullPass(UID, 'h1', seen);

      expect(marked()).toEqual(['h1']);
    });

    it('outlives the pass when the mark is a row that did not fit', () => {
      journalRows(UID, Array.from({ length: LEDGER_JOURNAL_CAP }, (_, i) => ({ hid: 'h1', txId: `t${i}` })));
      journalRows(UID, [{ hid: 'h2', txId: 'late' }]);
      const seen = fullPassSeq(UID);
      journalRows(UID, [{ hid: 'h2', txId: 'later' }]);

      clearFullPass(UID, 'h2', seen);

      expect(marked()).toEqual(['h2']);
    });
  });

  it('reads the list of households an earlier journal kept as marks made before any pass', () => {
    localStorage.setItem(ledgerJournalKey(UID), JSON.stringify({ rows: [], full: ['h1', 'h2'] }));
    expect(marked()).toEqual(['h1', 'h2']);

    clearFullPass(UID, 'h1', fullPassSeq(UID));

    expect(marked()).toEqual(['h2']);
  });

  it('forgets everything it holds for one household: its rows, its full mark and its stamps', () => {
    journalRows(UID, [{ hid: 'h1', txId: 't1' }, { hid: 'h2', txId: 't1' }]);
    markFullPass(UID, 'h1');
    stampSweep(UID, 'h1', 'full', 1000);
    stampSweep(UID, 'h2', 'full', 2000);

    forgetJournalHousehold(UID, 'h1');

    expect(readLedgerJournal(UID).rows).toEqual([{ hid: 'h2', txId: 't1' }]);
    expect(marked()).toEqual([]);
    expect(readSweepStamps(UID, 'h1')).toEqual({});
    expect(readSweepStamps(UID, 'h2')).toEqual({ full: 2000 });
  });

  it('erases everything this device holds for one account, and nothing of another\'s', () => {
    for (const uid of [UID, OTHER]) {
      journalRows(uid, [{ hid: 'h1', txId: 't1' }]);
      markFullPass(uid, 'h2');
      stampSweep(uid, 'h1', 'full', 1000);
      stampSweep(uid, 'h2', 'check', 2000);
    }
    // A household the journal and the index no longer name leaves stamps too.
    stampSweep(UID, 'h3', 'full', 3000);
    localStorage.setItem('unrelated.key', 'kept');

    clearLedgerDeviceState(UID);

    expect(localStorage.getItem(ledgerJournalKey(UID))).toBeNull();
    for (const hid of ['h1', 'h2', 'h3']) expect(localStorage.getItem(ledgerSweepKey(UID, hid))).toBeNull();
    expect(readLedgerJournal(OTHER).rows).toEqual([{ hid: 'h1', txId: 't1' }]);
    expect(marked(OTHER)).toEqual(['h2']);
    expect(readSweepStamps(OTHER, 'h1')).toEqual({ full: 1000 });
    expect(readSweepStamps(OTHER, 'h2')).toEqual({ check: 2000 });
    expect(localStorage.getItem('unrelated.key')).toBe('kept');
    localStorage.removeItem('unrelated.key');
  });

  it('erases one account\'s stamps without taking another\'s whose id begins with it', () => {
    stampSweep(UID, 'h1', 'full', 1000);
    stampSweep(`${UID}x`, 'h1', 'full', 2000);

    clearLedgerDeviceState(UID);

    expect(readSweepStamps(`${UID}x`, 'h1')).toEqual({ full: 2000 });
    localStorage.removeItem(ledgerSweepKey(`${UID}x`, 'h1'));
  });

  it('stamps each pass apart, per household', () => {
    stampSweep(UID, 'h1', 'check', 1000);
    stampSweep(UID, 'h1', 'full', 2000);
    stampSweep(UID, 'h1', 'check', 3000);

    expect(readSweepStamps(UID, 'h1')).toEqual({ check: 3000, full: 2000 });
    expect(readSweepStamps(UID, 'h2')).toEqual({});
  });

  describe('storage it cannot use', () => {
    it('still erases the journal, and never throws, when the browser will not list its keys', () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      const key = spyOn(Storage.prototype, 'key').and.throwError('SecurityError');

      expect(() => clearLedgerDeviceState(UID)).not.toThrow();
      expect(localStorage.getItem(ledgerJournalKey(UID))).toBeNull();
      key.and.callThrough();
    });

    it('reads as empty when the browser refuses a read (a private window, blocked site data)', () => {
      journalRows(UID, [{ hid: 'h1', txId: 't1' }]);
      stampSweep(UID, 'h1', 'full', 1000);
      spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');

      expect(readLedgerJournal(UID)).toEqual({ rows: [], full: {}, seq: 0 });
      expect(readSweepStamps(UID, 'h1')).toEqual({});
    });

    it('never throws when the browser refuses a write', () => {
      const setItem = spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');
      const removeItem = spyOn(Storage.prototype, 'removeItem').and.throwError('SecurityError');

      expect(() => journalRows(UID, [{ hid: 'h1', txId: 't1' }])).not.toThrow();
      expect(() => settleJournalRows(UID, [{ hid: 'h1', txId: 't1' }])).not.toThrow();
      expect(() => markFullPass(UID, 'h1')).not.toThrow();
      expect(() => clearFullPass(UID, 'h1', 0)).not.toThrow();
      expect(() => stampSweep(UID, 'h1', 'full', 1000)).not.toThrow();
      expect(() => forgetJournalHousehold(UID, 'h1')).not.toThrow();
      expect(() => clearLedgerDeviceState(UID)).not.toThrow();

      // The afterEach clears storage through the same methods.
      setItem.and.callThrough();
      removeItem.and.callThrough();
    });

    it('reads what is not a journal as empty, and keeps only the well-formed parts of one', () => {
      localStorage.setItem(ledgerJournalKey(UID), '{not json');
      expect(readLedgerJournal(UID)).toEqual({ rows: [], full: {}, seq: 0 });

      localStorage.setItem(ledgerJournalKey(UID), JSON.stringify({
        rows: [{ hid: 'h1', txId: 't1' }, { hid: 7, txId: 't2' }, 'row', { hid: 'h2' }],
        full: ['h1', 3, null]
      }));
      expect(readLedgerJournal(UID)).toEqual({ rows: [{ hid: 'h1', txId: 't1' }], full: { h1: 0 }, seq: 0 });

      // The number is never below a mark's, whatever was stored for it.
      localStorage.setItem(ledgerJournalKey(UID), JSON.stringify({
        rows: [],
        full: { h1: 4, h2: 'soon', h3: -1, h4: 1.5 },
        seq: 'many'
      }));
      expect(readLedgerJournal(UID)).toEqual({ rows: [], full: { h1: 4 }, seq: 4 });

      localStorage.setItem(ledgerSweepKey(UID, 'h1'), JSON.stringify({ check: 'soon', full: 5 }));
      expect(readSweepStamps(UID, 'h1')).toEqual({ full: 5 });
    });
  });
});
