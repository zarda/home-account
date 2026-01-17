import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { PwaService } from './pwa.service';

// Database schema
interface OfflineQueueDB extends DBSchema {
  'pending-images': {
    key: string;
    value: QueuedImage;
    indexes: { 'by-created': number };
  };
  'pending-transactions': {
    key: string;
    value: QueuedTransaction;
    indexes: { 'by-created': number; 'by-status': QueueStatus };
  };
  'sync-log': {
    key: string;
    value: SyncLogEntry;
    indexes: { 'by-timestamp': number };
  };
}

export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueuedImage {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  data: ArrayBuffer;
  createdAt: number;
  status: QueueStatus;
  retryCount: number;
  lastError?: string;
}

export interface QueuedTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  currency: string;
  categoryId: string;
  source: 'local' | 'cloud';
  createdAt: number;
  status: QueueStatus;
  syncedAt?: number;
  lastError?: string;
}

export interface SyncLogEntry {
  id: string;
  timestamp: number;
  action: 'sync_started' | 'sync_completed' | 'sync_failed' | 'item_processed' | 'item_failed';
  itemId?: string;
  details?: string;
}

export interface QueueStats {
  pendingImages: number;
  pendingTransactions: number;
  failedItems: number;
  lastSyncTime: number | null;
}

const DB_NAME = 'homeaccount-offline-queue';
const DB_VERSION = 1;
const MAX_RETRY_COUNT = 3;

@Injectable({ providedIn: 'root' })
export class OfflineQueueService implements OnDestroy {
  private pwaService = inject(PwaService);
  
  private db: IDBPDatabase<OfflineQueueDB> | null = null;
  private syncInProgress = false;
  private onlineHandler: (() => void) | null = null;
  private syncEventHandler: ((event: Event) => void) | null = null;

  // State signals
  private _isReady = signal<boolean>(false);
  private _pendingCount = signal<number>(0);
  private _isSyncing = signal<boolean>(false);
  private _lastSyncTime = signal<number | null>(null);
  private _syncProgress = signal<number>(0);

  // Public computed signals
  isReady = computed(() => this._isReady());
  pendingCount = computed(() => this._pendingCount());
  isSyncing = computed(() => this._isSyncing());
  lastSyncTime = computed(() => this._lastSyncTime());
  syncProgress = computed(() => this._syncProgress());
  hasPendingItems = computed(() => this._pendingCount() > 0);

  constructor() {
    this.initializeDB();
    this.setupListeners();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private async initializeDB(): Promise<void> {
    try {
      this.db = await openDB<OfflineQueueDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          // Pending images store
          if (!db.objectStoreNames.contains('pending-images')) {
            const imageStore = db.createObjectStore('pending-images', { keyPath: 'id' });
            imageStore.createIndex('by-created', 'createdAt');
          }

          // Pending transactions store
          if (!db.objectStoreNames.contains('pending-transactions')) {
            const txStore = db.createObjectStore('pending-transactions', { keyPath: 'id' });
            txStore.createIndex('by-created', 'createdAt');
            txStore.createIndex('by-status', 'status');
          }

          // Sync log store
          if (!db.objectStoreNames.contains('sync-log')) {
            const logStore = db.createObjectStore('sync-log', { keyPath: 'id' });
            logStore.createIndex('by-timestamp', 'timestamp');
          }
        },
      });

