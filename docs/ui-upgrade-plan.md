# UI Design & Layout Upgrade Plan

**Status:** Proposed · **Date:** 2026-07-03 · **Branch:** `feature/ui-design-layout-upgrade`

This plan was produced by running the app end-to-end (Angular dev server + Firebase emulators,
seeded with a realistic demo account) and capturing 44 screenshots across desktop/mobile,
light/dark themes, and a Japanese-locale check, then auditing both the **rendered output** and
the **source code** area by area. Key before-state screenshots live in [`docs/ui-audit/`](./ui-audit/).

---

## 1. Executive summary

The app has a **solid foundation**: a real semantic CSS-token system with complete light/dark
pairs, signal-based components, centralized breakpoint logic, good empty/loading states, and
several genuinely polished surfaces (budget cards, the Smart Import dropzone, the login page).
The problems are concentrated in four areas:

1. **The desktop layout is broken by design** — the navigation drawer auto-opens as a modal
   overlay with a full-screen scrim on *every* page load, dimming and click-blocking the entire
   app until dismissed ([evidence](./ui-audit/dashboard-desktop-light-DEFAULT-sidebar-open.png)).
   There is no docked/persistent sidebar at any width.
2. **Three-and-a-half competing styling systems** — legacy Material **M2** theming, Tailwind,
   hand-rolled CSS tokens, and ~59 usages of **M3 `--mat-sys-*` variables that are never
   defined** (camera capture and AI settings render with transparent/inherited colors).
   ~300 hardcoded hex colors bypass the token system; income/expense semantics exist in ~10
   different green/red shades.
3. **Trust-eroding number presentation** — budgets cap at "100%" while showing "$50.49 over",
   `$93.1` / `$506.9` one-decimal formatting, multi-currency totals that change between loads,
   and a budget-alert snackbar that contradicts the budget card on the same screen.
4. **Consistency drift** — the same patterns (summary cards, period selectors, page headers,
   transaction rows, category icon chips, dialogs, empty states) are re-implemented per page
   with different anatomy, while half the shared component library sits unused or broken.

The plan is sequenced so the **token/theme foundation lands first** (everything else builds on
it), then the **app shell**, then **shared components**, then **page-level passes**, and finally
a **dark-mode/a11y/i18n hardening pass** with a repeatable screenshot harness for visual QA.

---

## 2. Evidence gallery (before state)

| Screen | Evidence |
|---|---|
| Desktop default state — modal sidebar dims/covers content | [dashboard-desktop-light-DEFAULT-sidebar-open.png](./ui-audit/dashboard-desktop-light-DEFAULT-sidebar-open.png) |
| Dashboard, desktop light (sidebar dismissed) | [dashboard-desktop-light.png](./ui-audit/dashboard-desktop-light.png) |
| Dashboard, desktop dark (different totals — conversion nondeterminism) | [dashboard-desktop-dark.png](./ui-audit/dashboard-desktop-dark.png) |
| Dashboard, mobile | [dashboard-mobile-light.png](./ui-audit/dashboard-mobile-light.png) |
| Transactions — "Today" default, near-empty canvas, top-right FAB | [transactions-desktop-light.png](./ui-audit/transactions-desktop-light.png) |
| Add Transaction dialog — clipped "Currency" label, cropped field | [transaction-form-desktop-light.png](./ui-audit/transaction-form-desktop-light.png) |
| Budgets — best card language, but "100%" cap + `$93.1` formatting | [budgets-desktop-light.png](./ui-audit/budgets-desktop-light.png) |
| Reports — single-point "trend" chart, duplicated stat-card design | [reports-desktop-light.png](./ui-audit/reports-desktop-light.png) |
| Settings — mixed row anatomies, stretched theme toggle | [settings-desktop-light.png](./ui-audit/settings-desktop-light.png) |
| Smart Import — the internal design north star | [import-wizard-desktop-light.png](./ui-audit/import-wizard-desktop-light.png) |
| Japanese locale (holds up well) | [dashboard-desktop-dark-ja.png](./ui-audit/dashboard-desktop-dark-ja.png) |
| Login | [login-mobile-light.png](./ui-audit/login-mobile-light.png) |

---

## 3. What is already good — preserve these

- **Semantic token layer with full light/dark pairs** (`src/styles.scss:122-228`): surfaces,
  borders, three text tiers, brand, semantic, income/expense, scrollbar, shadows, overlay.
  Most color fixes below are *adoption*, not invention.
