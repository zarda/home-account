import { Timestamp } from '@angular/fire/firestore';

// Named alias rather than a bare literal so later categories can be added
// without reshaping documents that are already stored.
export type FeedbackCategory = 'bug' | 'idea' | 'other';

/**
 * One entry in the users/{uid}/feedback subcollection.
 *
 * Deliberately carries nothing the client did not already know about itself:
 * the app version the About page shows, the three-value Capacitor runtime
 * container, and the UI locale. The account email the operator replies to
 * is looked up server-side at mail time, never stored here.
 */
export interface FeedbackEntry {
  id: string;
  userId: string;
  category: FeedbackCategory;
  message: string;
  appVersion: string;
  platform: string;
  locale: string;
  createdAt?: Timestamp;  // stamped by FirestoreService.addDocument
  updatedAt?: Timestamp;  // stamped by FirestoreService.addDocument
}
