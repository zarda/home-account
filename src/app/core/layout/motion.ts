/**
 * Motion preferences helper (§9). The global CSS kill-switch in styles.scss
 * neutralizes CSS animations/transitions under prefers-reduced-motion, but
 * Angular Material component animations run through the Web Animations API and
 * are driven by explicit `animationDuration` inputs, which CSS can't reach.
 * Components read this to zero those durations when the user asks for less
 * motion.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Tab/stepper slide duration, collapsed to 0ms under reduced motion. */
export function tabAnimationDuration(): string {
  return prefersReducedMotion() ? '0ms' : '200ms';
}
