import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { NoteTranslationService } from './note-translation.service';
import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { SupportedLocale, TranslationService } from './translation.service';
import { NoteTranslation } from './llm-provider.interface';
import { ANALYTICS_EVENTS } from '../config/analytics-events';
import { AI_ANSWER_INCOMPLETE } from '../utils/ai-error.utils';
import { LLMProvider } from '../../models';

describe('NoteTranslationService', () => {
  let service: NoteTranslationService;
  let translateText: jasmine.Spy;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let hasProvider: ReturnType<typeof signal<boolean>>;
  let provider: ReturnType<typeof signal<LLMProvider | null>>;
  let locale: ReturnType<typeof signal<SupportedLocale>>;
  let userId: ReturnType<typeof signal<string | null>>;

  const japanese: NoteTranslation = { text: 'Rice ball 150', sourceLanguage: 'Japanese' };

  beforeEach(() => {
    hasProvider = signal(true);
    provider = signal<LLMProvider | null>('gemini');
    locale = signal<SupportedLocale>('en');
    userId = signal<string | null>('user-1');

    // The two availability members are read through signals rather than
    // returned from spies: `available` is a computed over hasAnyCloudProvider,
    // and a double answering from a captured boolean would never invalidate it.
    translateText = jasmine.createSpy('translateText').and.resolveTo(japanese);
    const cloudLLM = {
      translateText,
      hasAnyCloudProvider: hasProvider,
      resolveProvider: (feature: string) => (feature === 'translation' ? provider() : null),
    };

    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['trackAiAssistUsed']);

    TestBed.configureTestingModule({
      providers: [
        { provide: CloudLLMProviderService, useValue: cloudLLM },
        { provide: TranslationService, useValue: { currentLocale: locale } },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AuthService, useValue: { userId } },
      ],
    });

    service = TestBed.inject(NoteTranslationService);
  });

  it('translates a note through the façade and hands back what it answered', async () => {
    await expectAsync(service.translate('おにぎり 150')).toBeResolvedTo(japanese);
    expect(translateText).toHaveBeenCalledOnceWith('おにぎり 150');
  });

  it('follows the façade for whether the lens can run at all', () => {
    expect(service.available()).toBeTrue();
    hasProvider.set(false);
    expect(service.available()).toBeFalse();
  });

  describe('the cache', () => {
    it('answers a repeat of the same note without calling the provider again', async () => {
      await service.translate('おにぎり 150');
      await expectAsync(service.translate('おにぎり 150')).toBeResolvedTo(japanese);
      expect(translateText).toHaveBeenCalledTimes(1);
    });

    it('misses when the UI language moved, since the answer is in that language', async () => {
      await service.translate('おにぎり 150');
      locale.set('ja');
      await service.translate('おにぎり 150');
      expect(translateText).toHaveBeenCalledTimes(2);
    });

    it('misses when a different provider would answer', async () => {
      await service.translate('おにぎり 150');
      provider.set('claude');
      await service.translate('おにぎり 150');
      expect(translateText).toHaveBeenCalledTimes(2);
    });

    it('keeps notes apart', async () => {
      await service.translate('おにぎり 150');
      await service.translate('お茶 120');
      expect(translateText).toHaveBeenCalledTimes(2);
    });

    it('never stores a failure, so the next attempt is a real retry', async () => {
      translateText.and.rejectWith(new Error('503 service unavailable'));
      await expectAsync(service.translate('おにぎり 150')).toBeRejected();

      translateText.and.resolveTo(japanese);
      await expectAsync(service.translate('おにぎり 150')).toBeResolvedTo(japanese);
      expect(translateText).toHaveBeenCalledTimes(2);
    });

    it('is emptied when a different account signs in', async () => {
      await service.translate('おにぎり 150');
      userId.set('user-2');
      TestBed.tick();

      await service.translate('おにぎり 150');
      expect(translateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('a blank note', () => {
    it('spends no model call and reports no usage', async () => {
      await service.translate('   \n  ');
      expect(translateText).not.toHaveBeenCalled();
      expect(analytics.trackAiAssistUsed).not.toHaveBeenCalled();
    });

    it('answers with nothing rather than throwing', async () => {
      await expectAsync(service.translate('')).toBeResolvedTo({ text: '', sourceLanguage: '' });
    });
  });

  describe('analytics', () => {
    it('reports one use per real provider call', async () => {
      await service.translate('おにぎり 150');
      expect(analytics.trackAiAssistUsed).toHaveBeenCalledOnceWith({ feature: 'translation' });
    });

    it('stays silent on a cache hit, which costs nothing', async () => {
      await service.translate('おにぎり 150');
      await service.translate('おにぎり 150');
      expect(analytics.trackAiAssistUsed).toHaveBeenCalledTimes(1);
    });

    it('carries the value in the taxonomy', () => {
      // The parameter is typed as `string` (derived from the JSON import), so
      // nothing at compile time would catch the event being sent with a value
      // AnalyticsService then drops on the floor at runtime.
      expect(ANALYTICS_EVENTS.ai_assist_used.params.feature).toContain('translation');
    });
  });

  describe('failureKey', () => {
    it('names the invalid key, which is the one failure the user can fix', () => {
      expect(service.failureKey(new Error('401 unauthorized'))).toBe('noteTranslation.failedKey');
    });

    it('names the rate limit, which is worth waiting out', () => {
      expect(service.failureKey(new Error('429 too many requests')))
        .toBe('noteTranslation.failedRateLimited');
    });

    it('names the connection', () => {
      expect(service.failureKey(new Error('Failed to fetch')))
        .toBe('noteTranslation.failedOffline');
    });

    it('names a cut-short answer, including the prose a model returned instead of JSON', () => {
      expect(service.failureKey(new Error(AI_ANSWER_INCOMPLETE)))
        .toBe('noteTranslation.failedIncomplete');
      expect(service.failureKey(new SyntaxError('Unexpected token < in JSON at position 0')))
        .toBe('noteTranslation.failedIncomplete');
    });

    it('falls back to the general failure for everything else', () => {
      for (const error of [
        new Error('402 payment required'),
        new Error('503 service unavailable'),
        new Error('Request timed out'),
        new Error('something nobody classified'),
      ]) {
        expect(service.failureKey(error)).toBe('noteTranslation.failed');
      }
    });
  });
});
