import { Injectable, inject, untracked } from '@angular/core';
import { MatDatepickerIntl, yearsPerPage } from '@angular/material/datepicker';
import { AppDateAdapter } from './app-date-adapter';
import { TranslationService } from './translation.service';

/**
 * The calendar's buttons and labels in the reader's language: the toggle's
 * name, the previous and next buttons, the period button and a page of
 * years' range. Material's own are English literals, fixed for the life of
 * the app.
 *
 * The labels are assigned, not read through getters: Material declares them
 * as class fields, which would shadow a getter here. They are assigned once
 * at construction, from the catalog the app loaded before any page rendered,
 * and again whenever the adapter follows the reader to another language or
 * format. Each time the labels come first and `changes` second, so a
 * calendar told to redraw finds them, and finds the adapter, which the
 * header's period text is formatted by, already in the new language.
 *
 * `calendarLabel`, `startDateLabel` and `endDateLabel` keep Material's
 * defaults: nothing in this version's templates reads them.
 */
@Injectable({ providedIn: 'root' })
export class AppDatepickerIntl extends MatDatepickerIntl {
  private readonly translation = inject(TranslationService);

  constructor() {
    super();
    untracked(() => this.relabel());
    inject(AppDateAdapter).localeChanges.subscribe(() => {
      this.relabel();
      this.changes.next();
    });
  }

  /** Reads every label from the catalog of the reader's language. */
  relabel(): void {
    const years = yearsPerPage;
    this.openCalendarLabel = this.translation.t('datepicker.openCalendar');
    this.closeCalendarLabel = this.translation.t('datepicker.closeCalendar');
    this.prevMonthLabel = this.translation.t('datepicker.previousMonth');
    this.nextMonthLabel = this.translation.t('datepicker.nextMonth');
    this.prevYearLabel = this.translation.t('datepicker.previousYear');
    this.nextYearLabel = this.translation.t('datepicker.nextYear');
    this.prevMultiYearLabel = this.translation.t('datepicker.previousYears', { years });
    this.nextMultiYearLabel = this.translation.t('datepicker.nextYears', { years });
    this.switchToMonthViewLabel = this.translation.t('datepicker.chooseDate');
    this.switchToMultiYearViewLabel = this.translation.t('datepicker.chooseMonthAndYear');
    this.comparisonDateLabel = this.translation.t('datepicker.comparisonRange');
  }

  /** The period button's text on a page of years: its first and last year, as the adapter names them. */
  override formatYearRange(start: string, end: string): string {
    return this.translation.t('datepicker.yearRange', { start, end });
  }

  /** The same range as a screen reader announces it. */
  override formatYearRangeLabel(start: string, end: string): string {
    return this.translation.t('datepicker.yearRangeLabel', { start, end });
  }
}
