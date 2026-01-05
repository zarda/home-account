import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AuthService } from '../../../core/services/auth.service';
import { TranslationService, SupportedLocale } from '../../../core/services/translation.service';
import { ThemeService, ThemePreference } from '../../../core/services/theme.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { SUPPORTED_CURRENCIES } from '../../../models';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './profile-settings.component.html',
  styleUrl: './profile-settings.component.scss',
})
export class ProfileSettingsComponent {
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private translationService = inject(TranslationService);
  private themeService = inject(ThemeService);
  private geminiService = inject(GeminiService);

  currencies = SUPPORTED_CURRENCIES;

  // Current preferences
  baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
  theme: ThemePreference = this.authService.currentUser()?.preferences?.theme || 'system';
  dateFormat = this.authService.currentUser()?.preferences?.dateFormat || 'MM/DD/YYYY';
  language: SupportedLocale = (this.authService.currentUser()?.preferences?.language as SupportedLocale) || this.translationService.currentLocale();

  // Gemini API Key
  geminiApiKey = this.authService.currentUser()?.preferences?.geminiApiKey || '';
  isTestingKey = false;
  keyTestResult: 'success' | 'error' | null = null;

  dateFormats = [
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2024)' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2024)' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-12-31)' },
  ];

  languages = this.translationService.languages;

  async onCurrencyChange(): Promise<void> {
    await this.savePreference({ baseCurrency: this.baseCurrency });
  }

  async onDateFormatChange(): Promise<void> {
    await this.savePreference({ dateFormat: this.dateFormat });
  }

  async onThemeChange(): Promise<void> {
    // Apply theme immediately
    this.themeService.setTheme(this.theme);
    await this.savePreference({ theme: this.theme });
  }

  async onLanguageChange(): Promise<void> {
    await this.translationService.setLocale(this.language);
    await this.savePreference({ language: this.language });
  }

  async onApiKeyChange(): Promise<void> {
    this.keyTestResult = null;
    await this.savePreference({ geminiApiKey: this.geminiApiKey || undefined });
    // Reinitialize Gemini with the new key
    this.geminiService.reinitialize(this.geminiApiKey || undefined);
  }

  async testApiKey(): Promise<void> {
    if (!this.geminiApiKey) return;

    this.isTestingKey = true;
    this.keyTestResult = null;

    try {
      // Reinitialize with the key to test
      this.geminiService.reinitialize(this.geminiApiKey);

      // Check if initialization succeeded
      if (this.geminiService.isAvailable()) {
        this.keyTestResult = 'success';
      } else {
        this.keyTestResult = 'error';
      }
    } catch {
      this.keyTestResult = 'error';
    } finally {
      this.isTestingKey = false;
    }
  }

  clearApiKey(): void {
    this.geminiApiKey = '';
    this.keyTestResult = null;
    this.onApiKeyChange();
  }

  private async savePreference(pref: Record<string, unknown>): Promise<void> {
    try {
      await this.authService.updateUserPreferences({
        ...this.authService.currentUser()?.preferences,
        ...pref,
      });
    } catch {
      this.snackBar.open(this.translationService.t('common.error'), this.translationService.t('common.close'), {
        duration: 3000,
        horizontalPosition: 'center',
      });
    }
  }
}
