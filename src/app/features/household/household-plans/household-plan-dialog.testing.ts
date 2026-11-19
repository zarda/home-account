import { ComponentType, OverlayContainer } from '@angular/cdk/overlay';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { runAxe, summarizeViolations } from '../../../core/services/testing';
import { PLAN_DIALOG_CONFIG } from './household-plan-form';

/**
 * The three font scales an account can choose (AccessibilityService), which
 * the global `html` rule applies through `--app-font-scale`.
 */
export const PLAN_FONT_SCALES = ['1', '1.15', '1.3'] as const;

/**
 * The dialog's width on a 320px phone. PLAN_DIALOG_CONFIG's own max-width
 * replaces the side margins Material keeps below 600px, so the dialog takes
 * the phone's whole width.
 */
export const PLAN_PHONE_WIDTH = '320px';

/**
 * Karma serves none of the app's fonts, so a spec that measures text pins a
 * face with the runner's metrics (docs/testing.md, "Karma serves no fonts").
 */
const RUNNER_FACE = "Verdana, 'DejaVu Sans', sans-serif";

export interface OpenPlanDialog<T> {
  ref: MatDialogRef<T>;
  container: HTMLElement;
  /** Closes the dialog and takes back the face and the scale. */
  close: () => void;
}

/**
 * Opens `component` as the plans section opens it, bounded by `bounds`, at
 * font `scale`, in the runner's face. The face and the scale are set before
 * the dialog opens, so Material sizes each outline's notch for the text the
 * spec measures, as it does for an account's own scale.
 */
export async function openPlanDialog<T>(
  component: ComponentType<T>,
  data: unknown,
  bounds: { maxWidth?: string; maxHeight?: string },
  options: { scale?: string; prepare?: (dialog: T) => void } = {}
): Promise<OpenPlanDialog<T>> {
  const root = document.documentElement;
  const overlay = TestBed.inject(OverlayContainer).getContainerElement();
  const tokens = ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font'];
  overlay.style.fontFamily = RUNNER_FACE;
  for (const token of tokens) overlay.style.setProperty(token, RUNNER_FACE);
  if (options.scale) root.style.setProperty('--app-font-scale', options.scale);
  const ref = TestBed.inject(MatDialog).open(component, { ...PLAN_DIALOG_CONFIG, ...bounds, data });
  const close = (): void => {
    ref.close();
    TestBed.tick();
    root.style.removeProperty('--app-font-scale');
    overlay.style.removeProperty('font-family');
    for (const token of tokens) overlay.style.removeProperty(token);
  };
  try {
    options.prepare?.(ref.componentInstance);
    TestBed.tick();
    await firstValueFrom(ref.afterOpened());
    TestBed.tick();
    // Material re-measures a label that resized on the next task.
    await new Promise(resolve => setTimeout(resolve));
    TestBed.tick();
    // By the ref's own id: a spec that opens one dialog after another reads
    // the one it opened, never one still on its way out.
    const container = document.getElementById(ref.id);
    if (!container?.classList.contains('mat-mdc-dialog-container')) throw new Error('The dialog did not open');
    return { ref, container, close };
  } catch (error) {
    close();
    throw error;
  }
}

export interface PinnedActionsReading {
  /** The surface scrolls as a whole, taking the actions with it. */
  surfaceScrolls: boolean;
  /** The fields scroll inside the content, between the title and the actions. */
  contentScrolls: boolean;
  /** The action buttons whose box leaves the surface's visible box. */
  actionsOutside: string[];
  /** The shortest action button's height, which the 40px floor still holds. */
  shortestAction: number;
}

/**
 * Opens `component` in a dialog too short for its fields and reads whether
 * its actions stay pinned in view while the fields scroll. The height goes on
 * the pane, where CDK writes it inline and it beats the viewport cap in
 * styles.scss, so the reading does not depend on the runner's window.
 */
