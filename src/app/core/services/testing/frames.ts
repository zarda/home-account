/**
 * Resolves once two animation frames have gone by.
 *
 * Some work lands in a frame's rendering steps after that frame's animation
 * callbacks have run: a ResizeObserver's report, which the browser delivers
 * once the frame's layout is done, and a render hook's focus fix-up, which
 * runs as the page next renders. A single `requestAnimationFrame` callback
 * runs ahead of both in its own frame and finds neither; the second frame's
 * callback runs after the first frame has finished, so it finds that frame's
 * work delivered.
 */
export function afterTwoFrames(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
