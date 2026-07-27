import { nextImportRowId, resetImportRowIdsForTest } from './import-row-id.utils';

describe('import row ids', () => {
  beforeEach(() => resetImportRowIdsForTest());

  it('never repeats an id, however fast ids are minted', () => {
    // The previous scheme embedded Date.now(), so two files parsed inside the
    // same millisecond produced the same id. The duplicate pass keys a Map on
    // the row id, so a collision made one row inherit the other's verdict.
    const ids = Array.from({ length: 5000 }, () => nextImportRowId('import'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps ids from different sources apart', () => {
    // The wizard concatenates image rows and per-file rows into one array, so a
    // batch-level pass sees ids minted by different call sites at once.
    const ids = [
      nextImportRowId('multi_img'),
      nextImportRowId('import'),
      nextImportRowId('json'),
      nextImportRowId('strategy'),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('prefixes the id with its source', () => {
    expect(nextImportRowId('import')).toBe('import_1');
    expect(nextImportRowId('multi_img')).toBe('multi_img_2');
  });
});