- **Tailwind dark mode correctly wired** to `.dark-theme` (`tailwind.config.js:3`), matching the
  signal-based `ThemeService` (light/dark/system with live `prefers-color-scheme` listener).
- **Centralized breakpoints**: one CDK `BreakpointObserver` mapped into
  `isMobile/isTablet/isDesktop` signals (`main-layout.component.ts`).
- **Budget card anatomy** (icon chip, spent vs limit hierarchy, state-colored amounts) — the
  strongest component in the app; use it as the model for card design.
- **Smart Import flow**: dropzone composition, feature chips, typed error states, drag-reorder
  with accessible fallbacks — the aesthetic north star for the rest of the app.
- **Dual mobile/desktop rendering done right** in transactions (cards vs sortable table) and
  the dashboard's deliberate mobile content ordering.
- **Accessibility groundwork**: `EmptyStateComponent` (role=status, aria-live, 8 call sites),
  AnnouncerService pairing with snackbars, keyboard-operable rows, 44px targets in the shell.
- **i18n coverage ~718 keys** with only 3 missing in ja/tc; Japanese renders well on the pages
  captured ([evidence](./ui-audit/dashboard-desktop-dark-ja.png)).
- **Locale/currency-aware formatting infrastructure** (`CurrencyService.formatCurrency`,
  Intl-based chart tooltips) — needs consistent adoption, not replacement.

---

## 4. Phase 0 — Trust & correctness quick wins (S effort, do first)

Small fixes, outsized credibility payoff. All are independent of the larger refactors.

| # | Fix | Where | Evidence |
|---|---|---|---|
| 0.1 | **Deterministic multi-currency totals**: dashboard/report aggregations must always use `amountInBaseCurrency`; never silently fall back to raw `amount` when exchange rates are unavailable (totals visibly changed between loads: $6,247.08 vs $2,472.50 for the same range). Show the base currency code on summary cards. | transaction/report aggregation services | [light](./ui-audit/dashboard-desktop-light.png) vs [dark](./ui-audit/dashboard-desktop-dark.png) |
| 0.2 | **Show true budget utilization**: replace the "100%" cap with the real figure ("117%") or an overage chip ("+17%"), and make bar fill, percentage, and status label derive from one state token. | `budget-progress-card.component.ts` | [budgets](./ui-audit/budgets-desktop-light.png) |
| 0.3 | **Uniform money formatting**: route every monetary string through one currency pipe — kills `$93.1` / `$506.9` next to `$350.49`. | budgets, dashboards, previews | [budgets](./ui-audit/budgets-desktop-light.png) |
| 0.4 | **Fix the contradicting budget alert**: alert snackbar and Budget Progress card must derive from the same period/query (snackbar said "Shopping exceeded 117%" while the card showed 30%). | `dashboard.component.ts:316-341` | mobile scroll shots |
| 0.5 | **Un-clip the "Currency" label** in the Add Transaction dialog (widen the select or drop the floating label; the selected code "USD" carries meaning). | `transaction-form.component` | [dialog](./ui-audit/transaction-form-desktop-light.png) |
| 0.6 | **Fix broken `AmountDisplayComponent`** (computed() over plain `@Input`s never re-evaluates): migrate to signal inputs — prerequisite for Phase 3 adoption. | `amount-display.component.ts` | code audit |
| 0.7 | **ConfirmDialog i18n fallback**: inject TranslationService for default Cancel/Confirm labels; fix the `confirmText`→`confirmLabel` typo call sites. | `confirm-dialog.component` | code audit |
| 0.8 | **Multi-currency row clarity**: foreign-currency rows show a converted secondary value ("-¥3,800 ≈ -$26.05"). | transaction lists | [dashboard](./ui-audit/dashboard-desktop-light.png) |

---

## 5. Phase 1 — Design-token & theming foundation (M/L effort)

Everything later builds on this. Goal: **one source of truth for color/type/space, two dark-mode
mechanisms max, themed Material and charts.**

### 5.1 Consolidate the color systems
- Make the CSS custom properties in `styles.scss` the **single source of truth**.
- Point `tailwind.config.js` colors at the tokens (`primary: 'var(--color-primary)'`, surface /
  text / border scales too); delete the unused teal `accent` ramp (semantic drift: "accent" is
  teal in Material/Tailwind but indigo in CSS vars).
