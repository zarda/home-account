import { Timestamp } from '@angular/fire/firestore';

/**
 * A merchant the user has categorized by hand, and what they chose.
 *
 * Stored at `users/{uid}/categoryMemory/{merchantKey}` — the normalized
 * merchant key *is* the document id, so a repeat correction overwrites rather
 * than accumulating rows, and a lookup is a map hit rather than a query.
 */
export interface CategoryMemoryEntry {
  /** Normalized merchant key. Same value as the document id. */
  merchantKey: string;
  categoryId: string;
  /** The description as the user last saw it, for showing the entry in settings. */
  sampleDescription: string;
  /** How many times this merchant has been confirmed. Higher is more settled. */
  count: number;
  updatedAt?: Timestamp;
}

/**
 * Confidence stamped on a row categorized from memory.
 *
 * Deliberately not 1.0. `applyCategorizations` documents 1.0 as "the user
 * confirmed this one", and the preview renders anything >= 0.8 with the green
 * high-confidence dot. A remembered category is strong evidence but it is still
 * an inference — the user corrected this merchant once, not this row — so it
 * sits just below certainty. A wrong memory therefore still reads as a
 * suggestion the reviewer can scan past, rather than as something they already
 * agreed to.
 */
export const CATEGORY_MEMORY_CONFIDENCE = 0.95;
