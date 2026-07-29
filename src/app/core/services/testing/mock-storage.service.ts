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
  /** When set, uploads at this slot (and beyond) reject — for batch rollback tests. */
  failFromSlot: number | null = null;

  private _uploadReceiptSpy = new SimpleSpy();
  private _deleteReceiptSpy = new SimpleSpy();
  private _deleteReceiptSlotsSpy = new SimpleSpy();

  get uploadReceiptSpy() { return this._uploadReceiptSpy; }
  get deleteReceiptSpy() { return this._deleteReceiptSpy; }
  get deleteReceiptSlotsSpy() { return this._deleteReceiptSlotsSpy; }

  clearMocks(): void {
    this._uploadReceiptSpy.reset();
    this._deleteReceiptSpy.reset();
    this._deleteReceiptSlotsSpy.reset();
    this.uploadError = null;
    this.failFromSlot = null;
  }

  async uploadReceipt(
    userId: string,
    transactionId: string,
    file: File,
    slot = 0
  ): Promise<string> {
    this._uploadReceiptSpy.call(userId, transactionId, file, slot);
    if (this.uploadError) {
      throw this.uploadError;
    }
    if (this.failFromSlot !== null && slot >= this.failFromSlot) {
      throw new Error(`upload rejected at slot ${slot}`);
    }
    // Slot-distinct URLs so callers can assert array ordering.
    return slot === 0 ? this.uploadResult : `${this.uploadResult}_${slot}`;
  }

  async deleteReceipt(userId: string, transactionId: string, slot = 0): Promise<void> {
    this._deleteReceiptSpy.call(userId, transactionId, slot);
  }

  async deleteReceiptSlots(userId: string, transactionId: string, slots: number[]): Promise<void> {
    this._deleteReceiptSlotsSpy.call(userId, transactionId, slots);
    await Promise.allSettled(
      slots.map(slot => this.deleteReceipt(userId, transactionId, slot))
    );
  }
}
