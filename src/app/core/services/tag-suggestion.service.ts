import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { RagContextService } from './rag-context.service';
import { TagMemoryService } from './tag-memory.service';
import { Transaction, effectiveRagLevel } from '../../models';
import { normalizeTags } from '../utils/tag.utils';
import { TagSuggestionRow } from './llm-provider.interface';

/** Receipt bodies run long; the first lines name the items, which is what a tag is about. */
const MAX_DETAILS_CHARS = 160;

/**
 * Tags for import rows, drawn only from what the account already uses.
 *
 * The same ladder as categorization: memory answers first (the user's own
 * decisions, read locally, so it works with RAG off), the model answers for
 * the rest only when RAG is on and there is a vocabulary to choose from, and
 * every answer is checked against that vocabulary on the way back. An account
 * with no tags gets no chips and no request. Whichever rung answered, what the
 * user refused for a merchant is never offered again.
 */
@Injectable({ providedIn: 'root' })
export class TagSuggestionService {
  private tagMemory = inject(TagMemoryService);
  private cloudLLMProvider = inject(CloudLLMProviderService);
  private ragContext = inject(RagContextService);
  private authService = inject(AuthService);

  /** Distinct tags across the recent history and the memory. */
  vocabularyFrom(history: readonly Transaction[]): string[] {
    const fromMemory = this.tagMemory.remembered().flatMap(e => e.tags);
    const fromHistory = history.flatMap(t => t.tags ?? []);
    return normalizeTags([...fromMemory, ...fromHistory]);
  }

  /**
   * One list of tags per input row, in input order.
   *
   * Never rejects: every failure is caught and answers nothing, so a caller
   * needs no guard.
   */
  async suggest(rows: readonly TagSuggestionRow[], history: readonly Transaction[]): Promise<string[][]> {
    if (rows.length === 0) return [];
    await this.tagMemory.ensureLoaded();
    const remembered = rows.map(row => this.tagMemory.lookup(row.description));
    // Normalized on the way in, because a stored entry predates the one
    // spelling rule and would otherwise miss the vocabulary check below.
    const suggestions: string[][] = remembered.map(entry => normalizeTags(entry?.tags ?? []));

    const unknown = Array.from(rows.keys()).filter(i => suggestions[i].length === 0);
    const vocabulary = this.vocabularyFrom(history);
    const ragOn = effectiveRagLevel(this.authService.currentUser()?.preferences) !== 'off';
    if (ragOn && unknown.length > 0 && vocabulary.length > 0 && this.cloudLLMProvider.hasAnyCloudProvider()) {
      try {
        const asked = await this.cloudLLMProvider.suggestTags(
          unknown.map(i => ({
            description: rows[i].description,
            ...(rows[i].merchant ? { merchant: rows[i].merchant } : {}),
            ...(rows[i].details ? { details: rows[i].details!.slice(0, MAX_DETAILS_CHARS) } : {}),
          })),
          vocabulary,
          this.ragContext.buildTagGrounding({ transactions: [...history] }) || undefined
        );
        asked.forEach((tags, position) => {
          suggestions[unknown[position]] = tags;
        });
      } catch (error) {
        console.warn('[TagSuggestion] Suggestion failed, offering none:', error);
      }
    }

    // Validated here as well as in the adapter: this is the seam the app
    // owns, and the only one an emulator run exercises with the adapter stubbed.
    const known = new Set(vocabulary);
    return suggestions.map((tags, i) => {
      const suppressed = new Set(normalizeTags(remembered[i]?.suppressed ?? []));
      return tags.filter(tag => known.has(tag) && !suppressed.has(tag));
    });
  }
}
