import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { CurrencyChoiceSessionService } from './currency-choice-session.service';
import { AuthService } from './auth.service';

describe('CurrencyChoiceSessionService', () => {
  let userId: ReturnType<typeof signal<string | null>>;
  let service: CurrencyChoiceSessionService;

  beforeEach(() => {
    userId = signal<string | null>('user-1');
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { userId } }],
    });
    service = TestBed.inject(CurrencyChoiceSessionService);
  });

  it('starts with no choice', () => {
    expect(service.current()).toBeNull();
  });

  it('remembers the last choice only', () => {
    service.remember('KRW');
    service.remember('THB');
    expect(service.current()).toBe('THB');
  });

  it('ignores an empty choice rather than forgetting the last one', () => {
    service.remember('KRW');
    service.remember('');
    expect(service.current()).toBe('KRW');
  });

  it('can be cleared', () => {
    service.remember('KRW');
    service.clear();
    expect(service.current()).toBeNull();
  });

  it('forgets the choice on sign-out, so it never follows the next account', () => {
    service.remember('KRW');
    userId.set(null);
    TestBed.tick();
    expect(service.current()).toBeNull();
  });

  it('does not persist anywhere', () => {
    // Per trip, not per merchant: a persisted memory would be ADR 0029's
    // whole checklist for a fact that is stale by the next trip.
    spyOn(Storage.prototype, 'setItem');
    service.remember('KRW');
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
  });
});
