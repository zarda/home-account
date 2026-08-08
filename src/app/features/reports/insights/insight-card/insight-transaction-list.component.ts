import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Transaction } from '../../../../models';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { FitTextDirective } from '../../../../shared/directives/fit-text.directive';

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
  imports: [CurrencyPipe, DatePipe, TranslatePipe, FitTextDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="insight-transactions">
      @for (transaction of rows(); track transaction.id) {
        <div class="transaction-item">
          <div class="transaction-info">
            <span class="transaction-description">{{ transaction.description }}</span>
            <span class="transaction-date">{{ transaction.date.toDate() | date:'MMM d, yyyy' }}</span>
          </div>
          <span class="transaction-amount" appFitText>
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

    /* Was overflow/text-overflow/white-space: nowrap, and unlike the three
       dead rules ADR 0010 deleted this one worked — a plain span, so the
       ellipsis really rendered and really shortened the description. It
       survived the sweep because it worked: a rule that clips is obvious in a
       screenshot, one that truncates cleanly reads as somebody's decision.
       Text wraps now, with anywhere so a pasted URL shrinks too. */
    .transaction-description {
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }

    .transaction-date,
    .transactions-empty,
    .transactions-truncated {
      font-size: var(--text-xs);
      color: var(--text-muted);
    }

    // nowrap is what appFitText needs from the cascade: the directive writes
    // no style at all while the value fits, so the row must already promise
    // the number stays on one line.
    .transaction-amount {
      font-size: var(--text-sm);
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
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
