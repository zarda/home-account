import { Injectable, inject, signal } from '@angular/core';
import { Observable, of, map } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { ImportHistory, ImportStatus } from '../../models';

@Injectable({ providedIn: 'root' })
export class ImportHistoryService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  // Signals
  importHistory = signal<ImportHistory[]>([]);
  isLoading = signal<boolean>(false);

  private get userImportsPath(): string {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/imports`;
  }

  /**
   * Get all import history for the current user
   */
  getImportHistory(): Observable<ImportHistory[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<ImportHistory>(
      this.userImportsPath,
      {
        orderBy: [{ field: 'importedAt', direction: 'desc' }]
      }
    ).pipe(
      map(history => {
        this.importHistory.set(history);
        return history;
      })
    );
  }

  /**
   * Get recent import history (limited)
   */
  getRecentImportHistory(limit = 5): Observable<ImportHistory[]> {
    const userId = this.authService.userId();
    if (!userId) return of([]);

    return this.firestoreService.subscribeToCollection<ImportHistory>(
      this.userImportsPath,
      {
        orderBy: [{ field: 'importedAt', direction: 'desc' }],
        limit
      }
    );
  }

  /**
   * Get a single import history by ID
   */
  getImportById(id: string): Observable<ImportHistory | null> {
    return this.firestoreService.subscribeToDocument<ImportHistory>(
      `${this.userImportsPath}/${id}`
    );
  }

  /**
   * Save a new import history record
   */
  async saveImportHistory(history: Omit<ImportHistory, 'id'>): Promise<string> {
    this.isLoading.set(true);

    try {
      const userId = this.authService.userId();
      if (!userId) throw new Error('User not authenticated');

      const id = await this.firestoreService.addDocument(
        this.userImportsPath,
        {
          ...history,
          userId,
          importedAt: this.firestoreService.getTimestamp()
        }
      );

      return id;
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Update an existing import history record
   */
  async updateImportHistory(id: string, updates: Partial<ImportHistory>): Promise<void> {
    await this.firestoreService.updateDocument(
      `${this.userImportsPath}/${id}`,
      updates
    );
  }

  /**
   * Delete an import history record
   */
  async deleteImportHistory(id: string): Promise<void> {
    this.isLoading.set(true);

    try {
      await this.firestoreService.deleteDocument(
        `${this.userImportsPath}/${id}`
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Create a pending import history record (before processing starts)
   */
  async createPendingImport(
    fileName: string,
    fileSize: number,
    source: ImportHistory['source'],
    fileType: ImportHistory['fileType']
  ): Promise<string> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const history: Omit<ImportHistory, 'id'> = {
      userId,
      importedAt: Timestamp.now(),
      source,
      fileType,
      fileName,
      fileSize,
      transactionCount: 0,
      successCount: 0,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 0,
      status: 'pending',
      duplicatesSkipped: 0
    };

    return this.saveImportHistory(history);
  }

  /**
   * Mark an import as completed with final stats
   */
  async completeImport(
    id: string,
    stats: {
      transactionCount: number;
      successCount: number;
      skippedCount: number;
      errorCount: number;
      totalIncome: number;
      totalExpenses: number;
      duplicatesSkipped: number;
      errors?: ImportHistory['errors'];
    }
  ): Promise<void> {
    const status: ImportStatus = stats.errorCount > 0
      ? (stats.successCount > 0 ? 'partial' : 'failed')
      : 'completed';

    await this.updateImportHistory(id, {
      ...stats,
      status
    });
  }

  /**
   * Mark an import as failed
   */
  async failImport(id: string, errors: ImportHistory['errors']): Promise<void> {
    await this.updateImportHistory(id, {
      status: 'failed',
      errors
    });
  }

  /**
   * Get import statistics for the current user
   */
  getImportStats(): Observable<{
    totalImports: number;
    totalTransactionsImported: number;
    successRate: number;
  }> {
    return this.getImportHistory().pipe(
      map(history => {
        const totalImports = history.length;
        const totalTransactionsImported = history.reduce(
          (sum, h) => sum + h.successCount,
          0
        );
        const completedImports = history.filter(h => h.status === 'completed').length;
        const successRate = totalImports > 0
          ? (completedImports / totalImports) * 100
          : 0;

        return {
          totalImports,
          totalTransactionsImported,
          successRate
        };
      })
    );
  }
}
