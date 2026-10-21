import { givenName, memberDisplayName } from './person-name.utils';
import en from '../../../assets/i18n/en.json';
import ja from '../../../assets/i18n/ja.json';
import tc from '../../../assets/i18n/tc.json';

/** A translator that answers with the key, so a case names the key it expects. */
const keyOnly = (key: string): string => key;

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
