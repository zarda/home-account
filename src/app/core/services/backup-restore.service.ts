import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import {
  BACKUP_SCHEMA_VERSION,
  ExportData,
  SUPPORTED_BACKUP_VERSIONS,
} from './export.service';
import { TransactionService } from './transaction.service';
import { CategoryService } from './category.service';
import { BudgetService } from './budget.service';
import { RecurringService } from './recurring.service';
import { InsightSnapshotService } from './insight-snapshot.service';
import {
  Budget,
  Category,
  CreateTransactionDTO,
  RecurringTransaction,
  Transaction,
} from '../../models';
import { parseDateInput } from '../utils/transaction-date.utils';

/** Thrown when a backup's `version` is one this build cannot read. */
export const UNSUPPORTED_BACKUP_VERSION = 'UNSUPPORTED_BACKUP_VERSION';
/** Thrown when the file is not a backup at all. */
export const INVALID_BACKUP_FORMAT = 'INVALID_BACKUP_FORMAT';

/** How many documents were written back, per section. */
export interface RestoreSummary {
  transactions: number;
  categories: number;
  budgets: number;
  recurring: number;
  insightSnapshots: number;
  /** Rows that could not be written, with the reason, for reporting. */
  skipped: { section: string; id: string; reason: string }[];
}

/** What a parsed backup contains, for the pre-restore preview. */
export interface BackupContents {
  version: string;
  exportDate: string;
  transactions: number;
  categories: number;
  budgets: number;
  recurring: number;
  insightSnapshots: number;
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'seconds' in value) {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    // Backups serialise timestamps as full ISO instants, which keep meaning the
    // instant they name. A date-only string reaches here only from a
    // hand-edited or third-party file, and there it means a local calendar day.
    return parseDateInput(value) ?? new Date();
  }
  return new Date();
}

function toTimestamp(value: unknown): Timestamp {
  return Timestamp.fromDate(toDate(value));
}

/**
 * Restores a full backup.
 *
 * Kept apart from ExportService's CSV import on purpose. The JSON restore used
 * to be squeezed through `ImportedTransaction`, a type built for bank CSV rows,
 * which is structurally why every non-transaction section was silently dropped
 * and why document ids could not survive: the shape had nowhere to put them.
 *
 * Two rules hold everywhere here:
 *
 * - **Write by the backup's own id.** Restoring the same file twice then
 *   overwrites the same documents instead of appending a second copy of every
 *   row, which used to double every balance, budget and chart while reporting
 *   success.
 * - **Stamp the current account, never the backup's.** The security rules
 *   require `userId == request.auth.uid` on create, and the service create
 *   paths already take it from auth — which is also what lets a backup be
 *   restored into a different account at all.
 */
@Injectable({ providedIn: 'root' })
export class BackupRestoreService {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private budgetService = inject(BudgetService);
  private recurringService = inject(RecurringService);
  private insightSnapshots = inject(InsightSnapshotService);

  /**
   * Validate a parsed JSON file as a backup.
   *
   * `version` is checked rather than merely written: a file from a newer build
   * may carry sections this one would silently drop, and a half-restore is
   * worse than a refusal.
   */
  parse(raw: unknown): ExportData {
    if (!raw || typeof raw !== 'object') {
      throw new Error(INVALID_BACKUP_FORMAT);
    }
    const data = raw as Partial<ExportData>;
    if (!Array.isArray(data.transactions)) {
      throw new Error(INVALID_BACKUP_FORMAT);
    }

    // Absent means a backup written before the field existed; those predate
    // every section beyond transactions and categories, so they read as 1.0.
    const version = typeof data.version === 'string' ? data.version : '1.0';
    if (!(SUPPORTED_BACKUP_VERSIONS as readonly string[]).includes(version)) {
      throw new Error(UNSUPPORTED_BACKUP_VERSION);
    }

    return {
      transactions: data.transactions as Transaction[],
      categories: Array.isArray(data.categories) ? data.categories as Category[] : [],
      insightSnapshots: Array.isArray(data.insightSnapshots) ? data.insightSnapshots : [],
      budgets: Array.isArray(data.budgets) ? data.budgets as Budget[] : [],
      recurring: Array.isArray(data.recurring) ? data.recurring as RecurringTransaction[] : [],
      exportDate: typeof data.exportDate === 'string' ? data.exportDate : '',
      version,
    };
  }

