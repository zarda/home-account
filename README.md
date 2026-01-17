# HomeAccount

A personal finance management application built with Angular 21.

## Why This Project?

This project demonstrates modern Angular development practices with a focus on:

- **Signal-Based Architecture** - Uses Angular 21 signals for reactive state management instead of NgRx/Redux, resulting in less boilerplate and fine-grained reactivity
- **Real-Time Sync** - Firebase Firestore with `onSnapshot` subscriptions for instant UI updates across devices
- **Standalone Components** - No NgModules - all 40+ components use the modern standalone pattern
- **Multi-Currency Engine** - Transaction-level exchange rate tracking with 12-hour cached rates
- **AI Integration** - Gemini API for receipt parsing and intelligent category suggestions
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
- **Local AI** - On-device OCR with Tesseract.js for privacy-first receipt scanning
- **ML Enhancement** - Optional Transformers.js model for improved accuracy

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | Angular 21, TypeScript 5.9 |
| UI | Angular Material 21, Tailwind CSS 3.4 |
| State | Angular Signals |
| Backend | Firebase (Auth, Firestore) |
| AI (Cloud) | Google Generative AI (Gemini) |
| AI (Local) | Tesseract.js (OCR), @huggingface/transformers (ML) |
| Charts | Chart.js + ng2-charts |
| Export | jspdf, date-fns |
| PWA | Service Worker, IndexedDB |

## Project Structure

```
src/
├── app/
│   ├── core/                    # Business logic layer
│   │   ├── services/            # Core services
│   │   │   ├── auth.service.ts          # Firebase Auth, user profile
│   │   │   ├── firestore.service.ts     # Generic CRUD, real-time subscriptions
│   │   │   ├── transaction.service.ts   # Transactions, filtering, currency conversion
│   │   │   ├── budget.service.ts        # Budget periods, spending, alerts
│   │   │   ├── category.service.ts      # System defaults + custom categories
│   │   │   ├── currency.service.ts      # Exchange rates with caching
│   │   │   ├── theme.service.ts         # Light/dark/system theme
│   │   │   ├── translation.service.ts   # i18n with locale detection
│   │   │   ├── export.service.ts        # CSV & PDF generation
│   │   │   ├── gemini.service.ts        # Cloud AI receipt parsing (Gemini)
│   │   │   ├── local-ai.service.ts      # On-device OCR (Tesseract.js)
│   │   │   ├── transformers-ai.service.ts # ML parsing (Transformers.js)
│   │   │   ├── ml-worker.service.ts     # Web Worker for ML processing
│   │   │   ├── ai-strategy.service.ts   # Hybrid AI decision logic
│   │   │   ├── offline-queue.service.ts # Queue for offline processing
│   │   │   ├── pwa.service.ts           # PWA state & caching
│   │   │   ├── ai-import.service.ts     # AI import workflow orchestration
│   │   │   └── device.service.ts        # Device capabilities detection
│   │   └── guards/              # Route protection
│   │       ├── auth.guard.ts            # Protect authenticated routes
│   │       └── public.guard.ts          # Redirect logged-in users
│   ├── features/                # Feature modules
│   │   ├── auth/                # Google OAuth login
│   │   ├── dashboard/           # Financial overview, charts
│   │   ├── transactions/        # CRUD, filtering, multi-currency, camera capture
│   │   ├── budgets/             # Budget limits, alerts, recurring transactions
│   │   ├── reports/             # Analytics, CSV/PDF export
│   │   ├── ai/                  # AI-powered import wizard, category suggestions
│   │   └── settings/            # User preferences, categories, AI settings
│   │       └── ai-settings-page/ # Dedicated AI configuration page
│   ├── workers/                 # Web Workers
│   │   └── ml.worker.ts         # Transformers.js ML processing
│   ├── shared/
│   │   ├── components/          # Reusable UI (dialogs, chips, spinners)
│   │   ├── layout/              # Main layout, header, sidebar, bottom nav
│   │   └── pipes/               # TranslatePipe
│   └── models/                  # TypeScript interfaces
│       ├── user.model.ts
│       ├── transaction.model.ts
│       ├── budget.model.ts
│       ├── category.model.ts
│       └── currency.model.ts
├── assets/i18n/                 # Translation files (en, tc, ja)
├── service-worker.ts            # Custom service worker for PWA
└── environments/                # Firebase configs
```

