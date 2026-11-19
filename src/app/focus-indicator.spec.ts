import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepicker } from '@angular/material/datepicker';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { provideAppDialogs } from './core/config/dialog.config';
import { TranslationService } from './core/services/translation.service';
import { DialogHeaderComponent } from './shared/components/dialog-header/dialog-header.component';
import { PeriodSelectorComponent } from './shared/components/period-selector/period-selector.component';
import {
  createTranslationStub,
  expectIndicatorInEveryPalette,
  expectOneRule,
  provideNoMotion,
  readIndicator,
  selectorsOf,
  styleRules,
} from './core/services/testing';

/**
 * The focus indicator a keyboard-focused Material button shows, of every kind:
 * text, flat, stroked, raised, tonal, icon and the FAB (styles.scss).
 *
 * It is Material's own indicator, the `::before` of the `.mat-focus-indicator`
 * span inside each button, which the app turns on, draws in the button's own
 * text colour, 2px wide (3px under high contrast), and keeps inside the
 * button. The text colour is what the button's label or glyph is already read
 * in against what it sits on, so the indicator reads wherever the button
 * does; no one colour does that on every surface a button sits on. Inside,
 * because Material draws it a few px past the edge of a flat, raised,
 * stroked or tonal button and the FAB, where the label's colour meets the
 * page instead of the fill, and a parent that clips its overflow cuts a line
 * out there off. A held button, disabled but kept focusable, draws it in
 * --mat-sys-on-surface-variant, as its label is read at 38%.
 *
 * A scripted focus is no reliable :focus-visible, so nothing here focuses a
 * button. The rules are read from the CSSOM, and the indicator off its
 * `::before`, by `readIndicator` (testing/focus-indicator.ts), which says how.
 */

