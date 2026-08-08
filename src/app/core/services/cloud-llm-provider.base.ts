import { computed, inject, signal } from '@angular/core';
import { CategoryService } from './category.service';
import { CurrencyService } from './currency.service';
import { TranslationService } from './translation.service';
import { languageInstruction } from '../prompts';
import { mapCategoryNameToId } from '../utils/categorization.utils';

/**
 * What every cloud provider service shares once the transport is set aside.
 *
 * Gemini, OpenAI and Claude implemented the same twenty-one operations three
 * times over. Only four things actually differed: the sentence a provider
 * throws when it has no client, the shape of the SDK call, how the answer is
 * dug out of the response, and the console prefix. Everything else — the
 * two-hundred-line spending-summary prologue, the category catalog, the
 * normalization of every extracted row — was copied, and copies drift. They
 * already had: see docs/prompts.md for the six ways the prompts diverged
 * before the registry, all of which were invisible until something compared
 * them.
 *
 * The inject() calls run in field initializers, which is valid because every
 * subclass is providedIn: 'root' and therefore constructed inside an
 * injection context. cloud-llm-provider.smoke.spec.ts proves that against the
 * real root injector rather than a TestBed.
 */
export abstract class CloudLLMProviderBase {
  protected categoryService = inject(CategoryService);
  protected currencyService = inject(CurrencyService);
  protected translationService = inject(TranslationService);

  readonly isProcessing = signal<boolean>(false);
  readonly lastError = signal<string | null>(null);

  /**
   * Set by each provider's own initialization. Kept separate from
   * `isAvailable()`, which answers from the live client handle: the signal is
   * what the façade's computed status watches, so it has to change on a write
   * rather than on a read.
   */
  protected readonly available = signal<boolean>(false);
  readonly isAvailableSignal = computed(() => this.available());

  /** Console prefix and the noun in this provider's error sentences. */
  protected abstract readonly providerLabel: string;

  /**
   * The JSON payload inside a model's answer.
   *
   * The greedy bracket match is enough wherever the model was asked for JSON
   * and answered with it, possibly fenced. Gemini overrides this: its models
   * narrate before the JSON, so it counts brackets instead.
   */
  protected extractJson(text: string): string {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const jsonMatch = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    return cleaned.trim();
  }

  /** The locale sentence appended to any prompt whose answer the user reads. */
  protected getLanguageInstruction(): string {
    return languageInstruction(this.translationService.currentLocale());
  }

  /**
   * Category names of default categories are stored as i18n keys
   * (e.g. categoryNames.groceries) — translate them before they reach a
   * prompt, otherwise the model echoes the raw key into the insights text.
   */
  protected translateCategoryName(name?: string): string {
    return name ? this.translationService.t(name) : 'Other';
  }

  /** Resolve whatever the model called a category onto a catalog id. */
  protected mapCategoryNameToId(categoryName: string): string {
    return mapCategoryNameToId(
      categoryName,
      this.categoryService.categories(),
      name => this.translateCategoryName(name)
    );
  }
}
