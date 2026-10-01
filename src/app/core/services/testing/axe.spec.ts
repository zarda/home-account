import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
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

/**
 * A button that starts on a pair clearing AA and moves, slowly, to one that
 * fails it — the shape of the transactions quick filters, whose "This month"
 * class lands after first render and whose `transition: all` then carries
 * the colours across.
 */
@Component({
  selector: 'app-axe-moving-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<button type="button" class="swatch" [class.late]="late()">Pay</button>',
  styles: `
    .swatch { color: #000000; background: #ffffff; transition: all 60s linear; }
    .swatch.late { color: #777777; background: #888888; }
  `,
})
class MovingFixtureComponent {
  readonly late = signal(false);
}

@Component({
  selector: 'app-axe-spinner-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span class="spinner" aria-hidden="true"></span>',
  styles: `
    .spinner { display: inline-block; width: 8px; height: 8px; animation: axe-spin 1s linear infinite; }
    @keyframes axe-spin { to { transform: rotate(360deg); } }
  `,
})
class SpinnerFixtureComponent {}

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

  describe('motion', () => {
    // Headless Chrome need not paint a frame between a class landing and the
    // pass, so a transition can still sit on its first colours for the whole
    // run. Scored there, a pair the page never rests on passes — which is how
    // the quick filters' 3.45:1 dark pair passed runs it should have failed.
    it('scores the colours a transition is heading for, not the ones it is passing through', async () => {
      TestBed.configureTestingModule({ imports: [MovingFixtureComponent] });
      const fixture = TestBed.createComponent(MovingFixtureComponent);
      fixture.detectChanges();
      const button = (fixture.nativeElement as Element).querySelector('button') as HTMLElement;
      expect(getComputedStyle(button).backgroundColor).toBe('rgb(255, 255, 255)');

      fixture.componentInstance.late.set(true);
      fixture.detectChanges();
      expect(getComputedStyle(button).backgroundColor)
        .withContext('the transition has only just started')
        .toBe('rgb(255, 255, 255)');

      const results = await runAxe(fixture.nativeElement as Element);

      expect(summarizeViolations(results).map(line => line.split(' ')[0])).toContain('color-contrast');
      expect(getComputedStyle(button).backgroundColor).toBe('rgb(136, 136, 136)');
    });

    // finish() throws on an animation with no end, and a spinner or a
    // skeleton pulse is on most pages while they load.
    it('leaves an animation with no end running rather than throwing on it', async () => {
      TestBed.configureTestingModule({ imports: [SpinnerFixtureComponent] });
      const fixture = TestBed.createComponent(SpinnerFixtureComponent);
      fixture.detectChanges();
      const spinner = (fixture.nativeElement as Element).querySelector('.spinner') as HTMLElement;
      expect(spinner.getAnimations().length).toBe(1);

      await expectAsync(runAxe(fixture.nativeElement as Element)).toBeResolved();

      expect(spinner.getAnimations().map(animation => animation.playState)).toEqual(['running']);
    });
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
      const fixtureTable = { '/transactions': ['nested-interactive'] };

      expect(unexpectedViolations(results, '/data', fixtureTable)).toEqual([
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