- **Sweep ~300 hardcoded hexes across ~50 component SCSS files** onto tokens
  (`--color-income/-expense/-success/-warning/-error`, `--surface-*`, `--text-*`, `--border-*`).
  The worst offenders: reports (`#22c55e`/`#ef4444` everywhere), import wizard (foreign indigo
  `#6366f1` as "primary"), transaction filters (off-brand `#4f46e5`), recurring list.
- Split income/expense tokens into **fill vs text variants** — `#22c55e` as text fails WCAG
  (~2.3:1 on white). Use green-700/red-700 text in light, green-400/red-400 in dark.

### 5.2 Material theming: migrate M2 → M3 (or bridge first)
- Current state: deprecated `mat.m2-define-*` APIs; the dark theme is emitted as a **full
  duplicate (42% of a 177 KB theme stylesheet)**; ~90 lines of manual `.dark-theme` overrides
  pinned to private MDC internals; and **59 usages of `--mat-sys-*` tokens that are never
  defined** (camera-capture and AI-settings render transparent surfaces in both themes).
- Target: `mat.theme()` (M3) with the indigo palette, `color-scheme: light dark`, and the
  `.dark-theme`/`.light-theme` classes forcing scheme. This emits the `--mat-sys-*` system
  variables (fixing camera/AI settings for free) and deletes most manual overrides.
- If M3 migration is staged later, land the **bridge block now**: alias the ~15 consumed
  `--mat-sys-*` names to existing app tokens in `styles.scss`.

### 5.3 Reduce dark-mode mechanisms from five to two
- Keep: Tailwind `dark:` variants + theme-adaptive CSS vars.
- Remove: dead `.dark-theme ::ng-deep` selectors, dead `:host-context(.dark)` (never matches —
  the class is `.dark-theme`), and `prefers-color-scheme` media blocks that ignore the in-app
  toggle (budget-progress, data-management avatars).

### 5.4 Typography & spacing scale
- 38 distinct font sizes (px and rem mixed, 10–11px micro-text in 12 places) → define a small
  token scale (`--text-xs` … `--text-2xl`, 12px floor) or standardize on Tailwind `text-*`;
  wire the same scale into Material typography (PT Sans is already configured).
- One radius token set (e.g. `--radius-card: 12px`) — five different corner radii currently
  coexist on a single screen — and one elevation recipe (border + `--shadow-sm`, hover `-md`).

### 5.5 Fonts, icons, PWA chrome
- **Self-host PT Sans and Material Icons** (`src/assets/fonts` + `@font-face`, `font-display:
  swap`). Today they load via chained render-blocking CSS `@import` from Google CDN — with no
  network the app shows raw ligature text instead of icons (observed while capturing). Delete
  the unused Roboto download and the duplicate/unused icon fetches.
- Fix `theme-color` meta: `#1976d2` matches neither the `#3F51B5` brand nor dark `#121212`; add
  a dark-scheme variant and update it from `ThemeService` on toggle.

### 5.6 Chart theming (used by dashboard + reports)
- One shared chart-theme helper: reads tokens (`--text-muted`, `--border-primary`, PT Sans) and
  injects into Chart.js `ticks.color`, `legend.labels.color`, `grid.color`; re-applies when the
  theme flips. Today dark-mode charts keep light-theme grays and are **unreadable**
  ([reports dark](./ui-audit/dashboard-desktop-dark.png)).

### 5.7 Global a11y primitives
- `:focus-visible` outline token globally (none exists today).
- Global `@media (prefers-reduced-motion: reduce)` block (zero support today; several infinite
  animations in the import flow).

**Acceptance criteria:** zero raw hex in component SCSS (lint/grep gate); one green/red pair
app-wide; camera + AI settings render correctly in both themes; charts legible in dark mode;
icons/fonts render offline; Lighthouse a11y contrast passes on all five main pages.

---

## 6. Phase 2 — App shell & navigation (M effort)

### 6.1 Docked desktop sidebar (the single highest-impact layout fix)
- ≥1024px (or 1280px): render the drawer **docked** — no backdrop, `.main-container` gets a
  `margin-left: 256px` offset (or migrate the shell to `MatSidenav` with `mode='side'` vs
  `'over'`, which brings focus trap, Escape handling, and ARIA for free).
