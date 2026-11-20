import { DestroyRef, Injectable, effect, signal, untracked } from '@angular/core';
import type { MatDialogRef } from '@angular/material/dialog';

import type { HouseholdStatus } from '../../core/services/household.service';
import { sameStamp } from '../../core/utils/household-index.utils';
import type { Household } from '../../models';

/**
 * The same household, and the same generation of it, as a section holds
 * the one the page showed: a rename is no change. None shown (null)
 * matches nothing, not even null, so an action begun with no household
 * never counts as the page still showing it. Unlike the ledger's
 * sameHousehold, the owner is not compared: one generation has one owner.
 */
export const sameShownHousehold = (a: Household | null, b: Household | null): boolean =>
  a !== null && b !== null && a.id === b.id && sameStamp(a.createdAt, b.createdAt);

/** A dialog as a section holds it: all it needs of one is to close it. */
export type OpenDialog = Pick<MatDialogRef<unknown>, 'close'>;

/**
 * Closes, unanswered, each of a section's open dialogs once the page shows
 * a household other than the one it was opened for (sameShownHousehold),
 * and every one of them when the section goes: nothing asked about one
 * household is answered in another. Called from a constructor, where
 * `effect` has its injection context; `open` is the section's own map, which
 * it keeps as its dialogs open and close.
 */
export function closeDialogsOnSwitch(
  shown: () => Household | null,
  open: ReadonlyMap<OpenDialog, Household | null>,
  destroyRef: DestroyRef
): void {
  effect(() => {
    const household = shown();
    untracked(() => {
      for (const [ref, opened] of open) if (!sameShownHousehold(opened, household)) ref.close();
    });
  });
  destroyRef.onDestroy(() => {
    for (const ref of open.keys()) ref.close();
  });
}

/**
 * A swap the page moves focus for once its view is on screen: one an action
 * asked for, or a switch chosen in the page's switcher.
 */
export type HouseholdSwap =
  | {
      readonly kind: 'action';
      /** The statuses whose view it lands on; `none` is the setup. */
      readonly statuses: readonly HouseholdStatus[];
    }
  | {
      readonly kind: 'switch';
      /** The household whose member view it lands on, or null for the setup. */
      readonly switchTo: string | null;
      /** The switcher, which stays on screen: focus left on it moves with the swap. */
      readonly origin: Element | null;
    };

/**
 * Where focus goes when an action replaces the section it was taken in.
 * Creating or joining swaps the setup for the member view, leaving or
 * dissolving swaps it for the setup or for another household's member view,
 * and a retry replaces the notice that holds its button; each takes the
 * focused element with it. The acting section names the status it waits for,
 * and the page, which renders every section, moves focus once that status is
 * on screen.
 *
 * A switch, chosen in the page's switcher, is a swap too, though the switcher
 * stays: it names the household it waits for, or the setup, and focus moves
 * from the switcher to the view that came in.
 *
 * Only an action, a switch, or the page's own notice that access was lost,
 * sets it: a first load, or a change made on another device, moves nothing.
 */
@Injectable()
export class HouseholdPageFocus {
  private readonly swap = signal<HouseholdSwap | null>(null);

  /** The swap focus is waiting on; null when none is. */
  readonly awaited = this.swap.asReadonly();

  /** Focus moves on the next time the page shows one of these. */
  afterSwapTo(...statuses: HouseholdStatus[]): void {
    this.swap.set({ kind: 'action', statuses });
  }

  /** Focus moves from `origin` once the page shows this household's member view, or the setup for null. */
  afterSwitchTo(householdId: string | null, origin: Element | null): void {
    this.swap.set({ kind: 'switch', switchTo: householdId, origin });
  }

  clear(): void {
    this.swap.set(null);
  }
}
