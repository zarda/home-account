import { Timestamp } from '@angular/fire/firestore';
import {
  findSerializationIssues,
  flattenNumbers,
  stableStringify,
} from './firestore-value.utils';

describe('firestore-value.utils', () => {
  describe('findSerializationIssues', () => {
    it('passes a clean nested object', () => {
      expect(findSerializationIssues({
        a: 1, b: 'text', c: null, d: [1, 2], e: { f: true },
      })).toEqual([]);
    });

    it('reports an undefined field with its path', () => {
      const issues = findSerializationIssues({ outer: { inner: undefined } });
      expect(issues.length).toBe(1);
      expect(issues[0].path).toBe('outer.inner');
      expect(issues[0].reason).toContain('undefined');
    });

    it('reports NaN and Infinity separately', () => {
      const issues = findSerializationIssues({ a: 0 / 0, b: 1 / 0, c: -1 / 0 });
      expect(issues.map(i => i.path)).toEqual(['a', 'b', 'c']);
      expect(issues[0].reason).toContain('NaN');
      expect(issues[1].reason).toContain('Infinity');
    });

    it('reports a Date, which would come back as a Timestamp', () => {
      const issues = findSerializationIssues({ when: new Date(2026, 0, 1) });
      expect(issues[0].path).toBe('when');
      expect(issues[0].reason).toContain('ISO string');
    });

    it('reports a Timestamp inside a facts-style payload', () => {
      const issues = findSerializationIssues({ facts: { at: Timestamp.now() } });
      expect(issues[0].path).toBe('facts.at');
    });

    it('reports Map and Set', () => {
      const issues = findSerializationIssues({ m: new Map(), s: new Set() });
      expect(issues.length).toBe(2);
    });

    it('reports a nested array', () => {
      const issues = findSerializationIssues({ series: [[1, 2], [3, 4]] });
      expect(issues.length).toBe(2);
      expect(issues[0].reason).toContain('nested arrays');
      expect(issues[0].path).toBe('series[0]');
    });

    it('accepts the flat per-category shape used instead of a nested array', () => {
      expect(findSerializationIssues({
        totalsByCategory: [{ categoryId: 'food', values: [1, 2, 3] }],
      })).toEqual([]);
    });

    it('reports an undefined element inside an array', () => {
      const issues = findSerializationIssues({ list: [1, undefined, 3] });
      expect(issues[0].path).toBe('list[1]');
    });

    it('reports every issue rather than stopping at the first', () => {
      const issues = findSerializationIssues({ a: undefined, b: 0 / 0, c: new Date() });
      expect(issues.length).toBe(3);
    });

    it('labels a bare offending value at the root', () => {
      expect(findSerializationIssues(undefined)[0].path).toBe('(root)');
    });
  });

  describe('stableStringify', () => {
    it('sorts keys so insertion order cannot change the output', () => {
      expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    });

    it('sorts keys at every depth', () => {
      const one = stableStringify({ outer: { z: 1, a: { y: 2, b: 3 } } });
      const two = stableStringify({ outer: { a: { b: 3, y: 2 }, z: 1 } });
      expect(one).toBe(two);
    });

    it('preserves array order, which is meaningful', () => {
      expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
    });

    it('distinguishes different values', () => {
      expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    });

    it('renders null and skips undefined members', () => {
      expect(stableStringify({ a: null })).toBe('{"a":null}');
      expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    });
  });

  describe('flattenNumbers', () => {
    it('flattens numbers to dotted paths', () => {
      const flat = flattenNumbers({ a: 1, b: { c: 2 } });
      expect(flat.get('a')).toBe(1);
      expect(flat.get('b.c')).toBe(2);
    });

    it('indexes array members', () => {
      const flat = flattenNumbers({ series: [10, 20] });
      expect(flat.get('series[0]')).toBe(10);
      expect(flat.get('series[1]')).toBe(20);
    });

    it('keeps nulls, so a ratio that became unavailable is visible', () => {
      const flat = flattenNumbers({ ratio: null });
      expect(flat.has('ratio')).toBeTrue();
      expect(flat.get('ratio')).toBeNull();
    });

    it('ignores strings and booleans', () => {
      const flat = flattenNumbers({ label: 'x', on: true, n: 1 });
      expect([...flat.keys()]).toEqual(['n']);
    });
  });
});