export async function measurePinnedActions<T>(component: ComponentType<T>, data: unknown): Promise<PinnedActionsReading> {
  const dialog = await openPlanDialog(component, data, { maxHeight: '300px' });
  try {
    const surface = dialog.container.querySelector<HTMLElement>('.mat-mdc-dialog-surface')!;
    const content = dialog.container.querySelector<HTMLElement>('.plan-dialog-content')!;
    const box = surface.getBoundingClientRect();
    const actions = Array.from(dialog.container.querySelectorAll<HTMLElement>('.plan-dialog-cancel, .plan-dialog-save'));
    if (actions.length !== 2) throw new Error('The dialog has no Cancel and save to measure');
    return {
      surfaceScrolls: surface.scrollHeight > surface.clientHeight + 1,
      contentScrolls: content.scrollHeight > content.clientHeight + 1,
      actionsOutside: actions
        .filter(action => {
          const rect = action.getBoundingClientRect();
          return rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5;
        })
        .map(action => action.className.split(' ')[0]),
      shortestAction: Math.min(...actions.map(action => action.getBoundingClientRect().height))
    };
  } finally {
    dialog.close();
  }
}

export interface SubscriptReading {
  kind: 'hint' | 'error';
  /** The hint or error, as it reads. */
  text: string;
  /** How many lines it wraps to. */
  lines: number;
  /** How far it runs past the bottom of its own field; 0 or less inside it. */
  overrun: number;
  /** Where it ends on the page. */
  bottom: number;
}

/**
 * Reads every hint and error the dialog shows under its fields. A field's
 * box holds only what it makes room for, so a subscript that runs past its
 * own field is drawn over whatever comes next.
 */
export function readSubscripts(container: HTMLElement): SubscriptReading[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.plan-dialog-content mat-hint, .plan-dialog-content mat-error')).map(
    subscript => {
      const rect = subscript.getBoundingClientRect();
      const field = (subscript.closest('mat-form-field') as HTMLElement).getBoundingClientRect();
      const line = parseFloat(getComputedStyle(subscript).lineHeight) || 16;
      return {
        kind: subscript.tagName === 'MAT-ERROR' ? 'error' : 'hint',
        text: subscript.textContent?.trim() ?? '',
        lines: Math.round(rect.height / line),
        overrun: rect.bottom - field.bottom,
        bottom: rect.bottom
      };
    }
  );
}

export interface AmountRowReading {
  /** The height of the outline drawn round the amount. */
  amountOutline: number;
  /** The height of the outline drawn round the currency beside it. */
  currencyOutline: number;
  /** Where the first field under the row starts. */
  nextFieldTop: number;
}

/**
 * Reads the amount's row: the outline each field on it draws, and where the
 * field after the row starts. A field the row stretches draws its outline at
 * the row's height rather than its own.
 */
export function readAmountRow(container: HTMLElement): AmountRowReading {
  const row = container.querySelector<HTMLElement>('.plan-dialog-row')!;
  const outline = (field: string): number =>
    row.querySelector<HTMLElement>(`${field} .mdc-notched-outline`)!.getBoundingClientRect().height;
  // A later sibling rather than the next one: an edited plan puts its note
  // between the row and the field after it.
  const next = row.parentElement!.querySelector<HTMLElement>('.plan-dialog-row ~ mat-form-field')!;
  return {
    amountOutline: outline('.plan-dialog-grow'),
    currencyOutline: outline('.plan-dialog-currency'),
    nextFieldTop: next.getBoundingClientRect().top
  };
}

export interface ReservedRowReading {
  /** The field, by its label. */
  field: string;
  /** The height of the row under its outline that holds a hint or an error. */
  height: number;
}

/**
 * Reads the row each field keeps under its outline for a hint or an error.
 * Read with nothing wrong, it is the space between one field and the next.
 */
export function readReservedRows(container: HTMLElement): ReservedRowReading[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.plan-dialog-content mat-form-field')).map(field => ({
    field: field.querySelector('mat-label')?.textContent?.trim() ?? field.className,
    height: field.querySelector<HTMLElement>('.mat-mdc-form-field-subscript-wrapper')!.getBoundingClientRect().height
  }));
}

