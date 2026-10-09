/**
 * How many lines `element`'s own text is laid out on, counting each line
 * once however many text nodes share it. An icon's ligature is text in the
 * DOM but draws as one glyph, so text inside a `mat-icon` is left out.
 *
 * A height says the same only while the line height is known, and a
 * `line-height: normal` varies with the face, which Karma does not serve.
 */
export function textLines(element: Element): number {
  const tops = new Set<number>();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest('mat-icon')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0) tops.add(Math.round(rect.top));
    }
  }
  return tops.size;
}
