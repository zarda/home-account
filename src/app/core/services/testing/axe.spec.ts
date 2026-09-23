import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DISABLED_RULES,
  KNOWN_VIOLATIONS,
  KNOWN_VIOLATION_REASONS,
  axeOptions,
  runAxe,
  summarizeViolations,
  unexpectedViolations,
} from './axe';

/**
 * The axe harness itself, proven against a component that is wrong on
 * purpose.
 *
 * This lives in the UNIT suite, not beside the walkthrough it serves, for
 * three reasons. It needs no emulator, so the harness stays proven on a
 * machine — or a CI job — where the JDK step is skipped. `app.smoke.spec.ts`
 * pins `random: false` globally because its last spec shuts the shared
 * Firebase app down, so adding a file there means reasoning about
 * declaration order for no gain. And a route deliberately carrying a
 * violation would poison `expectPage`, which sweeps every route it visits.
 *
 * Without this, a misconfigured pass — a tag name typo'd, a rule set
 * disabled wholesale — would report zero violations on every route and read
 * exactly like success.
 */
@Component({
  selector: 'app-axe-broken-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // An image with no text alternative is the whole fixture: the lint rule
  // that would normally stop it is the very defect axe has to find, so it is
  // disabled here and nowhere else.
  template: `
    <!-- eslint-disable-next-line @angular-eslint/template/alt-text -->
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
  `,
})
class BrokenFixtureComponent {}

@Component({
  selector: 'app-axe-sound-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" />',
})
class SoundFixtureComponent {}

describe('the axe harness', () => {
  async function violationsOf(component: typeof BrokenFixtureComponent): Promise<string[]> {
    TestBed.configureTestingModule({ imports: [component] });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    const results = await runAxe(fixture.nativeElement as Element);
    return summarizeViolations(results).map(line => line.split(' ')[0]);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('reports an image with no alt attribute', async () => {
    expect(await violationsOf(BrokenFixtureComponent)).toContain('image-alt');
  });

  // The other half, and the one that matters: `alt=""` is WCAG's idiom for a
  // decorative image. A pass that flagged it would be a pass every route
  // fails, which is a pass that gets turned off.
  it('says nothing about a decorative image that declares itself', async () => {
    expect(await violationsOf(SoundFixtureComponent)).toEqual([]);
  });

  it('runs the two WCAG conformance tags and nothing wider', () => {
    expect(axeOptions().runOnly).toEqual({ type: 'tag', values: ['wcag2a', 'wcag2aa'] });
  });

  it('disables exactly the page-level rules Karma owns, and no others', () => {
    // Read back as a set so a rule added here has to be added to the
    // DISABLED_RULES comment's reasoning too, not slipped in.
    expect([...DISABLED_RULES].sort()).toEqual([
      'bypass',
      'document-title',
      'html-has-lang',
      'landmark-banner-is-top-level',
      'landmark-one-main',
      'landmark-unique',
      'page-has-heading-one',
      'region',
    ]);
  });

  it('leaves colour contrast on — it is the rule with the most to say', () => {
    expect(axeOptions().rules?.['color-contrast']).toBeUndefined();
  });

  describe('the frozen violations', () => {
    const frozenRules = [...new Set(Object.values(KNOWN_VIOLATIONS).flat())].sort();

    it('gives every frozen rule a reason', () => {
      expect(frozenRules.filter(rule => !KNOWN_VIOLATION_REASONS[rule]))
        .withContext('a violation nobody wrote a reason for is an exemption, not a debt')
        .toEqual([]);
    });

    it('keeps no reason for a rule it no longer freezes', () => {
      expect(Object.keys(KNOWN_VIOLATION_REASONS).filter(rule => !frozenRules.includes(rule)))
        .withContext('a reason outliving its row reads as a violation that is still tolerated')
        .toEqual([]);
    });

    it('drops a frozen violation from what a route reports', async () => {
      const results = {
        violations: [{ id: 'color-contrast', nodes: [{ target: ['.a'] }] }],
      } as Parameters<typeof unexpectedViolations>[0];
      const fixtureTable = { '/transactions': ['color-contrast'] };

      expect(unexpectedViolations(results, '/transactions', fixtureTable)).toEqual([]);
    });

    // The load-bearing half: the freeze is per route and per rule, so the
    // same violation on a route that never had it still fails, and so does a
    // rule nobody listed.
    it('still reports a frozen rule on a route that did not carry it', () => {
      const results = {
        violations: [{ id: 'nested-interactive', nodes: [{ target: ['.a'] }] }],
      } as Parameters<typeof unexpectedViolations>[0];

      expect(unexpectedViolations(results, '/data')).toEqual([
        'nested-interactive (1): .a',
      ]);
    });

    it('reports a rule nobody froze at all', () => {
      const results = {
        violations: [{ id: 'button-name', nodes: [{ target: ['.b'] }] }],
      } as Parameters<typeof unexpectedViolations>[0];

      expect(unexpectedViolations(results, '/transactions')).toEqual(['button-name (1): .b']);
    });

    it('summarizes a violation with its rule, its count and its first targets', () => {
      const results = {
        violations: [
          { id: 'color-contrast', nodes: [{ target: ['.a'] }, { target: ['.b', '.c'] }] },
        ],
      } as Parameters<typeof summarizeViolations>[0];

      expect(summarizeViolations(results)).toEqual(['color-contrast (2): .a, .b .c']);
    });
  });
});
