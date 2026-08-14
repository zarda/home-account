/**
 * The shape a prompt hands back, and the named input fragments prompts compose
 * to declare what they need.
 *
 * Prompts take pre-rendered strings and nothing else — never a `Category[]`, a
 * `Transaction[]`, or an injected service. Callers run the formatting helpers
 * they already own (`buildCategoryPromptCatalog`, `CurrencyService.formatAmount`,
 * `RagContextService`) and pass the result in. That keeps this whole directory
 * free of Angular DI, lets the registry spec run without TestBed, and means no
 * raw user record ever reaches the prompt layer.
 */

/** How the model is expected to answer, which decides the provider adapter's job. */
export type PromptResponseKind = 'json' | 'markdown' | 'plainText';

/**
 * A rendered prompt, ready for a provider adapter to translate into that SDK's
 * request shape.
 *
 * `system` is separate from `user` because Claude takes a top-level `system`
 * parameter while Gemini and OpenAI have no equivalent and must fold it into the
 * user turn. Keeping them apart lets each adapter do the right thing instead of
 * every prompt author guessing.
 *
 * `temperature` and `maxOutputTokens` live here rather than at the call site
 * because they are properties of the task, not of the provider. They used to be
 * written per call site per provider, which is how Gemini ended up categorizing
 * at `temperature: 0.05` while OpenAI and Claude passed nothing at all.
 *
 * `maxOutputTokens` reaches every transport. `temperature` reaches the models
 * that accept one: Gemini always, Claude only before Opus 4.6, OpenAI never
 * while the catalog is GPT-5. That is a limit of the transports, not a gap in
 * the registry — the declared value stays required, and `acceptsSampling` in
 * `config/ai-models.ts` is where a model's answer is recorded. ADR 0043.
 */
export interface RenderedPrompt {
  system?: string;
  user: string;
  expects: PromptResponseKind;
  maxOutputTokens: number;
  temperature: number;
  /** Gemini-only nucleus sampling; other adapters ignore it. */
  topP?: number;
}

/**
 * The locale sentence appended to any prompt whose answer is shown to the user.
 * Callers pass it in already rendered because it is derived from the active
 * translation, which is a service concern.
 */
export interface LanguageInput {
  languageInstruction: string;
}

/** Output of `buildCategoryPromptCatalog` — `id: Name` and `id: Parent / Child` lines. */
export interface CategoryCatalogInput {
  categoryCatalog: string;
}

/**
 * Optional per-user grounding from `RagContextService`. Absent or empty means
 * the user has RAG off, and the prompt must render exactly as it would have
 * before the grounding feature existed.
 */
export interface GroundingInput {
  grounding?: string;
}

export interface BaseCurrencyInput {
  baseCurrency: string;
}

/** Trailing block appended only when a value is present, with no stray blank lines. */
export function optionalSection(body: string | undefined): string {
  const trimmed = body?.trim();
  return trimmed ? `\n${trimmed}\n` : '';
}

/**
 * The sentence that pins the answer's language to the app's active locale.
 *
 * Each provider service used to carry its own byte-identical copy of this, which
 * meant nothing stopped a prompt from being wired up in one service and not the
 * others — and that is exactly what happened to the pattern narrative.
 */
export function languageInstruction(locale: string): string {
  const byLocale: Record<string, string> = {
    en: 'Respond in English.',
    tc: 'Respond in Traditional Chinese (繁體中文).',
    ja: 'Respond in Japanese (日本語).',
  };
  return byLocale[locale] ?? byLocale['en'];
}
