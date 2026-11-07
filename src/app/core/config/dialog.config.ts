import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { focusDropped } from '../utils/focus.utils';

/**
 * What every MatDialog opens with, provided once at the root.
 *
 * `MatDialog.open` spreads these options where it would otherwise spread
 * `new MatDialogConfig()`, not over it, so a key left out here is undefined
 * rather than Material's default. The container binds `role` and
 * `aria-modal` straight from it: options that named only the width, the
 * max width and the two focus settings left every dialog with no role. Material's defaults therefore come first, and
 * the app changes three of them:
 *
 * - the width, a comfortable one that always leaves a 16px gutter, so a
 *   fixed width like 400 or 500px can never overflow a 360px phone;
 * - the max width, which stays when a dialog opens at its own width, so even
 *   that width keeps the 16px gutter;
 * - the focus trap, which moves focus into a dialog as soon as it renders
 *   rather than after its 150ms entrance. That has been the app's behaviour
 *   since 6be36d28, and it is kept on purpose: the keys typed straight after
 *   the press that opened a dialog reach the dialog, not the page behind it.
 *   Material's default, the delayed trap, is the alternative passed over.
 *
 * Beside the options, one rule for where focus goes when a dialog closes: a
 * dialog a menu's entry opened gives focus back to the menu's trigger
 * (returnFocusPastTheMenu).
 */
export function provideAppDialogs(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: {
        ...new MatDialogConfig(),
        width: 'min(480px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        delayFocusTrap: false,
      } satisfies MatDialogConfig,
    },
    provideEnvironmentInitializer(returnFocusPastTheMenu),
  ]);
}

/**
 * A dialog a menu's entry opened gives focus back to the menu's trigger.
 *
 * A dialog returns focus to whatever held it as it opened. An entry's click
 * runs before its menu closes, so a dialog an entry opens finds the entry
 * focused (or the panel's first entry, on a touch), and the entry leaves the
 * page with its menu: the container then focuses a detached node and focus
 * falls to the document. The trigger owns the panel: while the menu is open
 * its aria-controls names the panel's id. Once the dialog has gone, focus
 * left on the document goes to the trigger. Focus the container could put
 * back, as where a dialog was told where to return it, stays where it went.
 *
 * The focus carries the origin of the close: the container has just set it
 * for its own attempt, in the same call, so an Escape returns keyboard focus
 * and a click on the backdrop returns mouse focus, as the container's own
 * restore would.
 *
 * Three call sites fixed this one door at a time before it was a rule: the
 * review card's currency chip and the transaction form's currency select,
 * which name their trigger as restoreFocus and so keep it, and the command
 * palette opened from the shortcuts hint, which is not a menu and returns
 * focus past the hint by a selector of its own (restoreFocusPastTheHint).
 *
 * What it cannot see: a dialog closed before its menu has left the page (the
 * container puts focus back on the entry, which leaves after); a submenu's
 * entry, whose trigger is an entry too; restoreFocus: false, which a menu's
 * dialog would not keep. The app has none of the three.
 */
function returnFocusPastTheMenu(): void {
  inject(MatDialog).afterOpened.subscribe(ref => {
    const panel = document.activeElement?.closest('[role="menu"][id]');
    const trigger = panel && document.querySelector<HTMLElement>(`[aria-controls~="${CSS.escape(panel.id)}"]`);
    if (!trigger) return;
    ref.afterClosed().subscribe(() => {
      if (focusDropped()) trigger.focus();
    });
  });
}
