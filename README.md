# HomeAccount

[![CI](https://github.com/zarda/home-account/actions/workflows/ci.yml/badge.svg)](https://github.com/zarda/home-account/actions/workflows/ci.yml)

A personal finance management application built with Angular 21, supporting web (PWA), iOS native, and macOS (Apple Silicon) platforms.

## Why This Project?

This project demonstrates modern Angular development practices with a focus on:

- **Signal-Based Architecture** - Uses Angular 21 signals for reactive state management instead of NgRx/Redux, resulting in less boilerplate and fine-grained reactivity
- **Real-Time Sync** - Firebase Firestore with `onSnapshot` subscriptions for instant UI updates across devices
- **Standalone Components** - No NgModules - all 40+ components use the modern standalone pattern
- **Multi-Currency Engine** - Transaction-level exchange rate tracking with 12-hour cached rates
- **Multi-Platform** - Single codebase deploys to web (Firebase), iOS (App Store), and macOS (Apple Silicon) via Capacitor
- **AI Integration** - Apple's on-device foundation model (Apple Intelligence) on macOS 26 / iOS 26, cloud AI (Gemini 3.1 / Gemma 4) for web, native Vision OCR everywhere as fallback
- **Type-Safe Throughout** - Full TypeScript with strict mode, DTOs, and well-defined interfaces

## Features

- **Dashboard** - Financial overview with income/expense summary and spending charts
- **Transactions** - Multi-currency support with filtering, tags, and location tracking
- **Budgets** - Period-based budget limits with recurring transactions management
- **Reports** - Financial analytics with CSV and PDF export
- **AI Import** - Import transactions from receipt images with intelligent category suggestions
- **Camera Capture** - Take photos directly from the app for receipt scanning
- **Dark Mode** - Light/dark/system theme support
- **Multi-language** - English, Traditional Chinese, Japanese
- **PWA Support** - Install as a native app on iOS/Android, works offline

## Platform-Specific Features

| Feature | Web (PWA) | iOS (Native) | macOS (Apple Silicon) |
|---------|-----------|--------------|-----------------------|
| **Receipt OCR** | Cloud AI (Gemini) | Vision OCR + Apple Intelligence (iOS 26+) | Apple Intelligence (on-device) → Cloud AI → Vision OCR |
| **Camera** | Browser API | Native Camera | File picker |
| **Offline** | Service Worker | Native + SW | Native + SW |
| **Donate Link** | Visible | Hidden (App Store guidelines) | Hidden (App Store guidelines) |
| **Installation** | Add to Home Screen | App Store | App Store / runs the iOS app ("Designed for iPad") |

On macOS the iOS build runs natively on Apple Silicon. When Apple Intelligence is available (macOS 26+ / iOS 26+ with the Foundation Models framework), receipts are processed fully on device: Vision OCR recognizes the text and Apple's foundation model structures it into transactions — no API key or network needed. Browsers cannot access Apple's model, so the Mac app is the way to use it; without Apple Intelligence, Macs fall back to the configured cloud models (Gemini 3.1 / Gemma 4) and then to the basic Vision OCR parser. Building the Apple Intelligence plugin requires Xcode 26 (it compiles to an unavailable stub on older SDKs).

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | Angular 21, TypeScript 5.9 |
| UI | Angular Material 21, Tailwind CSS 3.4 |
| State | Angular Signals |
| Backend | Firebase (Auth, Firestore) |
| AI (Web) | Google Generative AI (Gemini 3.1 / Gemma 4) |
| AI (On-Device) | Apple Foundation Models (Apple Intelligence) + Vision Framework |
| Multi-Platform | Capacitor 8 |
| Charts | Chart.js + ng2-charts |
| Export | jspdf, date-fns |
| PWA | Service Worker, IndexedDB |

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

`src/environments/environment.ts` re-exports from the gitignored `.vscode/environment.ts`, so local Firebase keys never land in version control. Production builds use `environment.production.ts` with values injected from CI/CD secrets.

## Build Commands

```bash
# Web (PWA)
npm run build:web          # Build for production
firebase deploy            # Deploy to Firebase Hosting

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

### iOS (Native OCR)
Native Vision OCR works automatically on iOS devices - no configuration needed.
Falls back to cloud AI if native OCR is unavailable.

## PWA Support

The web app is a fully-featured Progressive Web App:

- **Installable** - Add to home screen on any device
- **Offline Queue** - Images saved for processing when back online
- **Background sync** - Queued images processed when online

### iOS Installation (PWA)
1. Open in Safari
2. Tap Share button
3. Select "Add to Home Screen"

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Dev server at localhost:4200 |
| `npm run build` | Production build |
| `npm run build:ios` | Build and sync to iOS |
| `npm run cap:ios` | Open iOS project in Xcode |
| `npm test` | Run unit tests |
| `npm run test:ci` | Run unit tests once (headless, with coverage) |
| `npm run lint` | ESLint |
| `firebase deploy` | Deploy web to Firebase Hosting |

## Continuous Integration

GitHub Actions (`.github/workflows/ci.yml`) runs lint, headless unit tests with coverage, and a production build on every pull request and push to `main`. The coverage report is uploaded as a build artifact. Dependabot keeps npm packages and workflow actions current.

**Note:** `npm install` runs a postinstall script that patches `@capacitor-firebase/authentication` to remove the Facebook SDK dependency (only Google Sign-In is used).

## Live Demo

https://home-accounter.web.app
