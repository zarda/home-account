import { CATALOGS, catalogTranslationStub, catalogTranslator } from './catalog-translator';

describe('catalogTranslator', () => {
  it('fills a ja string\'s placeholders from the ja catalog', () => {
    expect(catalogTranslator('ja')('common.welcomeNamed', { name: 'Ada' })).toBe('おかえりなさい、Adaさん');
  });

  it('picks an en plural member by the count, as the service does', () => {
    const t = catalogTranslator('en');

    expect(t('transactions.resultCountAnnouncement', { count: 1 })).toBe('1 transaction shown');
    expect(t('transactions.resultCountAnnouncement', { count: 3 })).toBe('3 transactions shown');
  });

  it('returns a missing key as the key, as the service does', () => {
    expect(catalogTranslator('tc')('common.noSuchKey')).toBe('common.noSuchKey');
  });

  it('throws on a missing key when strict, naming the key and the locale', () => {
    const t = catalogTranslator('ja', { strict: true });

    expect(() => t('common.noSuchKey')).toThrowError(/ja.*common\.noSuchKey/);
    expect(t('common.welcomeNamed', { name: 'Ada' })).toBe('おかえりなさい、Adaさん');
  });
});

describe('catalogTranslationStub', () => {
  it('renders the locale\'s own words and reports the locale', () => {
    const stub = catalogTranslationStub('tc');

    expect(stub.t('common.welcomeNamed', { name: 'Ada' })).toBe('歡迎回來，Ada');
    expect(stub.currentLocale()).toBe('tc');
    expect(stub.translationsVersion()).toBe(0);
  });

  it('serves the same catalogs CATALOGS holds', () => {
    expect(catalogTranslationStub('en').t('shortcuts.hint')).toBe(CATALOGS.en.shortcuts.hint);
  });
});