  /** What the file holds, for the confirmation dialog. */
  describe(data: ExportData): BackupContents {
    return {
      version: data.version,
      exportDate: data.exportDate,
      transactions: data.transactions.length,
      categories: data.categories.length,
      budgets: data.budgets?.length ?? 0,
      recurring: data.recurring?.length ?? 0,
      insightSnapshots: data.insightSnapshots?.length ?? 0,
    };
  }

  /**
   * Write every section back.
   *
   * Order matters. Categories first, so restored transactions resolve to
   * categories that exist — a restore onto a clean account used to leave every
   * transaction pointing at a category document that was never written.
   * Budgets after transactions, because createBudget recomputes `spent` from
   * the ledger and would otherwise compute it from an empty one.
   */
  async restore(data: ExportData): Promise<RestoreSummary> {
    const summary: RestoreSummary = {
      transactions: 0, categories: 0, budgets: 0, recurring: 0, insightSnapshots: 0,
      skipped: [],
    };

    const skip = (section: string, id: string, error: unknown): void => {
      summary.skipped.push({
        section,
        id,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    };

    for (const category of data.categories) {
      // Built-in categories are generated, not stored, so restoring one would
      // write a duplicate of something the app already provides.
      if (category.isDefault) continue;
      try {
        await this.categoryService.addCategory({
          name: category.name,
          icon: category.icon,
          color: category.color,
          type: category.type,
          ...(category.parentId ? { parentId: category.parentId } : {}),
        }, { id: category.id });
        summary.categories++;
      } catch (error) {
        skip('categories', category.id, error);
      }
    }

    for (const transaction of data.transactions) {
      try {
        const dto: CreateTransactionDTO = {
          type: transaction.type,
          amount: transaction.amount,
          currency: transaction.currency,
          categoryId: transaction.categoryId,
          description: transaction.description,
          date: toDate(transaction.date),
          isRecurring: transaction.isRecurring ?? false,
          ...(transaction.note ? { note: transaction.note } : {}),
          ...(transaction.tags?.length ? { tags: transaction.tags } : {}),
          ...(transaction.period ? { period: transaction.period } : {}),
          ...(transaction.location ? { location: transaction.location } : {}),
        };
        // Receipt fields are deliberately not restored: a backup holds no
        // storage objects, so a restored receiptUrl would point at a dead (or
        // another account's) object and inflate the image quota.
        await this.transactionService.addTransaction(dto, {
          id: transaction.id,
          ...(typeof transaction.exchangeRate === 'number'
            && typeof transaction.amountInBaseCurrency === 'number'
            && transaction.baseCurrency
            ? {
              snapshot: {
                exchangeRate: transaction.exchangeRate,
                baseCurrency: transaction.baseCurrency,
                amountInBaseCurrency: transaction.amountInBaseCurrency,
              },
            }
            : {}),
        });
        summary.transactions++;
      } catch (error) {
        skip('transactions', transaction.id, error);
      }
    }

    for (const budget of data.budgets ?? []) {
      try {
        await this.budgetService.createBudget({
          categoryId: budget.categoryId,
          name: budget.name,
          amount: budget.amount,
          currency: budget.currency,
          period: budget.period,
          startDate: toDate(budget.startDate),
          alertThreshold: budget.alertThreshold,
          ...(budget.endDate ? { endDate: toDate(budget.endDate) } : {}),
        }, { id: budget.id });
        summary.budgets++;
      } catch (error) {
        skip('budgets', budget.id, error);
      }
    }

    for (const rule of data.recurring ?? []) {
      try {
        await this.recurringService.createRecurring({
          name: rule.name,
          type: rule.type,
          amount: rule.amount,
          currency: rule.currency,
          categoryId: rule.categoryId,
          description: rule.description,
          frequency: rule.frequency,
          startDate: toDate(rule.startDate),
          ...(rule.endDate ? { endDate: toDate(rule.endDate) } : {}),
        }, { id: rule.id });
        summary.recurring++;
      } catch (error) {
        skip('recurring', rule.id, error);
      }
    }

    for (const snapshot of data.insightSnapshots ?? []) {
      try {
        await this.insightSnapshots.restore({
          ...snapshot,
          generatedAt: toTimestamp(snapshot.generatedAt),
          createdAt: toTimestamp(snapshot.createdAt),
        });
        summary.insightSnapshots++;
      } catch (error) {
        skip('insightSnapshots', snapshot.id, error);
      }
    }

    return summary;
  }

  /** The version this build writes, for the exporter. */
  get currentVersion(): string {
    return BACKUP_SCHEMA_VERSION;
  }
}
