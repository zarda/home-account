import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';

import { AuthService } from '../../core/services/auth.service';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { ProfileSettingsComponent } from './profile-settings/profile-settings.component';
import { CategoryManagerComponent } from './category-manager/category-manager.component';
import { DataManagementComponent } from './data-management/data-management.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatExpansionModule,
    ProfileSettingsComponent,
    CategoryManagerComponent,
    DataManagementComponent,
    TranslatePipe,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private authService = inject(AuthService);

  userName = this.authService.currentUser()?.displayName || 'User';
  userEmail = this.authService.currentUser()?.email || '';
  userPhoto = this.authService.currentUser()?.photoURL || '';
}
