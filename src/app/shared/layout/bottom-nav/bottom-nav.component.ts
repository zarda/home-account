import { Component, inject } from '@angular/core';

import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { TransactionFormComponent } from '../../../features/transactions/transaction-form/transaction-form.component';

interface NavItem {
  label: string;
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

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
    { label: 'Transactions', icon: 'receipt_long', route: '/transactions' },
    { label: 'Add', icon: 'add', route: '', isAction: true },
    { label: 'Budgets', icon: 'savings', route: '/budgets' },
    { label: 'More', icon: 'more_horiz', route: '/settings' },
  ];

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
