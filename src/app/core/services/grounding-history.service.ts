import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { Transaction, effectiveRagLevel } from '../../models';

/** A recent window rather than everything: habits change, and the point is how this user files things now. */
export const GROUNDING_HISTORY_MONTHS = 6;

/**
 * The one read every per-user grounding shares — category habits and tag
 * vocabulary alike — gated on `ragInsightsLevel` so that off means no
 * transaction history leaves the device and no prompt changes shape.
 * Failing to read is not worth failing an import over: the model answers
 * unaided, as it did before grounding existed.
 */
@Injectable({ providedIn: 'root' })
export class GroundingHistoryService {
  private transactionService = inject(TransactionService);
  private authService = inject(AuthService);

  async recent(): Promise<Transaction[]> {
    if (effectiveRagLevel(this.authService.currentUser()?.preferences) === 'off') {
      return [];
    }
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - GROUNDING_HISTORY_MONTHS);
      return await firstValueFrom(this.transactionService.getTransactions({ startDate }));
    } catch (error) {
      console.warn('[GroundingHistory] Could not load recent transactions:', error);
      return [];
    }
  }
}