/**
 * Types `text` into the dialog's input `selector` and leaves it, as a reader
 * does: a datepicker's parse check sees only what was typed, never a value
 * set on its control.
 */
export function typeInto(container: HTMLElement, selector: string, text: string): void {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  TestBed.tick();
}

/**
 * Opens `component` at a phone's width at each of the app's font scales,
 * `prepare` setting its state, and returns what `read` finds in each, marked
 * with its scale.
 */
export async function readAtEveryScale<T, R extends object>(
  component: ComponentType<T>,
  data: unknown,
  read: (container: HTMLElement) => R[],
  prepare?: (dialog: T) => void
): Promise<(R & { scale: string })[]> {
  const readings: (R & { scale: string })[] = [];
  for (const scale of PLAN_FONT_SCALES) {
    const dialog = await openPlanDialog(component, data, { maxWidth: PLAN_PHONE_WIDTH }, { scale, prepare });
    try {
      readings.push(...read(dialog.container).map(reading => ({ ...reading, scale })));
    } finally {
      dialog.close();
    }
  }
  return readings;
}

export interface FloatedLabelReading {
  scale: string;
  /** The field the label names, by its class in the plan dialog. */
  field: string;
  floated: boolean;
  /** The label's text width against the box it is drawn in. */
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Opens `component` at a phone's width at each of the app's font scales and
 * reads each label on the amount's row: the amount and its currency. `prepare`
 * gives the amount a value, so its label floats as the currency's does. The
 * spec provides catalogTranslationStub('en'), so the labels are the reader's
 * words.
 */
export function measureAmountRowLabels<T>(
  component: ComponentType<T>,
  data: unknown,
  prepare: (dialog: T) => void
): Promise<FloatedLabelReading[]> {
  return readAtEveryScale(
    component,
    data,
    container =>
      Array.from(container.querySelectorAll<HTMLElement>('.plan-dialog-row mat-form-field')).map(field => {
        const label = field.querySelector<HTMLElement>('.mdc-floating-label')!;
        return {
          field: field.classList.contains('plan-dialog-currency') ? 'currency' : 'amount',
          floated: label.classList.contains('mdc-floating-label--float-above'),
          scrollWidth: label.scrollWidth,
          clientWidth: label.clientWidth
        };
      }),
    prepare
  );
}

/**
 * The two themes the plans section and its dialogs are audited in. Each
 * class forces its scheme on Material's tokens and the app's alike, as
 * ThemeService does; without one, Material follows the machine's scheme and
 * the app's tokens stay light, a pairing no reader ever sees.
 */
export const PLAN_AUDIT_THEMES = ['light-theme', 'dark-theme'] as const;

export interface PlanDialogAudit {
  violations: string[];
  /** The dialog is named by its title, as a screen reader announces it on opening. */
  labelledByTitle: boolean;
  /** How many scroll positions of the content axe ran at: 1 when it fits the frame. */
  stops: number;
}

/**
 * What axe finds in `container`, run at every half-screenful of the dialog's
 * scrolling content, each line kept once, and how many stops that took.
 *
 * The app caps a dialog's panel to the viewport (styles.scss) and its content
 * scrolls inside it, and Karma's frame is 413px tall, so the budget dialog's
 * dates and alert threshold start below the content's visible box. axe skips
 * text a scroller clips, without even leaving it undecided, so one pass read
 * the dialog clean with its lower half never scored. Half a screenful at a
 * time, so a line cut by the box's edge at one stop is whole at the next.
 *
 * It refuses a dialog with no content area, and one whose last stop does not
 * show the content's end, rather than read either clean unscrolled. It also
 * refuses a stop at which axe skipped a rule on an error: a rule that throws
 * is filed under `incomplete` with its error, never under `violations`, so
 * that stop would read clean with none of the rule's lines scored.
 */
async function sweepScrolledThrough(container: HTMLElement): Promise<{ violations: string[]; stops: number }> {
  const content = container.querySelector<HTMLElement>('.mat-mdc-dialog-content');
  if (!content) throw new Error('auditPlanDialog: no .mat-mdc-dialog-content to scroll through');
  const step = Math.max(1, Math.floor(content.clientHeight / 2));
  const found = new Set<string>();
  let stops = 0;
  try {
    for (let top = 0; ; top += step) {
      // `instant`: a stylesheet's `scroll-behavior: smooth` would otherwise
      // leave the content still travelling when axe reads it.
      content.scrollTo({ top, behavior: 'instant' });
      stops++;
      const results = await runAxe(container);
      const skipped = results.incomplete.flatMap(rule => (rule.error ? [`${rule.id} (${rule.error.message})`] : []));
      if (skipped.length) {
        throw new Error(`auditPlanDialog: axe skipped ${skipped.join(', ')} on an error at stop ${stops} (${top}px)`);
      }
      for (const line of summarizeViolations(results)) found.add(line);
      if (top + content.clientHeight >= content.scrollHeight) break;
    }
    // The stops above count what was asked for; this reads where the content
    // went. A content area that does not scroll stays at its top, its end
    // clipped at every stop and never scored.
    const shownTo = content.scrollTop + content.clientHeight;
    if (shownTo < content.scrollHeight - 1) {
      throw new Error(
        `auditPlanDialog: the last stop never showed the end of its content (shown to ${Math.round(shownTo)}px of ` +
          `${content.scrollHeight}px)`
      );
    }
  } finally {
    content.scrollTo({ top: 0, behavior: 'instant' });
  }
  return { violations: [...found].sort(), stops };
}

/**
 * Runs `fn` with the page scrolled to its top, then puts the page back where
 * it was.
 *
 * Karma's page is seldom at its top when a spec starts: jasmine's report
 * outgrows the 413px frame, and a focus() on a fixture appended below it
 * scrolls the page.
 * While a dialog is open, the CDK's block scroll strategy pins `<html>` where
 * the page was (`position: fixed`, `top` at minus the scroll), and scrolled
 * past body's 413px, body sits wholly above the viewport. Jasmine's
 * stylesheet makes body a scroll region, so axe files everything under it,
 * the dialog's overlay included, in body's grid, yet leaves body itself out
 * of every grid as off screen. `color-contrast` then throws on the first
 * node it stacks, and axe skips the rule, which the sweep refuses rather than
 * read clean. Opened from the top, body stays on screen and the rule runs.
 */
async function fromThePageTop<T>(fn: () => Promise<T>): Promise<T> {
  const page = document.scrollingElement ?? document.documentElement;
  const { scrollTop: top, scrollLeft: left } = page;
  // `instant`, as the content's own scroll is.
  page.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  try {
    return await fn();
  } finally {
    page.scrollTo({ top, left, behavior: 'instant' });
  }
}

/**
 * Opens `component` in a real dialog, as the plans section opens it, painted
 * on the dialog's own surface in `theme`, and reports what axe finds in it,
 * scrolled through. `prepare` sets the dialog's state before the audit. The
 * page is at its top while the dialog is open, and back where it was after.
 */
export function auditPlanDialog<T>(
  component: ComponentType<T>,
  data: unknown,
  theme: (typeof PLAN_AUDIT_THEMES)[number],
  prepare?: (dialog: T) => void
): Promise<PlanDialogAudit> {
  return fromThePageTop(async () => {
    const root = document.documentElement;
    root.classList.add(theme);
    const ref = TestBed.inject(MatDialog).open(component, { ...PLAN_DIALOG_CONFIG, data });
    try {
      prepare?.(ref.componentInstance);
      TestBed.tick();
      await firstValueFrom(ref.afterOpened());
      TestBed.tick();
      const container = document.querySelector<HTMLElement>('.mat-mdc-dialog-container');
      if (!container) throw new Error('The dialog did not open');
      const title = container.querySelector<HTMLElement>('.mat-mdc-dialog-title');
      return {
        ...(await sweepScrolledThrough(container)),
        labelledByTitle: !!title?.id && container.getAttribute('aria-labelledby') === title.id
      };
    } finally {
      ref.close();
      TestBed.tick();
      root.classList.remove(theme);
    }
  });
}
