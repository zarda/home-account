import { Injectable, signal, computed, OnDestroy } from '@angular/core';

/**
 * Service to communicate with the ML Web Worker.
 * Provides a clean API for loading models and processing text.
 * 
 * Supports two model types:
 * - 'qa': Question-answering (English, ~65MB)
 * - 'embeddings': Multilingual embeddings (~120MB)
 */

export type MLModelType = 'qa' | 'embeddings';

export interface MLParseResult {
  merchant: string;
  merchantConfidence: number;
  date: string;
  dateConfidence: number;
  total: number;
  totalConfidence: number;
  currency: string;
  rawAnswers: Record<string, unknown>;
  modelType?: MLModelType;
}

interface WorkerMessage {
  type: 'init' | 'parse' | 'status' | 'terminate';
  id: string;
  payload?: unknown;
}

interface WorkerResponse {
  type: 'ready' | 'progress' | 'result' | 'error';
  id: string;
  payload?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: number, status: string) => void;
}

// Model configurations
const MODEL_CONFIGS = {
  qa: { sizeMB: 65, name: 'Question-Answering (English)' },
  embeddings: { sizeMB: 120, name: 'Multilingual Embeddings' },
};

@Injectable({ providedIn: 'root' })
export class MLWorkerService implements OnDestroy {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageId = 0;

  // Shared preferences storage key
  private readonly PREFERENCES_KEY = 'homeaccount_ai_preferences';

  // State signals
  private _isReady = signal<boolean>(false);
  private _isLoading = signal<boolean>(false);
  private _progress = signal<number>(0);
  private _status = signal<string>('');
  private _error = signal<string | null>(null);
  private _isSupported = signal<boolean>(typeof Worker !== 'undefined');
  private _currentModelType = signal<MLModelType>('qa');
  private _wasDownloaded = signal<boolean>(false);

  // Public computed signals
  isReady = computed(() => this._isReady());
  isLoading = computed(() => this._isLoading());
  progress = computed(() => this._progress());
  status = computed(() => this._status());
  error = computed(() => this._error());
  isSupported = computed(() => this._isSupported());
  currentModelType = computed(() => this._currentModelType());
  wasDownloaded = computed(() => this._wasDownloaded());

  // Model size (based on current model type)
  readonly MODEL_SIZE_MB = 65; // Default for QA
  modelSize = computed(() => MODEL_CONFIGS[this._currentModelType()].sizeMB * 1024 * 1024);
  
  // Get model info
  getModelInfo(type: MLModelType = this._currentModelType()) {
    return MODEL_CONFIGS[type];
  }

  constructor() {
    // Load persisted model preferences
    this.loadPersistedState();
    
    // Check Web Worker support
    if (typeof Worker === 'undefined') {
      console.warn('[MLWorker] Web Workers not supported in this environment');
      this._isSupported.set(false);
    }
  }

  ngOnDestroy(): void {
    this.terminate();
  }

  /**
   * Load persisted model preferences from shared preferences.
   */
  private loadPersistedState(): void {
    try {
      const stored = localStorage.getItem(this.PREFERENCES_KEY);
      if (stored) {
        const prefs = JSON.parse(stored);
        if (prefs.mlModelType === 'qa' || prefs.mlModelType === 'embeddings') {
          this._currentModelType.set(prefs.mlModelType);
        }
        if (prefs.mlModelDownloaded === true) {
          this._wasDownloaded.set(true);
        }
      }
    } catch {
      // localStorage may not be available or invalid JSON
    }
  }

  /**
   * Persist model state to shared preferences.
   */
  private persistState(): void {
    try {
      const stored = localStorage.getItem(this.PREFERENCES_KEY);
      const prefs = stored ? JSON.parse(stored) : {};
      prefs.mlModelType = this._currentModelType();
      prefs.mlModelDownloaded = true;
      localStorage.setItem(this.PREFERENCES_KEY, JSON.stringify(prefs));
    } catch {
      // localStorage may not be available
    }
  }

  /**
   * Get the saved model type (for restoring state).
   */
  getSavedModelType(): MLModelType {
    return this._currentModelType();
  }

