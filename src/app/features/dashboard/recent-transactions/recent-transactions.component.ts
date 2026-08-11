import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Timestamp } from '@angular/fire/firestore';
import { Transaction, Category } from '../../../models';
import { dayKey } from '../../../core/utils/transaction-date.utils';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    // A local day key, which the transactions page reads back with
    // parseDayKey. The two are exact inverses; a private copy of either half
    // is how the round trip came to write local and read UTC.
    this.router.navigate(['/transactions'], { queryParams: { date: dayKey(date) } });
  }
}
