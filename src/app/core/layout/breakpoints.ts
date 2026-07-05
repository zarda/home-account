/**
 * The app's single breakpoint scale. Keep in sync with the SCSS
 * counterpart in src/theme/_breakpoints.scss.
 *
 * Navigation modes bind to these ranges (§6.2 of the UI upgrade plan):
 *   - mobile  (<600px):        bottom nav; drawer opens as overlay
 *   - tablet  (600–1023px):    overlay drawer via the header hamburger
 *   - desktop (≥1024px):       docked sidebar, no modal navigation
 *
 * Finer-grained cosmetic media queries inside a page (spacing, column
 * counts) may use other widths, but layout/navigation mode decisions in
 * TypeScript must observe these queries only.
 */
export const APP_BREAKPOINTS = {
  mobile: '(max-width: 599.98px)',
  tablet: '(min-width: 600px) and (max-width: 1023.98px)',
  desktop: '(min-width: 1024px)',
} as const;

export type AppBreakpointName = keyof typeof APP_BREAKPOINTS;
