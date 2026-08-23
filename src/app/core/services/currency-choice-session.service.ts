import { Injectable, effect, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * The last currency the user chose for a row whose currency nobody read,
 * held for this session only.
 *
 * A week of Korean receipts scanned at home all fall back to the base
 * currency; correcting the first one should make the second one's chip say
 * KRW without asking the phone where it is. In memory on purpose — a trip is
 * not a per-merchant fact worth a collection, a cascade step and a data-hub
 * row (ADR 0029) — and cleared on sign-out the way every root-provided cache
 * is, so it can never surface for the next account on a shared device.
 */
@Injectable({ providedIn: 'root' })
export class CurrencyChoiceSessionService {
  private authService = inject(AuthService);
  private choice = signal<string | null>(null);

  constructor() {
    // Signed-out edge only; see TransactionService's reset effect for why the
    // cache is cleared from the owning service and not from signOut().
    effect(() => {
      if (this.authService.userId() === null) {
        this.choice.set(null);
      }
    });
  }

  /** Record a currency the user chose for a fallen-back row. Empty is ignored. */
  remember(code: string): void {
    if (code) {
      this.choice.set(code);
    }
  }

  current(): string | null {
    return this.choice();
  }

  clear(): void {
    this.choice.set(null);
  }
}
