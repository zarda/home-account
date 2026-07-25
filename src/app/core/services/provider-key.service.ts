import { Injectable, computed, inject, signal } from '@angular/core';
import { deleteField } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import {
  LLMProvider,
  LegacyProviderApiKeys,
  ProviderSecrets,
  UserPreferences
} from '../../models';

/**
 * Keep only the provider fields: FirestoreService.getDocument also returns the
 * document id and the updatedAt stamp. Exported as a pure seam for the spec.
 */
export function pickProviderSecrets(data: Record<string, unknown> | null): ProviderSecrets {
  const secrets: ProviderSecrets = {};
  if (!data) return secrets;

  for (const provider of ['gemini', 'openai', 'claude'] as const) {
    const value = data[provider];
    if (typeof value === 'string' && value.trim() !== '') {
      secrets[provider] = value;
    }
  }
  return secrets;
}

/**
 * The signed-in user's AI provider keys, held at users/{uid}/secrets/providers.
 *
 * They used to live on UserPreferences, which the app subscribes to wholesale,
 * so every snapshot of the user document carried them. Here they are read once
 * per session by the code that actually needs them.
 */
@Injectable({ providedIn: 'root' })
export class ProviderKeyService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);

  private cache = signal<ProviderSecrets | null>(null);
  private cachedUserId = signal<string | null>(null);
  private failed = signal<boolean>(false);
  private inFlight: Promise<ProviderSecrets> | null = null;

  /** Last loaded keys, or null before the first load / after an account switch. */
  readonly keys = computed<ProviderSecrets | null>(() =>
    this.authService.userId() === this.cachedUserId() ? this.cache() : null
  );

  /** True when the most recent load could reach neither Firestore nor its cache. */
  readonly loadFailed = computed(() => this.failed());

  private secretsPath(userId: string): string {
    return `users/${userId}/secrets/providers`;
  }

  /** Load once per session and return the signed-in user's provider keys. */
  async resolve(): Promise<ProviderSecrets> {
    const userId = this.authService.userId();
    if (!userId) {
      this.clearCache();
      return {};
    }

    const cached = this.keys();
    if (cached) return cached;

    // Dedupe concurrent AI calls racing a cold cache.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.load(userId).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(userId: string): Promise<ProviderSecrets> {
    try {
      const raw = await this.firestoreService.getDocument<Record<string, unknown>>(
        this.secretsPath(userId)
      );
      const stored = await this.migrateFromPreferences(pickProviderSecrets(raw));

      this.cache.set(stored);
      this.cachedUserId.set(userId);
      this.failed.set(false);
      return stored;
    } catch (error) {
      // Offline with a cold persistent cache: getDoc rejects rather than
      // returning nothing. Leave the cache unpopulated so the next call
      // retries once a connection is back.
      console.warn('[ProviderKey] Keys unavailable:', error);
      this.failed.set(true);
      return {};
    }
  }

  /** One provider's key, or undefined when unset. */
  async getKey(provider: LLMProvider): Promise<string | undefined> {
    return (await this.resolve())[provider];
  }

  /** Store or clear one provider's key; writes through to the cache. */
  async setKey(provider: LLMProvider, apiKey: string | undefined): Promise<void> {
    const userId = this.authService.userId();
    if (!userId) throw new Error('User not authenticated');

    const value = apiKey?.trim() || undefined;
    await this.firestoreService.setDocument(
      this.secretsPath(userId),
      // Firestore rejects a literal undefined; deleteField() is how a merge
      // write removes a field.
      { [provider]: value ?? deleteField() },
      true
    );

    const next = { ...(this.keys() ?? {}) };
    if (value) {
      next[provider] = value;
    } else {
      delete next[provider];
    }
    this.cache.set(next);
    this.cachedUserId.set(userId);
    this.failed.set(false);
  }

  /**
   * Move keys an older build left on the preferences map into the secrets
   * document, then clear them from preferences.
   *
   * Driven by state rather than a migration marker: once preferences hold no
   * keys this returns immediately, and an older client that writes a key back
   * onto preferences is cleaned up on the next load instead of being stranded
   * behind a one-shot flag.
   */
  async migrateFromPreferences(stored: ProviderSecrets): Promise<ProviderSecrets> {
    const userId = this.authService.userId();
    const prefs = this.authService.currentUser()?.preferences as
      | (UserPreferences & LegacyProviderApiKeys)
      | undefined;
    if (!userId || !prefs) return stored;

    const legacy: ProviderSecrets = {};
    if (prefs.geminiApiKey?.trim()) legacy.gemini = prefs.geminiApiKey.trim();
    if (prefs.openaiApiKey?.trim()) legacy.openai = prefs.openaiApiKey.trim();
    if (prefs.claudeApiKey?.trim()) legacy.claude = prefs.claudeApiKey.trim();

    if (Object.keys(legacy).length === 0) return stored;

    // Stored wins: the secrets document is the source of truth, so a stale
    // preferences copy on another device cannot overwrite a rotated key.
    const merged: ProviderSecrets = { ...legacy, ...stored };

    // Write the new location and wait for the acknowledgement BEFORE clearing
    // the old one, so there is no window where the key looks lost.
    await this.firestoreService.setDocument(this.secretsPath(userId), merged, true);
    await this.authService.clearStoredProviderApiKeys();

    return merged;
  }

  /** Forget the cached keys (sign-out on a shared device). */
  clearCache(): void {
    this.cache.set(null);
    this.cachedUserId.set(null);
    this.inFlight = null;
    this.failed.set(false);
  }
}
