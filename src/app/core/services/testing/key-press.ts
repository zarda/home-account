/** The legacy `keyCode` Chrome also puts on each key's keydown. */
const LEGACY_KEY_CODES = { Enter: 13, ' ': 32, End: 35 } as const;

/**
 * A key as the browser delivers it to a focused control. Its keydown bubbles
 * and can be cancelled, and a button then presses itself, on Enter's keypress
 * or on Space's keyup, unless something on the way cancelled that keydown. A
 * synthetic keydown presses nothing, so the press is the button's own click.
 * End only moves (a key manager to its last item) and presses nothing.
 *
 * `repeat` is a held key's auto-repeat. Chrome and WebKit send each repeat as
 * a further keydown to whatever holds focus by then, and a repeated Enter
 * presses a button there as the first one did. A repeated Space presses
 * nothing by itself: it arms the button it reaches, and the keyup that ends
 * the hold presses that button. The model stops at the keydown, so it presses
 * nothing for a repeated Space; a case that lets the key go sends its own
 * keyup.
 *
 * `legacyKeyCode` puts on the keydown the `keyCode` Chrome sends with it,
 * which Material and the CDK still read in places: a key manager moves on
 * it, and a menu trigger notes from it that the keyboard opened its menu. It
 * is off unless asked for, so a case written without it reads the keydown it
 * always did.
 */
export function pressKey(
  target: Element,
  key: 'Enter' | ' ' | 'End',
  { repeat = false, legacyKeyCode = false }: { repeat?: boolean; legacyKeyCode?: boolean } = {}
): KeyboardEvent {
  const keydown = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
  if (legacyKeyCode) Object.defineProperty(keydown, 'keyCode', { value: LEGACY_KEY_CODES[key] });
  target.dispatchEvent(keydown);
  const presses = key === 'Enter' || (key === ' ' && !repeat);
  if (presses && !keydown.defaultPrevented && target instanceof HTMLButtonElement) target.click();
  return keydown;
}
