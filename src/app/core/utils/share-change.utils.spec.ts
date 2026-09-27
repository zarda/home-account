import { applyShareChange, landedKinds, shareChange } from './share-change.utils';

describe('share change utils', () => {
  describe('shareChange', () => {
    it('shares into each household newly chosen and stops sharing with each one left out', () => {
      expect(shareChange(['h1'], ['h2'], ['h1', 'h2'])).toEqual({ share: ['h2'], unshare: ['h1'] });
    });

    it('moves nothing the controls did not offer', () => {
      // h3 is a key the row still holds for a membership that has ended: no
      // control showed it, so leaving it out of the choice is not a choice.
      expect(shareChange(['h1', 'h3'], ['h1'], ['h1', 'h2'])).toEqual({ share: [], unshare: [] });
      expect(shareChange([], ['h3'], ['h1'])).toEqual({ share: [], unshare: [] });
    });

    it('changes nothing for the choice the row already holds', () => {
      expect(shareChange(['h2', 'h1'], ['h1', 'h2'], ['h1', 'h2'])).toEqual({ share: [], unshare: [] });
    });
  });

  describe('applyShareChange', () => {
    it('adds what was shared and drops what was unshared, each once', () => {
      expect(applyShareChange(['h1', 'h3'], { share: ['h2', 'h3'], unshare: ['h1'] })).toEqual(['h3', 'h2']);
    });
  });

  describe('landedKinds', () => {
    it('names each kind once, however many households it went through for', () => {
      expect(landedKinds({ share: ['h1', 'h2'], unshare: ['h3'] })).toEqual(['share', 'unshare']);
      expect(landedKinds({ share: ['h1'], unshare: [] })).toEqual(['share']);
      expect(landedKinds({ share: [], unshare: ['h1', 'h2'] })).toEqual(['unshare']);
    });

    it('names nothing when nothing went through', () => {
      expect(landedKinds({ share: [], unshare: [] })).toEqual([]);
    });
  });
});
