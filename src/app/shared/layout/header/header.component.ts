import { Component, computed, EventEmitter, inject, Input, Output } from '@angular/core';

import { Router, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe
  ],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  @Input() isSidebarOpen = true;
  @Output() toggleSidebar = new EventEmitter<void>();

  private authService = inject(AuthService);
  private router = inject(Router);

  currentUser = computed(() => this.authService.currentUser());

  async logout(): Promise<void> {
    await this.authService.signOut();
    this.router.navigate(['/login']);
  }
}
