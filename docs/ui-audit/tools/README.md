# UI screenshot harness

Captures the app's real rendered output — every main page at desktop (1440×900) and mobile
(390×844), in light and dark themes, plus Japanese-locale spot checks — against **Firebase
emulators** with a seeded demo account ("Alex Chen", July 2026 data). No real Firebase project
or Google sign-in needed: the scripts create a Google-linked user via the Auth emulator REST API
and inject the session directly into IndexedDB, then seed Firestore over the emulator REST API.

Originally built to audit the app for the 2026-07 UI upgrade (landed via #96).
Re-run it on UI PRs for before/after screenshots; commit only curated evidence
into [`docs/ui-audit/`](../).

## Setup

1. **Install harness deps** (in this folder — kept out of the app's package.json):

   ```bash
   cd docs/ui-audit/tools
   npm init -y
   npm i playwright material-icons @fontsource/pt-sans
   npx playwright install chromium   # or set CHROMIUM_PATH to an existing binary
   ```

   `material-icons` / `@fontsource/pt-sans` are served to the page via Playwright route
   interception, so screenshots render correct icons/fonts even with no network access.

2. **Serve the app against the emulators.** Nothing is edited: the committed `emulators`
   build configuration (`angular.json`) swaps `src/environments/environment.ts` for
   `environment.emulators.ts` — this harness's demo project, `demo-home-account`, with the
   `demo-api-key` the scripts key their session records by — and `src/environments/emulators.ts`
   for `emulators.on.ts`, which names the four emulator hosts from `firebase.json`. Auth,
   Firestore, Storage and the invite callable connect to them before their first use.
   `src/app/build-configurations.spec.ts` fails if any other configuration, the production
   build above all, ever picks up either file
   ([ADR 0155](../../ADR/0155-journeys-that-need-two-accounts-run-against-the-emulators.md)).

3. **Run everything:**

   ```bash
   npx firebase emulators:start --only auth,firestore,storage --project demo-home-account &
   npx ng serve --configuration emulators &   # :4200, where the capture scripts look
   cd docs/ui-audit/tools
   node capture.mjs                   # full sweep -> ./shots/
   node capture-scroll.mjs            # below-the-fold shots for long pages
   ```

   `npm run start:emulators` serves the same configuration on :4300 instead. That is the port
   the two-account browser journeys use ([e2e.md](../../e2e.md)), so its origin never shares a
   session or a Firestore cache with a production serve on :4200. Never run the emulators here
   while `npm run smoke` is running: they take the same ports.

## Files

| File | Purpose |
|---|---|
| `seed.mjs` | Seeds Firestore emulator: user profile, 40 transactions (3 months, multi-currency), 5 budgets (healthy/warning/exceeded), 4 recurring. Invoked by `capture.mjs`; can run standalone: `node seed.mjs <uid>`. |
| `seed-household.mjs` | Seeds two household-ready accounts for the two-account browser journeys: Alex Chen (USD) and Sam Lee (JPY), each a Google-linked, verified user in the Auth emulator, each given `seed.mjs`'s data, then their own name, address and base currency, one custom category, one budget current for this month, one goal and two rows this month — one of Alex's a converted yen row with no base stamp. Writes both IndexedDB session records to the path given, as `{ alex, sam }`, in a file only its owner can read, and refuses a path inside the repository: the records carry live emulator tokens. `node seed-household.mjs <sessions.json outside the repo>`. |
| `capture.mjs` | Creates the demo auth user, seeds data, then screenshots all pages: desktop/mobile × light/dark, ja spot-checks, dialogs, user menu, and the default sidebar-open state. |
| `capture-scroll.mjs` | The app scrolls inside a fixed `.main-container`, so full-page screenshots clip; this scrolls the container and captures stepped viewport shots for long pages. |
| `capture-edit-dialog.mjs` | Opens the Edit Transaction dialog on a phone viewport and reports whether the Save Changes button is inside the visible viewport, at 390×844 and at a deliberately short 390×500 (the toolbar-collapsed iOS case). Prints a VERDICT line; run before/after a dialog-height change. `node capture-edit-dialog.mjs <label>`. |
| `capture-dialogs.mjs` | The same check across every dialog in the app (transaction add/edit, confirm, budget, recurring, category, export, AI search, camera), at four viewport heights from an ordinary portrait phone down to landscape. Prints PASS/FAIL per dialog per height and shoots the tallest and shortest. Run before/after any change to dialog sizing: `node capture-dialogs.mjs <label>`. |
| `capture-overflow.mjs` | Hunts content that is clipped, collapsed, or pushed out of reach, on five pages across seven widths (320–1440) in three passes: `en`, `ja`, and one with the safe-area variables overridden to notch-sized values. Seeds four deliberately hostile transactions first — an unbreakable URL, a nine-figure foreign amount, a category and location longer than their columns — because realistic data does not provoke the bug. Distinguishes "outside a scroller" (fine) from "outside `overflow: hidden`" (gone). Prints PASS/FAIL per page per width and exits non-zero on any finding. Run before/after any layout change: `node capture-overflow.mjs <label>`. |

Environment knobs: `CHROMIUM_PATH` (use a pre-installed Chromium instead of Playwright's
download); shots land in `docs/ui-audit/tools/shots/` (gitignored — commit only curated
evidence into `docs/ui-audit/`).

`capture-overflow.mjs` is the enforcement half of [docs/ui-overflow.md](../../ui-overflow.md):
each of the five invariants there has a corresponding check here, so a rule that gets
broken later fails a run rather than only reading badly in review.
