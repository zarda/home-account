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
- **Budgets** - Period-based budget limits with customizable alert thresholds
- **Reports** - Financial analytics with CSV and PDF export
- **AI Receipt Parsing** - Automatic transaction creation from receipt images (Gemini API)
- **Multi-language** - English, Traditional Chinese, Japanese

## Tech Stack

| Category | Technology |
|----------|------------|
| Frontend | Angular 21, TypeScript 5.9 |
| UI | Angular Material 21, Tailwind CSS 3.4 |
| State | Angular Signals |
| Backend | Firebase (Auth, Firestore) |
| AI | Google Generative AI (Gemini) |
| Charts | Chart.js + ng2-charts |
| Export | jspdf, date-fns |

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
│   │   │   └── gemini.service.ts        # AI receipt parsing
│   │   └── guards/              # Route protection
│   │       ├── auth.guard.ts            # Protect authenticated routes
│   │       └── public.guard.ts          # Redirect logged-in users
│   ├── features/                # Feature modules
│   │   ├── auth/                # Google OAuth login
│   │   ├── dashboard/           # Financial overview, charts
│   │   ├── transactions/        # CRUD, filtering, multi-currency
│   │   ├── budgets/             # Budget limits & alerts
│   │   ├── reports/             # Analytics, CSV/PDF export
│   │   └── settings/            # User preferences, categories
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

### State Management with Signals

```typescript
// Writable signals for state
transactions = signal<Transaction[]>([]);
isLoading = signal<boolean>(false);

// Computed signals for derived values (auto-update)
totalExpense = computed(() =>
  this.transactions()
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amountInBaseCurrency, 0)
);

// Effects for side effects
effect(() => {
  const user = this.currentUser();
  if (user?.preferences) {
    this.themeService.init(user.preferences.theme);
  }
});
```

### Multi-Currency Conversion

```typescript
// On transaction creation:
async addTransaction(data: CreateTransactionDTO) {
  const baseCurrency = user.preferences.baseCurrency;  // e.g., "USD"
  const exchangeRate = currencyService.getExchangeRate(data.currency, baseCurrency);

  // Store both original and converted amounts
  const transaction = {
    amount: data.amount,              // Original: 1000
    currency: data.currency,          // Original: "THB"
    amountInBaseCurrency: data.amount * exchangeRate,  // Converted: 28.50
    exchangeRate: exchangeRate,       // Historical: 0.0285
  };
}

// Exchange rates cached in Firestore (12-hour TTL)
// Fetched from ExchangeRate-API, converted through USD base
```

### Budget Spending Calculation

```typescript
// Denormalized "spent" field updated when transactions change
async recalculateBudgetSpent(budgetId: string) {
  const budget = await getDocument(budgetId);
  const { start, end } = getBudgetPeriodDates(budget);  // Weekly/Monthly/Yearly

  const transactions = await getTransactions({
    categoryId: budget.categoryId,
    startDate: start,
    endDate: end,
    type: 'expense'
  });

  // Convert each transaction to budget's currency
  const totalSpent = transactions.reduce((sum, t) =>
    sum + currencyService.convert(t.amount, t.currency, budget.currency), 0
  );

  await updateDocument(budgetId, { spent: totalSpent });
}

// Alert severity levels:
// - Warning (yellow): >= alertThreshold (default 80%)
// - Critical (orange): >= 90%
// - Exceeded (red): >= 100%
```

### Real-Time Subscriptions

```typescript
// FirestoreService wraps onSnapshot in RxJS Observable
subscribeToCollection<T>(path: string, options?: QueryOptions): Observable<T[]> {
  return new Observable(subscriber => {
    const unsubscribe = onSnapshot(query, snapshot => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      subscriber.next(data);  // Emit on ANY change
    });
    return () => unsubscribe();  // Cleanup on unsubscribe
  });
}

// Components subscribe and update signals automatically
// No manual refresh needed - changes sync across all open tabs
```

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
| GeminiService | AI receipt parsing & category suggestion |

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

### Client-Side Guards (Defense in Depth)

In addition to Firestore rules, the Angular app uses route guards:

```typescript
// auth.guard.ts - Protect routes requiring login
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }
  router.navigate(['/login']);
  return false;
};

// public.guard.ts - Redirect logged-in users from login page
export const publicGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    router.navigate(['/dashboard']);
    return false;
  }
  return true;
};
```

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

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Dev server at localhost:4200 |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run lint` | ESLint |
