import { Directive, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDatepicker, MatDatepickerContent, MatDatepickerIntl } from '@angular/material/datepicker';

/** The part of an open calendar this directive writes. */
type OpenCalendar = Pick<MatDatepickerContent<unknown>, '_closeButtonText'>;

/**
 * The component of `picker`'s open calendar, or undefined while it is
 * closed. Material keeps it in `_componentRef`, which its types mark
 * private: the one private read here, and the spec that opens a calendar and
 * looks for it is what a Material upgrade that moves it fails.
 */
export function openCalendarContent<D>(picker: MatDatepicker<D>): OpenCalendar | undefined {
  const held = picker as unknown as { _componentRef?: { instance?: OpenCalendar } | null };
  return held._componentRef?.instance ?? undefined;
}

/**
 * Gives a calendar that is open across a change of language its close
 * button in the new one.
 *
 * Material copies `closeCalendarLabel` into the calendar when it opens and
 * listens to nothing afterwards; the toggle and the calendar's header do
 * follow `MatDatepickerIntl.changes`. The button is the one a screen reader
 * user leaves the calendar by, hidden until it has focus.
 *
 * The label is written in place and the calendar asked to redraw
 * (`stateChanges`, which its content already redraws on). Closing and
 * reopening would rebuild it with the new label, but `open()` is ignored for
 * the length of the exit animation, the month the reader had moved to would
 * be lost, and the dialog would be announced again.
 *
 * A component that declares a `<mat-datepicker>` imports this, and
 * `npm run material:check` fails one that does not. The app declares no
 * range picker, so the comparison label a calendar body copies the same way
 * is never read.
 */
// The calendar's own element is the selector on purpose: a host cannot then
// declare a calendar and leave the attribute off it, only forget the import,
// which material:check fails.
// eslint-disable-next-line @angular-eslint/directive-selector
@Directive({ selector: 'mat-datepicker' })
export class RelabelOpenCalendarDirective {
  constructor() {
    const picker = inject<MatDatepicker<unknown>>(MatDatepicker, { self: true });
    const intl = inject(MatDatepickerIntl);
    intl.changes.pipe(takeUntilDestroyed()).subscribe(() => {
      const content = openCalendarContent(picker);
      if (!picker.opened || !content) return;
      content._closeButtonText = intl.closeCalendarLabel;
      picker.stateChanges.next();
    });
  }
}
