import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);

  isLoading = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    // Check for redirect result when component loads
    try {
      const wasRedirected = await this.authService.checkRedirectResult();
      if (wasRedirected) {
        this.router.navigate(['/']);
      }
    } catch (err: unknown) {
      this.handleAuthError(err);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // This will redirect to Google - page will reload after auth
      await this.authService.signInWithGoogle();
    } catch (err: unknown) {
      this.handleAuthError(err);
      this.isLoading.set(false);
    }
  }

  private handleAuthError(err: unknown): void {
    console.error('Login error:', err);

    const error = err as { code?: string; message?: string };
    if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
      this.error.set('Sign-in was cancelled. Please try again.');
    } else if (error.code === 'auth/network-request-failed') {
      this.error.set('Network error. Please check your connection.');
    } else if (error.code === 'auth/user-cancelled') {
      this.error.set('Sign-in was cancelled. Please try again.');
    } else {
      this.error.set('Failed to sign in. Please try again.');
    }
  }
}
