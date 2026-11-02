import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { GoalProgressCardComponent } from './goal-progress-card.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { Goal } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import {
  accessibleName,
  catalogTranslationStub,
  catalogTranslator,
  channels,
  createLocaleFormatStub,
  createTranslationStub,
  expectPainted,
  inPalette,
  paintedBackground,
  paintedColor,
  PALETTES,
  provideNoMotion,
  ratio,
  settleAnimations,
  tokenValue,
  type TranslationStub,
  withTheme,
} from '../../../../core/services/testing';

function goalOf(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'user123',
    kind: 'saving',
    name: 'Emergency fund',
    targetAmount: 3000,
    contributedAmount: 750,
    currency: 'USD',
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  };
}

describe('GoalProgressCardComponent', () => {
  let fixture: ComponentFixture<GoalProgressCardComponent>;
  let component: GoalProgressCardComponent;

  function goal(overrides: Partial<Goal> = {}): Goal {
    return {
      id: 'g1',
      userId: 'user123',
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides
    };
  }

  beforeEach(async () => {
    const mockCurrency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrency.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount}`
    );

    await TestBed.configureTestingModule({
      imports: [GoalProgressCardComponent],
      providers: [{ provide: CurrencyService, useValue: mockCurrency }, provideNoMotion()],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalProgressCardComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(GoalProgressCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('goal', goal());
    fixture.detectChanges();
  });

  it('computes percentage, capped bar value, and remaining', () => {
    expect(component.percentage()).toBe(25);
    expect(component.barValue()).toBe(25);
    expect(component.remaining()).toBe(2250);
    expect(component.reached()).toBeFalse();
  });

  it('caps the bar at 100 but keeps the true percentage', () => {
    fixture.componentRef.setInput('goal', goal({ contributedAmount: 4500 }));
    fixture.detectChanges();

    expect(component.percentage()).toBe(150);
    expect(component.barValue()).toBe(100);
    expect(component.remaining()).toBe(0);
    expect(component.reached()).toBeTrue();
  });

  it('reads progress as manual plus linked, on every figure at once', () => {
    // 750 manual + 750 linked = 1500 of 3000: the percentage, the remaining
    // amount and the reached flag must all see the same total.
    fixture.componentRef.setInput('goal', goal({ linkedAmount: 750 }));
    fixture.detectChanges();

    expect(component.progressAmount()).toBe(1500);
    expect(component.percentage()).toBe(50);
    expect(component.remaining()).toBe(1500);
    expect(component.reached()).toBeFalse();
  });

  it('reaches the target on linked money alone', () => {
    fixture.componentRef.setInput('goal', goal({ contributedAmount: 0, linkedAmount: 3000 }));
    fixture.detectChanges();

    expect(component.reached()).toBeTrue();
    expect(component.remaining()).toBe(0);
  });

  it('exposes the linked share only when there is one', () => {
    expect(component.linkedAmount()).toBe(0); // pre-link document

    fixture.componentRef.setInput('goal', goal({ linkedAmount: 120 }));
    fixture.detectChanges();
    expect(component.linkedAmount()).toBe(120);
  });

  it('counts checked items for a project', () => {
    fixture.componentRef.setInput(
      'goal',
      goal({
        kind: 'project',
        items: [
          { name: 'Flights', amount: 800, done: true },
          { name: 'Hotel', amount: 1200, done: false }
        ]
      })
    );
    fixture.detectChanges();

    expect(component.doneCount()).toBe(1);
    expect(component.kindIcon()).toBe('flag');
  });

  it('emits viewTransactions when the button is activated', () => {
    let emitted = 0;
    component.viewTransactions.subscribe(() => emitted++);

    component.viewTransactions.emit();

    expect(emitted).toBe(1);
  });

  it('emits toggleItem with the item position and next state', () => {
    const emitted: { index: number; done: boolean }[] = [];
    component.toggleItem.subscribe(event => emitted.push(event));

    component.onItemToggled(1, true);

    expect(emitted).toEqual([{ index: 1, done: true }]);
  });
});

/**
 * The cases above override the template to `<div></div>`, so they prove the
 * computeds and nothing else: the four `@if` gates on the card (the target
 * date, the linked breakdown, the reached note, the checklist), the
 * "View transactions" button that only exists once linked money arrives, and
 * the five outputs each control emits are all unproven by them. This is the
 * card as a user meets it.
 */
describe('GoalProgressCardComponent, through its own template', () => {
  let fixture: ComponentFixture<GoalProgressCardComponent>;
  let component: GoalProgressCardComponent;
  let translation: TranslationStub;

  function card(overrides: Partial<Goal> = {}): void {
    fixture.componentRef.setInput('goal', goalOf(overrides));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const button = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  beforeEach(async () => {
    const mockCurrency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);
    translation = createTranslationStub();

    await TestBed.configureTestingModule({
      imports: [GoalProgressCardComponent],
      providers: [
        { provide: CurrencyService, useValue: mockCurrency },
        { provide: TranslationService, useValue: translation },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() },
        provideNoMotion()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GoalProgressCardComponent);
    component = fixture.componentInstance;
  });

  it('reads the goal on one line: contributed, target and percentage', () => {
    card();

    expect(text('.goal-name')).toBe('Emergency fund');
    expect(text('.contributed')).toBe('USD 750');
    expect(text('.target')).toBe('/ USD 3000');
    expect(text('.percentage')).toBe('25%');
    expect(text('.kind-icon')).toBe('savings');
  });

  it('carries a project goal\'s own icon', () => {
    card({ kind: 'project' });

    expect(text('.kind-icon')).toBe('flag');
  });

  it('shows the remaining amount until the goal is reached, then the note', () => {
    card();
    expect(text('.status')).toBe('goal.remaining:{"amount":"USD 2250"}');
    expect(el().querySelector('.reached-note')).toBeNull();
    expect(el().querySelector('.goal-card')?.classList).not.toContain('reached');

    card({ contributedAmount: 3000 });
    expect(text('.reached-note')).toContain('goal.reached');
    expect(el().querySelector('.goal-card')?.classList).toContain('reached');
  });

  it('clamps the bar while the number keeps the overshoot', () => {
    card({ contributedAmount: 4500 });

    const bar = el().querySelector('mat-progress-bar') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(text('.percentage')).toBe('150%');
  });

  it("names the progress bar with the goal's own name and percentage", () => {
    card();

    const bar = el().querySelector('mat-progress-bar') as HTMLElement;
    expect(bar.getAttribute('aria-label')).toBe('goals.progressLabel:{"name":"Emergency fund","percent":25}');
  });

  it('names the linked share and offers its transactions only once linked money exists', () => {
    card();
    expect(el().querySelector('.linked-breakdown')).toBeNull();
    expect(button('goal.viewTransactions')).toBeUndefined();

    card({ linkedAmount: 750 });
    expect(text('.linked-breakdown')).toBe(
      'goal.linkedBreakdown:{"manual":"USD 750","linked":"USD 750"}'
    );
    expect(button('goal.viewTransactions')).toBeDefined();
  });

  it('shows the target date only when the goal carries one', () => {
    card();
    expect(el().querySelector('.goal-date')).toBeNull();

    card({ targetDate: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')) });
    expect(text('.goal-date')).toContain('2026-12-01');
  });

  it('renders the checklist and reports its done count', () => {
    card({
      items: [
        { name: 'Deposit', amount: 100, done: true },
        { name: 'Transfer', amount: 200, done: false }
      ]
    });

    expect(text('.items-count')).toBe('goal.itemsDone:{"done":1,"total":2}');
    expect(
      Array.from(el().querySelectorAll('.item-label')).map(n => n.textContent?.trim())
    ).toEqual(['Deposit', 'Transfer']);
    expect(el().querySelectorAll('.item-label.done').length).toBe(1);
  });

  it('emits the item index and its new state when a checkbox is ticked', () => {
    const emitted: { index: number; done: boolean }[] = [];
    component.toggleItem.subscribe(e => emitted.push(e));
    card({
      items: [
        { name: 'Deposit', amount: 100, done: false },
        { name: 'Transfer', amount: 200, done: false }
      ]
    });

    const second = el().querySelectorAll('mat-checkbox input')[1] as HTMLInputElement;
    second.click();
    fixture.detectChanges();

    expect(emitted).toEqual([{ index: 1, done: true }]);
  });

  it('emits edit, delete and contribute from their own controls', () => {
    const seen: string[] = [];
    component.edit.subscribe(() => seen.push('edit'));
    component.delete.subscribe(() => seen.push('delete'));
    component.contribute.subscribe(() => seen.push('contribute'));
    card();

    const [edit, remove] = Array.from(el().querySelectorAll<HTMLButtonElement>('.goal-actions button'));
    edit.click();
    remove.click();
    button('goal.contribute')?.click();

    expect(seen).toEqual(['edit', 'delete', 'contribute']);
  });

  /**
   * The goals page stamps one card per goal, so each card's Edit and Delete
   * name the goal they act on, in the words the card's header shows. The
   * catalog stub goes in before the first render, so the pipe never caches
   * an echoed key.
   */
  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`names its Edit and Delete by the goal in ${locale}`, () => {
      const t = catalogTranslator(locale, { strict: true });
      Object.assign(translation, catalogTranslationStub(locale));
      card({ name: 'Japan trip' });

      expect(text('.goal-name')).toBe('Japan trip');
      expect(Array.from(el().querySelectorAll('.goal-actions button')).map(accessibleName)).toEqual([
        t('goal.editNamed', { name: 'Japan trip' }),
        t('goal.deleteNamed', { name: 'Japan trip' }),
      ]);
    });
  }

  it('shows the note only when the goal carries one', () => {
    card();
    expect(el().querySelector('.goal-note')).toBeNull();

    card({ note: 'Three months of expenses' });
    expect(text('.goal-note')).toBe('Three months of expenses');
  });

  // A token colour, not an opacity, so the high-contrast theme reaches it.
  it('strikes a done item through without fading it', () => {
    card({
      items: [
        { name: 'Deposit', amount: 100, done: true },
        { name: 'Transfer', amount: 200, done: false }
      ]
    });

    const done = el().querySelector<HTMLElement>('.item-label.done')!;
    expect(getComputedStyle(done).textDecorationLine).toBe('line-through');
    expect(getComputedStyle(done).opacity).toBe('1');
  });

  /**
   * #533: a secondary line rests in the muted token, not a fade. A fade
   * lowers a line against whatever it sits on, and the high-contrast palette
   * deepens the token but can never reach an opacity. The card is filled so
   * every faded line renders at once: the target date and its glyph, the
   * target, the linked share, the remaining amount, the checklist count, an
   * item's amount and the note.
   */
  it('rests every secondary line in the muted token, at AA on the card, in all four palettes', () => {
    card({
      targetDate: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')),
      linkedAmount: 250,
      items: [{ name: 'Deposit', amount: 100, done: false }],
      note: 'Three months of expenses',
    });
    const lines = [
      '.goal-date',
      '.goal-date mat-icon',
      '.target',
      '.linked-breakdown',
      '.status',
      '.items-count',
      '.item-amount',
      '.goal-note',
    ];
    const muted = new Map<string, string>();

    for (const palette of PALETTES) {
      inPalette(palette.classes, () => {
        muted.set(palette.name, tokenValue('--text-muted'));
        expect(paintedBackground(el().querySelector('.goal-card')!))
          .withContext(`${palette.name} card`)
          .toEqual(channels(tokenValue('--mat-sys-surface-container-low')).rgb);
        for (const selector of lines) {
          const node = el().querySelector(selector);
          const label = `${palette.name} ${selector}`;
          expect(node ? getComputedStyle(node).opacity : null).withContext(`${label} opacity`).toBe('1');
          expectPainted(node, '--text-muted', label);
        }
      });
    }

    // Four palettes prove four things only while high contrast moves the token.
    expect(muted.get('high contrast')).withContext('light high contrast').not.toBe(muted.get('plain'));
    expect(muted.get('dark high contrast')).withContext('dark high contrast').not.toBe(muted.get('dark'));
  });

  // The reached note is the card's good news, so it speaks in the card's own
  // colour rather than the muted one its `.status` class would give it.
  it('lets the reached note keep the card\'s own colour, unfaded and at AA, in all four palettes', () => {
    card({ contributedAmount: 3000 });
    const note = el().querySelector<HTMLElement>('.status.reached-note');
    expect(note).withContext('the reached note renders').not.toBeNull();
    if (!note) return;

    for (const palette of PALETTES) {
      inPalette(palette.classes, () => {
        settleAnimations(document);
        expect(getComputedStyle(note).opacity).withContext(`${palette.name} opacity`).toBe('1');
        expect(getComputedStyle(note).color)
          .withContext(`${palette.name} colour`)
          .toBe(getComputedStyle(note.parentElement!).color);
        expect(ratio(paintedColor(note), paintedBackground(note)))
          .withContext(`${palette.name} on the card`)
          .toBeGreaterThanOrEqual(4.5);
      });
    }
  });

  // Material paints the indicator as the inner bar's top border, from
  // --mat-progress-bar-active-indicator-color alone. It is a graphic, so its
  // floor is 3:1 (WCAG 1.4.11), against the track it runs along and the card
  // around it.
  it("draws a reached goal's bar apart from one in progress, at 3:1 or better on its track and the card, in both themes", () => {
    const part = (selector: string) => el().querySelector<HTMLElement>(selector)!;
    const tokenValue = (name: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      document.body.appendChild(probe);
      try {
        return getComputedStyle(probe).color;
      } finally {
        probe.remove();
      }
    };
    const states = [
      { name: 'in progress', contributedAmount: 750, token: '--mat-sys-primary' },
      { name: 'reached', contributedAmount: 3000, token: '--color-success-text' },
    ];

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        const painted = new Map<string, string>();
        for (const state of states) {
          card({ contributedAmount: state.contributedAmount });
          settleAnimations(document);
          const label = `${theme} ${state.name} bar`;
          const indicator = getComputedStyle(part('.mdc-linear-progress__bar-inner')).borderTopColor;
          painted.set(state.name, indicator);
          expect(indicator).withContext(label).toBe(tokenValue(state.token));
          expect(ratio(channels(indicator).rgb, paintedBackground(part('.mdc-linear-progress__buffer-bar'))))
            .withContext(`${label} on its track`)
            .toBeGreaterThanOrEqual(3);
          expect(ratio(channels(indicator).rgb, paintedBackground(part('.goal-card'))))
            .withContext(`${label} on the card`)
            .toBeGreaterThanOrEqual(3);
        }
        expect(painted.get('reached'))
          .withContext(`${theme} a reached bar paints apart from one in progress`)
          .not.toBe(painted.get('in progress'));
      });
    }
  });

  // A glyph is a graphic, so its floor is 3:1 (WCAG 1.4.11).
  it("paints the kind icon in the theme's primary, at 3:1 or better on the card, in both themes", () => {
    card();
    const icon = el().querySelector<HTMLElement>('.kind-icon')!;
    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--mat-sys-primary)';
        document.body.appendChild(probe);
        try {
          settleAnimations(document);
          expect(getComputedStyle(icon).color).withContext(theme).toBe(getComputedStyle(probe).color);
        } finally {
          probe.remove();
        }
        expect(ratio(paintedColor(icon), paintedBackground(icon)))
          .withContext(`${theme} on the card`)
          .toBeGreaterThanOrEqual(3);
      });
    }
  });
});