## System Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   PRESENTATION LAYER                        │
│   Components (standalone)  |  Layout  |  Dialogs  |  Pipes  │
├─────────────────────────────────────────────────────────────┤
│                   BUSINESS LOGIC LAYER                      │
│   AuthService | TransactionService | BudgetService | ...    │
│   (Signal-based state management + computed values)         │
├─────────────────────────────────────────────────────────────┤
│                    DATA ACCESS LAYER                        │
│   FirestoreService (generic CRUD + real-time subscriptions) │
├─────────────────────────────────────────────────────────────┤
│                    EXTERNAL SERVICES                        │
│   Firebase Auth | Firestore | ExchangeRate-API | Gemini AI  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌───────────┐      ┌─────────────────┐      ┌──────────────────┐      ┌──────────┐
│ Component │ ───▶ │ Service         │ ───▶ │ FirestoreService │ ───▶ │ Firebase │
│           │      │ (Signals)       │      │ (CRUD)           │      │          │
└───────────┘      └─────────────────┘      └──────────────────┘      └──────────┘
      ▲                    ▲                                                │
      │                    │                                                │
      │                    └────────────────────────────────────────────────┘
      │                              Real-time Updates (onSnapshot)
      │
      └─── UI automatically re-renders when signals change
```

### Authentication Flow

```
┌──────────┐    ┌─────────────┐    ┌───────────────┐    ┌────────────────┐
│  Login   │───▶│ Google OAuth│───▶│ Firebase Auth │───▶│ Get/Create     │
│  Button  │    │ Popup       │    │ signInWithPop │    │ User Document  │
└──────────┘    └─────────────┘    └───────────────┘    └────────────────┘
                                                               │
                    ┌──────────────────────────────────────────┘
                    ▼
