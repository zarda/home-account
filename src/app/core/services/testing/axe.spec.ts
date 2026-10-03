import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AxeResults } from 'axe-core';
import { type EffectiveTheme, ThemeService } from '../theme.service';
import {
  AUDIT_SCHEMES,
  DISABLED_RULES,
  KNOWN_VIOLATIONS,
  KNOWN_VIOLATION_REASONS,
  auditInView,
  axeOptions,
  runAxe,
  summarizeViolations,
  unexpectedViolations,
  withScheme,
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

/**
 * A failing pair under a spacer taller than any Karma frame, inside a fixed
 * scroller the way the app shell's `.main-container` holds every page.
 *
 * The scroller is the point. Axe grids the whole document, so a pair in plain
 * flow is scored at any depth; what it skips is a node under a fixed ancestor
 * whose top is at or below the viewport's bottom, which axe calls offscreen.
 * Every routed page sits under one, so a plain pass never scores the cards
 * below its fold.
 */
@Component({
  selector: 'app-axe-fold-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div class="scroller"><div class="spacer"></div><p class="pair">Total</p></div>',
  styles: `
    .scroller { position: fixed; inset: 0; overflow-y: auto; }
    .spacer { height: 2000px; }
    .pair { margin: 0; color: #777777; background: #888888; }
  `,
})
class FoldFixtureComponent {}

/**
 * Two nodes no scroll can bring into the band below the app's header: one
 * pinned to the top of the viewport, one taller than any viewport.
 */
@Component({
  selector: 'app-axe-out-of-band-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p class="pinned">Total</p><div class="tall"><p>Total</p></div>',
  styles: `
    .pinned { position: fixed; top: 0; inset-inline: 0; margin: 0; }
    .tall { height: 4000px; }
  `,
})
class OutOfBandFixtureComponent {}

/** A pair that clears AA in the light theme and fails it in the dark one. */
@Component({
  selector: 'app-axe-dark-only-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p class="pair">Total</p>',
  styles: `
    .pair { margin: 0; color: #000000; background: #ffffff; }
    :host-context(.dark-theme) .pair { color: #777777; background: #888888; }
  `,
})
class DarkOnlyFixtureComponent {}

/**
 * A component that reads the theme, the shape of every chart card: its first
 * render creates ThemeService inside the Angular zone, so the service's
 * effect is flushed in a run of that zone.
 */
@Component({
  selector: 'app-axe-theme-reader-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>{{ theme.effectiveTheme() }}</p>',
})
class ThemeReaderFixtureComponent {
  readonly theme = inject(ThemeService);
}

describe('the axe harness', () => {
  function rulesOf(results: AxeResults): string[] {
    return summarizeViolations(results).map(line => line.split(' ')[0]);
  }

  async function violationsOf(component: typeof BrokenFixtureComponent): Promise<string[]> {
    TestBed.configureTestingModule({ imports: [component] });
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    return rulesOf(await runAxe(fixture.nativeElement as Element));
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

  describe('below the fold', () => {
    // The tall fixture scrolls the document itself.
    afterEach(() => {
      document.scrollingElement?.scrollTo(0, 0);
    });

    it('scores a node below the fold once it is scrolled into view, and not before', async () => {
      TestBed.configureTestingModule({ imports: [FoldFixtureComponent] });
      const fixture = TestBed.createComponent(FoldFixtureComponent);
      fixture.detectChanges();
      const pair = (fixture.nativeElement as Element).querySelector('.pair') as HTMLElement;
      expect(pair.getBoundingClientRect().top)
        .withContext('the pair starts below the fold')
        .toBeGreaterThan(window.innerHeight);

      expect(rulesOf(await runAxe(pair)))
        .withContext('a plain pass never reaches below the fold')
        .not.toContain('color-contrast');
      expect(rulesOf(await auditInView(pair))).toContain('color-contrast');
    });

    // A node the scroll cannot centre below the header would be scored only
    // where it shows, or not at all, and read as clean. The guard makes that
    // loud instead.
    it('refuses a node no scroll can bring into the band below the 64 px header', async () => {
      TestBed.configureTestingModule({ imports: [OutOfBandFixtureComponent] });
      const fixture = TestBed.createComponent(OutOfBandFixtureComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as Element;

      await expectAsync(auditInView(root.querySelector('.pinned') as HTMLElement))
        .withContext('pinned under the header')
        .toBeRejectedWithError(/outside the band .*64/);
      await expectAsync(auditInView(root.querySelector('.tall') as HTMLElement))
        .withContext('taller than the band')
        .toBeRejectedWithError(/outside the band .*64/);
    });
  });

  describe('either scheme', () => {
    const root = document.documentElement;

    beforeEach(() => {
      root.classList.remove('light-theme', 'dark-theme');
    });

    afterEach(() => {
      root.classList.remove('light-theme', 'dark-theme');
    });

    function renderDarkOnly(): { theme: ThemeService; host: Element } {
      TestBed.configureTestingModule({ imports: [DarkOnlyFixtureComponent] });
      const fixture = TestBed.createComponent(DarkOnlyFixtureComponent);
      fixture.detectChanges();
      return { theme: TestBed.inject(ThemeService), host: fixture.nativeElement as Element };
    }

    it('audits the light scheme and the dark one', () => {
      expect([...AUDIT_SCHEMES]).toEqual(['light', 'dark']);
    });

    it('reports a pair that fails only in the dark theme under the dark scheme alone', async () => {
      const { theme, host } = renderDarkOnly();

      const dark = await withScheme(theme, 'dark', () => {
        expect(theme.effectiveTheme())
          .withContext('forced through the service, not stamped on <html>')
          .toBe('dark');
        return runAxe(host);
      });
      const light = await withScheme(theme, 'light', () => {
        expect(theme.effectiveTheme()).toBe('light');
        return runAxe(host);
      });

      expect(rulesOf(dark)).toContain('color-contrast');
      expect(rulesOf(light)).not.toContain('color-contrast');
    });

    // The service stamps a class only when the effective theme changes, and
    // a restore puts back classes the service has no idea were taken off. A
    // spec's second pass, in the scheme the host resolves to, starts there.
    it('forces the scheme the service already resolves to, once its class has been taken off', async () => {
      const { theme, host } = renderDarkOnly();
      TestBed.tick();
      const resolved = theme.effectiveTheme();
      const other = resolved === 'dark' ? 'light' : 'dark';
      expect(root.classList.contains(`${resolved}-theme`))
        .withContext('the service stamped the host scheme')
        .toBeTrue();
      root.classList.remove('light-theme', 'dark-theme');

      await withScheme(theme, resolved, () => {
        expect(root.classList.contains(`${resolved}-theme`))
          .withContext(`${resolved}-theme`)
          .toBeTrue();
        expect(root.classList.contains(`${other}-theme`))
          .withContext(`${other}-theme`)
          .toBeFalse();
        return runAxe(host);
      });
    });

    // Forced to the scheme the host does not resolve to, so the restore to
    // 'system' changes the effective theme and the service stamps a class
    // again; only putting the classes back after that leaves none behind.
    function hostOpposite(theme: ThemeService): EffectiveTheme {
      return theme.effectiveTheme() === 'dark' ? 'light' : 'dark';
    }

    it('leaves neither theme class behind and the preference on system', async () => {
      const { theme, host } = renderDarkOnly();
      expect(theme.theme()).toBe('system');

      await withScheme(theme, hostOpposite(theme), () => runAxe(host));

      expect(root.classList.contains('dark-theme')).withContext('dark-theme').toBeFalse();
      expect(root.classList.contains('light-theme')).withContext('light-theme').toBeFalse();
      expect(theme.theme()).toBe('system');
    });

    it('restores the same way when the pass it wraps rejects', async () => {
      const { theme } = renderDarkOnly();
      const forced = hostOpposite(theme);

      const failingPass = (): Promise<AxeResults> => {
        expect(root.classList.contains(`${forced}-theme`))
          .withContext('forced while the pass runs')
          .toBeTrue();
        return Promise.reject(new Error('the pass failed'));
      };

      await expectAsync(withScheme(theme, forced, failingPass))
        .toBeRejectedWithError('the pass failed');

      expect(root.classList.contains('dark-theme')).withContext('dark-theme').toBeFalse();
      expect(root.classList.contains('light-theme')).withContext('light-theme').toBeFalse();
      expect(theme.theme()).toBe('system');
    });

    // A spec calls withScheme from outside the zone. Leaving the zone run the
    // effect flushes in asks the zone scheduler for a tick while the forced
    // one is still running; Angular refuses it and only logs the error, so a
    // spec stays green while every flip is reported as a recursive tick.
    it('flips a theme a rendered component reads without a recursive tick', () => {
      TestBed.configureTestingModule({ imports: [ThemeReaderFixtureComponent] });
      const fixture = TestBed.createComponent(ThemeReaderFixtureComponent);
      fixture.detectChanges();
      const theme = TestBed.inject(ThemeService);
      const errors = spyOn(console, 'error');

      for (const scheme of AUDIT_SCHEMES) {
        withScheme(theme, scheme, () => {
          expect(theme.effectiveTheme()).withContext(scheme).toBe(scheme);
        });
      }

      const recursive = errors.calls
        .allArgs()
        .map(args => args.map(String).join(' '))
        .filter(line => line.includes('NG0101'));
      expect(recursive).withContext('console.error lines naming NG0101').toEqual([]);
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
