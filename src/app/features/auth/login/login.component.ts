import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private translationService = inject(TranslationService);

  isLoading = signal(false);
  error = signal<string | null>(null);

  async signInWithGoogle(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Opens popup for Google sign-in
      await this.authService.signInWithGoogle();
      // Navigate to dashboard on success
      this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      this.handleAuthError(err);
      this.isLoading.set(false);
    }
  }

  private handleAuthError(err: unknown): void {
    const error = err as { code?: string; message?: string };
    if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
      this.error.set(this.translationService.t('auth.signInCancelled'));
    } else if (error.code === 'auth/network-request-failed') {
      this.error.set(this.translationService.t('auth.networkError'));
    } else if (error.code === 'auth/user-cancelled') {
      this.error.set(this.translationService.t('auth.signInCancelled'));
    } else {
      this.error.set(this.translationService.t('auth.signInFailed'));
    }
  }
}