/** A selector's specificity as [ids, classes, types]. */
function specificityOf(selector: string): [number, number, number] {
  if (selector.includes('(')) {
    throw new Error(`focus-indicator: ${selector} holds a functional pseudo-class, which this count does not weigh`);
  }
  const pseudoElements = selector.match(/::[\w-]+/g) ?? [];
  const rest = selector.replace(/::[\w-]+/g, '');
  const ids = rest.match(/#[\w-]+/g) ?? [];
  const classes = rest.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? [];
  const types = rest.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ').match(/[a-z][\w-]*/gi) ?? [];
  return [ids.length, classes.length, types.length + pseudoElements.length];
}

/** Whether specificity `a` outranks `b`. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * The rules of the document's sheets with `selector` in their list that
 * declare `prop`: outside any media query, or under the one whose condition
 * holds `media`.
 */
function declaring(selector: string, prop: string, media: string | null = null): CSSStyleRule[] {
  return styleRules()
    .filter(({ media: condition }) => (media === null ? condition === null : !!condition?.includes(media)))
    .map(({ rule }) => rule)
    .filter(rule => selectorsOf(rule.selectorText).includes(selector) && rule.style.getPropertyValue(prop) !== '');
}

/**
 * The surfaces a button sits on, each painted with the tokens of the screen
 * it stands for: a card, the page, and the suffix of an outlined field
 * (every field in the app is one). Every button kind stands on the card,
 * held ones included. The period selector is the real one, with a month
 * chosen: the chip and the filled picker button. The save-search pill, the
 * search suggestions and the pinned pin of an expanded history row are
 * measured on their own templates, in transaction-filters.component.spec.ts
 * and search-answer-history.component.spec.ts.
 */
@Component({
  selector: 'app-focus-surfaces-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, PeriodSelectorComponent],
  template: `
    <div class="card">
      <button mat-icon-button type="button" data-case="icon-on-card" aria-label="Edit">
        <mat-icon>edit</mat-icon>
      </button>
      <button mat-flat-button type="button" data-case="flat">Save</button>
      <button mat-button type="button" data-case="text">Cancel</button>
      <button mat-stroked-button type="button" data-case="stroked">Browse</button>
      <button mat-raised-button type="button" data-case="raised">Donate</button>
      <button mat-fab type="button" data-case="fab" aria-label="Add a transaction">
        <mat-icon>add</mat-icon>
      </button>
      <button mat-mini-fab type="button" data-case="mini-fab" aria-label="Add">
        <mat-icon>add</mat-icon>
      </button>
      <button mat-stroked-button type="button" data-case="held-stroked" [disabled]="true" disabledInteractive>
        Share with…
      </button>
      <button mat-flat-button type="button" data-case="held-flat" [disabled]="true" disabledInteractive>
        Continue
      </button>
      <button mat-button type="button" data-case="held-text" [disabled]="true" disabledInteractive>
        Translate
      </button>
      <mat-form-field appearance="outline">
        <mat-label>API key</mat-label>
        <input matInput type="password" value="key">
        <button mat-icon-button matSuffix type="button" data-case="suffix" aria-label="Remove the API key">
          <mat-icon>close</mat-icon>
        </button>
      </mat-form-field>
    </div>
    <div class="page">
      <button mat-icon-button type="button" data-case="icon-on-page" aria-label="Back">
        <mat-icon>arrow_back</mat-icon>
      </button>
      <app-period-selector />
    </div>
  `,
  styles: `
    .card,
    .page {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      padding: 16px;
    }

    .card {
      background: var(--surface-card);
    }

    .page {
      background: var(--surface-background);
    }
  `,
})
class FocusSurfacesHostComponent {}

/** A dialog drawn with the shared header alone. */
@Component({
  selector: 'app-focus-headered-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogHeaderComponent, MatDialogModule],
  template: `
    <app-dialog-header [titleKey]="data.titleKey" />
    <mat-dialog-content></mat-dialog-content>
  `,
})
class FocusHeaderedDialogComponent {
  readonly data = inject<{ titleKey: string }>(MAT_DIALOG_DATA);
}

/** Each button on the host, by its `data-case`, and what a failure calls it. */
const CASES: readonly (readonly [dataCase: string, label: string])[] = [
  ['icon-on-card', 'an icon button on a card'],
  ['icon-on-page', 'an icon button on the page'],
  ['suffix', "an icon button in a form field's suffix"],
  ['flat', 'a flat button, on its own fill'],
  ['text', 'a text button'],
  ['stroked', 'a stroked button'],
  ['raised', 'a raised button, on its own fill'],
  ['fab', 'the FAB, on its own fill'],
  ['mini-fab', 'the mini FAB, on its own fill'],
];

/**
 * The held buttons on the host, by their `data-case`: disabled, and kept
 * focusable (disabledInteractive) so a keyboard user reaches them and the
 * hint that says why they are held. Material reads their label at 38% of
 * --mat-sys-on-surface, which an indicator in that colour would share.
 */
const HELD_CASES: readonly (readonly [dataCase: string, label: string])[] = [
  ['held-stroked', 'a held stroked button (Share with…, Stop sharing)'],
  ['held-flat', "a held flat button, on its own fill (the wizard's Continue)"],
  ['held-text', 'a held text button (Translate, Retry)'],
];

/** The kinds whose indicator Material draws outside the button, by the class it keys the margin on. */
const OUTSET_KINDS = [
  'mat-mdc-unelevated-button',
  'mat-mdc-raised-button',
  'mat-mdc-outlined-button',
  'mat-tonal-button',
];

describe('the focus indicator of a Material button', () => {
  let fixture: ComponentFixture<FocusSurfacesHostComponent>;
  let host: HTMLElement;
  let opened: MatDialogRef<FocusHeaderedDialogComponent> | undefined;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FocusSurfacesHostComponent, FocusHeaderedDialogComponent],
      providers: [
        provideAppDialogs(),
        provideNoMotion(),
        provideNativeDateAdapter(),
        { provide: TranslationService, useValue: { ...createTranslationStub(), getIntlLocale: () => 'en-US' } },
      ],
    });
    fixture = TestBed.createComponent(FocusSurfacesHostComponent);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    // A month chosen: the chip shows with its clear button, and the picker button is filled.
    const selector = fixture.debugElement.query(By.directive(PeriodSelectorComponent))
      .componentInstance as PeriodSelectorComponent;
    selector.onMonthSelected(new Date(2026, 2, 15), { close: () => undefined } as unknown as MatDatepicker<Date>);
    fixture.detectChanges();
  });

  afterEach(async () => {
    const ref = opened;
    opened = undefined;
    if (ref) {
      const closed = firstValueFrom(ref.afterClosed());
      ref.close();
      TestBed.tick();
      await closed;
    }
    fixture.destroy();
  });

  describe('from the stylesheet', () => {
    it('shows it on every Material button, in the text colour, 2px wide', () => {
      const rules = declaring('.mat-mdc-button-base', '--mat-focus-indicator-display');
      expectOneRule(rules);
      const read = (prop: string) => rules[0]?.style.getPropertyValue(prop).trim();
      expect(read('--mat-focus-indicator-display')).withContext('shown').toBe('block');
      expect(read('--mat-focus-indicator-border-color')?.toLowerCase())
        .withContext('in the text colour')
        .toBe('currentcolor');
      expect(read('--mat-focus-indicator-border-width')).withContext('2px wide').toBe('2px');
    });

    it('widens it to 3px under high contrast', () => {
      const rules = declaring('.high-contrast .mat-mdc-button-base', '--mat-focus-indicator-border-width');
      expectOneRule(rules);
      expect(rules[0]?.style.getPropertyValue('--mat-focus-indicator-border-width').trim()).toBe('3px');
    });

    it("lays no focus state layer under an icon button's indicator", () => {
      const rules = declaring('.mat-mdc-icon-button', '--mat-icon-button-focus-state-layer-opacity');
      expectOneRule(rules);
      expect(rules[0]?.style.getPropertyValue('--mat-icon-button-focus-state-layer-opacity').trim()).toBe('0');
    });

    it("clears the app's own outline from a focused button at (0,2,0), and leaves forced colours Material's", () => {
      const app = declaring(':focus-visible', 'outline-offset');
      expectOneRule(app);
      const cleared = declaring('.mat-mdc-button-base:focus-visible', 'outline-style', 'forced-colors: none');
      expectOneRule(cleared);
      expect(cleared[0]?.style.getPropertyValue('outline-style')).withContext('no outline').toBe('none');
      expect(specificityOf('.mat-mdc-button-base:focus-visible')).toEqual([0, 2, 0]);
      expect(outranks(specificityOf('.mat-mdc-button-base:focus-visible'), specificityOf(':focus-visible')))
        .withContext("over the app's own outline, whichever sheet comes first")
        .toBeTrue();
      // Every copy, whatever query it sits under: one under (forced-colors:
      // active), or under a query that holds there too, would clear the
      // outline Material draws in forced colours.
      const copies = styleRules().filter(
        ({ rule }) =>
          selectorsOf(rule.selectorText).includes('.mat-mdc-button-base:focus-visible') &&
          rule.style.getPropertyValue('outline-style') !== ''
      );
      expect(
        copies
          .filter(({ media }) => !media?.includes('forced-colors: none'))
          .map(({ media, rule }) => `${media ?? 'no query'}: ${rule.cssText}`)
      )
        .withContext("no copy outside (forced-colors: none), so forced colours keeps Material's outline")
        .toEqual([]);
    });

    for (const kind of OUTSET_KINDS) {
      it(`pulls a ${kind}'s indicator inside it at (0,3,1), over Material's own margin`, () => {
        const ours = `.mat-mdc-button-base.${kind} .mat-focus-indicator::before`;
        const rules = declaring(ours, 'margin');
        expectOneRule(rules);
        expect(rules[0]?.style.getPropertyValue('margin')).toBe('0px');
        expect(specificityOf(ours)).toEqual([0, 3, 1]);
        expectToOutrankMaterial(ours, kind, 'margin');
      });
    }

    it("pulls the FAB's indicator inside it at (0,3,1), on the FAB's own corner", () => {
      const fab = '.mat-mdc-button-base.mat-mdc-fab-base .mat-focus-indicator::before';
      const rules = declaring(fab, 'margin');
      expectOneRule(rules);
      expect(rules[0]?.style.getPropertyValue('margin')).toBe('0px');
      expect(rules[0]?.style.getPropertyValue('border-radius'))
        .toBe('var(--mat-fab-container-shape, var(--mat-sys-corner-large))');
      expect(specificityOf(fab)).toEqual([0, 3, 1]);
      expectToOutrankMaterial(fab, 'mat-mdc-fab-base', 'margin');
      expectToOutrankMaterial(fab, 'mat-mdc-fab-base', 'border-radius');

      const mini = '.mat-mdc-button-base.mat-mdc-mini-fab .mat-focus-indicator::before';
      const small = declaring(mini, 'border-radius');
      expectOneRule(small);
      expect(small[0]?.style.getPropertyValue('border-radius'))
        .toBe('var(--mat-fab-small-container-shape, var(--mat-sys-corner-medium))');
      expect(specificityOf(mini)).toEqual([0, 3, 1]);
      expectToOutrankMaterial(mini, 'mat-mdc-mini-fab', 'border-radius');
    });

    /**
     * Material's own rules that set `prop` on `kind`'s indicator are there,
     * and `ours` outranks each: a later Material that raised its own would
     * take the indicator back outside, or off the FAB's corner.
     */
    function expectToOutrankMaterial(ours: string, kind: string, prop: 'margin' | 'border-radius'): void {
      const theirs = styleRules().flatMap(({ rule }) =>
        rule.style.getPropertyValue(prop) === ''
          ? []
          : selectorsOf(rule.selectorText).filter(
              selector =>
                selector.endsWith(' .mat-focus-indicator::before') &&
                selector.includes(`.${kind}`) &&
                !selector.includes('.mat-mdc-button-base')
            )
      );
      expect(theirs.length).withContext(`Material's own ${prop} for ${kind}`).toBeGreaterThan(0);
      for (const selector of theirs) {
        expect(outranks(specificityOf(ours), specificityOf(selector))).withContext(`over ${selector}`).toBeTrue();
      }
    }
  });

  describe('rendered, in every palette', () => {
    for (const [dataCase, label] of CASES) {
      it(`${label}: inside, in its own text colour, 3:1 or better on what it is drawn over`, () => {
        expectIndicatorInEveryPalette(host.querySelector<HTMLElement>(`[data-case="${dataCase}"]`), label);
      });
    }

    for (const [dataCase, label] of HELD_CASES) {
      it(`${label}: inside, in --mat-sys-on-surface-variant, 3:1 or better on what it is drawn over`, () => {
        const button = host.querySelector<HTMLButtonElement>(`[data-case="${dataCase}"]`);
        expect(button?.getAttribute('aria-disabled')).withContext(`${label}: held`).toBe('true');
        expect(button?.disabled).withContext(`${label}: kept focusable, not natively disabled`).toBeFalse();
        expectIndicatorInEveryPalette(button, label, '--mat-sys-on-surface-variant');
      });
    }

    it("the FAB's indicator follows the FAB's own corner", () => {
      const fab = host.querySelector('[data-case="fab"]') as HTMLElement;
      expect(readIndicator(fab).corner).toBe(getComputedStyle(fab).borderTopLeftRadius);
    });

    // The FAB's rule and the mini FAB's share a specificity and both match a
    // mini FAB, so only their order in the sheet gives it the smaller corner.
    it("the mini FAB's indicator follows the mini FAB's own corner, not the FAB's", () => {
      const mini = host.querySelector('[data-case="mini-fab"]') as HTMLElement;
      const fab = host.querySelector('[data-case="fab"]') as HTMLElement;
      const corner = getComputedStyle(mini).borderTopLeftRadius;
      expect(corner)
        .withContext("the mini FAB's corner, apart from the FAB's")
        .not.toBe(getComputedStyle(fab).borderTopLeftRadius);
      expect(readIndicator(mini).corner).toBe(corner);
    });

    it('the clear button on the period chip: inside, in its own text colour, 3:1 or better on the chip', () => {
      expectIndicatorInEveryPalette(
        host.querySelector<HTMLElement>('app-period-selector .period-chip .clear-btn'),
        'the clear button on the period chip'
      );
    });

    it('the period picker button while a month is chosen: inside, in its own text colour, 3:1 or better on its fill', () => {
      const picker = host.querySelector<HTMLElement>('app-period-selector .picker-btn');
      expect(picker?.classList.contains('active')).withContext('the picker is filled').toBeTrue();
      expectIndicatorInEveryPalette(picker, 'the filled period picker button');
    });

    it("the close button of a dialog's header: inside, in its own text colour, 3:1 or better on the dialog", async () => {
      const ref = TestBed.inject(MatDialog).open(FocusHeaderedDialogComponent, { data: { titleKey: 'common.edit' } });
      opened = ref;
      TestBed.tick();
      await firstValueFrom(ref.afterOpened());
      TestBed.tick();
      const container = document.getElementById(ref.id);
      expectIndicatorInEveryPalette(
        container?.querySelector<HTMLElement>('.dialog-header-close') ?? null,
        "the close button of a dialog's header"
      );
    });
  });
});

