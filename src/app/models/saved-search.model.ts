import { Timestamp } from '@angular/fire/firestore';

// One remembered transaction search. Pinned entries are user-labeled
// shortcuts ("saved searches"); unpinned entries form the recent-search
// history, capped and pruned by SearchHistoryService.
export interface SavedSearch {
  id: string;
  userId: string;
  query: string;
  label?: string; // shown for pinned entries; recents render the query itself
  pinned: boolean;
  lastUsedAt: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
