/**
 * The pure half of a row's share controls, apart from RowSharingService so
 * the transaction form, which the initial bundle holds, can weigh a choice
 * without carrying the service.
 */

/** A household the account belongs to, as the share controls offer it. */
export interface ShareTarget {
  householdId: string;
  /** The name the account's index cached for it. */
  name: string;
}

/** The households one row is to be shared into and taken out of. */
export interface ShareChange {
  share: string[];
  unshare: string[];
}

/**
 * The shares and unshares that take a row from the households it names
 * (`before`) to the ones chosen for it (`after`), limited to the households
 * the controls offered: a key the row holds for a membership that has ended
 * had no control, so its absence from the choice is not a choice.
 */
export function shareChange(
  before: readonly string[],
  after: readonly string[],
  offered: readonly string[]
): ShareChange {
  return {
    share: offered.filter(id => after.includes(id) && !before.includes(id)),
    unshare: offered.filter(id => before.includes(id) && !after.includes(id))
  };
}

/** The households a row names once `landed` has gone through, from those it named. */
export function applyShareChange(held: readonly string[], landed: ShareChange): string[] {
  const kept = held.filter(id => !landed.unshare.includes(id));
  return [...kept, ...landed.share.filter(id => !kept.includes(id))];
}
