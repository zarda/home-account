import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ReceiptTranslationService } from './receipt-translation.service';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { NoteTranslationService } from './note-translation.service';
import { ReceiptImageService, RECEIPT_IMAGE_DOWNLOAD_FAILED } from './receipt-image.service';
import { SupportedLocale, TranslationService } from './translation.service';
import { NoteTranslation } from './llm-provider.interface';
import { LLMProvider } from '../../models';
import { createTransaction } from './testing';

describe('ReceiptTranslationService', () => {
  let service: ReceiptTranslationService;
  let translateReceiptImage: jasmine.Spy;
  let receiptImage: jasmine.SpyObj<ReceiptImageService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let noteTranslation: jasmine.SpyObj<NoteTranslationService>;
  let hasVisionProvider: ReturnType<typeof signal<boolean>>;
  let provider: ReturnType<typeof signal<LLMProvider | null>>;
  let locale: ReturnType<typeof signal<SupportedLocale>>;
  let userId: ReturnType<typeof signal<string | null>>;

  const japanese: NoteTranslation = { text: 'Rice ball 150', sourceLanguage: 'Japanese' };
  const transaction = createTransaction({ id: 'txn-1' });

  beforeEach(() => {
    hasVisionProvider = signal(true);
    provider = signal<LLMProvider | null>('gemini');
    locale = signal<SupportedLocale>('en');
    userId = signal<string | null>('user-1');

    // The two availability members are read through signals rather than
    // returned from spies: `available` is a computed over hasVisionProvider,
    // and a double answering from a captured boolean would never invalidate it.
    translateReceiptImage = jasmine.createSpy('translateReceiptImage').and.resolveTo(japanese);
    const cloudLLM = {
      translateReceiptImage,
      hasVisionProvider,
      resolveVisionProvider: (feature: string) => (feature === 'translation' ? provider() : null),
    };

    receiptImage = jasmine.createSpyObj<ReceiptImageService>('ReceiptImageService', [
      'loadAsDataUrl',
    ]);
    receiptImage.loadAsDataUrl.and.resolveTo('data:image/jpeg;base64,aW1n');

    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['trackAiAssistUsed']);
    noteTranslation = jasmine.createSpyObj<NoteTranslationService>('NoteTranslationService', [
      'failureKey',
    ]);
    noteTranslation.failureKey.and.returnValue('noteTranslation.failed');

    TestBed.configureTestingModule({
      providers: [
        { provide: CloudLLMProviderService, useValue: cloudLLM },
        { provide: ReceiptImageService, useValue: receiptImage },
        { provide: TranslationService, useValue: { currentLocale: locale } },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AuthService, useValue: { userId } },
        { provide: NoteTranslationService, useValue: noteTranslation },
      ],
    });

    service = TestBed.inject(ReceiptTranslationService);
  });

  it('loads the image and translates it through the façade', async () => {
    await expectAsync(service.translate(transaction, 0)).toBeResolvedTo(japanese);
    expect(receiptImage.loadAsDataUrl).toHaveBeenCalledOnceWith(transaction, 0);
    expect(translateReceiptImage).toHaveBeenCalledOnceWith('data:image/jpeg;base64,aW1n');
  });

  it('follows the façade for whether the lens can run at all', () => {
    expect(service.available()).toBeTrue();
    hasVisionProvider.set(false);
    expect(service.available()).toBeFalse();
  });

  describe('the cache', () => {
    it('answers a repeat of the same slot without calling the provider again', async () => {
      await service.translate(transaction, 0);
      await expectAsync(service.translate(transaction, 0)).toBeResolvedTo(japanese);
      expect(receiptImage.loadAsDataUrl).toHaveBeenCalledTimes(1);
      expect(translateReceiptImage).toHaveBeenCalledTimes(1);
    });

    it('misses on a different slot, since it is a different photo', async () => {
      await service.translate(transaction, 0);
      await service.translate(transaction, 1);
      expect(translateReceiptImage).toHaveBeenCalledTimes(2);
    });

    it('misses when the UI language moved, since the answer is in that language', async () => {
      await service.translate(transaction, 0);
      locale.set('ja');
      await service.translate(transaction, 0);
      expect(translateReceiptImage).toHaveBeenCalledTimes(2);
    });

    it('misses when a different provider would answer', async () => {
      await service.translate(transaction, 0);
      provider.set('claude');
      await service.translate(transaction, 0);
      expect(translateReceiptImage).toHaveBeenCalledTimes(2);
    });

    it('never stores a failure, so the next attempt is a real retry', async () => {
      translateReceiptImage.and.rejectWith(new Error('503 service unavailable'));
      await expectAsync(service.translate(transaction, 0)).toBeRejected();

      translateReceiptImage.and.resolveTo(japanese);
      await expectAsync(service.translate(transaction, 0)).toBeResolvedTo(japanese);
      expect(translateReceiptImage).toHaveBeenCalledTimes(2);
    });

    it('is emptied when a different account signs in', async () => {
      await service.translate(transaction, 0);
      userId.set('user-2');
      TestBed.tick();

      await service.translate(transaction, 0);
      expect(translateReceiptImage).toHaveBeenCalledTimes(2);
    });
  });

  describe('analytics', () => {
    it('reports one use per real provider call', async () => {
      await service.translate(transaction, 0);
      expect(analytics.trackAiAssistUsed).toHaveBeenCalledOnceWith({ feature: 'translation' });
    });

    it('stays silent on a cache hit, which costs nothing', async () => {
      await service.translate(transaction, 0);
      await service.translate(transaction, 0);
      expect(analytics.trackAiAssistUsed).toHaveBeenCalledTimes(1);
    });

    it('stays silent on a failed download, since no provider request was made', async () => {
      receiptImage.loadAsDataUrl.and.rejectWith(new Error(RECEIPT_IMAGE_DOWNLOAD_FAILED));
      await expectAsync(service.translate(transaction, 0)).toBeRejected();
      expect(analytics.trackAiAssistUsed).not.toHaveBeenCalled();
      expect(translateReceiptImage).not.toHaveBeenCalled();
    });
  });

  describe('failureKey', () => {
    it('names the failed download without asking the note lens, since only this lens owns that failure', () => {
      expect(service.failureKey(new Error(RECEIPT_IMAGE_DOWNLOAD_FAILED)))
        .toBe('receiptViewer.failedDownload');
      expect(noteTranslation.failureKey).not.toHaveBeenCalled();
    });

    it('delegates every other failure to the note lens, so the two lenses share one vocabulary', () => {
      const cases: [Error, string][] = [
        [new Error('401 unauthorized'), 'noteTranslation.failedKey'],
        [new Error('429 too many requests'), 'noteTranslation.failedRateLimited'],
        [new Error('Failed to fetch'), 'noteTranslation.failedOffline'],
        [new Error('something nobody classified'), 'noteTranslation.failed'],
      ];

      for (const [error, key] of cases) {
        noteTranslation.failureKey.and.returnValue(key);
        expect(service.failureKey(error)).toBe(key);
        expect(noteTranslation.failureKey).toHaveBeenCalledWith(error);
      }
    });
  });
});
