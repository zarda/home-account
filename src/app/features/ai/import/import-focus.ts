import { DestroyRef, Injector, afterNextRender } from '@angular/core';

/** What a component needs to move focus within its own markup. */
export interface ImportFocusContext {
  host: HTMLElement;
  injector: Injector;
  destroyRef: DestroyRef;
}

/**
 * Focuses the first of `selectors` found under the host once the next render
 * has settled. The target of a swap does not exist until the swap has
 * rendered, which is what afterNextRender waits for; registering on a
 * destroyed injector throws NG0911, hence the guard.
 *
 * Focus moves wherever it is by then, unlike household-focus.ts's helper,
 * which moves it only off the document or the control the swap was chosen
 * in: a photo's arrow that a move disables can keep focus in Chrome, and
 * focus is meant to leave it.
 *
 * Several selectors rather than one because a control's usual landing place
 * is not always on screen. A selector that matches nothing drops focus at the
 * document root exactly as no call would, so the fallbacks are the point, and
 * they belong in one call rather than in a second focus path, which would be
 * a second thing to keep in step with the swaps.
 *
 * A key held down across the hand-off presses nothing where focus lands
 * (dropHeldRepeats).
 */
export function focusWhenRendered(
  { host, injector, destroyRef }: ImportFocusContext,
  ...selectors: readonly string[]
): void {
  if (destroyRef.destroyed) return;
  afterNextRender(
    () => {
      for (const selector of selectors) {
        const target = host.querySelector<HTMLElement>(selector);
        if (target) {
          target.focus();
          dropHeldRepeats(host.ownerDocument, destroyRef);
          return;
        }
      }
    },
    { injector }
  );
}

/** The guard standing on each window, so arming one releases the last. */
const standing = new WeakMap<Window, () => void>();

/**
 * Chrome and WebKit press a focused button on the keypress that follows each
 * Enter keydown, a held key's repeats included, and a click carries no mark
 * of the repeat it came from. So a press that handed focus on had the
 * control it landed on pressed by every repeat after: Clear all's filter
 * toggle closed and opened the panel, Save search opened the box a close
 * had just shut, a remove walked down the list to Browse and the picker,
 * and a photo's arrow sent it to one end and back. A held Space's repeat
 * presses nothing itself, but it arms the button it reaches, and the keyup
 * that ends the hold presses that button.
 *
 * Until that key is let go, the repeats of Enter and Space are cancelled, so
 * no keypress follows and no button is armed, and stopped ahead of every
 * other listener, so no handler of the control's own, such as the
 * save-search box's Enter, runs on one either. A keyup of Enter or Space
 * ends the guard, and so does a fresh keydown of either, a press of the
 * reader's own; any other key passes and leaves it standing, as a modifier
 * tapped mid-hold leaves the repeats coming. The component going ends it
 * too, and so does the next hand-off, so the taps that hand focus on and
 * never meet a key leave one guard standing, not one each.
 *
 * The listeners are the window's, in the capture phase, ahead of the
 * document's. zone.js runs every capture listener of one event on one
 * target from a single native listener, registered with the options of the
 * first, and CDK's InputModalityDetector registers the document's keydown
 * passive before any control renders: preventDefault does nothing there.
 */
function dropHeldRepeats(doc: Document, destroyRef: DestroyRef): void {
  const win = doc.defaultView;
  if (!win || destroyRef.destroyed) return;
  standing.get(win)?.();
  const guarded = (event: KeyboardEvent): boolean => event.key === 'Enter' || event.key === ' ';
  const drop = (event: KeyboardEvent): void => {
    if (!guarded(event)) return;
    if (!event.repeat) {
      release();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const letGo = (event: KeyboardEvent): void => {
    if (guarded(event)) release();
  };
  const release = (): void => {
    win.removeEventListener('keydown', drop, true);
    win.removeEventListener('keyup', letGo, true);
    unregister();
    if (standing.get(win) === release) standing.delete(win);
  };
  const unregister = destroyRef.onDestroy(release);
  win.addEventListener('keydown', drop, true);
  win.addEventListener('keyup', letGo, true);
  standing.set(win, release);
}
