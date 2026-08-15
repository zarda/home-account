import {
  TEXT_MODELS,
  VISION_MODELS,
  OPENAI_MODELS,
  CLAUDE_MODELS,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_CLAUDE_MODEL,
  AIModelOption,
  acceptsSampling,
} from './ai-models';
import { modelIdReplacements } from './ai-model-migrations';

/**
 * The catalog is four hand-maintained lists of ids that only a provider's
 * servers can validate, so every mistake in it is invisible until a request
 * fails: a default absent from its own list leaves the settings dropdown
 * blank, a default naming a model the vendor retired fails every call, and a
 * replacement pointing at an id nobody offers strands the user somewhere they
 * cannot see or change.
 *
 * None of that is reachable from a service spec — those pass model ids in as
 * fixtures — so it is asserted here, against the lists themselves.
 */
describe('AI model catalog', () => {
  const lists: { name: string; models: AIModelOption[]; fallback: string }[] = [
    { name: 'TEXT_MODELS', models: TEXT_MODELS, fallback: DEFAULT_TEXT_MODEL },
    { name: 'VISION_MODELS', models: VISION_MODELS, fallback: DEFAULT_VISION_MODEL },
    { name: 'OPENAI_MODELS', models: OPENAI_MODELS, fallback: DEFAULT_OPENAI_MODEL },
    { name: 'CLAUDE_MODELS', models: CLAUDE_MODELS, fallback: DEFAULT_CLAUDE_MODEL },
  ];

  const everyCatalogId = lists.flatMap(list => list.models.map(model => model.id));

  for (const { name, models, fallback } of lists) {
    describe(name, () => {
      it('offers the model it falls back to', () => {
        // mat-select renders nothing at all for a value absent from its
        // options, so a default outside its own list reads as "no model".
        expect(models.map(model => model.id)).toContain(fallback);
      });

      it('names each model once', () => {
        const ids = models.map(model => model.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('recommends exactly one model', () => {
        // Two recommendations is a stale entry someone forgot to demote;
        // none leaves a first-time user picking blind.
        const recommended = models.filter(model => model.name.includes('(Recommended)'));
        expect(recommended.length).toBe(1);
      });
    });
  }

  describe('against the replacement map', () => {
    it('never defaults to a model the migration moves away from', () => {
      // A default that is also a replacement key would be handed out to every
      // new install and rewritten on the next load — a loop no error reports.
      const replacements = modelIdReplacements();
      for (const { fallback } of lists) {
        expect(replacements[fallback]).toBeUndefined();
      }
    });

    it('only replaces a model with one the catalog offers', () => {
      // The migration is silent by design, so it must not be able to land a
      // preference on an id the dropdown cannot show.
      for (const replacement of Object.values(modelIdReplacements())) {
        expect(everyCatalogId).toContain(replacement);
      }
    });
  });

  describe('acceptsSampling', () => {
    it('answers false for an id the catalog does not carry', () => {
      // The safe direction: a brand-new model, or one a stored preference kept
      // alive past a catalog refresh, omits the parameter rather than risking a
      // 400 on every request.
      expect(acceptsSampling('claude-opus-9')).toBeFalse();
      expect(acceptsSampling('')).toBeFalse();
    });

    it('answers true for every Gemini and Gemma model', () => {
      for (const { id } of [...TEXT_MODELS, ...VISION_MODELS]) {
        expect(acceptsSampling(id)).withContext(id).toBeTrue();
      }
    });

    it('answers false for every OpenAI model while the catalog is GPT-5', () => {
      // The Responses API rejects an explicit temperature for that family, so
      // openai.service.ts sends none — and check-prompts.mjs holds it to a
      // named exemption for exactly this reason.
      for (const { id } of OPENAI_MODELS) {
        expect(acceptsSampling(id)).withContext(id).toBeFalse();
      }
    });

    it('splits the Claude catalog at Opus 4.6', () => {
      // Anthropic rejects any value but 1.0 on models released after it, which
      // is why this is per model rather than per provider.
      expect(acceptsSampling('claude-haiku-4-5')).toBeTrue();
      expect(acceptsSampling('claude-sonnet-5')).toBeFalse();
      expect(acceptsSampling('claude-opus-4-8')).toBeFalse();
    });

    it('leaves the Claude default on the rejecting side, which the transport must handle', () => {
      // Stated rather than assumed: if this ever flips, the gate in
      // ClaudeService.samplingParams stops being exercised by default.
      expect(acceptsSampling(DEFAULT_CLAUDE_MODEL)).toBeFalse();
    });
  });

  it('never defaults to a Gemma model', () => {
    // gemini.service.ts branches its response filtering on
    // `includes('gemma')`, and gemini.service.spec.ts leans on the text
    // default being the other side of that branch. A Gemma default would
    // point those specs at the wrong filter while they still passed.
    for (const { fallback } of lists) {
      expect(fallback).not.toContain('gemma');
    }
  });
});
