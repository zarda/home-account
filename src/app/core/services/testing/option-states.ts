import type { MatOption } from '@angular/material/core';
import type { MatSelect } from '@angular/material/select';

/**
 * Two category colours for a spec that measures a category's glyph: the
 * lightest of the seeded colours, which a light surface reads worst, and the
 * darkest colour a category can take, which a dark surface reads worst.
 * Unmoved, each measures under 2.5:1 on a select panel in its own scheme.
 */
export const GLYPH_PROBE_COLOURS = { light: '#8BC34A', dark: '#3F51B5' } as const;

/** A state Material paints behind a select option's content. */
export type OptionState = 'at rest' | 'active' | 'selected';

/**
 * Chooses the option of `select` whose value is `value` the way a pointer
 * does, opening the panel and clicking the option, so whatever the host binds
 * the select to (a form control, `ngModel`, a selection handler) takes the
 * value. A single select closes on the click; a multiple one is closed after.
 *
 * `flush` renders the host after each step: a fixture's `detectChanges`.
 */
export function chooseOption(select: MatSelect, value: unknown, flush: () => void): void {
  select.open();
  flush();
  try {
    const option = select.options.find(each => each.value === value);
    if (!option) throw new Error(`chooseOption: no option has the value ${String(value)}`);
    if (!option.selected) option._getHostElement().click();
    flush();
  } finally {
    select.close();
    flush();
  }
}

/**
 * Opens `select` and puts every option through the states Material paints
 * behind an option's content, calling `check` once per option per state, for
 * a spec to measure what the option holds against what is painted under it:
 *
 *   - selected: each chosen option with the active mark taken off it. The
 *     panel opens with the chosen option active, and Material paints an
 *     active option's layer in place of the selected fill, so the fill shows
 *     only once the keyboard has moved on. A multiple select paints no
 *     selected fill, so there a chosen option is painted as one at rest.
 *   - at rest: every option neither chosen nor active.
 *   - active: each option not chosen, made active in turn, as the arrow keys
 *     make it.
 *
 * Hover is left out: Karma cannot hover, and Material's hover layer is
 * fainter than its active one, so what reads on the active layer reads on
 * the hovered one too. The panel is closed again at the end.
 *
 * `flush` renders the host after each step: a fixture's `detectChanges`.
 */
export function eachOptionState(
  select: MatSelect,
  flush: () => void,
  check: (option: MatOption, state: OptionState) => void
): void {
  select.open();
  flush();
  try {
    const options = select.options.toArray();
    if (options.length === 0) throw new Error('eachOptionState: the select has no option to measure');
    for (const option of options) option.setInactiveStyles();
    flush();
    for (const option of options) check(option, option.selected ? 'selected' : 'at rest');
    for (const option of options.filter(each => !each.selected)) {
      option.setActiveStyles();
      flush();
      try {
        check(option, 'active');
      } finally {
        option.setInactiveStyles();
        flush();
      }
    }
  } finally {
    select.close();
    flush();
  }
}
