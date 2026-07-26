import { containsPotentialXSS, markdownToHtml } from './markdown.utils';

describe('markdown.utils', () => {
  describe('containsPotentialXSS', () => {
    it('flags a script tag', () => {
      expect(containsPotentialXSS('<script>alert(1)</script>')).toBeTrue();
    });

    it('flags an inline event handler', () => {
      expect(containsPotentialXSS('<img src=x onerror=alert(1)>')).toBeTrue();
      expect(containsPotentialXSS('<div onclick = "x()">')).toBeTrue();
    });

    it('flags a javascript: URL', () => {
      expect(containsPotentialXSS('<a href="javascript:alert(1)">x</a>')).toBeTrue();
    });

    it('flags embedding tags', () => {
      for (const markup of ['<iframe src=x>', '<embed src=x>', '<object data=x>']) {
        expect(containsPotentialXSS(markup)).toBeTrue();
      }
    });

    it('is case-insensitive', () => {
      expect(containsPotentialXSS('<SCRIPT>')).toBeTrue();
      expect(containsPotentialXSS('JavaScript:void(0)')).toBeTrue();
    });

    it('passes ordinary prose and the markdown subset', () => {
      expect(containsPotentialXSS('Your **grocery** spending rose 18%.')).toBeFalse();
      expect(containsPotentialXSS('## Heading\n- one\n- two')).toBeFalse();
    });

    it('passes text that merely mentions the words', () => {
      expect(containsPotentialXSS('You spent more on objects this month')).toBeFalse();
    });
  });

  describe('markdownToHtml', () => {
    it('converts the three heading levels', () => {
      expect(markdownToHtml('# One')).toContain('<h1 class="markdown-h1">One</h1>');
      expect(markdownToHtml('## Two')).toContain('<h2 class="markdown-h2">Two</h2>');
      expect(markdownToHtml('### Three')).toContain('<h3 class="markdown-h3">Three</h3>');
    });

    it('converts bold and italic', () => {
      expect(markdownToHtml('**bold**')).toContain('<strong>bold</strong>');
      expect(markdownToHtml('*italic*')).toContain('<em>italic</em>');
    });

    it('wraps a bullet run in a single list', () => {
      const html = markdownToHtml('- one\n- two');
      expect(html).toContain('<ul class="markdown-list">');
      expect(html).toContain('<li>one</li>');
      expect(html).toContain('<li>two</li>');
      expect((html.match(/<ul/g) ?? []).length).toBe(1);
    });

    it('closes a list that runs to the end of the input', () => {
      expect(markdownToHtml('- one').endsWith('</ul>')).toBeTrue();
    });

    it('closes a list before following prose', () => {
      const html = markdownToHtml('- one\nafter');
      expect(html.indexOf('</ul>')).toBeLessThan(html.indexOf('<p>after</p>'));
    });

    it('wraps plain lines in paragraphs and drops blank ones', () => {
      const html = markdownToHtml('first\n\nsecond');
      expect(html).toBe('<p>first</p><p>second</p>');
    });

    it('returns an empty string for empty input', () => {
      expect(markdownToHtml('')).toBe('');
    });

    it('handles a realistic narrative', () => {
      const html = markdownToHtml(
        'Your **groceries** rose 18% over six months.\n- Netflix, monthly\n- Gym, weekly');
      expect(html).toContain('<strong>groceries</strong>');
      expect(html).toContain('<li>Netflix, monthly</li>');
    });
  });
});
