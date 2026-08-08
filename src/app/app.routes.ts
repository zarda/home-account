import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { authGuard, lockGuard, publicGuard } from './core/guards';
import { MainLayoutComponent } from './shared/layout/main-layout/main-layout.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [publicGuard],
  },
  {
    path: 'lock',
    canActivate: [lockGuard],
    loadComponent: () =>
      import('./features/auth/app-lock/app-lock.component').then(m => m.AppLockComponent),
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/transactions/transactions.component')
            .then(m => m.TransactionsComponent)
      },
      {
        path: 'budgets',
        loadComponent: () =>
          import('./features/budgets/budgets.component').then(m => m.BudgetsComponent)
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/reports/reports.component').then(m => m.ReportsComponent)
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'ai',
        loadComponent: () =>
          import('./features/settings/ai-settings-page/ai-settings-page.component')
            .then(m => m.AiSettingsPageComponent)
      },
      {
        path: 'about',
        loadComponent: () =>
          import('./features/about/about.component').then(m => m.AboutComponent)
      },
      {
        path: 'search-history',
        loadComponent: () =>
          import('./features/ai/search-history/search-answer-history.component')
            .then(m => m.SearchAnswerHistoryComponent)
      },
      // New import routes (accessed from Transaction page FAB)
      {
        path: 'import/file',
        loadComponent: () =>
          import('./features/ai/import/import-wizard/import-wizard.component')
            .then(m => m.ImportWizardComponent)
      },
      {
        path: 'import/history',
        loadComponent: () =>
          import('./features/ai/import/import-history/import-history.component')
            .then(m => m.ImportHistoryComponent)
      },
      // Redirects from old settings/import paths
      { path: 'settings/import', redirectTo: '/import/file', pathMatch: 'full' },
      { path: 'settings/import/history', redirectTo: '/import/history', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
