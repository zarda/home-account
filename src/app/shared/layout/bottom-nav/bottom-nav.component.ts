import { Component, computed, inject } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { TransactionFormComponent } from '../../../features/transactions/transaction-form/transaction-form.component';
import { TranslationService } from '../../../core/services/translation.service';

interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
  isAction?: boolean;
}

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatIconModule],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
})
export class BottomNavComponent {
  private dialog = inject(MatDialog);
  private translationService = inject(TranslationService);

  private navItemsConfig: NavItem[] = [
    { labelKey: 'nav.dashboard', icon: 'dashboard', route: '/dashboard' },
    { labelKey: 'nav.transactions', icon: 'receipt_long', route: '/transactions' },
    { labelKey: 'nav.add', icon: 'add', route: '', isAction: true },
    { labelKey: 'nav.budgets', icon: 'savings', route: '/budgets' },
    { labelKey: 'nav.reports', icon: 'bar_chart', route: '/reports' },
  ];

  navItems = computed(() =>
    this.navItemsConfig.map((item) => ({
      ...item,
      label: this.translationService.t(item.labelKey),
    }))
  );

  openAddTransaction(): void {
    // Open dialog directly - works from any page
    this.dialog.open(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' },
    });
  }
}
