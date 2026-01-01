import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { AuthService } from '../../../core/services/auth.service';
import { SUPPORTED_CURRENCIES } from '../../../models';

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './profile-settings.component.html',
  styleUrl: './profile-settings.component.scss',
})
export class ProfileSettingsComponent {
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);

  currencies = SUPPORTED_CURRENCIES;
  isSaving = signal(false);

  // Current preferences
  baseCurrency = this.authService.currentUser()?.preferences?.baseCurrency || 'USD';
  theme: 'light' | 'dark' | 'system' = this.authService.currentUser()?.preferences?.theme || 'system';
  dateFormat = this.authService.currentUser()?.preferences?.dateFormat || 'MM/DD/YYYY';
  language = this.authService.currentUser()?.preferences?.language || 'en';

  dateFormats = [
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2024)' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2024)' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-12-31)' },
  ];

  languages = [
    { code: 'en', name: 'English' },
    { code: 'zh-Hant', name: '繁體中文' },
    { code: 'ja', name: '日本語' },
  ];

  async savePreferences(): Promise<void> {
    this.isSaving.set(true);

    try {
      await this.authService.updateUserPreferences({
        baseCurrency: this.baseCurrency,
        theme: this.theme,
        dateFormat: this.dateFormat,
        language: this.language,
      });

      this.snackBar.open('Preferences saved successfully', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
      });
    } catch {
      this.snackBar.open('Failed to save preferences', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
      });
    } finally {
      this.isSaving.set(false);
    }
  }
}
