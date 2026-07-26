import { Timestamp } from '@angular/fire/firestore';

// Named alias rather than a bare literal so later entry kinds can be added
// without reshaping documents that are already stored.
export type SecurityEventType = 'signIn';

/**
 * One entry in the append-only users/{uid}/securityEvents log.
 *
 * Deliberately carries nothing the client did not already know about itself:
 * no IP, no user-agent string, no device identifier. `platform` is the
 * three-value Capacitor runtime container and nothing finer.
 */
export interface SecurityEvent {
  id: string;
  userId: string;
  type: SecurityEventType;
  occurredAt: Timestamp;
  platform: string;
  createdAt?: Timestamp;  // stamped by FirestoreService.addDocument
  updatedAt?: Timestamp;  // stamped by FirestoreService.addDocument
}
