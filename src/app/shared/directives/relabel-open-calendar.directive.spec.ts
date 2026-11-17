import { Component, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerIntl,
} from '@angular/material/datepicker';
import { RelabelOpenCalendarDirective, openCalendarContent } from './relabel-open-calendar.directive';

@Component({
  imports: [MatDatepicker, MatDatepickerInput, RelabelOpenCalendarDirective],
  template: `
    <input [matDatepicker]="picker">
    <mat-datepicker #picker></mat-datepicker>
  `,
})
class RelabelledHost {
  readonly picker = viewChild.required<MatDatepicker<Date>>('picker');
}

@Component({
  imports: [MatDatepicker, MatDatepickerInput],
  template: `
    <input [matDatepicker]="picker">
    <mat-datepicker #picker></mat-datepicker>
  `,
})
class PlainHost {
  readonly picker = viewChild.required<MatDatepicker<Date>>('picker');
}

// Material copies the close label into the calendar when it opens and
// listens to nothing afterwards, so a calendar open across a change of
// language kept the old one until it was closed and opened again (#505).
// Motion is left on here: closing and reopening the calendar is a no-op for
// the 200 ms of its exit animation, which a spec with motion off cannot see.
describe('RelabelOpenCalendarDirective', () => {
  let intl: MatDatepickerIntl;

  const closeButton = () => document.querySelector<HTMLButtonElement>('.mat-datepicker-close-button');
  const closeLabel = () => closeButton()?.textContent?.trim();
  const periodButton = () => document.querySelector<HTMLElement>('.mat-calendar-period-button');

  function open<T extends { picker: () => MatDatepicker<Date> }>(host: new () => T): ComponentFixture<T> {
    const fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    fixture.componentInstance.picker().open();
    fixture.detectChanges();
    return fixture;
  }

  function switchLanguage(fixture: ComponentFixture<unknown>, label: string): void {
    intl.closeCalendarLabel = label;
    intl.changes.next();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideNativeDateAdapter()] });
    intl = TestBed.inject(MatDatepickerIntl);
    intl.closeCalendarLabel = 'Close calendar';
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach(container => container.replaceChildren());
  });

  it('gives an open calendar its close label in the new language', () => {
    const fixture = open(RelabelledHost);
    expect(closeLabel()).withContext('as it opened').toBe('Close calendar');

    switchLanguage(fixture, 'カレンダーを閉じる');

    expect(closeLabel()).toBe('カレンダーを閉じる');
  });

  it('leaves the calendar open, on the month it showed, with focus where it was', () => {
    const fixture = open(RelabelledHost);
    const picker = fixture.componentInstance.picker();
    const month = periodButton()?.textContent;
    const button = closeButton();
    const focused = document.activeElement;

    switchLanguage(fixture, 'カレンダーを閉じる');

    expect(picker.opened).toBeTrue();
    expect(closeButton()).withContext('the same calendar, not a second one').toBe(button);
    expect(periodButton()?.textContent).toBe(month);
    expect(document.activeElement).toBe(focused);
  });

  it('does nothing to a closed calendar, which reads the label when it next opens', () => {
    const fixture = TestBed.createComponent(RelabelledHost);
    fixture.detectChanges();

    switchLanguage(fixture, 'カレンダーを閉じる');
    expect(closeButton()).toBeNull();

    fixture.componentInstance.picker().open();
    fixture.detectChanges();
    expect(closeLabel()).toBe('カレンダーを閉じる');
  });

  it('is what does it: a host without the directive keeps the old label', () => {
    // The defect, pinned. If this fails, Material has started listening for
    // itself and the directive can go.
    const fixture = open(PlainHost);

    switchLanguage(fixture, 'カレンダーを閉じる');

    expect(closeLabel()).toBe('Close calendar');
  });

  it('finds the open calendar where Material keeps it', () => {
    // The one private read. A Material upgrade that moves the open
    // calendar's component fails here, and not in silence on a hidden button.
    const fixture = open(RelabelledHost);
    const content = openCalendarContent(fixture.componentInstance.picker());

    expect(content).withContext('the open calendar').toBeDefined();
    expect(content?._closeButtonText).toBe('Close calendar');
  });

  it('finds none while the calendar is closed', () => {
    const fixture = TestBed.createComponent(RelabelledHost);
    fixture.detectChanges();

    expect(openCalendarContent(fixture.componentInstance.picker())).toBeUndefined();
  });
});
