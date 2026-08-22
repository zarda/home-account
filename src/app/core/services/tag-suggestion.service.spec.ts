import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';

import { TagSuggestionService } from './tag-suggestion.service';
import { TagMemoryService } from './tag-memory.service';
import { CloudLLMProviderService } from './cloud-llm-provider.service';
import { RagContextService } from './rag-context.service';
import { AuthService } from './auth.service';
import { TagMemoryEntry, Transaction } from '../../models';
import { createTransaction } from './testing';

/**
 * The ladder tags climb: the user's own decisions first, the model only where
 * they are silent, and never a tag this account has not used.
 */
describe('TagSuggestionService', () => {
  let service: TagSuggestionService;
  let tagMemory: jasmine.SpyObj<TagMemoryService>;
  let cloudLLMProvider: jasmine.SpyObj<CloudLLMProviderService>;
  let ragContext: jasmine.SpyObj<RagContextService>;
  let currentUser: jasmine.Spy;
  let remembered: WritableSignal<TagMemoryEntry[]>;

  /** History that gives the account a vocabulary to draw from. */
  const tagged = (tags: string[]): Transaction[] => [
    createTransaction({ description: 'OLD SHOP', tags }),
  ];

  const ragLevel = (ragInsightsLevel: 'off' | 'standard') =>
    currentUser.and.returnValue({
      preferences: { baseCurrency: 'JPY', ragInsightsLevel },
    } as never);

  beforeEach(() => {
    remembered = signal<TagMemoryEntry[]>([]);
    tagMemory = jasmine.createSpyObj<TagMemoryService>(
      'TagMemoryService',
      ['ensureLoaded', 'lookup'],
      { remembered }
    );
    tagMemory.ensureLoaded.and.resolveTo(undefined);
    tagMemory.lookup.and.returnValue(null);

    cloudLLMProvider = jasmine.createSpyObj<CloudLLMProviderService>('CloudLLMProviderService', [
      'hasAnyCloudProvider',
      'suggestTags',
    ]);
    cloudLLMProvider.hasAnyCloudProvider.and.returnValue(true);
    cloudLLMProvider.suggestTags.and.resolveTo([]);

    ragContext = jasmine.createSpyObj<RagContextService>('RagContextService', ['buildTagGrounding']);
    ragContext.buildTagGrounding.and.returnValue('');

    currentUser = jasmine.createSpy('currentUser').and.returnValue(null);
    ragLevel('standard');

    TestBed.configureTestingModule({
      providers: [
        TagSuggestionService,
        { provide: TagMemoryService, useValue: tagMemory },
        { provide: CloudLLMProviderService, useValue: cloudLLMProvider },
        { provide: RagContextService, useValue: ragContext },
        { provide: AuthService, useValue: { currentUser } },
      ],
    });

    service = TestBed.inject(TagSuggestionService);
  });

  describe('vocabularyFrom', () => {
    it('is the distinct tags of the history and the memory together', () => {
      remembered.set([
        { merchantKey: 'starbucks', tags: ['Coffee'], suppressed: [], sampleDescription: 'STARBUCKS', count: 1 },
      ]);

      expect(service.vocabularyFrom(tagged(['work', 'coffee']))).toEqual(['coffee', 'work']);
    });

    it('is empty for an account that has never tagged anything', () => {
      expect(service.vocabularyFrom([])).toEqual([]);
    });
  });

  describe('suggest', () => {
    it('answers a known merchant from memory without calling the model', async () => {
      tagMemory.lookup.and.returnValue({ tags: ['coffee'], suppressed: [] });

      const out = await service.suggest([{ description: 'STARBUCKS' }], tagged(['coffee']));

      expect(out).toEqual([['coffee']]);
      expect(cloudLLMProvider.suggestTags).not.toHaveBeenCalled();
    });

    it('never mutates the memory\'s own arrays', async () => {
      // lookup hands back the stored arrays by reference.
      const stored = { tags: ['coffee'], suppressed: [] };
      tagMemory.lookup.and.returnValue(stored);

      const out = await service.suggest([{ description: 'STARBUCKS' }], tagged(['coffee']));
      out[0].push('mutated');

      expect(stored.tags).toEqual(['coffee']);
    });

    it('answers a memory entry stored before the one spelling rule', async () => {
      // A hand-edited or legacy tagMemory doc holds 'Coffee'; the vocabulary
      // check is over normalized tags, so an unnormalized entry would vanish.
      tagMemory.lookup.and.returnValue({ tags: ['Coffee'], suppressed: [] });

      await expectAsync(
        service.suggest([{ description: 'STARBUCKS' }], tagged(['coffee']))
      ).toBeResolvedTo([['coffee']]);
    });

    it('honours a refusal stored before the one spelling rule', async () => {
      tagMemory.lookup.and.returnValue({ tags: [], suppressed: ['Work'] });
      cloudLLMProvider.suggestTags.and.resolveTo([['coffee', 'work']]);

      await expectAsync(
        service.suggest([{ description: 'STARBUCKS' }], tagged(['coffee', 'work']))
      ).toBeResolvedTo([['coffee']]);
    });

    it('makes no request with RAG off, and still answers from memory', async () => {
      // The memory is the user's own decision, read locally: the gate is
      // about what leaves the device, not about what they already told us.
      ragLevel('off');
      tagMemory.lookup.and.callFake((d: string) =>
        d === 'STARBUCKS' ? { tags: ['coffee'], suppressed: [] } : null
      );

      const out = await service.suggest(
        [{ description: 'STARBUCKS' }, { description: 'NEW PLACE' }],
        tagged(['coffee'])
      );

      expect(out).toEqual([['coffee'], []]);
      expect(cloudLLMProvider.suggestTags).not.toHaveBeenCalled();
    });

    it('makes no request for an account with no vocabulary to choose from', async () => {
      const out = await service.suggest([{ description: 'NEW PLACE' }], []);

      expect(out).toEqual([[]]);
      expect(cloudLLMProvider.suggestTags).not.toHaveBeenCalled();
    });

    it('makes no request when no cloud provider is configured', async () => {
      cloudLLMProvider.hasAnyCloudProvider.and.returnValue(false);

      const out = await service.suggest([{ description: 'NEW PLACE' }], tagged(['coffee']));

      expect(out).toEqual([[]]);
      expect(cloudLLMProvider.suggestTags).not.toHaveBeenCalled();
    });

    it('asks the model only about the rows memory could not answer, and maps them back', async () => {
      tagMemory.lookup.and.callFake((d: string) =>
        d === 'STARBUCKS' ? { tags: ['coffee'], suppressed: [] } : null
      );
      cloudLLMProvider.suggestTags.and.resolveTo([['work']]);

      const out = await service.suggest(
        [{ description: 'STARBUCKS' }, { description: 'NEW PLACE', merchant: 'New Place' }],
        tagged(['coffee', 'work'])
      );

      const [asked, vocabulary] = cloudLLMProvider.suggestTags.calls.mostRecent().args;
      expect(asked.length).toBe(1);
      expect(asked[0].description).toBe('NEW PLACE');
      expect(asked[0].merchant).toBe('New Place');
      expect(vocabulary).toEqual(['coffee', 'work']);
      expect(out).toEqual([['coffee'], ['work']]);
    });

    it('drops a model answer outside the vocabulary itself', async () => {
      // The adapter validates too, but this is the seam the app owns — and
      // the only one exercised when the adapter is stubbed.
      cloudLLMProvider.suggestTags.and.resolveTo([['invented', 'coffee']]);

      const out = await service.suggest([{ description: 'NEW PLACE' }], tagged(['coffee']));

      expect(out).toEqual([['coffee']]);
    });

    it('never re-offers a tag this merchant refused', async () => {
      // A removed suggestion is a decision; offering it again argues with it.
      tagMemory.lookup.and.returnValue({ tags: [], suppressed: ['work'] });
      cloudLLMProvider.suggestTags.and.resolveTo([['coffee', 'work']]);

      const out = await service.suggest([{ description: 'STARBUCKS' }], tagged(['coffee', 'work']));

      expect(out).toEqual([['coffee']]);
    });

    it('grounds the request in how this user tags, when there is anything to say', async () => {
      ragContext.buildTagGrounding.and.returnValue('How this user usually tags these merchants:\n- OLD SHOP → coffee');

      await service.suggest([{ description: 'NEW PLACE' }], tagged(['coffee']));

      expect(cloudLLMProvider.suggestTags.calls.mostRecent().args[2]).toContain('OLD SHOP → coffee');
    });

    it('sends no grounding when there is nothing to ground in', async () => {
      await service.suggest([{ description: 'NEW PLACE' }], tagged(['coffee']));

      expect(cloudLLMProvider.suggestTags.calls.mostRecent().args[2]).toBeUndefined();
    });

    it('offers nothing rather than throwing when the provider fails', async () => {
      const warn = spyOn(console, 'warn');
      cloudLLMProvider.suggestTags.and.rejectWith(new Error('rate limited'));

      await expectAsync(
        service.suggest([{ description: 'NEW PLACE' }], tagged(['coffee']))
      ).toBeResolvedTo([[]]);
      expect(warn).toHaveBeenCalled();
    });

    it('asks nothing at all for an empty batch', async () => {
      await expectAsync(service.suggest([], tagged(['coffee']))).toBeResolvedTo([]);
      expect(tagMemory.ensureLoaded).not.toHaveBeenCalled();
    });
  });
});
