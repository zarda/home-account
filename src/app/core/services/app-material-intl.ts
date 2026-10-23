import { Injectable, Provider, effect, inject, untracked } from '@angular/core';
import { MatStepperIntl } from '@angular/material/stepper';
import { TranslationService } from './translation.service';

/**
 * The stepper's hidden words in the reader's language: what a screen reader
 * hears on the icon of a step that is finished and can be revisited, on one
 * that is finished and sealed, and under the label of an optional step.
 * Material's own are English literals, fixed for the life of the app.
 *
 * The labels are assigned, not read through getters: Material declares them
 * as class fields, which would shadow a getter here. They are assigned once at
 * construction, from the catalog the app loaded before any page rendered, and
 * again whenever a catalog arrives. A root effect on `translationsVersion`
 * does that rather than the locale alone, because a catalog can arrive under
 * an unchanged locale (a failed load that falls back to the default, a reload
 * of the same language). Nothing here depends on another service having
 * moved first, so the labels need no ordering beyond coming before `changes`,
 * which tells every step header to redraw and so must find them in place.
 *
 * In the import wizard a finished step that is not the selected one is
 * editable (`[editable]="!isImporting()"`), so a reader hears `editableLabel`;
 * `completedLabel` is heard only while the import is being written and the
 * steps are sealed.
 */
@Injectable({ providedIn: 'root' })
export class AppStepperIntl extends MatStepperIntl {
  private readonly translation = inject(TranslationService);

  constructor() {
    super();
    untracked(() => this.relabel());
    effect(() => {
      this.translation.translationsVersion();
      untracked(() => {
        this.relabel();
        this.changes.next();
      });
    });
  }

  /** Reads every label from the catalog of the reader's language. */
  relabel(): void {
    this.completedLabel = this.translation.t('stepper.completed');
    this.editableLabel = this.translation.t('stepper.editable');
    this.optionalLabel = this.translation.t('stepper.optional');
  }
}

/**
 * `MatStepperIntl` answered by `AppStepperIntl`, for a component that carries
 * a stepper to list in its own `providers` (its headers reach the intl
 * through the component's element injector).
 *
 * A plain provider rather than the environment providers of
 * `provideAppDatepicker()`, and not listed in `app.config.ts` or the eager
 * `app.routes.ts`, for two reasons: a component's `providers` cannot take
 * `EnvironmentProviders`, and anything the initial bundle imports by name
 * would pull Material's stepper code out of the lazy import wizard and into
 * `main` (36 kB; ADR 0023 keeps lazy code out of the initial bundle).
 */
export const APP_STEPPER_INTL_PROVIDER: Provider = { provide: MatStepperIntl, useExisting: AppStepperIntl };
