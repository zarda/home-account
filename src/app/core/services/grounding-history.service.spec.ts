import { TestBed } from '@angular/core/testing';

import { GROUNDING_HISTORY_MONTHS, GroundingHistoryService } from './grounding-history.service';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { createTransaction } from './testing';

describe('GroundingHistoryService', () => {
  let service: GroundingHistoryService;
  let transactionService: jasmine.SpyObj<TransactionService>;
  let currentUser: jasmine.Spy;

  const ragLevel = (ragInsightsLevel: 'off' | 'standard') =>
    currentUser.and.returnValue({
      preferences: { baseCurrency: 'JPY', ragInsightsLevel },
    } as never);

  beforeEach(() => {
    transactionService = jasmine.createSpyObj<TransactionService>('TransactionService', [
      'getTransactionsOnce',
    ]);
    transactionService.getTransactionsOnce.and.resolveTo([]);
    currentUser = jasmine.createSpy('currentUser').and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        GroundingHistoryService,
        { provide: TransactionService, useValue: transactionService },
        { provide: AuthService, useValue: { currentUser } },
      ],
    });

    service = TestBed.inject(GroundingHistoryService);
  });

  it('reads nothing at all when RAG is off', async () => {
    // The gate is the point: off means no transaction history is even read,
    // not that it is read and then discarded.
    ragLevel('off');

    await expectAsync(service.recent()).toBeResolvedTo([]);
    expect(transactionService.getTransactionsOnce).not.toHaveBeenCalled();
  });

  it('reads nothing when the account has expressed no preference', async () => {
    await expectAsync(service.recent()).toBeResolvedTo([]);
    expect(transactionService.getTransactionsOnce).not.toHaveBeenCalled();
  });

  it('reads a recent window when RAG is on', async () => {
    ragLevel('standard');
    const rows = [createTransaction()];
    transactionService.getTransactionsOnce.and.resolveTo(rows);

    await expectAsync(service.recent()).toBeResolvedTo(rows);

    const startDate = transactionService.getTransactionsOnce.calls.mostRecent().args[0]?.startDate;
    const expected = new Date();
    expected.setMonth(expected.getMonth() - GROUNDING_HISTORY_MONTHS);
    expect(startDate).toBeDefined();
    expect(Math.abs((startDate as Date).getTime() - expected.getTime())).toBeLessThan(60000);
  });

  it('answers empty and says so when the read fails', async () => {
    // A grounding nobody could build is not worth failing an import over.
    const warn = spyOn(console, 'warn');
    ragLevel('standard');
    transactionService.getTransactionsOnce.and.rejectWith(new Error('offline'));

    await expectAsync(service.recent()).toBeResolvedTo([]);
    expect(warn).toHaveBeenCalled();
  });

  it('reads with no live listener to fall back to', async () => {
    // The mock stubs only the one-shot method; a regression to the listener
    // would throw inside the try block, land in the catch, and resolve to
    // [] with a warning — the same shape as a genuine failure, so the
    // assertion must pin down the real rows and a silent warn, not just
    // "resolved".
    const warn = spyOn(console, 'warn');
    ragLevel('standard');
    const rows = [createTransaction()];
    transactionService.getTransactionsOnce.and.resolveTo(rows);

    await expectAsync(service.recent()).toBeResolvedTo(rows);
    expect(warn).not.toHaveBeenCalled();
  });
});
