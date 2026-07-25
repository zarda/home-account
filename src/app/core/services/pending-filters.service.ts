import { Injectable, signal } from '@angular/core';
import { TransactionFilters } from '../../models';

interface PendingFilters {
  filters: TransactionFilters;
  seq: number;
}

/**
 * Hand-off channel for applying transaction filters from outside the
 * Transactions page (the smart-search dialog). The producer calls apply()
 * and navigates; the page consumes the pending set whether it was already
 * open or is freshly created.
 */
@Injectable({ providedIn: 'root' })
export class PendingFiltersService {
  private pendingState = signal<PendingFilters | null>(null);
  private seq = 0;

  readonly pending = this.pendingState.asReadonly();

  apply(filters: TransactionFilters): void {
    this.pendingState.set({
      filters: { ...filters },
      seq: ++this.seq,
    });
  }

  /** Read and clear the pending filters. */
  consume(): TransactionFilters | null {
    const current = this.pendingState();
    if (!current) return null;
    this.pendingState.set(null);
    return current.filters;
  }
}