- Never auto-open a modal drawer on load. Overlay + scrim only for `isOverlayMode()`.
- Persist the user's collapse preference (localStorage) and offer a slim icon-rail collapsed
  state as a stretch goal.
- Fix the z-index collision: shell layers (1000/1100/1200) sit above the CDK overlay container
  (1000), so menus/dialogs/snackbars can render *beneath* the open sidebar. Define a z-index
  token scale below 1000.

### 6.2 Unify breakpoints & close the navigation dead zone
- One scale, encoded once (TS + SCSS map): `<600` mobile (bottom nav), `600–1023` overlay
  drawer, `≥1024` docked sidebar. Today 600–1279px has no bottom nav, a closed sidebar, and
  hamburger-only navigation, and three conflicting breakpoint systems coexist.

### 6.3 Bottom nav: labels, active state, one add button
- Add translated 11px labels under icons + `aria-label`s (labels exist in TS but are unused and
  hardcoded English; the bar is icon-only with **no active-state indicator** on non-tab pages).
- Resolve the **two competing "+" buttons** on mobile transactions (header FAB + bottom-nav
  center FAB): keep the bottom-nav FAB as the single add affordance on mobile.

### 6.4 iOS safe areas (PWA + Capacitor)
- `viewport-fit=cover` is declared but `env(safe-area-inset-*)` is used **nowhere**: the status
  bar overlaps the fixed header and the home indicator overlaps the bottom nav on notched
  iPhones. Add `--safe-top/--safe-bottom` tokens and apply to header height/padding, bottom-nav
  height, main-container offsets, and the mobile drawer.

### 6.5 Header & notification policy
- Theme the dark toolbar onto the dark surface scale (it is currently a third, mismatched gray)
  and brighten the wordmark for dark contrast.
- Replace the standing budget-alert snackbar with a **dismissible inline alert banner** (or a
  badge on the Budget nav item) with a "View budgets" action. Snackbars return to transient
  feedback only; today one snackbar permanently covers content in every captured state.
- Gate the hide-on-scroll header to mobile and throttle it with rAF outside the zone.

**Acceptance criteria:** first desktop paint shows content + docked nav, nothing dimmed; no
navigation dead zone at any width; bottom nav labeled with visible active state; no fixed
element under notch/home indicator on iPhone; no permanent snackbar.

---

## 7. Phase 3 — Shared component system (M effort)

Adopt-or-delete for the existing shared library, plus extraction of the patterns every page
currently hand-rolls. Each extraction lists its consumers.

| Component | Action | Consumers |
|---|---|---|
| `<app-page-header>` (title, subtitle, actions slot) | **extract** — pattern is copy-pasted on every page with drifting hierarchy | all feature pages |
| `<app-period-selector>` (emits `{start,end}` + label) | **extract** — ~70 lines duplicated between Dashboard and Reports; fixes the weak light-mode selected state (use primary-tinted fill both themes, drop the checkmark) and ambiguous mobile labels | dashboard, reports, (transactions quick-filters later) |
| `<app-stat-card>` (icon, label, value, delta chip) | **extract** — currently three divergent implementations | financial-summary, spending-analysis, monthly-comparison, import confirm/history |
| `<app-transaction-row>` | **extract** — duplicated & diverged between transactions list and dashboard recent-transactions | both lists |
| `CategoryChipComponent` | **extend** with `tile` appearance + size input; replace 6+ local re-implementations (drifting alpha/size/radius, no dark handling) | lists, budgets, reports, import |
| `AmountDisplayComponent` | **fix (0.6) then adopt** for every amount rendering | app-wide |
| Dialog shell/defaults | `MAT_DIALOG_DEFAULT_OPTIONS` (width `min(400px, calc(100vw-32px))`, maxWidth) + one dialog chrome (title + close-X, pinned footer); kills the 400px-min-width overflow on 360px phones (budget + category dialogs) | all dialogs |
| `EmptyStateComponent` | already good — **adopt everywhere** (4 hand-rolled empty states bypass it); add `size='sm'` for in-card use | ai-summary, others |
| `LoadingSpinnerComponent` | adopt for page/section loading; document raw `mat-spinner` only inside buttons | 4 call sites |
| Notification service | one snackbar call shape exists already — wrap it; encode the "transient feedback only" policy | app-wide |
| `TranslatePipe` | make pure + memoize per (key, locale, params) — impure pipe currently re-evaluates ~440 bindings per CD cycle | app-wide |

