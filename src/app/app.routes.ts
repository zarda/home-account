import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { authGuard, publicGuard } from './core/guards';
import { MainLayoutComponent } from './shared/layout/main-layout/main-layout.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { TransactionsComponent } from './features/transactions/transactions.component';
import { BudgetsComponent } from './features/budgets/budgets.component';
import { ReportsComponent } from './features/reports/reports.component';
import { SettingsComponent } from './features/settings/settings.component';
import { AboutComponent } from './features/about/about.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [publicGuard],
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'transactions', component: TransactionsComponent },
      { path: 'budgets', component: BudgetsComponent },
      { path: 'reports', component: ReportsComponent },
      { path: 'settings', component: SettingsComponent },
      { 
        path: 'ai', 
        loadComponent: () => 
          import('./features/settings/ai-settings-page/ai-settings-page.component')
            .then(m => m.AiSettingsPageComponent)
      },
      { path: 'about', component: AboutComponent },
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
