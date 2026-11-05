import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';

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
  ]);
}
