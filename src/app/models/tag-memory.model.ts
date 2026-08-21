import { Timestamp } from '@angular/fire/firestore';

/**
 * What a merchant's rows are tagged with, and which suggested tags the user
 * refused for it.
 *
 * Stored at `users/{uid}/tagMemory/{merchantKey}`, the same shape of contract
 * as category memory: the normalized merchant key is the document id, so a
 * repeat confirmation overwrites rather than accumulating rows.
 */
export interface TagMemoryEntry {
  /** Normalized merchant key. Same value as the document id. */
  merchantKey: string;
  /** Tags the user kept on this merchant's rows at the last confirm. */
  tags: string[];
  /** Tags the user removed from a suggestion for this merchant; never offered again until kept. */
  suppressed: string[];
  /** The description as the user last saw it, for the settings screen. */
  sampleDescription: string;
  /** How many confirms have touched this merchant. */
  count: number;
  updatedAt?: Timestamp;
}