  /**
   * Initialize the ML worker and load the model.
   * @param modelType - 'qa' for English QA (~65MB), 'embeddings' for multilingual (~120MB)
   */
  async initialize(modelType: MLModelType = 'qa'): Promise<void> {
    // If already ready with the same model type, skip
    if (this._isReady() && this._currentModelType() === modelType) {
      return;
    }

    // If switching model types, terminate and reinitialize
    if (this._isReady() && this._currentModelType() !== modelType) {
      this.terminate();
    }

    if (this._isLoading()) {
      throw new Error('Already initializing');
    }

    if (!this._isSupported()) {
      throw new Error('Web Workers not supported');
    }

    this._isLoading.set(true);
    this._progress.set(0);
    this._currentModelType.set(modelType);
    const modelInfo = MODEL_CONFIGS[modelType];
    this._status.set(`Starting ML worker (${modelInfo.name})...`);
    this._error.set(null);

    try {
      // Create the worker
      await this.createWorker();

      // Initialize the pipeline (downloads model)
      await this.sendMessage('init', { modelType }, (progress, status) => {
        this._progress.set(progress);
        this._status.set(status);
      });

      this._isReady.set(true);
      this._wasDownloaded.set(true);
      this._status.set(`${modelInfo.name} ready`);
      this.persistState();
      console.log(`[MLWorker] Initialization complete (${modelType})`);
    } catch (error) {
      console.error('[MLWorker] Initialization failed:', error);
      this._error.set(error instanceof Error ? error.message : 'Failed to initialize');
      throw error;
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Create the web worker instance.
   */
  private async createWorker(): Promise<void> {
    if (this.worker) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Create worker using Angular's web worker syntax
        this.worker = new Worker(new URL('../../workers/ml.worker', import.meta.url), {
          type: 'module',
        });

        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(event.data);
        };

        this.worker.onerror = (error) => {
          console.error('[MLWorker] Worker error:', error);
          this._error.set('Worker error: ' + error.message);
          reject(error);
        };

        // Worker is created, resolve immediately
        // Actual model loading happens in initialize()
        resolve();
      } catch (error) {
        console.error('[MLWorker] Failed to create worker:', error);
        reject(error);
      }
    });
  }

  /**
   * Handle messages from the worker.
   */
  private handleWorkerMessage(response: WorkerResponse): void {
    const { type, id, payload } = response;
    const pending = this.pendingRequests.get(id);

    switch (type) {
      case 'ready':
        if (pending) {
          pending.resolve(payload);
          this.pendingRequests.delete(id);
        }
        break;

      case 'progress':
        if (pending?.onProgress) {
          const { progress, status } = payload as { progress: number; status: string };
          pending.onProgress(progress, status);
        }
        break;

      case 'result':
        if (pending) {
          pending.resolve(payload);
          this.pendingRequests.delete(id);
        }
        break;

      case 'error':
        if (pending) {
          const { error } = payload as { error: string };
          pending.reject(new Error(error));
          this.pendingRequests.delete(id);
        }
        break;
    }
  }

  /**
   * Send a message to the worker and wait for response.
   */
  private sendMessage(
    type: 'init' | 'parse' | 'status' | 'terminate',
    payload: unknown = {},
    onProgress?: (progress: number, status: string) => void
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not created'));
        return;
      }

      const id = `msg_${++this.messageId}`;
      
      this.pendingRequests.set(id, { resolve, reject, onProgress });

      const message: WorkerMessage = { type, id, payload };
      this.worker.postMessage(message);
    });
  }

  /**
   * Parse receipt text using the ML model.
   * Returns structured data extracted from the text.
   */
  async parseReceipt(text: string): Promise<MLParseResult> {
    if (!this._isReady()) {
      throw new Error('ML model not initialized. Call initialize() first.');
    }

    this._status.set('Parsing receipt...');
    this._progress.set(0);

    try {
      const result = await this.sendMessage('parse', { text }, (progress, status) => {
        this._progress.set(progress);
        this._status.set(status);
      });

      this._status.set('');
      return result as MLParseResult;
    } catch (error) {
      this._status.set('');
      throw error;
    }
  }

  /**
   * Get the current status of the worker.
   */
  async getStatus(): Promise<{ isReady: boolean; isInitializing: boolean }> {
    if (!this.worker) {
      return { isReady: false, isInitializing: false };
    }

    const result = await this.sendMessage('status');
    return result as { isReady: boolean; isInitializing: boolean };
  }

  /**
   * Terminate the worker and free resources.
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    this._isReady.set(false);
    this._isLoading.set(false);
    this._status.set('');
    this._progress.set(0);

    // Reject any pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();

    console.log('[MLWorker] Worker terminated');
  }

  /**
   * Check if ML processing can run offline (model is cached).
   */
  canProcessOffline(): boolean {
    return this._isReady();
  }
}
