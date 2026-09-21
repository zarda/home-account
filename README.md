# HomeAccount

[![CI](https://github.com/zarda/home-account/actions/workflows/ci.yml/badge.svg)](https://github.com/zarda/home-account/actions/workflows/ci.yml)

A personal finance management application built with Angular 22, supporting web (PWA), iOS native, and macOS (Apple Silicon) platforms.

## Why This Project?

This project demonstrates modern Angular development practices with a focus on:

- **Signal-Based Architecture** - Uses Angular 22 signals for reactive state management instead of NgRx/Redux, resulting in less boilerplate and fine-grained reactivity
- **Real-Time Sync** - Firebase Firestore with `onSnapshot` subscriptions for instant UI updates across devices
- **Standalone Components** - No NgModules - all 40+ components use the modern standalone pattern
- **Multi-Currency Engine** - Transaction-level exchange rate tracking with 12-hour cached rates
- **Multi-Platform** - Single codebase deploys to web (Firebase), iOS (App Store), and macOS (Apple Silicon) via Capacitor
- **AI Integration** - Apple's on-device foundation model (Apple Intelligence) on macOS 26 / iOS 26, cloud AI (Gemini 3.5 / Gemma 4) for web, native Vision OCR everywhere as fallback
- **Type-Safe Throughout** - Full TypeScript with strict mode, DTOs, and well-defined interfaces

## Features

- **Dashboard** - Financial overview with income/expense summary and spending charts, plus an opt-in weekly recap: last week's spending, where it went, and what is still due, once a week until you close it — with a Monday notification on the installed app and an optional AI write-up — see [docs/weekly-recap.md](docs/weekly-recap.md). Five of its cards can be moved, hidden and reset per account, from Settings — see [docs/dashboard.md](docs/dashboard.md)
- **Transactions** - Multi-currency support with filtering, tags, and location tracking; typo-tolerant search with saved and recent searches, plus insight quick-filter chips (unusual amounts, new and top categories) computed locally from your data. A purchase that covers more than one category can be split across them, taking amounts off the total rather than re-entering it — see [docs/splits.md](docs/splits.md). A note kept in a receipt's own script can be shown translated into your language on demand — the stored note is never touched and the translation is never saved — see [docs/translation-lens.md](docs/translation-lens.md)
- **Smart Search** - Ask questions in plain language from the app header ("how much did I spend on groceries last month"); the AI only translates the question into filters or an aggregate operation — every number shown is computed locally from your transactions, and it degrades to keyword search offline
- **Budgets** - Period-based budget limits with recurring transactions management
- **Reports** - Financial analytics with CSV and PDF export
- **AI Import** - Import receipts, bank-statement screenshots and PDF statements. Statements become one transaction per line; receipts collapse to the purchase they add up to. Categories are validated against your catalog, corrections are remembered per merchant so the same shop is never re-asked, and amounts or dates the model was unsure it read are flagged for a second look. The review step is where you fix them — the date, amount, description, category and currency are all editable on the card, a receipt dated on any day but today has to be kept or re-dated before the import will move, and a row you correct is checked for duplicates again. PDFs work with any vision-capable provider — see [docs/prompts.md](docs/prompts.md)
- **AI Insights** - Spending summaries and advice with selectable detail-grounding levels (Off/Light/Standard/Deep) that trade token cost and speed for detail; transaction details are only shared with your configured AI provider when enabled — see [docs/rag-insights.md](docs/rag-insights.md)
- **Camera Capture** - Take photos directly from the app for receipt scanning
- **Dark Mode** - Light/dark/system theme support
- **Multi-language** - English, Traditional Chinese, Japanese
- **Usage statistics** - Included in the free plan; premium accounts can turn it off. Only which screens are opened and which features are used are recorded; never amounts, merchants, categories, notes or anything you typed — see [docs/analytics.md](docs/analytics.md)
- **PWA Support** - Install to the home screen on iOS/Android; a receipt photographed without a connection waits in an on-device queue and is processed when the connection returns

## Platform-Specific Features

| Feature | Web (PWA) | iOS (Native) | macOS (Apple Silicon) |
|---------|-----------|--------------|-----------------------|
| **Receipt OCR** | Cloud AI (Gemini) | Vision OCR + Apple Intelligence (iOS 26+) | Apple Intelligence (on-device) → Cloud AI → Vision OCR |
| **Camera** | Browser API | Native Camera | File picker |
| **Offline** | Offline queue in IndexedDB; no caching worker | Offline queue in IndexedDB | Offline queue in IndexedDB |
| **Donate Link** | Visible | Hidden (App Store guidelines) | Hidden (App Store guidelines) |
| **Home-screen widget** | Not available | This month's spend, net, top budget and next bill, from the dashboard's last paint — see [docs/widget.md](docs/widget.md) | Not available |
| **Installation** | Add to Home Screen | App Store | App Store / runs the iOS app ("Designed for iPad") |

On macOS the iOS build runs natively on Apple Silicon. When Apple Intelligence is available (macOS 26+ / iOS 26+ with the Foundation Models framework), receipts are processed fully on device: Vision OCR recognizes the text and Apple's foundation model structures it into transactions — no API key or network needed. Browsers cannot access Apple's model, so the Mac app is the way to use it; without Apple Intelligence, Macs fall back to the configured cloud models (Gemini 3.5 / Gemma 4) and then to the basic Vision OCR parser. Building the Apple Intelligence plugin requires Xcode 26 (it compiles to an unavailable stub on older SDKs).

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | Angular 22, TypeScript 6.0 |
| UI | Angular Material 22, Tailwind CSS 3.4 |
| State | Angular Signals |
| Backend | Firebase (Auth, Firestore) |
| AI (Web) | Google Generative AI (Gemini 3.5 / Gemma 4); OpenAI and Anthropic as alternative providers |
| AI (On-Device) | Apple Foundation Models (Apple Intelligence) + Vision Framework |
| Multi-Platform | Capacitor 8 |
| Charts | Chart.js + ng2-charts |
| Export | jspdf, date-fns |
| PWA | Share-target service worker (share intake and reminder notifications), IndexedDB |

## Project Structure

```
home-account/
├── src/
│   ├── app/
│   │   ├── core/                    # Business logic layer
│   │   │   ├── services/            # Core services
│   │   │   │   ├── auth.service.ts          # Firebase Auth, user profile
│   │   │   │   ├── firestore.service.ts     # Generic CRUD, real-time subscriptions
│   │   │   │   ├── transaction.service.ts   # Transactions, filtering, currency
│   │   │   │   ├── budget.service.ts        # Budget periods, spending, alerts
│   │   │   │   ├── gemini.service.ts        # Cloud AI receipt parsing
│   │   │   │   ├── ai-strategy.service.ts   # Platform-aware AI orchestration
│   │   │   │   ├── cloud-llm-provider.service.ts # Multi-provider cloud AI
│   │   │   │   └── ...
│   │   │   ├── plugins/             # Capacitor plugin TypeScript bridges
│   │   │   │   └── vision-ocr.plugin.ts     # iOS Vision OCR plugin bridge
│   │   │   └── guards/
│   │   ├── features/                # Feature modules
│   │   ├── shared/                  # Reusable components, pipes
│   │   └── models/                  # TypeScript interfaces
│   └── assets/i18n/                 # Translation files (en, tc, ja)
├── ios/                             # iOS native project (Xcode)
│   └── App/
│       └── Plugins/                 # Native plugins (Vision OCR Swift code)
├── capacitor.config.ts              # Capacitor configuration
└── package.json
```

## Multi-Platform Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Angular App                              │
├─────────────────────────────────────────────────────────────────┤
│                    AIStrategyService                             │
│                  (Platform Detection)                            │
│                         │                                        │
│          ┌──────────────┴──────────────┐                        │
│          ▼                             ▼                        │
│   ┌─────────────┐              ┌─────────────┐                  │
│   │     WEB     │              │     iOS     │                  │
│   │             │              │             │                  │
│   │  Cloud AI   │              │ Native OCR  │                  │
│   │  (Gemini)   │              │  (Vision)   │                  │
│   └─────────────┘              └─────────────┘                  │
│          │                             │                        │
│          ▼                             ▼                        │
│   Firebase Hosting              App Store                       │
└─────────────────────────────────────────────────────────────────┘
```

## Getting Started

```bash
# Prerequisites: Node.js 20+, Angular CLI

npm install

# Configure Firebase: copy the template and fill in your project values
mkdir -p .vscode
cp src/environments/environment.local.example.ts .vscode/environment.ts
# Edit .vscode/environment.ts with your Firebase config

# Configure Gemini API key in Profile Settings (after first run)

npm start
```

`src/environments/environment.ts` re-exports from the gitignored `.vscode/environment.ts`, so local Firebase keys never land in version control. Production builds use the gitignored `environment.prod-local.ts` — copy `src/environments/environment.prod-local.example.ts` to `environment.prod-local.ts` and fill in your Firebase values, so deploy config stays out of version control too. (If it's missing, the production build fails loudly rather than shipping placeholders.)

## Build Commands

```bash
# Web (PWA)
npm run build:web          # Build for production
# Merging to main deploys automatically (hosting, rules, indexes — see
# docs/deploy.md). Manual fallback:
npx firebase deploy --only hosting,firestore,storage

# iOS
npm run build:ios          # Build and sync to iOS
npm run cap:ios            # Open Xcode project
# Then build/archive in Xcode for App Store
```

### iOS: Firebase / Google Sign-In setup

The Xcode project expects `ios/App/App/GoogleService-Info.plist` (this file is not committed because it contains API keys). To build the iOS app:

1. **Option A:** In [Firebase Console](https://console.firebase.google.com/) → your project → Project settings → General, add an iOS app or download **GoogleService-Info.plist**, then copy it to `ios/App/App/GoogleService-Info.plist`.
2. **Option B:** Copy the template and fill in your values:
   ```bash
   cp ios/App/App/GoogleService-Info.plist.example ios/App/App/GoogleService-Info.plist
   ```
   Then replace the placeholders in `GoogleService-Info.plist` with your Firebase project values (same Firebase Console page).

Without this file, the Xcode build will fail with a missing resource error. The **Google Sign-In URL scheme** (CFBundleURLTypes) is injected into Info.plist at build time from your `GoogleService-Info.plist`’s `REVERSED_CLIENT_ID`, so it always matches your Firebase project—no need to add it manually in Xcode.

## AI Configuration

### Web (Cloud AI)
1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/)
2. Go to **Settings > AI Processing**
3. Expand "Google Gemini" and enter your API key
4. Optionally configure OpenAI or Claude as alternative providers

Each AI feature — receipt scanning, categorization, insights, and smart
search — can be pinned to a specific provider in the same settings page;
unavailable providers fall back in the order Gemini → OpenAI → Claude.

### iOS (Native OCR)
Native Vision OCR works automatically on iOS devices - no configuration needed.
Falls back to cloud AI if native OCR is unavailable.

## PWA Support

The web app installs as a Progressive Web App:

- **Installable** - The browser offers its own install prompt where it has one; the app neither suppresses it nor puts up a prompt of its own. iOS has no such prompt, so it is still Add to Home Screen from the Share sheet (below)
- **Offline queue** - A receipt captured without a connection is stored in IndexedDB on the device and processed when the connection returns, or on **Sync Now** in Settings → AI Processing
- **Share target** - A receipt shared from another app lands in the import wizard ([docs/share-import.md](docs/share-import.md))

There is no caching worker: the app itself needs a connection to load.

### iOS Installation (PWA)
1. Open in Safari
2. Tap Share button
3. Select "Add to Home Screen"

## Scripts

Every step the `ci` job runs, in the order it runs it. Two of them are not
`npm` scripts and are written the way CI writes them; the deploy-only commands
are a separate table below, because they belong to `deploy-web` and never run
here.

| Command | Description |
|---------|-------------|
| `npm --prefix functions test` | The functions workspace's own tests, after `npm --prefix functions ci` builds it — not a root script |
| `npm run lint` | ESLint, templates included |
| `npm run lint-guards:check` | Verify the ESLint import and syntax bans still resolve for the files they were written for — the analytics ban died once by being silently replaced |
| `npm run i18n:check` | Verify every literal translation key resolves in all locales, and no template hard-codes an aria-label, alt text or visible English sentence ([docs/i18n.md](docs/i18n.md)) |
| `npm run analytics:check` | Verify docs/analytics.md matches the tracked events and routes |
| `npm run prompts:check` | Verify every registered prompt reaches every provider and is documented |
| `npm run indexes:check` | Verify firestore.indexes.json covers every transaction filter combination |
| `npm run firebase-tools:check` | Verify the pinned firebase-tools major has not drifted |
| `node scripts/check-prod-env.mjs --self-test` | The digest checker's own logic, against a stub. **CI runs this half only** — the "Create local environment stubs" step overwrites the file the real digest was taken from, so the compare would fail here by construction. The real compare belongs to `deploy-web`, below |
| `node scripts/wait-for-indexes.mjs --self-test` | The index wait's state classification, deadline math, signed assertion and token-and-poll loop, against a local stub server. The real wait reaches the Firestore Admin API and belongs to `deploy-web`, below |
| `npm run truncation:check` | Verify nothing under src/ declares text-overflow — G3, nothing truncates ([docs/ui-overflow.md](docs/ui-overflow.md)) |
| `npm run grid:check` | Verify no `grid-template-columns` nests a `minmax()` inside another or declares a bare `1fr` — G2 ([docs/ui-overflow.md](docs/ui-overflow.md)) |
| `npm run direction:check` | Verify the physical-direction CSS is still exactly where the per-file baseline says ([docs/rtl.md](docs/rtl.md)) |
| `npm run material:check` | Verify every `Mat*Module` a component imports is used by its template — ESLint counts the symbol as used the moment it appears in the array |
| `npm run dates:check` | Run the date audit greps over production code — a hand-built end-of-day or month end, a UTC day key, a day step in milliseconds, a re-parsed date field ([docs/dates.md](docs/dates.md)) |
| `npm run motion:check` | Verify both reduced-motion kill-switches are intact and no component stylesheet declares an `!important` duration that outruns them ([docs/accessibility.md](docs/accessibility.md)) |
| `npm run contrast:check` | Score every colour pair the app paints against WCAG AA, in all four rendered modes ([docs/accessibility.md](docs/accessibility.md)) |
| `npm run icon-labels:check` | Verify every `mat-icon` carrying `role="img"` or an aria-label also carries a literal `aria-hidden` — a bound one does not reach Material's constructor ([docs/accessibility.md](docs/accessibility.md)) |
| `npm run test:ci` | Run unit tests once (headless, with coverage) |
| `npm run test:dates` | Run the zone-sensitive specs — CI runs them twice, under `TZ=America/New_York` and `TZ=Asia/Tokyo` |
| `npm run smoke` | Run integration tests against Firebase emulators, including the axe-core accessibility pass over every route the walkthrough opens (requires JDK 21+) |
| `npm run smoke:dates` | Run the zone-sensitive smoke specs under two shifted timezones, with one emulator boot |
| `npm run build` | Production build |

Deploy only — these run in `deploy-web` on a push to `main`, never in the `ci`
job ([docs/deploy.md](docs/deploy.md)):

| Command | Description |
|---------|-------------|
| `npm run prod-env:check` | The real compare: the `PROD_ENVIRONMENT_TS` secret against its committed digest. Its `--self-test` half is what the `ci` job runs, above |
| `node scripts/wait-for-indexes.mjs` | Poll the Firestore Admin API until every composite index the deploy accepted is `READY` — the deploy returns as soon as the definitions are taken |

Local only:

| Command | Description |
|---------|-------------|
| `npm start` | Dev server at localhost:4200 |
| `npm run build:ios` | Build and sync to iOS |
| `npm run cap:ios` | Open iOS project in Xcode |
| `npm test` | Run unit tests |
| `npm run test:ios` | Run the Swift share-seam tests in the iOS Simulator — CI never builds iOS; edit the destination if iPhone 17 is not installed |
| `npx firebase deploy --only hosting,firestore,storage` | Manual web deploy — merges to `main` deploy automatically ([docs/deploy.md](docs/deploy.md)) |

## Continuous Integration

GitHub Actions (`.github/workflows/ci.yml`) runs, in order, the functions workspace build and tests, lint, the lint-guard check, the translation-key check, the analytics-registry check, the prompt-registry check, the composite-index check, the firebase-tools major check, the self-test of the production-config digest checker (the real compare belongs to `deploy-web`), the self-test of the Firestore index wait (which cannot reach the Admin API outside a deploy), the truncation check, the grid-track check, the direction check, the Material-imports check, the date-arithmetic check, the reduced-motion check, the colour-contrast check, the icon-label check, headless unit tests with coverage, the date specs under two non-UTC timezones, the emulator smoke tests, the zone-sensitive smoke specs under the same two timezones, and a production build — on every pull request and push to `main`. The Scripts table above lists the same steps with what each one is for; the two tables change together. On a push to `main`, a `changes` job classifies what the merge touched and a green pipeline fans out into deploys: `deploy-web` rebuilds against the real production config held in the `PROD_ENVIRONMENT_TS` secret and ships hosting, the Firestore rules and indexes, and the Storage rules, while `deploy-functions` ships the Cloud Function when `functions/` or `firebase.json` changed — docs-only merges deploy nothing, and [docs/deploy.md](docs/deploy.md) is the runbook. The coverage report is uploaded as a build artifact. Dependabot keeps npm packages and workflow actions current. Nothing in CI builds the iOS target, so native changes are verified only by a local `npm run build:ios` and an Xcode run.

**Note:** `npm install` runs a postinstall script that patches `@capacitor-firebase/authentication` to remove the Facebook SDK dependency (only Google Sign-In is used).

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/analytics.md](docs/analytics.md) | GA4 event taxonomy, tagging registry, consent, privacy boundary, console setup |
| [docs/prompts.md](docs/prompts.md) | The prompt registry, how prompts are written, and what the consistency check can and cannot see |
| [docs/ai-models.md](docs/ai-models.md) | The model catalog and its defaults, how a stored choice outranks them, and the procedure for retiring a model |
| [docs/insights.md](docs/insights.md) | Spending-pattern detectors, monthly snapshots, card contract, privacy boundary |
| [docs/rag-insights.md](docs/rag-insights.md) | Detail-grounded AI insights: levels, privacy trade-off, preference storage |
| [docs/translation-lens.md](docs/translation-lens.md) | Reading a stored note in your own language: where the controls are, what is sent, the session cache, the failure classes, and what is never written |
| [docs/receipt-import.md](docs/receipt-import.md) | What bounds receipt scanning, which engine runs, where the amount comes from, and the offline queue |
| [docs/receipt-quota.md](docs/receipt-quota.md) | The receipt-image quota: the trigger-owned count, how the limit is resolved, what the rules allow, and the fail-open windows |
| [docs/model-probe/](docs/model-probe/README.md) | Manual probe: the real receipt prompt against a real model, compared to a recorded baseline |
| [docs/merchant-match-probe/](docs/merchant-match-probe/README.md) | Manual probe: whether embedding merchant text beats the string threshold, and the recorded answer |
| [docs/remote-config.md](docs/remote-config.md) | Firebase Remote Config parameters and defaults |
| [docs/storage-cors-setup.md](docs/storage-cors-setup.md) | One-time Cloud Storage CORS setup for in-browser receipt reads |
| [docs/ui-overflow.md](docs/ui-overflow.md) | What the app does when content does not fit: the five layout invariants, and where each is enforced |
| [docs/recurring.md](docs/recurring.md) | Recurring rules: frequencies, the clamp and the anchor, the catch-up engine, pause/resume, the reminder lead, the Upcoming card, and the validity floor |
| [docs/reminders.md](docs/reminders.md) | Bill and budget reminders: the opt-in, when a sweep runs, the per-device dedup keys, and the web/native delivery split |
| [docs/weekly-recap.md](docs/weekly-recap.md) | The weekly recap: the opt-in, which week and its key, where the figures come from, the card's lifetime, the Monday nudge, the narrative gate, and the device-local state |
| [docs/dashboard.md](docs/dashboard.md) | The dashboard: its fixed parts and its five arranged cards, what each card reads, the layout preference and its resolver, the desktop areas rule, and the editor |
| [docs/smart-search.md](docs/smart-search.md) | Natural-language search: one interpretation call, local aggregation, keyword fallback, and the persisted answer history |
| [docs/account-deletion.md](docs/account-deletion.md) | Account deletion: the client-side cascade, its ordering, partial-failure semantics, and the rules it needed |
| [docs/share-import.md](docs/share-import.md) | Share-sheet import: the web share target and its minimal service worker, and the iOS Share Extension handoff |
| [docs/widget.md](docs/widget.md) | The iOS home-screen widget: the snapshot contract, when it is written and deduplicated, the four states, the plugin and target, and verifying it on the simulator |
| [docs/goals.md](docs/goals.md) | Savings goals and projects: the model, transactional contributions, the checklist rule, and where goals surface |
| [docs/forecast.md](docs/forecast.md) | The cash-flow forecast: zero-at-today baseline, the catch-up seam, horizons, and what never projects |
| [docs/csv-format.md](docs/csv-format.md) | The CSV export and import contract: columns, escaping, and what round-trips |
| [docs/import-fields.md](docs/import-fields.md) | What an import writes: the row shapes, the one mapper every door builds through, photo attachment, the recorded source, and where a suggestion comes from |
| [docs/backup-restore.md](docs/backup-restore.md) | The JSON backup: what the file carries, what a restore merges rather than replaces, what it will not touch, and the wizard's reviewed way back in |
| [docs/performance.md](docs/performance.md) | What loads eagerly, where the heavy dependencies load instead, and the bundle budget |
| [docs/dates.md](docs/dates.md) | Date and period conventions: local parts, day and month keys, and the window contracts |
| [docs/money-snapshots.md](docs/money-snapshots.md) | Money that is stored already converted: what each figure is denominated in, when it is re-taken, and what repairs it |
| [docs/period-totals.md](docs/period-totals.md) | The transactions header totals: the whole-set sweep, exact-or-absent rendering, the cap, and what refolds versus what re-reads |
| [docs/one-shot-reads.md](docs/one-shot-reads.md) | Reads that must see the whole collection: which values may never come from a listener's first emission, and which must be answered by the server |
| [docs/splits.md](docs/splits.md) | Splitting a purchase across categories: the sibling-row model, what a part carries, the form's remainder and refusals, and what still counts a split as several rows |
| [docs/data.md](docs/data.md) | The stored-data hub: every kind of record, where each is managed, and what the counts do and do not mean |
| [docs/feedback.md](docs/feedback.md) | In-app feedback: the stored record, its About-page door, and the mail that leaves from a Cloud Function |
| [docs/emulator-blind-spots.md](docs/emulator-blind-spots.md) | What the emulator suite cannot check: composite indexes, deployed rules and indexes, the browser layer, and the checks that stand in |
| [docs/e2e.md](docs/e2e.md) | The browser journey protocol: the checks before every run, the writes a run may make and how they are put back, the journeys and their passes |
| [docs/i18n.md](docs/i18n.md) | The translation catalog: which language a session speaks and where a new account's comes from, plural entries that only English carries, the checker's three scans, and what still escapes them |
| [docs/exchange-rates.md](docs/exchange-rates.md) | Where the exchange-rate table comes from: the fallback ladder from live fetch to device cache to constants, and what each rung stamps |
| [docs/auth.md](docs/auth.md) | The session lifecycle: the auth-state listener, the degraded fallback profile and its retry, and the identity check every write across an await makes |
| [docs/accessibility.md](docs/accessibility.md) | What the app guarantees to assistive technology, where each guarantee is enforced, and the gaps that remain |
| [docs/onboarding.md](docs/onboarding.md) | The first-run welcome: what decides a launch is a first run, the three panes, what a skip records, and the About-page card that replays it |
| [docs/shortcuts.md](docs/shortcuts.md) | The two global keyboard shortcuts, the guards each stands down for, and the command palette they open |
| [docs/rtl.md](docs/rtl.md) | Layout direction: where a locale's direction comes from, the ratchet that freezes the physical CSS left, and what still blocks an RTL locale |
| [docs/locale-formatting.md](docs/locale-formatting.md) | Dates and numbers in the chosen language: the one formatting chokepoint, named styles over patterns, and what deliberately stays raw |
| [docs/deploy.md](docs/deploy.md) | What deploys when: the change-gated CI deploys, the manual override, the service account and both secret inventories, the index-deletion policy, and the version scheme |
| [docs/ADR/](docs/ADR/) | Architecture decision records: why things are the way they are, and what was rejected |
| [docs/ui-audit/tools/](docs/ui-audit/tools/) | Screenshot harness for before/after evidence on UI PRs |

## Live Demo

https://home-accounter.web.app
