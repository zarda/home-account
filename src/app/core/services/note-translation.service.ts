import { Injectable, computed, effect, inject } from '@angular/core';

import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { NoteTranslation } from './llm-provider.interface';
import { TranslationService } from './translation.service';
import { parseAIError } from '../utils/ai-error.utils';

/**
 * A note read back in the app's own language, on demand.
 *
 * Not to be confused with TranslationService, which is the i18n resolver: this
 * one sends one user-written note to a model and shows what comes back. The
 * answer is a view of the note, never a second copy of it — nothing here
 * writes to the transaction, and the cache below is memory only.
 *
 * The cache is what keeps the lens cheap enough to be worth opening twice: a
 * note re-read after collapsing it, or the same receipt reopened from the
 * list, costs one model call for the session rather than one per look.
 */
@Injectable({ providedIn: 'root' })
export class NoteTranslationService {
  private cloudLLM = inject(CloudLLMProviderService);
  private translation = inject(TranslationService);
  private analytics = inject(AnalyticsService);
  private auth = inject(AuthService);

  private cache = new Map<string, NoteTranslation>();

  /**
   * Seeded from the current user rather than from null, so the effect's first
   * pass — which runs after the service is already answering calls — reads as
   * "same account" instead of throwing away a translation just paid for.
   */
  private cachedFor = this.auth.userId();

  /** Whether any cloud provider could answer. The button is shown either way. */
  readonly available = computed(() => this.cloudLLM.hasAnyCloudProvider());

  constructor() {
    // Notes are the most personal text in the app, so this cache is emptied on
    // any account change and not only on sign-out: a shared device must never
    // show one account's note under another's session.
    effect(() => {
      const userId = this.auth.userId();
      if (userId !== this.cachedFor) {
        this.cachedFor = userId;
        this.cache.clear();
      }
    });
  }

  /**
   * Translate a note into the UI language, from cache when the same question
   * has already been answered this session.
   *
   * Failures are left to propagate and are never cached — a rate limit or a
   * dropped connection says nothing about the note, and the retry the screen
   * offers has to be able to reach a provider.
   */
  async translate(note: string): Promise<NoteTranslation> {
    if (!note.trim()) {
      // A model handed nothing to translate answers with prose rather than the
      // JSON the prompt asked for, which parseAIError classes as a cut-short
      // answer: a spent call, reported as a failure the note never caused.
      return { text: '', sourceLanguage: '' };
    }

    const key = this.cacheKey(note);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    // After the cache check, before the call: the event exists to weigh what
    // the cloud costs, and a hit costs nothing.
    this.analytics.trackAiAssistUsed({ feature: 'translation' });

    const translated = await this.cloudLLM.translateText(note);
    this.cache.set(key, translated);
    return translated;
  }

  /**
   * The message key for a failed translation.
   *
   * Pure, so the component can call it from a catch block without holding an
   * error class of its own. Only the failures the reader can act on get their
   * own wording — a bad key, a rate limit, no connection, an answer that came
   * back cut short; everything else is one honest sentence rather than a
   * classification nobody can use.
   */
  failureKey(error: unknown): string {
    switch (parseAIError(error).type) {
      case 'auth':
        return 'noteTranslation.failedKey';
      case 'rate_limit':
        return 'noteTranslation.failedRateLimited';
      case 'network':
        return 'noteTranslation.failedOffline';
      case 'incomplete':
        return 'noteTranslation.failedIncomplete';
      default:
        return 'noteTranslation.failed';
    }
  }

  /**
   * Note, UI language and answering provider — the three things any of which
   * changes the answer. The provider is the one that would actually serve the
   * request, not the preference: the façade falls back when the preferred
   * provider has no key, so keying on the preference would serve Gemini's
   * answer under a switch to OpenAI that never happened.
   *
   * NUL-separated: a note may contain anything a keyboard can type, and any
   * printable separator is one a note could end with.
   */
  private cacheKey(note: string): string {
    const provider = this.cloudLLM.resolveProvider('translation') ?? 'none';
    return `${this.translation.currentLocale()}\u0000${provider}\u0000${note}`;
  }
}
