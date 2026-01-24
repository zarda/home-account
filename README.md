# HomeAccount

A personal finance management application built with Angular 21, supporting both web (PWA) and iOS native platforms.

## Why This Project?

This project demonstrates modern Angular development practices with a focus on:

- **Signal-Based Architecture** - Uses Angular 21 signals for reactive state management instead of NgRx/Redux, resulting in less boilerplate and fine-grained reactivity
- **Real-Time Sync** - Firebase Firestore with `onSnapshot` subscriptions for instant UI updates across devices
- **Standalone Components** - No NgModules - all 40+ components use the modern standalone pattern
- **Multi-Currency Engine** - Transaction-level exchange rate tracking with 12-hour cached rates
- **Multi-Platform** - Single codebase deploys to web (Firebase) and iOS (App Store) via Capacitor
- **AI Integration** - Cloud AI (Gemini) for web, native Vision OCR for iOS
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

| Feature | Web (PWA) | iOS (Native) |
|---------|-----------|--------------|
| **Receipt OCR** | Cloud AI (Gemini) | Native Vision Framework |
| **Camera** | Browser API | Native Camera |
| **Offline** | Service Worker | Native + SW |
| **Donate Link** | Visible | Hidden (App Store guidelines) |
| **Installation** | Add to Home Screen | App Store |

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | Angular 21, TypeScript 5.9 |
| UI | Angular Material 21, Tailwind CSS 3.4 |
| State | Angular Signals |
| Backend | Firebase (Auth, Firestore) |
| AI (Web) | Google Generative AI (Gemini) |
| AI (iOS) | Apple Vision Framework |
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
# Prerequisites: Node.js 18+, Angular CLI

npm install

# Configure Firebase (see src/environments/)
# Configure Gemini API key in Profile Settings

npm start
```

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
| `npm run lint` | ESLint |
| `firebase deploy` | Deploy web to Firebase Hosting |

## Live Demo

https://home-accounter.web.app