      this._isReady.set(true);
      await this.updatePendingCount();
      console.log('[OfflineQueue] Database initialized');
    } catch (error) {
      console.error('[OfflineQueue] Failed to initialize database:', error);
    }
  }

  private setupListeners(): void {
    // Listen for online status changes
    this.onlineHandler = () => {
      if (this.pwaService.isOnline() && this.hasPendingItems()) {
        this.syncQueue();
      }
    };
    window.addEventListener('online', this.onlineHandler);

    // Listen for sync event from service worker
    this.syncEventHandler = () => {
      this.syncQueue();
    };
    window.addEventListener('sync-offline-queue', this.syncEventHandler);
  }

  private cleanup(): void {
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
    }
    if (this.syncEventHandler) {
      window.removeEventListener('sync-offline-queue', this.syncEventHandler);
    }
    this.db?.close();
  }

  /**
   * Queue an image for later processing.
   */
  async queueImage(file: File): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const arrayBuffer = await file.arrayBuffer();

    const queuedImage: QueuedImage = {
      id,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      data: arrayBuffer,
      createdAt: Date.now(),
      status: 'pending',
      retryCount: 0,
    };

    await this.db.put('pending-images', queuedImage);
    await this.updatePendingCount();
    await this.logSync('item_processed', id, 'Image queued for processing');

    console.log('[OfflineQueue] Image queued:', id);
    
    // Register background sync if available
    this.pwaService.registerBackgroundSync('sync-offline-queue');

    return id;
  }

  /**
   * Queue multiple images.
   */
  async queueImages(files: File[]): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) {
      const id = await this.queueImage(file);
      ids.push(id);
    }
    return ids;
  }

  /**
   * Queue a transaction for later sync.
   */
  async queueTransaction(transaction: Omit<QueuedTransaction, 'id' | 'createdAt' | 'status'>): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const id = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const queuedTx: QueuedTransaction = {
      ...transaction,
      id,
      createdAt: Date.now(),
      status: 'pending',
    };

    await this.db.put('pending-transactions', queuedTx);
    await this.updatePendingCount();
    await this.logSync('item_processed', id, 'Transaction queued');

    console.log('[OfflineQueue] Transaction queued:', id);
    
    // Register background sync if available
    this.pwaService.registerBackgroundSync('sync-offline-queue');

    return id;
  }

  /**
   * Get all pending images.
   */
  async getPendingImages(): Promise<QueuedImage[]> {
    if (!this.db) return [];

    const all = await this.db.getAllFromIndex('pending-images', 'by-created');
    return all.filter(img => img.status === 'pending' || img.status === 'failed');
  }

  /**
   * Get all pending transactions.
   */
  async getPendingTransactions(): Promise<QueuedTransaction[]> {
    if (!this.db) return [];

    const all = await this.db.getAllFromIndex('pending-transactions', 'by-created');
    return all.filter(tx => tx.status === 'pending' || tx.status === 'failed');
  }

  /**
   * Get a queued image by ID.
   */
  async getQueuedImage(id: string): Promise<QueuedImage | undefined> {
    if (!this.db) return undefined;
    return this.db.get('pending-images', id);
  }

  /**
   * Convert queued image back to File.
   */
  async getQueuedImageAsFile(id: string): Promise<File | null> {
    const queuedImage = await this.getQueuedImage(id);
    if (!queuedImage) return null;

    return new File([queuedImage.data], queuedImage.fileName, {
      type: queuedImage.mimeType,
    });
  }

  /**
   * Update image status.
   */
  async updateImageStatus(id: string, status: QueueStatus, error?: string): Promise<void> {
    if (!this.db) return;

    const image = await this.db.get('pending-images', id);
    if (image) {
      image.status = status;
      if (error) {
        image.lastError = error;
        image.retryCount += 1;
      }
      await this.db.put('pending-images', image);
      await this.updatePendingCount();
    }
  }

  /**
   * Update transaction status.
   */
  async updateTransactionStatus(id: string, status: QueueStatus, error?: string): Promise<void> {
    if (!this.db) return;

    const tx = await this.db.get('pending-transactions', id);
    if (tx) {
      tx.status = status;
      if (status === 'completed') {
        tx.syncedAt = Date.now();
      }
      if (error) {
        tx.lastError = error;
      }
      await this.db.put('pending-transactions', tx);
      await this.updatePendingCount();
    }
  }

  /**
   * Remove a processed image from queue.
   */
  async removeImage(id: string): Promise<void> {
    if (!this.db) return;
    await this.db.delete('pending-images', id);
    await this.updatePendingCount();
  }

  /**
   * Remove a synced transaction from queue.
   */
  async removeTransaction(id: string): Promise<void> {
    if (!this.db) return;
    await this.db.delete('pending-transactions', id);
    await this.updatePendingCount();
  }

  /**
   * Sync all pending items when online.
   */
  async syncQueue(): Promise<{ success: number; failed: number }> {
    if (this.syncInProgress || !this.pwaService.isOnline()) {
      return { success: 0, failed: 0 };
    }

    this.syncInProgress = true;
    this._isSyncing.set(true);
    this._syncProgress.set(0);

    await this.logSync('sync_started');

    let success = 0;
    let failed = 0;

    try {
      // Get pending items
      const pendingImages = await this.getPendingImages();
      const pendingTxs = await this.getPendingTransactions();
      const total = pendingImages.length + pendingTxs.length;

      if (total === 0) {
        this._lastSyncTime.set(Date.now());
        await this.logSync('sync_completed', undefined, 'No pending items');
        return { success: 0, failed: 0 };
      }

      let processed = 0;

      // Process images (these need AI processing)
      for (const image of pendingImages) {
        if (image.retryCount >= MAX_RETRY_COUNT) {
          await this.updateImageStatus(image.id, 'failed', 'Max retries exceeded');
          failed++;
        } else {
          // Mark as processing - actual processing will be done by AIStrategyService
          await this.updateImageStatus(image.id, 'processing');
          // Emit event for processing
          window.dispatchEvent(new CustomEvent('process-queued-image', { detail: { id: image.id } }));
        }

        processed++;
        this._syncProgress.set(Math.round((processed / total) * 100));
      }

      // Process transactions (these just need to be saved to Firestore)
      for (const tx of pendingTxs) {
        try {
          // Emit event for saving
          window.dispatchEvent(new CustomEvent('sync-queued-transaction', { detail: { transaction: tx } }));
          await this.updateTransactionStatus(tx.id, 'completed');
          success++;
          await this.logSync('item_processed', tx.id, 'Transaction synced');
        } catch (error) {
          await this.updateTransactionStatus(tx.id, 'failed', 
            error instanceof Error ? error.message : 'Sync failed');
          failed++;
          await this.logSync('item_failed', tx.id, 
            error instanceof Error ? error.message : 'Unknown error');
        }

        processed++;
        this._syncProgress.set(Math.round((processed / total) * 100));
      }

      this._lastSyncTime.set(Date.now());
      await this.logSync('sync_completed', undefined, `Success: ${success}, Failed: ${failed}`);

      console.log('[OfflineQueue] Sync completed:', { success, failed });
    } catch (error) {
      console.error('[OfflineQueue] Sync failed:', error);
      await this.logSync('sync_failed', undefined, 
        error instanceof Error ? error.message : 'Unknown error');
    } finally {
      this.syncInProgress = false;
      this._isSyncing.set(false);
      this._syncProgress.set(0);
      await this.updatePendingCount();
    }

    return { success, failed };
  }

  /**
   * Get queue statistics.
   */
  async getStats(): Promise<QueueStats> {
    if (!this.db) {
      return {
        pendingImages: 0,
        pendingTransactions: 0,
        failedItems: 0,
        lastSyncTime: null,
      };
    }

    const images = await this.db.getAll('pending-images');
    const transactions = await this.db.getAll('pending-transactions');

    const pendingImages = images.filter(i => i.status === 'pending').length;
    const pendingTransactions = transactions.filter(t => t.status === 'pending').length;
    const failedItems = 
      images.filter(i => i.status === 'failed').length +
      transactions.filter(t => t.status === 'failed').length;

    return {
      pendingImages,
      pendingTransactions,
      failedItems,
      lastSyncTime: this._lastSyncTime(),
    };
  }

  /**
   * Clear all completed items.
   */
  async clearCompleted(): Promise<void> {
    if (!this.db) return;

    const images = await this.db.getAll('pending-images');
    const transactions = await this.db.getAll('pending-transactions');

    for (const img of images) {
      if (img.status === 'completed') {
        await this.db.delete('pending-images', img.id);
      }
    }

    for (const tx of transactions) {
      if (tx.status === 'completed') {
        await this.db.delete('pending-transactions', tx.id);
      }
    }

    await this.updatePendingCount();
    console.log('[OfflineQueue] Cleared completed items');
  }

  /**
   * Clear all failed items.
   */
  async clearFailed(): Promise<void> {
    if (!this.db) return;

    const images = await this.db.getAll('pending-images');
    const transactions = await this.db.getAll('pending-transactions');

    for (const img of images) {
      if (img.status === 'failed') {
        await this.db.delete('pending-images', img.id);
      }
    }

    for (const tx of transactions) {
      if (tx.status === 'failed') {
        await this.db.delete('pending-transactions', tx.id);
      }
    }

    await this.updatePendingCount();
    console.log('[OfflineQueue] Cleared failed items');
  }

  /**
   * Clear entire queue (use with caution).
   */
  async clearAll(): Promise<void> {
    if (!this.db) return;

    await this.db.clear('pending-images');
    await this.db.clear('pending-transactions');
    await this.updatePendingCount();
    console.log('[OfflineQueue] Cleared all items');
  }

  /**
   * Get sync log entries.
   */
  async getSyncLog(limit = 50): Promise<SyncLogEntry[]> {
    if (!this.db) return [];

    const all = await this.db.getAllFromIndex('sync-log', 'by-timestamp');
    return all.slice(-limit).reverse();
  }

  /**
   * Clear old sync log entries.
   */
  async clearOldLogs(olderThanDays = 7): Promise<void> {
    if (!this.db) return;

    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const all = await this.db.getAll('sync-log');

    for (const entry of all) {
      if (entry.timestamp < cutoff) {
        await this.db.delete('sync-log', entry.id);
      }
    }
  }

  /**
   * Update pending count signal.
   */
  private async updatePendingCount(): Promise<void> {
    if (!this.db) {
      this._pendingCount.set(0);
      return;
    }

    const images = await this.db.getAll('pending-images');
    const transactions = await this.db.getAll('pending-transactions');

    const count = 
      images.filter(i => i.status === 'pending' || i.status === 'failed').length +
      transactions.filter(t => t.status === 'pending' || t.status === 'failed').length;

    this._pendingCount.set(count);
  }

  /**
   * Log sync activity.
   */
  private async logSync(
    action: SyncLogEntry['action'],
    itemId?: string,
    details?: string
  ): Promise<void> {
    if (!this.db) return;

    const entry: SyncLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      action,
      itemId,
      details,
    };

    await this.db.put('sync-log', entry);
  }

  /**
   * Estimate storage usage.
   */
  async getStorageUsage(): Promise<{ used: number; quota: number }> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return { used: 0, quota: 0 };
  }
}
