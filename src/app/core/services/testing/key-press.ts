/**
 * A key as the browser delivers it to a focused control. Its keydown bubbles
 * and can be cancelled, and a button then presses itself, on Enter's keypress
 * or on Space's keyup, unless something on the way cancelled that keydown. A
 * synthetic keydown presses nothing, so the press is the button's own click.
 *
 * `repeat` is a held key's auto-repeat. Chrome and WebKit send each repeat as
 * a further keydown to whatever holds focus by then, and a repeated Enter
 * presses a button there as the first one did. A repeated Space presses
 * nothing by itself: it arms the button it reaches, and the keyup that ends
 * the hold presses that button. The model stops at the keydown, so it presses
 * nothing for a repeated Space; a case that lets the key go sends its own
 * keyup.
 */
export function pressKey(
  target: Element,
  key: 'Enter' | ' ',
  { repeat = false }: { repeat?: boolean } = {}
): KeyboardEvent {
  const keydown = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(keydown);
  const presses = key === 'Enter' || !repeat;
  if (presses && !keydown.defaultPrevented && target instanceof HTMLButtonElement) target.click();
  return keydown;
}