/**
 * Stroked buttons 100px wide, each in a box 4px narrower that cuts it off
 * one way, and one in a box with room to spare: what `readIndicator` names
 * as cutting the indicator off.
 */
@Component({
  selector: 'app-focus-cut-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  template: `
    <div class="narrow by-overflow"><button mat-stroked-button type="button" data-case="overflow">Cut</button></div>
    <div class="narrow by-clip-path"><button mat-stroked-button type="button" data-case="clip-path">Cut</button></div>
    <div class="narrow by-paint"><button mat-stroked-button type="button" data-case="paint">Cut</button></div>
    <div class="roomy"><button mat-stroked-button type="button" data-case="roomy">Whole</button></div>
  `,
  styles: `
    div {
      display: block;
      padding: 0;
      margin-block-end: 16px;
    }

    button {
      width: 100px;
    }

    .narrow {
      width: 96px;
    }

    .by-overflow,
    .roomy {
      overflow: hidden;
    }

    .by-clip-path {
      clip-path: inset(0);
    }

    .by-paint {
      contain: paint;
    }

    .roomy {
      width: 200px;
    }
  `,
})
class FocusCutHostComponent {}

describe('what readIndicator reads', () => {
  let fixture: ComponentFixture<FocusCutHostComponent>;
  let host: HTMLElement;
  const button = (dataCase: string) => host.querySelector(`[data-case="${dataCase}"]`) as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FocusCutHostComponent], providers: [provideNoMotion()] });
    fixture = TestBed.createComponent(FocusCutHostComponent);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => fixture.destroy());

  it('names a box whose overflow cuts the indicator off', () => {
    expect(readIndicator(button('overflow')).clippedBy).toEqual(['div.narrow.by-overflow']);
  });

  it('names a box whose clip-path cuts the indicator off', () => {
    expect(readIndicator(button('clip-path')).clippedBy).toEqual(['div.narrow.by-clip-path']);
  });

  it('names a box whose paint containment cuts the indicator off', () => {
    expect(readIndicator(button('paint')).clippedBy).toEqual(['div.narrow.by-paint']);
  });

  it('names nothing where the box that clips its overflow holds the indicator', () => {
    expect(readIndicator(button('roomy')).clippedBy).toEqual([]);
  });

  it("leaves a button that already showed Material's keyboard focus showing it", () => {
    const focused = button('roomy');
    focused.classList.add('cdk-keyboard-focused');
    readIndicator(focused);
    expect(focused.classList.contains('cdk-keyboard-focused')).withContext('after the reading').toBeTrue();
  });

  it("leaves a button that did not show Material's keyboard focus without it", () => {
    const plain = button('roomy');
    readIndicator(plain);
    expect(plain.classList.contains('cdk-keyboard-focused')).withContext('after the reading').toBeFalse();
  });
});
