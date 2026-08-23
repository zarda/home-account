import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ReceiptAttemptService,
  buildReceiptImportPayload,
  classifyReceiptFailure,
  provenanceOf,
} from './receipt-attempt.service';
import { AnalyticsService } from './analytics.service';
import { ImportHistoryService } from './import-history.service';
import { AuthService } from './auth.service';
import { ReceiptAttemptDiagnostics } from './ai-types';
import { AI_NO_PROVIDER, AI_QUEUED_OFFLINE, ReceiptProcessingError } from '../utils/ai-error.utils';

/**
 * The one producer of receipt_import and the one writer of a failed-attempt
 * record. The payload builder is pure and pinned branch by branch; the
 * handle is pinned for the property the camera dialog's old flag gave it —
 * exactly one event per attempt, whichever branch settles it.
 */
describe('ReceiptAttemptService', () => {
  const cloud: ReceiptAttemptDiagnostics = { engine: 'cloud', provider: 'gemini', durationMs: 3200 };

  describe('buildReceiptImportPayload', () => {
    it('fills every dimension with none when nothing ran', () => {
      expect(buildReceiptImportPayload('camera', 'failed', null, 'no_provider')).toEqual({
        outcome: 'failed', path: 'camera', engine: 'none', provider: 'none',
        failure: 'no_provider', duration: 'none',
      });
    });

    it('names a plain engine, and the fallback pair when one fell back', () => {
      expect(buildReceiptImportPayload('wizard', 'ok', cloud, null).engine).toBe('cloud');
      expect(buildReceiptImportPayload('wizard', 'ok', { ...cloud, engine: 'native', provider: null }, null).engine)
        .toBe('native');
      expect(buildReceiptImportPayload('wizard', 'ok', { ...cloud, fellBackFrom: 'native' }, null).engine)
        .toBe('cloud_after_native');
      expect(buildReceiptImportPayload('wizard', 'ok', { engine: 'native', fellBackFrom: 'cloud', provider: 'openai', durationMs: 1 }, null).engine)
        .toBe('native_after_cloud');
    });

    it('reports the provider as none when no cloud request was made', () => {
      expect(buildReceiptImportPayload('form', 'ok', { ...cloud, provider: null }, null).provider).toBe('none');
      expect(buildReceiptImportPayload('form', 'ok', { ...cloud, provider: 'claude' }, null).provider).toBe('claude');
    });

    it('buckets the duration at 5, 15 and 60 seconds', () => {
      const at = (durationMs: number) =>
        buildReceiptImportPayload('camera', 'ok', { ...cloud, durationMs }, null).duration;
      expect(at(0)).toBe('under_5s');
      expect(at(4999)).toBe('under_5s');
      expect(at(5000)).toBe('5s_to_15s');
      expect(at(14999)).toBe('5s_to_15s');
      expect(at(15000)).toBe('15s_to_60s');
      expect(at(59999)).toBe('15s_to_60s');
      expect(at(60000)).toBe('over_60s');
    });

    it('sends failure none on success and the class on failure', () => {
      expect(buildReceiptImportPayload('camera', 'ok', cloud, null).failure).toBe('none');
      expect(buildReceiptImportPayload('camera', 'failed', cloud, 'rate_limit').failure).toBe('rate_limit');
      expect(buildReceiptImportPayload('camera', 'queued_offline', null, null)).toEqual({
        outcome: 'queued_offline', path: 'camera', engine: 'none', provider: 'none',
        failure: 'none', duration: 'none',
      });
    });
  });

  describe('classifyReceiptFailure', () => {
    it('takes a pipeline reason as its own class', () => {
      expect(classifyReceiptFailure('nothing_extracted').failure).toBe('nothing_extracted');
      expect(classifyReceiptFailure('queue_write').failure).toBe('queue_write');
      expect(classifyReceiptFailure('no_provider').diagnostics).toBeNull();
    });

    it('reads a ReceiptProcessingError by its diagnostics', () => {
      const error = new ReceiptProcessingError(
        { ...cloud, errorType: 'timeout', retryable: true },
        new Error('Request was aborted')
      );
      const classified = classifyReceiptFailure(error);
      expect(classified.failure).toBe('timeout');
      expect(classified.diagnostics).toBe(error.diagnostics);
    });

    it('classifies a bare error with parseAIError', () => {
      expect(classifyReceiptFailure(new Error('429 too many requests')).failure).toBe('rate_limit');
      expect(classifyReceiptFailure(new Error('something odd')).failure).toBe('unknown');
    });

    it('does not take a prototype property as a pipeline reason', () => {
      // 'constructor', 'toString' and friends are `in` any object literal —
      // a `value in REASON_MESSAGES` test would have taken this string as
      // reason 'constructor' rather than falling through to parseAIError.
      expect(classifyReceiptFailure('constructor').failure).toBe('unknown');
      expect(classifyReceiptFailure('toString').failure).toBe('unknown');
    });

    it('files the no-provider sentinel under no_provider, not auth', () => {
      // parseAIError says 'auth' so the wizard can show the key hint; for
      // the record the honest class is that nothing was configured.
      expect(classifyReceiptFailure(new Error(AI_NO_PROVIDER)).failure).toBe('no_provider');
    });
  });

  describe('provenanceOf', () => {
    it('spreads only what is known', () => {
      expect(provenanceOf('wizard', null)).toEqual({ door: 'wizard' });
      expect(provenanceOf('camera', cloud)).toEqual({
        door: 'camera', engine: 'cloud', provider: 'gemini', durationMs: 3200,
      });
      expect(provenanceOf('form', { ...cloud, provider: null, fellBackFrom: 'native' }, 'timeout')).toEqual({
        door: 'form', engine: 'cloud', fellBackFrom: 'native', durationMs: 3200, errorType: 'timeout',
      });
    });
  });

  describe('the handle', () => {
    let service: ReceiptAttemptService;
    let analytics: jasmine.SpyObj<AnalyticsService>;
    let history: jasmine.SpyObj<ImportHistoryService>;
    const files = [
      new File(['aaaa'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['bb'], 'second.jpg', { type: 'image/jpeg' }),
    ];

    beforeEach(() => {
      analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['trackReceiptImport']);
      history = jasmine.createSpyObj<ImportHistoryService>('ImportHistoryService', ['saveImportHistory']);
      history.saveImportHistory.and.resolveTo('hist-1');
      TestBed.configureTestingModule({
        providers: [
          ReceiptAttemptService,
          { provide: AnalyticsService, useValue: analytics },
          { provide: ImportHistoryService, useValue: history },
          { provide: AuthService, useValue: { userId: signal<string | null>('user-1') } },
        ],
      });
      service = TestBed.inject(ReceiptAttemptService);
    });

    it('sends exactly one event per handle, whichever branch settles it first', () => {
      const attempt = service.begin('camera', 'receipt_image', files);
      attempt.failed('nothing_extracted');
      attempt.succeeded({ diagnostics: cloud });
      attempt.queued();
      attempt.failed(new Error('boom'));

      expect(analytics.trackReceiptImport).toHaveBeenCalledTimes(1);
      expect(analytics.trackReceiptImport).toHaveBeenCalledWith(
        jasmine.objectContaining({ outcome: 'failed', failure: 'nothing_extracted' })
      );
    });

    it('sends ok with the result diagnostics and writes no record', () => {
      service.begin('wizard', 'receipt_image', files).succeeded({ diagnostics: { ...cloud, fellBackFrom: 'native' } });

      expect(analytics.trackReceiptImport).toHaveBeenCalledWith({
        outcome: 'ok', path: 'wizard', engine: 'cloud_after_native', provider: 'gemini',
        failure: 'none', duration: 'under_5s',
      });
      expect(history.saveImportHistory).not.toHaveBeenCalled();
    });

    it('writes a failed record named after the first file and sized by all of them', async () => {
      const error = new ReceiptProcessingError(
        { ...cloud, errorType: 'timeout', retryable: true }, new Error('Request was aborted')
      );
      service.begin('camera', 'receipt_image', files).failed(error);
      await Promise.resolve();

      expect(history.saveImportHistory).toHaveBeenCalledWith(jasmine.objectContaining({
        userId: 'user-1',
        source: 'image', fileType: 'receipt_image', fileName: 'first.jpg', fileSize: 6,
        status: 'failed', errorCount: 1, successCount: 0, transactionCount: 0,
        door: 'camera', engine: 'cloud', provider: 'gemini', durationMs: 3200, errorType: 'timeout',
        errors: [{ message: 'AI processing timed out. Try with a clearer image or fewer files.' }],
      }));
      expect('fellBackFrom' in history.saveImportHistory.calls.mostRecent().args[0]).toBeFalse();
    });

    it('records a reason with no engine slots at all', async () => {
      service.begin('camera', 'receipt_image', files).failed('no_provider');
      await Promise.resolve();

      const written = history.saveImportHistory.calls.mostRecent().args[0];
      expect(written.errorType).toBe('no_provider');
      expect('engine' in written).toBeFalse();
      expect('provider' in written).toBeFalse();
      expect('durationMs' in written).toBeFalse();
    });

    it('sends queued_offline and writes nothing', () => {
      service.begin('camera', 'receipt_image', files).queued();

      expect(analytics.trackReceiptImport).toHaveBeenCalledWith(
        jasmine.objectContaining({ outcome: 'queued_offline', engine: 'none' })
      );
      expect(history.saveImportHistory).not.toHaveBeenCalled();
    });

    it('takes the offline sentinel as queued, not failed, when it reaches failed()', async () => {
      const attempt = service.begin('camera', 'receipt_image', files);
      attempt.failed(new Error(AI_QUEUED_OFFLINE));
      await Promise.resolve();

      expect(analytics.trackReceiptImport).toHaveBeenCalledWith(
        jasmine.objectContaining({ outcome: 'queued_offline', engine: 'none' })
      );
      expect(history.saveImportHistory).not.toHaveBeenCalled();

      // Still settles the handle — a later terminal is a no-op.
      attempt.succeeded({ diagnostics: cloud });
      expect(analytics.trackReceiptImport).toHaveBeenCalledTimes(1);
    });

    it('writes nothing and sends nothing for the offline sentinel on the queue door', async () => {
      service.begin('queue', 'receipt_image', files).failed(new Error(AI_QUEUED_OFFLINE));
      await Promise.resolve();

      expect(analytics.trackReceiptImport).not.toHaveBeenCalled();
      expect(history.saveImportHistory).not.toHaveBeenCalled();
    });

    it('records but never sends for the queue door', async () => {
      const attempt = service.begin('queue', 'receipt_image', files);
      attempt.failed(new Error('503 service unavailable'));
      await Promise.resolve();

      expect(analytics.trackReceiptImport).not.toHaveBeenCalled();
      expect(history.saveImportHistory).toHaveBeenCalledWith(
        jasmine.objectContaining({ door: 'queue', errorType: 'server' })
      );

      service.begin('queue', 'receipt_image', files).succeeded({ diagnostics: cloud });
      expect(analytics.trackReceiptImport).not.toHaveBeenCalled();
    });

    it('does not let a throwing terminal escape, and still counts as settled', () => {
      analytics.trackReceiptImport.and.throwError('boom');
      const attempt = service.begin('camera', 'receipt_image', files);

      expect(() => attempt.succeeded({ diagnostics: cloud })).not.toThrow();
      expect(analytics.trackReceiptImport).toHaveBeenCalledTimes(1);

      // The guard was set before the throw, so a later terminal is a no-op.
      attempt.failed(new Error('x'));
      expect(history.saveImportHistory).not.toHaveBeenCalled();
    });

    it('never throws when the record cannot be written', async () => {
      history.saveImportHistory.and.rejectWith(new Error('permission-denied'));
      expect(() => service.begin('form', 'receipt_image', files).failed(new Error('x'))).not.toThrow();
      await Promise.resolve();
      expect(analytics.trackReceiptImport).toHaveBeenCalledTimes(1);
    });

    it('writes no record when nobody is signed in', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ReceiptAttemptService,
          { provide: AnalyticsService, useValue: analytics },
          { provide: ImportHistoryService, useValue: history },
          { provide: AuthService, useValue: { userId: signal<string | null>(null) } },
        ],
      });
      TestBed.inject(ReceiptAttemptService).begin('form', 'receipt_image', files).failed(new Error('x'));
      await Promise.resolve();
      expect(history.saveImportHistory).not.toHaveBeenCalled();
    });
  });
});