┌────────────────────────┐    ┌─────────────────┐    ┌──────────────┐
│ Load User Preferences  │───▶│ Sync Theme &    │───▶│ Navigate to  │
│ (currency, language)   │    │ Language        │    │ Dashboard    │
└────────────────────────┘    └─────────────────┘    └──────────────┘
```

## Low-Level Design


### Design Patterns

| Pattern | Usage | Example |
|---------|-------|---------|
| Signals + Computed | State & derived values | All services |
| Standalone Components | No NgModules | All components |
| Functional Guards | Route protection | authGuard, publicGuard |
| Dialog-Based Forms | Add/Edit operations | TransactionFormComponent |
| DTO Pattern | API data transfer | CreateTransactionDTO |
| Real-time Subscriptions | Auto-sync UI | FirestoreService |
| Responsive Signals | Adapt to screen size | MainLayoutComponent |
| Cache with TTL | Optimize API calls | CurrencyService (12h cache) |
| Lazy Import | Avoid circular deps | TransactionService → BudgetService |

### Service Responsibilities

| Service | Purpose |
|---------|---------|
| AuthService | Firebase Auth, user profile, preferences sync |
| FirestoreService | Generic CRUD, real-time subscriptions |
| TransactionService | Transactions with filtering & currency conversion |
| BudgetService | Budget periods, spending calculation, alerts |
| CategoryService | System defaults + custom categories |
| CurrencyService | Exchange rates with Firestore caching |
| ThemeService | Light/dark/system theme with OS detection |
| TranslationService | i18n with browser locale detection |
| ExportService | CSV & PDF generation |
| GeminiService | AI receipt parsing & category suggestion (cloud) |
| LocalAIService | On-device OCR with Tesseract.js |
| TransformersAIService | ML-powered parsing with Transformers.js |
| MLWorkerService | Web Worker for Transformers.js processing |
| AIStrategyService | Hybrid AI strategy (auto/local/cloud) |
| OfflineQueueService | Queue for offline image processing |
| PwaService | PWA state, installation, caching |
| AIImportService | AI import workflow orchestration |
| DeviceService | Device capabilities (camera, mobile) detection |

### AI Architecture

The app supports three AI processing modes:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI PROCESSING MODES                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   AUTOMATIC (Recommended)                                                    │
│   ├── Online + Cloud available → Use Gemini AI (highest accuracy)          │
│   ├── Offline → Use Local AI (Tesseract.js + rule-based parsing)           │
│   └── Low confidence → Fallback to cloud if available                      │
│                                                                              │
│   LOCAL ONLY (Privacy First)                                                 │
│   ├── Tesseract.js OCR (English, Japanese, Traditional Chinese)            │
│   ├── Rule-based parsing (region detection, date formats)                  │
│   └── Optional: Transformers.js ML model (~65MB) for better accuracy       │
│                                                                              │
│   CLOUD ONLY                                                                 │
│   └── Always use Gemini AI (requires internet)                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Local AI Processing Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌────────────────┐
│   Image     │───▶│ Preprocessing │───▶│  Tesseract.js  │───▶│   Parsing      │
│   Capture   │    │ (contrast,    │    │  OCR Engine    │    │   (rule-based  │
│             │    │  sharpening)  │    │  (WASM)        │    │   or ML)       │
└─────────────┘    └──────────────┘    └────────────────┘    └────────────────┘
                                                                     │
                                              ┌──────────────────────┘
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PARSING MODES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Rule-Based (Built-in, ~0MB)                                               │
│   ├── Region detection (Taiwan, Hong Kong, Japan, International)           │
│   ├── Date parsing (ROC calendar, Reiwa era, ISO, US/EU formats)           │
│   ├── Merchant extraction (scoring algorithm)                               │
│   └── Item detection with quantity support                                  │
│                                                                              │
│   ML-Enhanced (Optional, ~65MB download)                                    │
│   ├── Transformers.js with DistilBERT Q&A model                            │
│   ├── Runs in Web Worker (non-blocking UI)                                 │
│   ├── Question-answering for semantic extraction                           │
│   └── Cached in IndexedDB for offline use                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Types

- **Container components** - Subscribe to services, manage state
- **Presentational components** - Receive data via inputs, emit events
- **Dialog components** - Modal forms with MAT_DIALOG_DATA injection
- **Layout components** - Responsive shell with BreakpointObserver

## Security & Authorization

### Firestore Security Rules

The app uses Firebase Security Rules for server-side authorization. All data access is validated at the database level.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SECURITY MODEL                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   /currencies/rates ──────────────── Any authenticated user (shared)    │
│         │                                                                │
│         └── read/write: isAuthenticated()                               │
│                                                                          │
│   /users/{userId} ────────────────── Owner only (isolated)              │
│         │                                                                │
│         ├── read/write: isOwner(userId)                                 │
│         │                                                                │
│         ├── /transactions/{id} ──── Owner only                          │
│         ├── /budgets/{id} ───────── Owner only                          │
│         ├── /categories/{id} ────── Owner only                          │
│         └── /recurring/{id} ─────── Owner only                          │
│                                                                          │
│   /* (everything else) ───────────── Denied                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Authorization Flow

```
┌──────────┐    ┌───────────────┐    ┌─────────────────────┐
│  Client  │───▶│ Firebase SDK  │───▶│ Firestore Database  │
│  Request │    │ (with token)  │    │                     │
└──────────┘    └───────────────┘    └─────────────────────┘
                       │                       │
                       ▼                       ▼
                ┌─────────────┐       ┌────────────────────┐
                │ Auth Token  │       │  Security Rules    │
                │ request.auth│──────▶│  isOwner(userId)?  │
                └─────────────┘       └────────────────────┘
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                        ┌─────────┐                     ┌──────────┐
                        │ ALLOW   │                     │  DENY    │
                        │ (200)   │                     │  (403)   │
                        └─────────┘                     └──────────┘
```

### Security Rules Implementation

```javascript
// firestore.rules

// Helper: Check if user is authenticated
function isAuthenticated() {
  return request.auth != null;
}

// Helper: Check if user owns the document
function isOwner(userId) {
  return isAuthenticated() && request.auth.uid == userId;
}