**Acceptance criteria:** one implementation per pattern; deleting a local style block is the
common case in page passes below; no dialog overflows a 360px viewport.

---

## 8. Phase 4 — Page-level passes (in this order)

### 8.1 Dashboard
- **Composition (desktop ≥1024px):** asymmetric grid — main column (chart + AI insights) 7–8/12,
  right rail (recent transactions + budget progress) 4–5/12; kill the dead zone below the fifth
  transaction (or size card to content + footer "View all").
- **Single DOM tree**: replace the duplicated mobile/desktop trees toggled with `display:none`
  with one grid using `grid-template-areas`.
- **No full-page spinner on period change**: keep content mounted, show skeletons on first load
  only, subtle progress on refetch.
- **Donut**: total-spend center label, compact legend or top-3 direct labels, group <2% into
  "Other", tooltip shows `Category: $amount (xx%)`.
- **Category bars**: scale relative to the largest category; one decimal under 10% (four rows
  currently all read "1%" with 2-px bars that look broken).
- **Budget progress rows**: neutral gray track (indigo-on-lavender fill boundary doesn't pop),
  muted gray 0% (not success-green), secondary "$X left" text.
- **Delta chips**: tinted pill (green-100/700 light, green-900-30/300 dark) via tokens — current
  values fail contrast; keep the semantically-correct expense-up=red logic.
- Summary cards: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, tabular-nums, keep icon slot fixed.

### 8.2 Transactions
- **Default range = This Month** (today "Today" shows one row and a near-empty desktop canvas).
- **Date-grouped list**: sticky day headers ("Today", "Yesterday", "Jun 12") with right-aligned
  day totals; drop per-row dates on mobile.
- **Filters**: applied filters become dismissible chips with "Clear all" (badge "2" currently
  reveals nothing); merge the two identical calendar icon buttons into one labeled "Custom…"
  range picker; persistent search field; 40–44px chip heights.
- **Add action**: desktop — labeled primary button in the page header; mobile — bottom-nav FAB
  only (see 6.3).
- **Form dialog**: consistent floating labels on all fields (Amount/Category/Description
  currently placeholder-only), two-column Amount+Currency row with sane widths, tighter ~88px
  field pitch, visible scroll affordance above pinned footer, expense/income segment styled with
  primary/neutral fill (not error-red pink with three redundant signals).
- Right-align the AMOUNT column with its header; keyboard access for desktop rows.

### 8.3 Budgets
- True % + one semantic ramp bound to bar, %, and label together (0.2): green → amber at
  threshold → red at 100%+ (the bar currently stays indigo even at 85% "approaching limit").
- Keep short status labels on mobile ("Near limit", "Over budget") — icons currently orphaned.
- **Summary strip** above the grid: total budgeted, total spent, overall %, period label.
- Left-align tabs at natural width (two tabs currently stretch across 1440px); shorten the
  mobile tab label to "Recurring" (currently clips to "Recurrii" with pagination chevrons).
- One card shell + one dialog chrome across both tabs (mat-card vs hand-rolled div today).

### 8.4 Reports
- **Right chart form per range**: "This Month" → daily/weekly cumulative lines or a two-bar
  comparison (today: two floating dots in an empty plot); keep monthly series for 3M/Year.
- Category Breakdown gets its promised donut (tab icon is a pie chart; there is no chart) with
  per-category bars visible in collapsed accordion rows.
- Kill the ~700px dead zone in Top Spending Categories rows (bar under the name, or cap card
  width); styled legend swatches instead of hollow Chart.js boxes.
- Monthly table: responsive columns (drop Trend on mobile), no 500px horizontal scroll.
- Mobile: labeled compact Export button (currently a full-width icon-only indigo bar that reads
  as broken); text labels on the three tabs (icon-only glyphs are ambiguous).
- Localize period-chip month names, date formats, and the PDF export title.

### 8.5 Settings, Auth, About
- One settings IA: navigation cards to sub-pages (the AI Processing row is the model), one row
  anatomy (icon tile + title + description + trailing affordance); Sign Out moves out of
  "Danger Zone" into the profile card/user menu.
- Theme toggle: cap width (~480px), inline checkmark, primary-tinted selected state.
- Date Format field: pattern-only label with example as helper text (value collides with the
  select arrow today); fix the orphaned Language field (2-col grid or full-width).
- Dark mode: raise form-field outline contrast; distinct danger-item surface.
- Login: ship the logo as inline SVG (mobile shows clipped "ac" fallback text); raise footer
  link contrast; translate the tagline/footer (hardcoded English).
- Category dialog: `min(400px, calc(100vw - 32px))` sizing; add loading state + empty-state CTA
  to the category manager.

### 8.6 AI import flow
- Adopt tokens (5.1) — the flow currently paints a foreign indigo and Material-palette hexes.
- **Responsive stepper**: below ~600px, icon-only headers or a "Step 2 of 4 — Upload" line
  (labels truncate to "Uplo / Proces / Revie / Impo" at 390px, worse in ja/tc); encode step
  state (active bold, upcoming muted, completed check) — all four circles are currently
  identical solid indigo.
- **Render the computed-but-never-shown AI confidence indicator** on category chips (green/
  amber/red dot + tooltip) — it is the core review affordance of the feature.
- Fix dropzone semantics after selection (file list must not re-open the OS picker); ≥40px
  touch targets on preview-row actions; focus-visible on the notes textarea; translate the
  remaining hardcoded strings; restyle import-history with the same system as the wizard;
  fix the Import History empty state's oversized icon spilling out of the "Start Import" button.

---

## 9. Phase 5 — Dark mode, accessibility & i18n hardening (S/M effort)

A cross-cutting QA pass once phases 1–4 land, with the screenshot harness as the loop:

- **Dark mode:** one surface scale everywhere (`#121212` bg / one card step / toolbar matching) —
  three unrelated grays currently coexist per screen; verify every `dark:` pair; transaction
  row surface mismatch; tab-badge and status colors get dark variants.
- **Accessibility:** aria-labels on every icon-only control (bottom nav, budget card kebabs,
  reports header buttons); ≥44px touch targets (quick-filter chips, date buttons, preview
  actions are 28–32px today); focus management in any remaining hand-rolled overlay; contrast
  audit of all delta/status text.
- **i18n resilience:** ja strings measure up to 3.7× the English width — audit steppers,
  buttons, toggles, tabs with ja/tc; shorten ja stepper strings; drop `nowrap` on text buttons;
  English ordinal suffixes in translated frequency strings ("every 1st") need locale-aware
  formatting.
- **Motion:** honor `prefers-reduced-motion` (global kill-switch from 5.7) and gate infinite
  animations.

---

## 10. Sequencing, effort, and dependencies

| Phase | Scope | Effort | Depends on |
|---|---|---|---|
| 0 | Trust & correctness quick wins | ~3–5 dev-days | — |
| 1 | Token & theming foundation | ~2 weeks | — |
| 2 | Shell & navigation | ~1 week | 1 (tokens, z-scale) |
| 3 | Shared component system | ~1–1.5 weeks | 1 |
| 4 | Page passes (dashboard → transactions → budgets → reports → settings → import) | ~2–3 weeks | 1, 2, 3 |
| 5 | Dark/a11y/i18n hardening + visual QA | ~1 week | 1–4 |

Phases 0 and 1 can start in parallel. Within Phase 4, pages are independent and can be split
across contributors — each page pass should *delete* local styling in favor of Phase 1 tokens
and Phase 3 components.

**Suggested PR slicing:** one PR per numbered subsection (5.1, 5.2, … 8.1, 8.2 …), each with
before/after screenshots from the capture harness.

---

## 11. Verification loop — screenshot harness

The audit's capture harness is checked in at [`docs/ui-audit/tools/`](./ui-audit/tools/). It
runs the app against Firebase emulators with a seeded demo account and captures every page at
desktop/mobile × light/dark (+ ja spot-checks) — no real Firebase project or Google sign-in
required. Use it to produce before/after evidence on every UI PR and as a lightweight visual
regression baseline. See the README in that folder for the three-step setup.

---

## 12. Out of scope (noted for the roadmap)

- Multi-currency conversion **architecture** (offline rate caching strategy) beyond making
  displayed totals deterministic (0.1).
- New features (search backend, notifications center); this plan only touches presentation and
  layout.
- Full M3 dynamic-color/design-token adoption on iOS native chrome.
