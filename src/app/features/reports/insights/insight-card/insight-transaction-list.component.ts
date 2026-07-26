import { Component, computed, input } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Transaction } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * The transactions behind an insight, listed in place.
 *
 * Used where no `TransactionFilters` set can reach the subset — a fuzzy merchant
 * cluster's members have different descriptions by construction, and there is no
 * id-list filter — so navigating to the Transactions page would show a different
 * set than the card counted. Row markup mirrors the category-breakdown accordion
 * so the two read identically.
 */
@Component({
  selector: 'app-insight-transaction-list',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, TranslatePipe],
  template: `
    <div class="insight-transactions">
      @for (transaction of rows(); track transaction.id) {
        <div class="transaction-item">
          <div class="transaction-info">
            <span class="transaction-description">{{ transaction.description }}</span>
            <span class="transaction-date">{{ transaction.date.toDate() | date:'MMM d, yyyy' }}</span>
          </div>
          <span class="transaction-amount">
            {{ transaction.amount | currency:transaction.currency:'symbol':'1.2-2' }}
          </span>
        </div>
      } @empty {
        <p class="transactions-empty">{{ 'insights.rowsUnavailable' | translate }}</p>
      }

      @if (truncated()) {
        <p class="transactions-truncated">{{ 'insights.listTruncated' | translate }}</p>
      }
    </div>
  `,
  styles: [`
    .insight-transactions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .transaction-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      background: var(--surface-subtle);
      border-radius: var(--radius-sm);
    }

    .transaction-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .transaction-description {
      font-size: var(--text-sm);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .transaction-date,
    .transactions-empty,
    .transactions-truncated {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    .transaction-amount {
      font-size: var(--text-sm);
      font-weight: 500;
      white-space: nowrap;
    }

    .transactions-truncated,
    .transactions-empty {
      margin: 4px 0 0;
    }
  `],
})
export class InsightTransactionListComponent {
  transactionIds = input.required<string[]>();
  /** Window rows by id; the cards carry ids only. */
  lookup = input.required<Map<string, Transaction>>();
  truncated = input(false);

  /**
   * Ids with no row are skipped rather than rendered as blanks: a frozen
   * snapshot can name a transaction that has since been deleted.
   */
  rows = computed<Transaction[]>(() => {
    const lookup = this.lookup();
    return this.transactionIds()
      .map(id => lookup.get(id))
      .filter((transaction): transaction is Transaction => transaction !== undefined);
  });
}
