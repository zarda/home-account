import { Provider } from '@angular/core';
import { PendingDeleteService } from '../pending-delete.service';

/**
 * A PendingDeleteService with no transaction delete waiting or running, for
 * a component with a sign-out door whose spec is not about that door: the
 * real one would bring the transaction write path, and Firestore, with it.
 */
export function provideNoPendingDelete(): Provider {
  return { provide: PendingDeleteService, useValue: { flushBeforeSignOut: () => Promise.resolve() } };
}
