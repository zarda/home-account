import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatDatepicker, MatDatepickerInput } from '@angular/material/datepicker';
import {
  PeriodSelectorComponent,
  PeriodSelection,
  defaultPeriodSelection,
} from './period-selector.component';
import { TranslationService } from '../../../core/services/translation.service';

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
        provideNoopAnimations(),
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
