import { TestBed } from '@angular/core/testing';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { ImportHistoryService } from './import-history.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { ImportHistory } from '../../models';

describe('ImportHistoryService', () => {
  let service: ImportHistoryService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let mockAuthService: jasmine.SpyObj<AuthService>;

  const baseRecord = (overrides: Partial<ImportHistory> = {}): ImportHistory => ({
    id: 'import1',
    userId: 'user123',
    importedAt: Timestamp.fromDate(new Date(2024, 0, 1)),
    source: 'csv',
    fileType: 'generic_csv',
    fileName: 'statement.csv',
    fileSize: 1024,
    transactionCount: 10,
    successCount: 10,
    skippedCount: 0,
    errorCount: 0,
    totalIncome: 500,
    totalExpenses: 200,
    status: 'completed',
    duplicatesSkipped: 0,
    ...overrides
  });

  const mockHistory: ImportHistory[] = [
    baseRecord({ id: 'import1', successCount: 10, status: 'completed' }),
    baseRecord({ id: 'import2', successCount: 5, status: 'partial', errorCount: 2 }),
    baseRecord({ id: 'import3', successCount: 0, status: 'failed', errorCount: 3 })
  ];

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', [
      'subscribeToCollection',
      'subscribeToDocument',
      'addDocument',
      'updateDocument',
      'deleteDocument',
      'getTimestamp'
    ]);

    mockAuthService = jasmine.createSpyObj('AuthService', [], {
      userId: jasmine.createSpy('userId').and.returnValue('user123')
    });

    mockFirestoreService.subscribeToCollection.and.returnValue(of(mockHistory));
    mockFirestoreService.subscribeToDocument.and.returnValue(of(mockHistory[0]));
    mockFirestoreService.addDocument.and.returnValue(Promise.resolve('new-import-id'));
    mockFirestoreService.updateDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.deleteDocument.and.returnValue(Promise.resolve());
    mockFirestoreService.getTimestamp.and.returnValue(Timestamp.now());

    TestBed.configureTestingModule({
      providers: [
        ImportHistoryService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: mockAuthService }
      ]
    });

    service = TestBed.inject(ImportHistoryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start with empty history signal', () => {
      expect(service.importHistory()).toEqual([]);
    });

    it('should start with isLoading false', () => {
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('getImportHistory', () => {
    it('should return empty array when user not authenticated', (done) => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      service.getImportHistory().subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('should query firestore with correct path and ordering', (done) => {
      service.getImportHistory().subscribe(() => {
        expect(mockFirestoreService.subscribeToCollection).toHaveBeenCalledWith(
          'users/user123/imports',
          { orderBy: [{ field: 'importedAt', direction: 'desc' }] }
        );
        done();
      });
    });

    it('should update the importHistory signal with received data', (done) => {
      service.getImportHistory().subscribe(result => {
        expect(result).toEqual(mockHistory);
        expect(service.importHistory()).toEqual(mockHistory);
        done();
      });
    });
  });

  describe('getRecentImportHistory', () => {
    it('should return empty array when user not authenticated', (done) => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      service.getRecentImportHistory().subscribe(result => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('should default to a limit of 5', (done) => {
      service.getRecentImportHistory().subscribe(() => {
        expect(mockFirestoreService.subscribeToCollection).toHaveBeenCalledWith(
          'users/user123/imports',
          { orderBy: [{ field: 'importedAt', direction: 'desc' }], limit: 5 }
        );
        done();
      });
    });

    it('should respect a custom limit', (done) => {
      service.getRecentImportHistory(12).subscribe(() => {
        const callArgs = mockFirestoreService.subscribeToCollection.calls.mostRecent().args;
        expect((callArgs[1] as { limit: number }).limit).toBe(12);
        done();
      });
    });
  });

  describe('getImportById', () => {
    it('should query firestore document with correct path', (done) => {
      service.getImportById('import1').subscribe(result => {
        expect(mockFirestoreService.subscribeToDocument).toHaveBeenCalledWith(
          'users/user123/imports/import1'
        );
        expect(result).toEqual(mockHistory[0]);
        done();
      });
    });
  });

  describe('saveImportHistory', () => {
    it('should throw when user not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      await expectAsync(
        service.saveImportHistory(baseRecord())
      ).toBeRejectedWithError('User not authenticated');
    });

    it('should add a document with userId and importedAt timestamp', async () => {
      const record = baseRecord();
      delete (record as Partial<ImportHistory>).id;

      const id = await service.saveImportHistory(record as Omit<ImportHistory, 'id'>);

      expect(id).toBe('new-import-id');
      const [path, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      expect(path).toBe('users/user123/imports');
      expect((data as Record<string, unknown>)['userId']).toBe('user123');
      expect((data as Record<string, unknown>)['importedAt']).toBeDefined();
    });

    it('should reset isLoading to false after saving', async () => {
      await service.saveImportHistory(baseRecord() as Omit<ImportHistory, 'id'>);
      expect(service.isLoading()).toBeFalse();
    });

    it('should reset isLoading to false even when save fails', async () => {
      mockFirestoreService.addDocument.and.returnValue(Promise.reject(new Error('boom')));

      await expectAsync(
        service.saveImportHistory(baseRecord() as Omit<ImportHistory, 'id'>)
      ).toBeRejected();
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('updateImportHistory', () => {
    it('should call updateDocument with correct path and updates', async () => {
      await service.updateImportHistory('import1', { status: 'completed' });

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/imports/import1',
        { status: 'completed' }
      );
    });
  });

  describe('deleteImportHistory', () => {
    it('should call deleteDocument with correct path', async () => {
      await service.deleteImportHistory('import1');

      expect(mockFirestoreService.deleteDocument).toHaveBeenCalledWith(
        'users/user123/imports/import1'
      );
    });

    it('should reset isLoading to false after deletion', async () => {
      await service.deleteImportHistory('import1');
      expect(service.isLoading()).toBeFalse();
    });

    it('should reset isLoading to false even when deletion fails', async () => {
      mockFirestoreService.deleteDocument.and.returnValue(Promise.reject(new Error('fail')));

      await expectAsync(service.deleteImportHistory('import1')).toBeRejected();
      expect(service.isLoading()).toBeFalse();
    });
  });

  describe('createPendingImport', () => {
    it('should throw when user not authenticated', async () => {
      (mockAuthService.userId as jasmine.Spy).and.returnValue(null);

      await expectAsync(
        service.createPendingImport('file.csv', 100, 'csv', 'generic_csv')
      ).toBeRejectedWithError('User not authenticated');
    });

    it('should create a pending record with zeroed stats', async () => {
      const id = await service.createPendingImport('file.csv', 2048, 'image', 'receipt_image');

      expect(id).toBe('new-import-id');
      const [, data] = mockFirestoreService.addDocument.calls.mostRecent().args;
      const record = data as Record<string, unknown>;
      expect(record['status']).toBe('pending');
      expect(record['fileName']).toBe('file.csv');
      expect(record['fileSize']).toBe(2048);
      expect(record['source']).toBe('image');
      expect(record['fileType']).toBe('receipt_image');
      expect(record['transactionCount']).toBe(0);
      expect(record['successCount']).toBe(0);
      expect(record['duplicatesSkipped']).toBe(0);
    });
  });

  describe('completeImport', () => {
    const stats = {
      transactionCount: 10,
      successCount: 10,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 100,
      totalExpenses: 50,
      duplicatesSkipped: 1
    };

    it('should mark status completed when there are no errors', async () => {
      await service.completeImport('import1', stats);

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['status']).toBe('completed');
    });

    it('should mark status partial when there are errors and some successes', async () => {
      await service.completeImport('import1', { ...stats, errorCount: 2, successCount: 8 });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['status']).toBe('partial');
    });

    it('should mark status failed when there are errors and no successes', async () => {
      await service.completeImport('import1', { ...stats, errorCount: 5, successCount: 0 });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['status']).toBe('failed');
    });

    it('should pass through stats and any errors', async () => {
      const errors = [{ row: 1, message: 'bad row' }];
      await service.completeImport('import1', { ...stats, errorCount: 1, successCount: 9, errors });

      const [, data] = mockFirestoreService.updateDocument.calls.mostRecent().args;
      expect((data as Record<string, unknown>)['errors']).toEqual(errors);
      expect((data as Record<string, unknown>)['totalIncome']).toBe(100);
    });
  });

  describe('failImport', () => {
    it('should set status failed with provided errors', async () => {
      const errors = [{ message: 'Import crashed' }];
      await service.failImport('import1', errors);

      expect(mockFirestoreService.updateDocument).toHaveBeenCalledWith(
        'users/user123/imports/import1',
        { status: 'failed', errors }
      );
    });
  });

  describe('getImportStats', () => {
    it('should compute totals and success rate from history', (done) => {
      service.getImportStats().subscribe(stats => {
        expect(stats.totalImports).toBe(3);
        expect(stats.totalTransactionsImported).toBe(15); // 10 + 5 + 0
        // 1 of 3 completed → 33.33%
        expect(stats.successRate).toBeCloseTo((1 / 3) * 100, 5);
        done();
      });
    });

    it('should return zero success rate when there is no history', (done) => {
      mockFirestoreService.subscribeToCollection.and.returnValue(of([]));

      service.getImportStats().subscribe(stats => {
        expect(stats.totalImports).toBe(0);
        expect(stats.totalTransactionsImported).toBe(0);
        expect(stats.successRate).toBe(0);
        done();
      });
    });
  });
});
