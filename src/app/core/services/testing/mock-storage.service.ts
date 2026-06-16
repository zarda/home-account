import { Injectable } from '@angular/core';

// Simple spy implementation that works without jasmine in production builds
interface SpyCall {
  args: unknown[];
}

class SimpleSpy {
  calls: SpyCall[] = [];

  call = (...args: unknown[]): void => {
    this.calls.push({ args });
  };

  mostRecent(): SpyCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
  }
}

/**
 * Mock StorageService for unit testing
 */
@Injectable()
export class MockStorageService {
  // Configurable behaviour
  uploadResult = 'https://storage.example.com/users/test-user-123/receipts/mock.jpg';
  uploadError: Error | null = null;

  private _uploadReceiptSpy = new SimpleSpy();
  private _deleteReceiptSpy = new SimpleSpy();

  get uploadReceiptSpy() { return this._uploadReceiptSpy; }
  get deleteReceiptSpy() { return this._deleteReceiptSpy; }

  clearMocks(): void {
    this._uploadReceiptSpy.reset();
    this._deleteReceiptSpy.reset();
    this.uploadError = null;
  }

  async uploadReceipt(userId: string, transactionId: string, file: File): Promise<string> {
    this._uploadReceiptSpy.call(userId, transactionId, file);
    if (this.uploadError) {
      throw this.uploadError;
    }
    return this.uploadResult;
  }

  async deleteReceipt(userId: string, transactionId: string): Promise<void> {
    this._deleteReceiptSpy.call(userId, transactionId);
  }
}
