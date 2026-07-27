import { Component, computed, effect, inject, signal } from '@angular/core';

import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { BudgetService } from '../../../core/services/budget.service';
import { TranslationService } from '../../../core/services/translation.service';
import { AnnouncerService } from '../../../core/services/announcer.service';
import { AnalyticsService } from '../../../core/services/analytics.service';
import { BudgetAlertSeverity } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Dismissible inline banner for budget threshold alerts. Replaces the
 * standing snackbar that permanently covered content: snackbars are for
 * transient feedback, while this banner sits in the page flow, links to
 * the budgets page, and can be dismissed for the rest of the visit.
 */
@Component({
  selector: 'app-budget-alert-banner',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatButtonModule, TranslatePipe],
  templateUrl: './budget-alert-banner.component.html',
  styleUrl: './budget-alert-banner.component.scss',
})
export class BudgetAlertBannerComponent {
  private budgetService = inject(BudgetService);
  private translationService = inject(TranslationService);
  private announcer = inject(AnnouncerService);
  private analytics = inject(AnalyticsService);

  private dismissed = signal(false);
  private announced = false;

  alerts = computed(() => this.budgetService.budgetAlerts());

  visible = computed(() => !this.dismissed() && this.alerts().length > 0);

  /** Worst alert first — the service orders by severity. */
  severity = computed<BudgetAlertSeverity | null>(() => this.alerts()[0]?.severity ?? null);

  message = computed(() => {
    const alerts = this.alerts();
    if (alerts.length === 0) return '';

    const keyBySeverity: Record<BudgetAlertSeverity, string> = {
      exceeded: 'budget.alertSnackbarExceeded',
      critical: 'budget.alertSnackbarCritical',
      warning: 'budget.alertSnackbarWarning',
    };
    const top = alerts[0];
    let message = this.translationService.t(keyBySeverity[top.severity], {
      name: top.budgetName,
      percent: Math.round(top.percentUsed),
    });
    if (alerts.length > 1) {
      message += ` ${this.translationService.t('budget.alertSnackbarMore', {
        count: alerts.length - 1,
      })}`;
    }
    return message;
  });

  constructor() {
    // Screen readers hear the alert once per appearance; the visual
    // banner itself is role=status so it is not re-announced on CD.
    effect(() => {
      if (this.visible() && !this.announced) {
        this.announced = true;
        this.announcer.announce(this.message());
        // Same once-per-appearance guard, for the same reason: the banner is
        // role=status and re-evaluates on change detection, so an ungated
        // report would fire repeatedly for one sighting.
        //
        // severity, never the message. message() interpolates the budget's
        // name, which is user-entered text that must not reach analytics —
        // the taxonomy would reject it, but the safer habit is not to reach
        // for it at all.
        const severity = this.severity();
        if (severity) {
          this.analytics.trackBudgetExceededViewed({ severity });
        }
      }
    });
  }

  dismiss(): void {
    this.dismissed.set(true);
  }
}
