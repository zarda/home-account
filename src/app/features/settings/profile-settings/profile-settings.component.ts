import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { AuthService } from '../../../core/services/auth.service';
import { TranslationService, SupportedLocale } from '../../../core/services/translation.service';
import { ThemeService, ThemePreference } from '../../../core/services/theme.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { SUPPORTED_CURRENCIES, baseCurrencyOf} from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { NotificationService } from '../../../core/services/notification.service';
import { SecurityActivityComponent } from '../security-activity/security-activity.component';
import { SecuritySettingsComponent } from '../security-settings/security-settings.component';
import { AnalyticsSettingsComponent } from '../analytics-settings/analytics-settings.component';
import { AnalyticsService } from '../../../core/services/analytics.service';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    TranslatePipe,
    SecurityActivityComponent,
    SecuritySettingsComponent,
    AnalyticsSettingsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-settings.component.html',
  styleUrl: './profile-settings.component.scss',
})
export class ProfileSettingsComponent {
  private notifications = inject(NotificationService);
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private themeService = inject(ThemeService);
  private analytics = inject(AnalyticsService);
  private transactionService = inject(TransactionService);

  currencies = SUPPORTED_CURRENCIES;

  // Current profile
  displayName = signal(this.authService.currentUser()?.displayName || '');

  // Current preferences
  baseCurrency = baseCurrencyOf(this.authService.currentUser());
  theme: ThemePreference = this.authService.currentUser()?.preferences?.theme || 'system';
  dateFormat = this.authService.currentUser()?.preferences?.dateFormat || 'MM/DD/YYYY';
  language: SupportedLocale = (this.authService.currentUser()?.preferences?.language as SupportedLocale) || this.translationService.currentLocale();

  // Pattern-only labels keep the select value from colliding with the arrow;
  // the worked example moves to helper text below the field.
  dateFormats = [
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', example: '12/31/2024' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', example: '31/12/2024' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', example: '2024-12-31' },
  ];

  get dateFormatExample(): string {
    return this.dateFormats.find(f => f.value === this.dateFormat)?.example ?? '';
  }

  languages = this.translationService.languages;

  async onDisplayNameChange(): Promise<void> {
    const trimmed = this.displayName().trim();
    const current = this.authService.currentUser()?.displayName ?? '';
    if (!trimmed || trimmed === current) {
      this.displayName.set(current);
      return;
    }

    this.displayName.set(trimmed);
    try {
      await this.authService.updateUserProfile({ displayName: trimmed });
    } catch {
      this.displayName.set(current);
      const message = this.translationService.t('common.error');
      this.notifications.error(message);
    }
  }

  async onCurrencyChange(): Promise<void> {
    const saved = await this.savePreference({ baseCurrency: this.baseCurrency });
    if (!saved) return;

    this.analytics.trackSettingsChange({ setting: 'currency' });

    // Stored per-transaction snapshots (amountInBaseCurrency/exchangeRate)
    // are frozen against the old base; rewrite them so lists, totals, and
    // budgets convert against the newly chosen currency.
    try {
      await this.transactionService.resnapshotBaseCurrency(this.baseCurrency);
      this.notifications.success(
        this.translationService.t('settings.amountsRecalculated')
      );
    } catch {
      this.notifications.error(
        this.translationService.t('settings.amountsRecalculateFailed')
      );
    }
  }

  async onDateFormatChange(): Promise<void> {
    await this.savePreference({ dateFormat: this.dateFormat });
  }

  async onThemeChange(): Promise<void> {
    // Apply theme immediately
    this.themeService.setTheme(this.theme);
    await this.savePreference({ theme: this.theme });
    this.analytics.trackSettingsChange({ setting: 'theme' });
  }

  async onLanguageChange(): Promise<void> {
    await this.translationService.setLocale(this.language);
    await this.savePreference({ language: this.language });
    // Tagged from the handler, never from TranslationService.setLocale: that
    // also runs at boot, on its own error fallback, and when preferences sync
    // from the database, none of which is someone changing a setting.
    this.analytics.trackSettingsChange({ setting: 'language' });
  }

  private async savePreference(pref: Record<string, unknown>): Promise<boolean> {
    try {
      // Only the touched keys: updateUserPreferences writes per-field, so
      // spreading the whole map back in would re-send — and clobber — keys
      // another device may have changed since this session read them.
      await this.authService.updateUserPreferences(pref);
      return true;
    } catch {
      const message = this.translationService.t('common.error');
      this.notifications.error(message);
      return false;
    }
  }
}
