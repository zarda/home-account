import { accountDisplayName, givenName, memberDisplayName, welcomeGreeting } from './person-name.utils';
import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';

/** A translator that answers with the key, so a case names the key it expects. */
const keyOnly = (key: string): string => key;

/** A translator that answers with the key and the params it was given, as the app's spec doubles do. */
const keyAndParams = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

/** The catalog's own words and templates, as the translation service reads them. */
function catalogTranslator(catalog: unknown): (key: string, params?: Record<string, string | number>) => string {
  return (key, params) => {
    let value: unknown = catalog;
    for (const part of key.split('.')) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof value !== 'string') throw new Error(`${key} is not a string in the catalog`);
    return Object.entries(params ?? {}).reduce(
      (text, [name, each]) => text.replaceAll(`{{${name}}}`, String(each)),
      value
    );
  };
}

describe('person-name.utils', () => {
  describe('givenName', () => {
    it('is the name the account gave, trimmed', () => {
      expect(givenName('Alex')).toBe('Alex');
      expect(givenName('  Alex Kim \n')).toBe('Alex Kim');
    });

    it('is empty for a name that is missing or only white space', () => {
      for (const missing of [null, undefined, '', '   ', '\t\n', '　', '  　']) {
        expect(givenName(missing)).withContext(JSON.stringify(missing)).toBe('');
      }
    });

    it('reads a stored "User" as the name it is (pin: the old code fallback is gone, not matched)', () => {
      expect(givenName('User')).toBe('User');
      expect(givenName(' User ')).toBe('User');
    });
  });

  describe('accountDisplayName', () => {
    it('is the given name, trimmed, and asks nobody for a fallback it will not use', () => {
      const t = jasmine.createSpy('t').and.callFake(keyOnly);

      expect(accountDisplayName('Alex', t)).toBe('Alex');
      expect(accountDisplayName('  Alex Kim \n', t)).toBe('Alex Kim');
      expect(t).not.toHaveBeenCalled();
    });

    it('reads a stored "User" as the name it is (pin)', () => {
      expect(accountDisplayName('User', keyOnly)).toBe('User');
      expect(accountDisplayName(' User ', keyOnly)).toBe('User');
    });

    it('is the word for an account with no name when none was given', () => {
      for (const missing of [null, undefined, '', '   ', '\t\n', '　']) {
        expect(accountDisplayName(missing, keyOnly)).withContext(JSON.stringify(missing)).toBe('common.unnamedAccount');
      }
    });

    describe('against the real catalogs', () => {
      const words = { en: 'No name set', ja: '名前未設定', tc: '未設定名稱' };

      for (const [locale, catalog] of Object.entries({ en, ja, tc })) {
        it(`reads ${locale} as its own word, with no punctuation or edge space of its own`, () => {
          const text = accountDisplayName('', catalogTranslator(catalog));

          expect(text).toBe(words[locale as keyof typeof words]);
          expect(text).toBe(text.trim());
          expect(text).not.toMatch(/[.!?。！？、，,:;：；]$/);
        });
      }
    });
  });

  describe('welcomeGreeting', () => {
    it('greets by the first word of the name, whatever white space ends it', () => {
      expect(welcomeGreeting('Ada Lovelace', keyAndParams)).toBe('common.welcomeNamed:{"name":"Ada"}');
      expect(welcomeGreeting('Ada\tLovelace', keyAndParams)).toBe('common.welcomeNamed:{"name":"Ada"}');
      expect(welcomeGreeting('Ada\nLovelace', keyAndParams)).toBe('common.welcomeNamed:{"name":"Ada"}');
    });

    it('splits a name written with the ideographic space as well', () => {
      expect(welcomeGreeting('山田　太郎', keyAndParams)).toBe('common.welcomeNamed:{"name":"山田"}');
    });

    it('greets a one-word name by that word, and ignores white space around the name', () => {
      expect(welcomeGreeting('Ada', keyAndParams)).toBe('common.welcomeNamed:{"name":"Ada"}');
      expect(welcomeGreeting('  Ada   Lovelace  ', keyAndParams)).toBe('common.welcomeNamed:{"name":"Ada"}');
      expect(welcomeGreeting('　山田　', keyAndParams)).toBe('common.welcomeNamed:{"name":"山田"}');
    });

    it('reads a stored "User" as the name it is (pin)', () => {
      expect(welcomeGreeting('User', keyAndParams)).toBe('common.welcomeNamed:{"name":"User"}');
      expect(welcomeGreeting('User Name', keyAndParams)).toBe('common.welcomeNamed:{"name":"User"}');
    });

    it('greets an account with no name by the plain welcome, and passes no params', () => {
      for (const missing of [null, undefined, '', '   ', '\t\n', '　']) {
        const t = jasmine.createSpy('t').and.callFake(keyAndParams);

        expect(welcomeGreeting(missing, t)).withContext(JSON.stringify(missing)).toBe('common.welcome');
        expect(t).withContext(JSON.stringify(missing)).toHaveBeenCalledOnceWith('common.welcome');
      }
    });

    it('asks only for the key it uses', () => {
      const t = jasmine.createSpy('t').and.callFake(keyAndParams);

      welcomeGreeting('Ada Lovelace', t);

      expect(t).toHaveBeenCalledOnceWith('common.welcomeNamed', { name: 'Ada' });
    });

    describe('against the real catalogs', () => {
      const named = {
        en: 'Welcome back, Ada',
        ja: 'おかえりなさい、Adaさん',
        tc: '歡迎回來，Ada',
      };

      for (const [locale, catalog] of Object.entries({ en, ja, tc })) {
        describe(locale, () => {
          const t = catalogTranslator(catalog);

          it('greets by name in the reader\'s language', () => {
            expect(welcomeGreeting('Ada Lovelace', t)).toBe(named[locale as keyof typeof named]);
          });

          it('greets an account with no name by the plain welcome', () => {
            expect(welcomeGreeting('', t)).toBe(t('common.welcome'));
          });
        });
      }
    });
  });

  describe('memberDisplayName', () => {
    it('is the given name, and asks nobody for a fallback it will not use', () => {
      const t = jasmine.createSpy('t').and.callFake(keyOnly);

      expect(memberDisplayName('  Alex ', t)).toBe('Alex');
      expect(memberDisplayName('Alex', t, 'inline')).toBe('Alex');
      expect(t).not.toHaveBeenCalled();
    });

    it('reads a stored "User" as the name it is (pin)', () => {
      expect(memberDisplayName('User', keyOnly)).toBe('User');
      expect(memberDisplayName('User', keyOnly, 'inline')).toBe('User');
    });

    it('opens a sentence with "a member" when no name was given', () => {
      for (const missing of [null, undefined, '', '   ', '　']) {
        expect(memberDisplayName(missing, keyOnly)).withContext(JSON.stringify(missing)).toBe('household.unnamedMember');
        expect(memberDisplayName(missing, keyOnly, 'start')).toBe('household.unnamedMember');
      }
    });

    it('reads "a member" in the middle of a sentence in its inline form', () => {
      for (const missing of [null, undefined, '', '   ', '　']) {
        expect(memberDisplayName(missing, keyOnly, 'inline'))
          .withContext(JSON.stringify(missing))
          .toBe('household.unnamedMemberInline');
      }
    });

    describe('against the real catalogs', () => {
      const catalogs = { en, ja, tc };

      for (const [locale, catalog] of Object.entries(catalogs)) {
        describe(locale, () => {
          const t = catalogTranslator(catalog);

          it('gives both forms as words that carry no punctuation or edge space of their own', () => {
            for (const form of ['start', 'inline'] as const) {
              const text = memberDisplayName('', t, form);

              expect(text).withContext(form).not.toBe('');
              expect(text).withContext(form).toBe(text.trim());
              // The sentence around the name brings its own full stop or question mark.
              expect(text).withContext(form).not.toMatch(/[.!?。！？、，,:;：；]$/);
            }
          });

          it('leaves the question around the name with its one question mark', () => {
            const title = t('household.members.removeTitle', { name: memberDisplayName('', t, 'inline') });

            expect(title).withContext(title).toContain(t('household.unnamedMemberInline'));
            expect(title.match(/[?？]/g)).withContext(title).toHaveSize(1);
            expect(title).withContext(title).toMatch(/[?？]$/);
          });

          it('leaves the notice around the name with its one full stop', () => {
            const notice = t('household.members.removed', { name: memberDisplayName('', t) });

            expect(notice).withContext(notice).toContain(t('household.unnamedMember'));
            expect(notice.match(/[.。]/g)).withContext(notice).toHaveSize(1);
            expect(notice).withContext(notice).toMatch(/[.。]$/);
          });
        });
      }

      it('has English begin a sentence with a capital and carry on in lower case', () => {
        const t = catalogTranslator(en);
        const start = memberDisplayName('', t, 'start');
        const inline = memberDisplayName('', t, 'inline');

        expect(start).toBe(t('household.unnamedMember'));
        expect(start.charAt(0)).toBe(start.charAt(0).toUpperCase());
        expect(inline).toBe(start.charAt(0).toLowerCase() + start.slice(1));
      });
    });
  });
});