// Shared currency rates (any authenticated user)
match /currencies/{document=**} {
  allow read, write: if isAuthenticated();
}

// User data (owner only - complete isolation)
match /users/{userId} {
  allow read, write: if isOwner(userId);

  // All subcollections inherit owner-only access
  match /transactions/{transactionId} {
    allow read, write: if isOwner(userId);
  }
  match /budgets/{budgetId} {
    allow read, write: if isOwner(userId);
  }
  match /categories/{categoryId} {
    allow read, write: if isOwner(userId);
  }
  match /recurring/{recurringId} {
    allow read, write: if isOwner(userId);
  }
}

// Default deny all other paths
match /{document=**} {
  allow read, write: if false;
}
```

### Key Security Principles

| Principle | Implementation |
|-----------|----------------|
| **Authentication Required** | All operations require `request.auth != null` |
| **User Isolation** | Users can only access `/users/{their-uid}/*` |
| **Path-Based Authorization** | User ID in URL path must match auth token |
| **Shared Cache** | Exchange rates shared (any user can update cache) |
| **Default Deny** | Unmatched paths return 403 Forbidden |
| **No Admin Bypass** | No special admin roles - all users equal |


### Why This Design?

1. **Serverless Security** - No backend server to maintain; rules enforced at database level
2. **User Isolation** - Each user's data is completely isolated by UID
3. **Simple Model** - No complex role-based access; owner-only pattern
4. **Shared Resources** - Exchange rates cached once, shared by all users
5. **Defense in Depth** - Client guards + server rules = double protection

## Data Models

### Firestore Schema

```
/users/{userId}
  ├── preferences: { baseCurrency, language, theme, dateFormat }
  │
  ├── /transactions/{transactionId}
  │     ├── type: "income" | "expense"
  │     ├── amount, currency, amountInBaseCurrency, exchangeRate
  │     ├── categoryId → /categories/{id}
  │     ├── description, date, tags[], location?
  │     └── recurringId? → /recurring/{id}
  │
  ├── /budgets/{budgetId}
  │     ├── categoryId → /categories/{id}
  │     ├── amount, currency, period (weekly/monthly/yearly)
  │     ├── spent (denormalized), alertThreshold
  │     └── startDate, endDate?, isActive
  │
  ├── /categories/{categoryId}
  │     ├── name, icon, color, type
  │     └── isDefault, order, parentId?
  │
  └── /recurring/{recurringId}
        ├── frequency: { type, interval, dayOfWeek?, dayOfMonth? }
        ├── amount, currency, categoryId
        └── nextOccurrence, isActive

/currencies/rates
  └── { USD: 1, EUR: 0.92, THB: 35.2, ... }, lastUpdated
```

### Entity Relationships

```
User (1) ──────< (N) Transaction
  │                    │
  │                    └──────> (1) Category
  │
  ├──────< (N) Budget ────────> (1) Category
  │
  ├──────< (N) Category (custom)
  │
  └──────< (N) RecurringTransaction ──────> (1) Category
```

## Getting Started

```bash
# Prerequisites: Node.js 18+, Angular CLI

npm install

# Configure Firebase (see src/environments/)

npm start
```

## PWA Support

The app is a fully-featured Progressive Web App:

- **Installable** - Add to home screen on iOS, Android, and desktop
- **Offline-first** - Core app works without internet
- **Background sync** - Queued images processed when online
- **Model caching** - AI models cached in IndexedDB for offline use

### iOS Installation

1. Open in Safari
2. Tap Share button
3. Select "Add to Home Screen"
4. App opens in standalone mode (no browser UI)

### AI Models for Offline Use

| Model | Size | Purpose |
|-------|------|---------|
| OCR (Tesseract.js) | ~15MB | Text recognition (EN, JA, TC) |
| ML (Transformers.js) | ~65MB | Semantic parsing (optional) |

Models are downloaded on-demand and cached for offline use.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Dev server at localhost:4200 |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run lint` | ESLint |
| `firebase deploy` | Deploy to Firebase Hosting |

## Live Demo

https://home-accounter.web.app
