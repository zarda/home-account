import { splitRemainder } from './split-purchase.utils';
import { SplitPart } from '../../models';

describe('split-purchase.utils', () => {
  describe('splitRemainder', () => {
    it('subtracts one part from the total, rounded to the cent', () => {
      expect(splitRemainder(100, [{ categoryId: 'b', amount: 30 }], 'USD')).toBe(70);
    });

    it('subtracts every part, so two parts leave the total minus both', () => {
      const parts: SplitPart[] = [
        { categoryId: 'b', amount: 30 },
        { categoryId: 'c', amount: 45.5 },
      ];
      expect(splitRemainder(100, parts, 'USD')).toBe(24.5);
    });

    it('rounds each part and the remainder to whole units for a currency with no minor unit', () => {
      expect(splitRemainder(100, [{ categoryId: 'b', amount: 30.4 }], 'JPY')).toBe(70);
    });

    it('refuses an empty parts list', () => {
      expect(splitRemainder(100, [], 'USD')).toBeNull();
    });

    it('refuses a part with no category', () => {
      expect(splitRemainder(100, [{ categoryId: '', amount: 30 }], 'USD')).toBeNull();
    });

    it('refuses a part whose category is only whitespace', () => {
      expect(splitRemainder(100, [{ categoryId: '   ', amount: 30 }], 'USD')).toBeNull();
    });

    it('accepts a part naming a category alongside a usable amount', () => {
      expect(splitRemainder(100, [{ categoryId: 'cat-home', amount: 30 }], 'USD')).toBe(70);
    });

    it('refuses a part that is not positive', () => {
      expect(splitRemainder(100, [{ categoryId: 'b', amount: 0 }], 'USD')).toBeNull();
      expect(splitRemainder(100, [{ categoryId: 'b', amount: -5 }], 'USD')).toBeNull();
    });

    it('refuses a part that is not a usable figure', () => {
      expect(splitRemainder(100, [{ categoryId: 'b', amount: NaN }], 'USD')).toBeNull();
      expect(splitRemainder(100, [{ categoryId: 'b', amount: Infinity }], 'USD')).toBeNull();
    });

    it('refuses a part that rounds to nothing in the currency', () => {
      // 0.4 clears a >0 guard on the way in, but JPY has no sliver smaller
      // than a whole yen, so it rounds to zero and is refused the same way
      // a part typed as zero outright would be.
      expect(splitRemainder(100, [{ categoryId: 'b', amount: 0.4 }], 'JPY')).toBeNull();
    });

    it('refuses parts that reach or exceed the total', () => {
      const parts: SplitPart[] = [
        { categoryId: 'b', amount: 60 },
        { categoryId: 'c', amount: 40 },
      ];
      expect(splitRemainder(100, parts, 'USD')).toBeNull();
      expect(splitRemainder(100, [{ categoryId: 'b', amount: 100 }], 'USD')).toBeNull();
    });

    it('refuses a total that is not a positive finite number', () => {
      const parts: SplitPart[] = [{ categoryId: 'b', amount: 30 }];
      expect(splitRemainder(0, parts, 'USD')).toBeNull();
      expect(splitRemainder(-10, parts, 'USD')).toBeNull();
      expect(splitRemainder(NaN, parts, 'USD')).toBeNull();
      expect(splitRemainder(Infinity, parts, 'USD')).toBeNull();
    });

    it('never mutates the parts array it was given', () => {
      const parts: SplitPart[] = [{ categoryId: 'b', amount: 30 }];
      const snapshot = parts.map(part => ({ ...part }));
      splitRemainder(100, parts, 'USD');
      expect(parts).toEqual(snapshot);
    });
  });
});
