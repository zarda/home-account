import { Timestamp } from '@angular/fire/firestore';

// The union is derived from the tuple so the two cannot drift: the form's
// kind toggle and the Firestore rules enumeration both read GOAL_KINDS
// rather than pinning the list a second time.
export const GOAL_KINDS = ['saving', 'project'] as const;

export type GoalKind = typeof GOAL_KINDS[number];

export function isGoalKind(value: unknown): value is GoalKind {
  return typeof value === 'string' && (GOAL_KINDS as readonly string[]).includes(value);
}

/** One planned purchase on a project goal's checklist. */
export interface GoalItem {
  name: string;
  amount: number;
  done: boolean;
}

/**
 * A target to put money toward. `kind` distinguishes the flavor, not the
 * mechanics: a *saving* goal accumulates toward an amount (emergency fund),
 * a *project* is a planned spend (a trip, a purchase list) that may carry an
 * itemized checklist. Either way `targetAmount` is authoritative and
 * progress is `(contributedAmount + linkedAmount) / targetAmount` —
 * `items` is a checklist
 * whose sum the form can copy into the target on demand, never a second
 * source of truth.
 */
export interface Goal {
  id: string;
  userId: string;
  kind: GoalKind;
  name: string;
  targetAmount: number;
  /** Manual contributions to date, via the Contribute dialog only. */
  contributedAmount: number;
  /**
   * Sum of linked transactions' `goalAmount`s (each already converted into
   * this goal's currency at link time). Kept in step by the same Firestore
   * transaction that writes or clears a link, and recomputed from the
   * ledger on backup restore. Absent on documents written before links
   * existed; read it as 0. Progress is the two counters added together —
   * see goalProgressAmount().
   */
  linkedAmount?: number;
  currency: string;
  targetDate?: Timestamp;
  items?: GoalItem[];
  note?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateGoalDTO {
  kind: GoalKind;
  name: string;
  targetAmount: number;
  currency: string;
  /** `null` means "delete the stored target date" on update. */
  targetDate?: Date | null;
  items?: GoalItem[];
  note?: string;
}
