import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDialog } from '@angular/material/dialog';

import { AuthService } from '../../core/services/auth.service';
import { TranslationService } from '../../core/services/translation.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/components/confirm-dialog/confirm-dialog.component';
import { ProfileSettingsComponent } from './profile-settings/profile-settings.component';
import { CategoryManagerComponent } from './category-manager/category-manager.component';
import { DataManagementComponent } from './data-management/data-management.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    PageHeaderComponent,
    CommonModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatExpansionModule,
    ProfileSettingsComponent,
    CategoryManagerComponent,
    DataManagementComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private authService = inject(AuthService);
  private translationService = inject(TranslationService);
  private dialog = inject(MatDialog);

  userName = computed(() => this.authService.currentUser()?.displayName || 'User');
  userEmail = computed(() => this.authService.currentUser()?.email || '');
  userPhoto = computed(() => this.authService.currentUser()?.photoURL || '');

  // Sign Out lives on the profile card (and the header user menu), no longer
  // buried in the destructive Danger Zone alongside delete-all-data.
  signOut(): void {
    const data: ConfirmDialogData = {
      title: this.translationService.t('auth.signOut'),
      message: this.translationService.t('settings.signOutConfirm'),
      confirmLabel: this.translationService.t('auth.signOut'),
      confirmColor: 'primary',
    };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, { data });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.authService.signOut();
      }
    });
  }
}
