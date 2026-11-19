import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDatepicker, MatDatepickerInput } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import {
  PeriodSelectorComponent,
  PeriodSelection,
  defaultPeriodSelection,
} from './period-selector.component';
import { INTL_LOCALES, TranslationService } from '../../../core/services/translation.service';
import { accessibleName, catalogTranslator, holdsShownWords, provideNoMotion } from '../../../core/services/testing';

describe('PeriodSelectorComponent', () => {
  let fixture: ComponentFixture<PeriodSelectorComponent>;
  let component: PeriodSelectorComponent;
  let emitted: PeriodSelection[];

  const fakePicker = { close: jasmine.createSpy('close') } as unknown as MatDatepicker<Date>;

  beforeEach(async () => {
    const translation = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    translation.t.and.callFake((key: string) => key);
    translation.getIntlLocale.and.returnValue('en-US');

    await TestBed.configureTestingModule({
      imports: [PeriodSelectorComponent],
      providers: [
        provideNoMotion(),
        provideNativeDateAdapter(),
        { provide: TranslationService, useValue: translation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PeriodSelectorComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.selectionChange.subscribe((s: PeriodSelection) => emitted.push(s));
    fixture.detectChanges();
  });

  it('defaultPeriodSelection covers the current calendar month', () => {
    const sel = defaultPeriodSelection();
    const now = new Date();
    expect(sel.option).toBe('thisMonth');
    expect(sel.start.getDate()).toBe(1);
    expect(sel.start.getMonth()).toBe(now.getMonth());
    expect(sel.end.getMonth()).toBe(now.getMonth());
    // The last millisecond, not 23:59:59 — the bound has to be inclusive of a
    // transaction posted in the final second of the month.
    expect(sel.end.getTime()).toBe(
      new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime());
  });

  it('does not emit on init — parents seed from defaultPeriodSelection()', () => {
    expect(emitted).toEqual([]);
  });

  // A radio group is entered by its name, so a reader hears that the quick
  // ranges choose a period before the first of them.
  it('names its quick-range group (real template)', () => {
    const group = (fixture.nativeElement as HTMLElement).querySelector('.period-toggle') as HTMLElement;

    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(accessibleName(group)).toBe('dashboard.period');
  });

  it('emits calendar bounds when a quick range is chosen', () => {
    component.onToggleChange('lastMonth');

    expect(emitted.length).toBe(1);
    const sel = emitted[0];
    const now = new Date();
    const expectedStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    expect(sel.option).toBe('lastMonth');
    expect(sel.start.getTime()).toBe(expectedStart.getTime());
    expect(sel.end.getMonth()).toBe(expectedStart.getMonth());
    expect(sel.end.getMilliseconds()).toBe(999);
    expect(sel.label).toBe('');
  });

  it('emits a custom month with a localized label', () => {
    component.onMonthSelected(new Date(2026, 2, 15), fakePicker);

    expect(fakePicker.close).toHaveBeenCalled();
    const sel = emitted[0];
    expect(sel.option).toBe('custom');
    expect(sel.start.getTime()).toBe(new Date(2026, 2, 1).getTime());
    expect(sel.end.getDate()).toBe(31);
    expect(sel.label).toContain('2026');
    expect(sel.label).toContain('Mar');
    expect(component.isCustomPeriod()).toBeTrue();
  });

  it('emits a custom year spanning the full year', () => {
    component.onYearSelected(new Date(2025, 6, 1), fakePicker);

    const sel = emitted[0];
    expect(sel.start.getTime()).toBe(new Date(2025, 0, 1).getTime());
    expect(sel.end.getFullYear()).toBe(2025);
    expect(sel.end.getMonth()).toBe(11);
    expect(sel.label).toBe('2025');
  });

  it('clearing the custom period returns to This Month and emits', () => {
    component.onMonthSelected(new Date(2026, 2, 15), fakePicker);
    component.clearCustomPeriod();

    expect(emitted.length).toBe(2);
    expect(emitted[1].option).toBe('thisMonth');
    expect(component.isCustomPeriod()).toBeFalse();
    expect(component.customPeriodLabel()).toBe('');
  });

  /**
   * A chosen month or year shows as a chip whose button clears it and returns
   * to the toggle. It closes nothing, so it is named for what it clears: the
   * chip's own words, whole, inside a name that says it clears them.
   */
  describe("the chip's clear button (real template)", () => {
    const pinned = {
      en: { month: 'Clear Oct 2026', year: 'Clear 2025' },
      ja: { month: '2026年10月をクリア', year: '2025年をクリア' },
      tc: { month: '清除 2026年10月', year: '清除 2025年' },
    } as const;

    for (const locale of ['en', 'ja', 'tc'] as const) {
      it(`names the clear for the period it clears, in ${locale}`, () => {
        const translation = TestBed.inject(TranslationService) as jasmine.SpyObj<TranslationService>;
        translation.t.and.callFake(catalogTranslator(locale));
        translation.getIntlLocale.and.returnValue(INTL_LOCALES[locale]);
        const t = catalogTranslator(locale);

        const read = (chosen: 'month' | 'year') => {
          fixture.detectChanges();
          const chip = (fixture.nativeElement as HTMLElement).querySelector('.period-chip');
          const clear = chip?.querySelector<HTMLButtonElement>('.clear-btn') ?? null;
          expect(clear).withContext(`the clear on the ${chosen}'s chip`).not.toBeNull();
          const shown = chip!.querySelector('span')!.textContent!.trim();
          expect(shown).withContext(`the ${chosen}'s chip shows its period`).toBe(component.customPeriodLabel());
          const name = accessibleName(clear!);
          expect(holdsShownWords(name, shown, locale))
            .withContext(`"${name}" holds the chip's words, "${shown}", whole`)
            .toBeTrue();
          expect(name).withContext(`"${name}" closes nothing`).not.toBe(t('common.close'));
          expect(name).withContext(`the ${chosen}, pinned`).toBe(pinned[locale][chosen]);
          expect(name).toBe(catalogTranslator(locale, { strict: true })('dashboard.clearPeriod', { period: shown }));
        };

        component.onMonthSelected(new Date(2026, 9, 15), fakePicker);
        read('month');
        component.onYearSelected(new Date(2025, 6, 1), fakePicker);
        read('year');
      });
    }

    /**
     * The chip leaves with the period it shows, and the clear with it, so
     * focus on the clear would fall to the page and a keyboard or screen
     * reader user would start again from the top. It goes to the quick range
     * the period returns to, This Month, checked.
     */
    describe('where focus goes once the chip has gone', () => {
      const host = () => fixture.nativeElement as HTMLElement;
      const thisMonth = () => host().querySelector<HTMLButtonElement>('mat-button-toggle[value="thisMonth"] button');

      beforeEach(() => {
        component.onMonthSelected(new Date(2026, 9, 15), fakePicker);
        fixture.detectChanges();
        expect(host().isConnected).withContext('the selector, on the page').toBeTrue();
      });

      it('goes to the This Month toggle, checked, from the clear the user pressed', () => {
        const clear = host().querySelector<HTMLButtonElement>('.period-chip .clear-btn')!;
        clear.focus();
        expect(document.activeElement).withContext('the clear, focused').toBe(clear);

        clear.click();
        fixture.detectChanges();
        // The hand-off waits for the render that removes the chip.
        TestBed.tick();

        expect(host().querySelector('.period-chip')).withContext('the chip, gone').toBeNull();
        expect(thisMonth()?.getAttribute('aria-checked')).withContext('This Month, checked').toBe('true');
        expect(document.activeElement).withContext('focus, on This Month').toBe(thisMonth());
      });

      it('stays where it is when the clear did not hold it (pin)', () => {
        const calendar = host().querySelector<HTMLButtonElement>('.picker-btn')!;
        calendar.focus();

        component.clearCustomPeriod();
        fixture.detectChanges();
        TestBed.tick();

        expect(host().querySelector('.period-chip')).withContext('the chip, gone').toBeNull();
        expect(document.activeElement).withContext('focus, on the calendar button still').toBe(calendar);
      });
    });
  });

  describe('picker bounds', () => {
    const year = new Date().getFullYear();
    const endOfNextYear = new Date(year + 1, 11, 31, 23, 59, 59, 999);

    const pickerInputs = () =>
      fixture.debugElement
        .queryAll(By.directive(MatDatepickerInput))
        .map(node => node.injector.get(MatDatepickerInput) as MatDatepickerInput<Date>);

    // The year view is a CDK overlay, outside the fixture.
    const yearCell = (value: number) =>
      Array.from(document.querySelectorAll<HTMLElement>('.mat-calendar-body-cell'))
        .find(cell => cell.textContent?.trim() === String(value));

    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach(node => node.remove());
    });

    it('gives both pickers the floor\'s month and 31 December next year', () => {
      fixture.componentRef.setInput('floor', new Date(year - 2, 5, 15, 9));
      fixture.detectChanges();

      const inputs = pickerInputs();
      expect(inputs.length).toBe(2);
      for (const input of inputs) {
        expect(input.min).toEqual(new Date(year - 2, 5, 1));
        expect(input.max).toEqual(endOfNextYear);
      }
    });

    it('caps both pickers and leaves the floor open with no floor input', () => {
      const inputs = pickerInputs();
      expect(inputs.length).toBe(2);
      for (const input of inputs) {
        expect(input.min).toBeNull();
        expect(input.max).toEqual(endOfNextYear);
      }
    });

    it('disables the years before the floor and offers none past next year', () => {
      fixture.componentRef.setInput('floor', new Date(year - 2, 5, 15));
      fixture.detectChanges();

      component.openYearPicker();
      fixture.detectChanges();

      expect(yearCell(year - 3)?.getAttribute('aria-disabled')).toBe('true');
      expect(yearCell(year - 2)?.getAttribute('aria-disabled')).toBeNull();
      expect(yearCell(year)?.getAttribute('aria-disabled')).toBeNull();
      expect(yearCell(year + 1)?.getAttribute('aria-disabled')).toBeNull();
      // The page ends on the cap, and there is no page after it.
      expect(yearCell(year + 2)).toBeUndefined();
      expect(document.querySelector('.mat-calendar-next-button')?.getAttribute('aria-disabled'))
        .toBe('true');
    });
  });
});
