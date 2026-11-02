import { expectOneRule, rulesUnder, underRule, withInlineStyle } from './style-rules';

describe('style-rules', () => {
  const made: HTMLElement[] = [];

  /** A style element in the head, removed after the case. */
  function sheet(css: string): void {
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    made.push(el);
  }

  /** A div under the body with `style` inline, removed after the case. */
  function box(style = ''): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = style;
    document.body.appendChild(el);
    made.push(el);
    return el;
  }

  afterEach(() => made.splice(0).forEach(el => el.remove()));

  // The same selector at top level, under the 480px query and under a wider
  // one, beside a selector that only starts the same.
  const PROBE = `
    .sr-probe { color: rgb(1, 1, 1); }
    @media (max-width: 480px) {
      .sr-probe { color: rgb(2, 2, 2); }
      .sr-probe-wide { color: rgb(3, 3, 3); }
    }
    @media (max-width: 600px) {
      .sr-probe { color: rgb(4, 4, 4); }
    }
  `;
  const PHONE = 'max-width: 480px';
  const PROBE_SELECTOR = /\.sr-probe(?![\w-])/;
  const colours = (rules: readonly CSSStyleRule[]) => rules.map(rule => rule.style.color);

  describe('rulesUnder', () => {
    it('finds the rules under the named query whose selector the pattern matches, and only those', () => {
      sheet(PROBE);

      expect(colours(rulesUnder(PHONE, PROBE_SELECTOR))).toEqual(['rgb(2, 2, 2)']);
    });

    it('takes a test of its own for a selector read by its parts', () => {
      sheet(PROBE);

      expect(colours(rulesUnder(PHONE, text => text.includes('.sr-probe-wide')))).toEqual(['rgb(3, 3, 3)']);
    });

    it('reads a global pattern the same on every rule', () => {
      // Back to back, so a pattern whose `lastIndex` carried over from the
      // first match would start past the second selector's end.
      sheet(`@media (${PHONE}) { .sr-probe { color: rgb(2, 2, 2); } .sr-probe { color: rgb(6, 6, 6); } }`);

      expect(colours(rulesUnder(PHONE, /\.sr-probe(?![\w-])/g))).toEqual(['rgb(2, 2, 2)', 'rgb(6, 6, 6)']);
    });
  });

  describe('expectOneRule', () => {
    it('passes a rule the CSSOM holds twice, each copy declaring the same', () => {
      sheet(PROBE);
      sheet(PROBE);
      const rules = rulesUnder(PHONE, PROBE_SELECTOR);

      expect(rules.length).withContext('a copy per sheet').toBe(2);
      expectOneRule(rules);
    });
  });

  describe('withInlineStyle', () => {
    it("lays the declarations on every node while fn runs, then puts back each node's own style", async () => {
      const styled = box('color: rgb(5, 5, 5)');
      const bare = box();
      let during: string[] = [];

      await withInlineStyle([styled, bare], 'display: none', () => (during = [styled.style.cssText, bare.style.cssText]));

      expect(during).withContext('while fn runs').toEqual(['display: none;', 'display: none;']);
      expect([styled.style.cssText, bare.style.cssText]).withContext('after').toEqual(['color: rgb(5, 5, 5);', '']);
    });

    it('waits for an async fn before putting the styles back', async () => {
      const node = box();
      let during = '';

      await withInlineStyle([node], 'display: none', async () => {
        await Promise.resolve();
        during = node.style.cssText;
      });

      expect(during).withContext('after fn awaited').toBe('display: none;');
      expect(node.style.cssText).withContext('after').toBe('');
    });

    it('puts the styles back when fn throws, and passes the error on', async () => {
      const node = box('color: rgb(5, 5, 5)');

      await expectAsync(
        withInlineStyle([node], 'display: none', () => {
          throw new Error('mid-case');
        })
      ).toBeRejectedWithError('mid-case');

      expect(node.style.cssText).toBe('color: rgb(5, 5, 5);');
    });
  });

  describe('underRule', () => {
    it("lays the rule's declarations on the nodes while fn runs, then puts them back", async () => {
      sheet(PROBE);
      const [rule] = rulesUnder(PHONE, PROBE_SELECTOR);
      const node = box();
      let during = '';

      await underRule(rule, [node], 'the probe rule', () => (during = getComputedStyle(node).color));

      expect(during).withContext('while fn runs').toBe('rgb(2, 2, 2)');
      expect(node.style.cssText).withContext('after').toBe('');
    });
  });
});
