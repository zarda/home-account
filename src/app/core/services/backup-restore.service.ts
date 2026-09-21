import { Injectable, inject } from '@angular/core';
import { locationSlotFrom } from '../utils/import-dto.utils';
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
import { GoalService } from './goal.service';
import { SearchHistoryService } from './search-history.service';
import { SearchAnswerHistoryService } from './search-answer-history.service';
import { CategoryMemoryService } from './category-memory.service';
import { TagMemoryService } from './tag-memory.service';
import { ImportHistoryService } from './import-history.service';
import {
  Budget,
  Category,
  CategoryMemoryEntry,
  CreateTransactionDTO,
  Goal,
  ImportHistory,
  RecurringTransaction,
  SavedSearch,
  SearchRecord,
  TagMemoryEntry,
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
  goals: number;
  insightSnapshots: number;
  savedSearches: number;
  searchAnswers: number;
  categoryMemory: number;
  tagMemory: number;
  imports: number;
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
  goals: number;
  insightSnapshots: number;
  savedSearches: number;
  searchAnswers: number;
  categoryMemory: number;
  tagMemory: number;
  imports: number;
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
 * Three rules hold everywhere here:
 *
 * - **Write by the backup's own id.** Restoring the same file twice then
 *   overwrites the same documents instead of appending a second copy of every
 *   row, which used to double every balance, budget and chart while reporting
 *   success.
 * - **Stamp the current account, never the backup's.** The security rules
 *   require `userId == request.auth.uid` on create, and the service create
 *   paths already take it from auth — which is also what lets a backup be
 *   restored into a different account at all.
 * - **Merge into the document already there, do not replace it.** A backup
 *   cannot carry everything a live row holds: receipt images live in Storage
 *   and are reachable only through the transaction that names them, so a
 *   replacing write erased them and orphaned the bytes for good. Merging is
 *   what keeps them. The cost is stated rather than hidden: a restore can no
 *   longer *clear* a field the backup dropped, so a note or tag removed after
 *   the file was taken survives restoring that file. Everything a restore
 *   does write is either verbatim from the file (ids, rates, links, flags,
 *   `createdAt`) or recomputed from the restored ledger (`spent`,
 *   `linkedAmount`), with one exception stated rather than hidden:
 *   `setDocument` merges `updatedAt: Timestamp.now()` into every write it
 *   makes, so that one field does come from today. It is a stamp nothing
 *   reads for a figure, so restoring the same file twice still lands the same
 *   documents in every field that means anything.
 */
@Injectable({ providedIn: 'root' })
export class BackupRestoreService {
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private budgetService = inject(BudgetService);
  private recurringService = inject(RecurringService);
  private insightSnapshots = inject(InsightSnapshotService);
  private goalService = inject(GoalService);
  private searchHistory = inject(SearchHistoryService);
  private searchAnswers = inject(SearchAnswerHistoryService);
  private categoryMemory = inject(CategoryMemoryService);
  private tagMemory = inject(TagMemoryService);
  private importHistory = inject(ImportHistoryService);

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
      goals: Array.isArray(data.goals) ? data.goals as Goal[] : [],
      savedSearches: Array.isArray(data.savedSearches)
        ? data.savedSearches as SavedSearch[] : [],
      searchAnswers: Array.isArray(data.searchAnswers)
        ? data.searchAnswers as SearchRecord[] : [],
      categoryMemory: Array.isArray(data.categoryMemory)
        ? data.categoryMemory as CategoryMemoryEntry[] : [],
      tagMemory: Array.isArray(data.tagMemory) ? data.tagMemory as TagMemoryEntry[] : [],
      imports: Array.isArray(data.imports) ? data.imports as ImportHistory[] : [],
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
      goals: data.goals?.length ?? 0,
      insightSnapshots: data.insightSnapshots?.length ?? 0,
      savedSearches: data.savedSearches?.length ?? 0,
      searchAnswers: data.searchAnswers?.length ?? 0,
      categoryMemory: data.categoryMemory?.length ?? 0,
      tagMemory: data.tagMemory?.length ?? 0,
      imports: data.imports?.length ?? 0,
    };
  }

  /**
   * Write every section back.
   *
   * Order matters. Categories first, so restored transactions resolve to
   * categories that exist — a restore onto a clean account used to leave every
   * transaction pointing at a category document that was never written.
   * Budgets after transactions, because createBudget recomputes `spent` from
   * the ledger and would otherwise compute it from an empty one. The import
   * history last, because each completed record names the rows it created and
   * those ids are checked against what the transactions loop actually wrote.
   *
   * The three per-collection caps — MAX_SEARCH_ANSWERS, MAX_RECENT_SEARCHES,
   * IMPORT_HISTORY_LIMIT — are enforced on their create paths, not here, so a
   * restore into a non-empty account can leave more rows than a cap allows.
   * That is deliberate: pruning here would delete rows the user just asked to
   * have back, and the two capped collections prune themselves on their next
   * ordinary write. The import limit bounds a subscription, not the stored
   * collection, so there is nothing there to exceed.
   */
  async restore(data: ExportData): Promise<RestoreSummary> {
    const summary: RestoreSummary = {
      transactions: 0, categories: 0, budgets: 0, recurring: 0, goals: 0, insightSnapshots: 0,
      savedSearches: 0, searchAnswers: 0, categoryMemory: 0, tagMemory: 0, imports: 0,
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
          // A deleted category is a soft delete, so the file records it as
          // inactive and the restore has to keep it that way. Absent means a
          // backup predating the flag; those rows were all live.
          //
          // `order` is the position the file recorded. Without it every
          // restored category takes maxOrder + 1 off the in-memory signal,
          // which mid-restore holds whatever the subscription has delivered —
          // so the list comes back reshuffled, and rows can collide on one
          // position.
        }, { id: category.id, isActive: category.isActive ?? true, order: category.order });
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
          ...locationSlotFrom(transaction.location),
          // Restored: the field says which rule posted the row, and the same
          // file restores those rules at their own ids, so it cannot dangle.
          // Without it the detector reads engine-posted history as untagged
          // charges and re-offers subscriptions already declared.
          ...(transaction.recurringId ? { recurringId: transaction.recurringId } : {}),
          // Restored the same way: the field alone says "part of a split",
          // and nothing here recomputes from it.
          ...(transaction.splitGroupId ? { splitGroupId: transaction.splitGroupId } : {}),
        };
        // Receipt fields are deliberately not *sourced* from the file: a backup
        // holds no storage objects, so a restored receiptUrl would point at a
        // dead (or another account's) object and inflate the image quota.
        // `merge` is the other half of that — it is what stops this write
        // erasing the receipts a live row already carries, which nothing could
        // then reclaim. `createdAt` comes from the file so a pre-existing row
        // is not restamped and a second restore is a genuine no-op.
        await this.transactionService.addTransaction(dto, {
          id: transaction.id,
          merge: true,
          createdAt: toTimestamp(transaction.createdAt),
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
          // A goal link restores verbatim, counters untouched: its goal may
          // not exist yet (goals restore after transactions), and the
          // recompute pass below settles every counter from the ledger.
          ...(transaction.goalId
            ? {
              goalSnapshot: {
                goalId: transaction.goalId,
                goalAmount: typeof transaction.goalAmount === 'number'
                  ? transaction.goalAmount
                  : 0,
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
        }, { id: budget.id, isActive: budget.isActive ?? true });
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
          // `!= null`, not truthiness: a lead of zero means "on the day", and
          // a field left off this list is dropped from the restore in silence.
          ...(rule.remindDaysBefore != null
            ? { remindDaysBefore: rule.remindDaysBefore }
            : {}),
          // A paused rule must come back paused: catch-up runs unprompted on
          // every dashboard load, so restoring one as active starts posting
          // money the user stopped.
        }, { id: rule.id, isActive: rule.isActive ?? true });
        summary.recurring++;
      } catch (error) {
        skip('recurring', rule.id, error);
      }
    }

    for (const goal of data.goals ?? []) {
      try {
        // The contributed balance rides in options: unlike a budget's spent,
        // there is no transaction source to recompute it from.
        await this.goalService.createGoal({
          kind: goal.kind,
          name: goal.name,
          targetAmount: goal.targetAmount,
          currency: goal.currency,
          ...(goal.targetDate ? { targetDate: toDate(goal.targetDate) } : {}),
          ...(goal.items?.length ? { items: goal.items } : {}),
          ...(goal.note ? { note: goal.note } : {}),
        }, {
          id: goal.id,
          contributedAmount: goal.contributedAmount ?? 0,
          isActive: goal.isActive ?? true,
        });
        summary.goals++;
      } catch (error) {
        skip('goals', goal.id, error);
      }
    }

    // Settle every linked counter from the ledger (the budget-`spent`
    // precedent). Restored rows carried their links without counter writes,
    // and createGoal reset each restored goal's counter to zero; summing
    // what the account now actually holds covers restored links, links the
    // account already had that the backup did not, and a double restore —
    // none of which a verbatim counter could survive without double-counting.
    // Restored goals are included even when no restored row links to them,
    // precisely for the pre-existing-links case.
    const linkedGoalIds = new Set<string>();
    for (const transaction of data.transactions) {
      if (transaction.goalId) linkedGoalIds.add(transaction.goalId);
    }
    for (const goal of data.goals ?? []) {
      linkedGoalIds.add(goal.id);
    }
    for (const goalId of linkedGoalIds) {
      try {
        await this.goalService.recomputeLinkedAmount(goalId);
      } catch (error) {
        skip('goals', goalId, error);
      }
    }

    for (const snapshot of data.insightSnapshots ?? []) {
      try {
        // Both outcomes count. A month left alone because the stored snapshot
        // is already at or above the backup's revision is accounted for, not
        // skipped — the skipped list is for rows the restore could not write,
        // and reporting a no-op there produced a partial-restore warning for
        // the one flow that is supposed to be idempotent.
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

    for (const search of data.savedSearches ?? []) {
      try {
        await this.searchHistory.restore(search);
        summary.savedSearches++;
      } catch (error) {
        skip('savedSearches', search.id, error);
      }
    }

    for (const answer of data.searchAnswers ?? []) {
      try {
        await this.searchAnswers.restore(answer);
        summary.searchAnswers++;
      } catch (error) {
        skip('searchAnswers', answer.id, error);
      }
    }

    for (const entry of data.categoryMemory ?? []) {
      try {
        await this.categoryMemory.restore(entry);
        summary.categoryMemory++;
      } catch (error) {
        // The merchant key, not an injected id: it is the document id here and
        // the rules require the two to agree, so it is the one name that
        // identifies the row in both places.
        skip('categoryMemory', entry.merchantKey, error);
      }
    }

    for (const entry of data.tagMemory ?? []) {
      try {
        await this.tagMemory.restore(entry);
        summary.tagMemory++;
      } catch (error) {
        skip('tagMemory', entry.merchantKey, error);
      }
    }

    // Last, and after transactions specifically: a completed import record
    // names the rows it created, and an id pointing at a row this restore
    // could not write would send the history's drill-down to a document that
    // does not exist.
    const unwritten = new Set(
      summary.skipped.filter(entry => entry.section === 'transactions').map(entry => entry.id)
    );
    for (const record of data.imports ?? []) {
      try {
        await this.importHistory.restore(this.pruneUnwrittenRows(record, unwritten));
        summary.imports++;
      } catch (error) {
        skip('imports', record.id, error);
      }
    }

    return summary;
  }

  /**
   * Drop the transaction ids this restore offered and could not write.
   *
   * `successCount` moves with them, because `transactionIds.length ===
   * successCount` is the field's stated contract and the history page reads
   * both. An id the file never carried is left alone: it was never offered to
   * this restore, so it is not a row the restore skipped — the account it is
   * being restored into may well hold it already.
   */
  private pruneUnwrittenRows(record: ImportHistory, unwritten: Set<string>): ImportHistory {
    const ids = record.transactionIds;
    if (!ids?.length || unwritten.size === 0) return record;

    const carried = ids.filter(id => !unwritten.has(id));
    if (carried.length === ids.length) return record;

    return { ...record, transactionIds: carried, successCount: carried.length };
  }

  /** The version this build writes, for the exporter. */
  get currentVersion(): string {
    return BACKUP_SCHEMA_VERSION;
  }
}
