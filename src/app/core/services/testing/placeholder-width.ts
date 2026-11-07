/**
 * How wide `input`'s placeholder is, px, laid out on one line in the input's
 * own font. A placeholder sits on its input's one line and cannot wrap, so a
 * hint wider than the room it is drawn in is cut where that room ends, and
 * the input's `scrollWidth` does not count it.
 *
 * Measured by a hidden probe beside the input rather than by the input
 * itself, which reports only its own box. Pin the face first, as
 * docs/testing.md *Karma serves no fonts* says.
 */
export function placeholderWidthPx(input: HTMLInputElement): number {
  const style = getComputedStyle(input);
  const probe = document.createElement('span');
  probe.style.cssText = 'position: absolute; visibility: hidden; white-space: pre';
  probe.style.font = style.font;
  probe.style.letterSpacing = style.letterSpacing;
  probe.textContent = input.placeholder;
  input.parentElement!.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/**
 * The room `input`'s placeholder is drawn in, px: its content box, inside its
 * borders and padding. Where `clip` is given the room ends at that element's
 * right edge instead, if sooner: a chip list's input runs past its field's
 * infix, and the infix is what cuts the hint.
 */
export function contentWidthPx(input: HTMLInputElement, clip?: Element): number {
  const style = getComputedStyle(input);
  const box = input.getBoundingClientRect();
  const start = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  const end = Math.min(
    box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    clip?.getBoundingClientRect().right ?? Infinity,
  );
  return end - start;
}
