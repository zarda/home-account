import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { InsightChipsComponent } from './insight-chips.component';
import { InsightChip, InsightChipsService } from '../../../core/services/insight-chips.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TransactionFilters } from '../../../models';
import {
  hoverValue,
  paintedBackground,
  paintedColor,
  ratio,
  settleAnimations,
  withTheme,
} from '../../../core/services/testing';

describe('InsightChipsComponent', () => {
  let fixture: ComponentFixture<InsightChipsComponent>;
  let component: InsightChipsComponent;
  let chipsSignal: ReturnType<typeof signal<InsightChip[]>>;
  let mockChipsService: {
    chips: ReturnType<typeof signal<InsightChip[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    load: jasmine.Spy;
  };

  const chip = (overrides: Partial<InsightChip> = {}): InsightChip => ({
    id: 'anomaly:food',
    kind: 'anomaly',
    labelKey: 'transactions.chipUnusual',
    labelParams: { category: 'Food' },
    icon: 'trending_up',
    filters: { type: 'expense', categoryId: 'food' },
    ...overrides,
  });

  beforeEach(async () => {
    chipsSignal = signal<InsightChip[]>([]);
    mockChipsService = {
      chips: chipsSignal,
      isLoading: signal(false),
      load: jasmine.createSpy('load'),
    };

    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake(
      (key: string, params?: Record<string, string | number>) =>
        params ? `${key}:${Object.values(params).join(',')}` : key);

    await TestBed.configureTestingModule({
      imports: [InsightChipsComponent],
      providers: [{ provide: TranslationService, useValue: mockTranslationService }],
    })
      .overrideComponent(InsightChipsComponent, {
        set: { providers: [{ provide: InsightChipsService, useValue: mockChipsService }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(InsightChipsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads chips on init', () => {
    expect(mockChipsService.load).toHaveBeenCalled();
  });

  it('renders nothing when there are no chips', () => {
    expect(fixture.nativeElement.querySelector('.insight-chips')).toBeNull();
  });

  it('renders one button per chip with a translated label', () => {
    chipsSignal.set([chip(), chip({ id: 'top:pets', kind: 'topCategory', labelParams: { category: 'Pets' } })]);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.insight-chip');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain('transactions.chipUnusual:Food');
  });

  it('labels the chip row for assistive technology', () => {
    chipsSignal.set([chip()]);
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.insight-chips');
    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBe('transactions.insightChipsLabel');
  });

  it('emits a fresh copy of the chip filters on click', () => {
    const source = chip();
    chipsSignal.set([source]);
    fixture.detectChanges();

    let emitted: TransactionFilters | undefined;
    component.chipSelected.subscribe(f => (emitted = f));
    fixture.nativeElement.querySelector('.insight-chip').click();

    expect(emitted).toEqual(source.filters);
    expect(emitted).not.toBe(source.filters);
  });

  it('gives the chip strip a gutter for its kept scrollbar', () => {
    chipsSignal.set([chip()]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);

    const strip = host.querySelector('.insight-chips') as HTMLElement;
    expect(getComputedStyle(strip).paddingBlockEnd)
      .withContext('.insight-chips: padding-block-end — the gutter the kept scrollbar is drawn in')
      .toBe('12px');

    host.remove();
  });

  describe('colours', () => {
    /** What `color: var(token)` computes to under the theme on <html> now. */
    function tokenColour(token: string): string {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.appendChild(probe);
      try {
        settleAnimations(document);
        return getComputedStyle(probe).color;
      } finally {
        probe.remove();
      }
    }

    function renderChip(): HTMLElement {
      chipsSignal.set([chip()]);
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.insight-chip') as HTMLElement;
    }

    it('paints the label in --text-muted at AA and the border in --border-primary, in both themes', () => {
      const button = renderChip();
      const label = button.querySelector('span') as HTMLElement;

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          // The chip carries `transition: all`, which would hold the other
          // theme's colours for as long as the spec runs.
          settleAnimations(document);
          expect(getComputedStyle(label).color).withContext(`${theme} label`).toBe(tokenColour('--text-muted'));
          expect(ratio(paintedColor(label), paintedBackground(label)))
            .withContext(`${theme} label on the chip`)
            .toBeGreaterThanOrEqual(4.5);
          expect(getComputedStyle(button).borderBlockStartColor)
            .withContext(`${theme} border`)
            .toBe(tokenColour('--border-primary'));
        });
      }
    });

    it('strengthens the border on hover to --border-strong, in both themes', () => {
      const button = renderChip();

      for (const theme of ['light', 'dark'] as const) {
        withTheme(theme, () => {
          try {
            button.style.borderColor = hoverValue(button, '.insight-chip', 'border-color');
            settleAnimations(document);
            expect(getComputedStyle(button).borderBlockStartColor)
              .withContext(`${theme} hovered border`)
              .toBe(tokenColour('--border-strong'));
          } finally {
            button.style.removeProperty('border-color');
          }
        });
      }
    });
  });
});
