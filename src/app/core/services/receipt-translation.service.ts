import { Injectable, computed, effect, inject } from '@angular/core';

import { AnalyticsService } from './analytics.service';
import { AuthService } from './auth.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { NoteTranslation } from './llm-provider.interface';
import { NoteTranslationService } from './note-translation.service';
import { ReceiptImageService, RECEIPT_IMAGE_DOWNLOAD_FAILED } from './receipt-image.service';
import { TranslationService } from './translation.service';
import { Transaction } from '../../models';

/**
 * A receipt photo read back in the app's own language, on demand.
 *
 * The answer is a view of the image, never a second copy of it — nothing
 * here writes to the transaction, and the cache below is memory only.
 *
 * The cache is what keeps the lens cheap enough to be worth opening twice: a
 * receipt reopened after collapsing it, or the same slot reached again from
 * the list, costs one model call for the session rather than one per look.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptTranslationService {
  private cloudLLM = inject(CloudLLMProviderService);
  private translation = inject(TranslationService);
  private analytics = inject(AnalyticsService);
  private auth = inject(AuthService);
  private receiptImage = inject(ReceiptImageService);
  private noteTranslation = inject(NoteTranslationService);

  private cache = new Map<string, NoteTranslation>();

  /**
   * Seeded from the current user rather than from null, so the effect's first
   * pass — which runs after the service is already answering calls — reads as
   * "same account" instead of throwing away a translation just paid for.
   */
  private cachedFor = this.auth.userId();

  /** Whether a vision-capable provider could answer. The button is shown either way. */
  readonly available = computed(() => this.cloudLLM.hasVisionProvider());

  constructor() {
    // A receipt photo can carry the same personal detail as a note, so this
    // cache is emptied on any account change and not only on sign-out: a
    // shared device must never show one account's image under another's
    // session.
    effect(() => {
      const userId = this.auth.userId();
      if (userId !== this.cachedFor) {
        this.cachedFor = userId;
        this.cache.clear();
      }
    });
  }

  /**
   * Translate one receipt image into the UI language, from cache when the
   * same slot has already been answered this session.
   *
   * Failures are left to propagate and are never cached — a rate limit, a
   * dropped connection or a failed download says nothing about the image,
   * and the retry the screen offers has to be able to reach the same slot
   * again.
   */
  async translate(transaction: Transaction, slot: number): Promise<NoteTranslation> {
    const key = this.cacheKey(transaction, slot);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const dataUrl = await this.receiptImage.loadAsDataUrl(transaction, slot);

    // After the cache check, so a hit costs nothing, and after the download,
    // so a failed download — the CORS trap loadAsDataUrl documents — never
    // reports a provider request that never happened.
    this.analytics.trackAiAssistUsed({ feature: 'translation' });

    const translated = await this.cloudLLM.translateReceiptImage(dataUrl);
    this.cache.set(key, translated);
    return translated;
  }

  /**
   * The message key for a failed translation.
   *
   * A failed download is the one failure this lens can hit that the note
   * lens cannot, so it is the only case answered here; every other failure
   * delegates to NoteTranslationService, which already classifies a model
   * failure by cause — the two lenses share one vocabulary and one switch,
   * not two that could quietly drift apart.
   */
  failureKey(error: unknown): string {
    if (error instanceof Error && error.message === RECEIPT_IMAGE_DOWNLOAD_FAILED) {
      return 'receiptViewer.failedDownload';
    }
    return this.noteTranslation.failureKey(error);
  }

  /**
   * Transaction, slot, UI language and answering provider — the four things
   * any of which changes the answer. Slot matters because a transaction can
   * hold more than one receipt image, each a different photo to translate;
   * the provider is the one that would actually serve the request, not the
   * preference, for the same reason the note service keys on it — the
   * façade falls back when the preferred provider has no vision model, so
   * keying on the preference would serve one provider's answer under a
   * switch that never happened.
   *
   * NUL-separated to match the note service's key rather than inventing a
   * second convention for what is otherwise the same cache.
   */
  private cacheKey(transaction: Transaction, slot: number): string {
    const provider = this.cloudLLM.resolveVisionProvider('translation') ?? 'none';
    return `${this.translation.currentLocale()}\u0000${provider}\u0000${transaction.id}\u0000${slot}`;
  }
}
