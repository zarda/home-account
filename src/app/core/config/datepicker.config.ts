import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';
import { APP_DATE_FORMATS, AppDateAdapter } from '../services/app-date-adapter';
import { AppDatepickerIntl } from '../services/app-datepicker-intl';

/**
 * What every date picker in the app reads, provided once at the root: the
 * adapter that shows and reads a date in the account's format and language,
 * the formats that route an input's text through it, and the calendar's
 * buttons and labels in that language.
 *
 * No picker component provides its own (the lint gate bans the modules that
 * would), so these reach every routed page and dialog. `DateAdapter` is the
 * root `AppDateAdapter` itself rather than a second instance of it, and
 * `MatDatepickerIntl` the root `AppDatepickerIntl`.
 */
export function provideAppDatepicker(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: DateAdapter, useExisting: AppDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: APP_DATE_FORMATS },
    { provide: MatDatepickerIntl, useExisting: AppDatepickerIntl },
  ]);
}
