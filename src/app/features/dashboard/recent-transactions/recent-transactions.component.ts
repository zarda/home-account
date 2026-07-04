import { Component, inject, input } from '@angular/core';

import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category } from '../../../models';
import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';
import { TransactionRowComponent } from '../../../shared/components/transaction-row/transaction-row.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-recent-transactions',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    EmptyStateComponent,
    TransactionRowComponent,
    TranslatePipe
  ],
  templateUrl: './recent-transactions.component.html',
  styleUrl: './recent-transactions.component.scss',
})
export class RecentTransactionsComponent {
  // Modern Angular 21: signal-based inputs
  transactions = input<Transaction[]>([]);
  categories = input<Map<string, Category>>(new Map());

  private router = inject(Router);

  onAddTransaction(): void {
    // Navigate to transactions page with add mode (SPA navigation, no full reload)
    this.router.navigate(['/transactions'], { queryParams: { action: 'add' } });
  }

  onTransactionClick(transaction: Transaction): void {
    const date = transaction.date instanceof Timestamp
      ? transaction.date.toDate()
      : new Date(transaction.date as unknown as Date);
    // Format as YYYY-MM-DD using local timezone (not UTC)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    this.router.navigate(['/transactions'], { queryParams: { date: dateStr } });
  }
}
