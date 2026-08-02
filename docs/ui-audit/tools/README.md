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

2. **Point the app at the emulators.** Create `.vscode/environment.ts` with the demo project:

   ```ts
   export const environment = {
     production: false,
     useEmulators: true,
     firebase: {
       apiKey: 'demo-api-key',
       authDomain: 'demo-home-account.firebaseapp.com',
       projectId: 'demo-home-account',
       storageBucket: 'demo-home-account.appspot.com',
       messagingSenderId: '000000000000',
       appId: '1:000000000000:web:demo',
       measurementId: 'G-DEMO'
     },
     donationUrlPaypal: ''
   };
   ```

   and (until a permanent `useEmulators` flag lands in `app.config.ts`) wire the emulator
   connectors in `src/app/app.config.ts`:

   ```ts
   // in provideAuth:      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
   // in provideFirestore: connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
   // in provideStorage:   connectStorageEmulator(storage, '127.0.0.1', 9199);
   ```

   (Gate each on `environment.useEmulators` and don't commit the wiring unless it's made a
   proper feature — see plan §11.)

3. **Run everything:**

   ```bash
   npx firebase emulators:start --only auth,firestore,storage --project demo-home-account &
   npm start &                        # ng serve on :4200
   cd docs/ui-audit/tools
   node capture.mjs                   # full sweep -> ./shots/
   node capture-scroll.mjs            # below-the-fold shots for long pages
   ```

## Files

| File | Purpose |
|---|---|
| `seed.mjs` | Seeds Firestore emulator: user profile, 40 transactions (3 months, multi-currency), 5 budgets (healthy/warning/exceeded), 4 recurring. Invoked by `capture.mjs`; can run standalone: `node seed.mjs <uid>`. |
| `capture.mjs` | Creates the demo auth user, seeds data, then screenshots all pages: desktop/mobile × light/dark, ja spot-checks, dialogs, user menu, and the default sidebar-open state. |
| `capture-scroll.mjs` | The app scrolls inside a fixed `.main-container`, so full-page screenshots clip; this scrolls the container and captures stepped viewport shots for long pages. |
| `capture-edit-dialog.mjs` | Opens the Edit Transaction dialog on a phone viewport and reports whether the Save Changes button is inside the visible viewport, at 390×844 and at a deliberately short 390×500 (the toolbar-collapsed iOS case). Prints a VERDICT line; run before/after a dialog-height change. `node capture-edit-dialog.mjs <label>`. |

Environment knobs: `CHROMIUM_PATH` (use a pre-installed Chromium instead of Playwright's
download); shots land in `docs/ui-audit/tools/shots/` (gitignored — commit only curated
evidence into `docs/ui-audit/`).
