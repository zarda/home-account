import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ReceiptQuotaService } from './receipt-quota.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { RemoteConfigService } from './remote-config.service';
import { MockAuthService, createMockUser } from './testing';
import { FREE_TIER_RECEIPT_IMAGE_LIMIT } from '../../models';

describe('ReceiptQuotaService', () => {
  let service: ReceiptQuotaService;
  let firestoreMock: jasmine.SpyObj<FirestoreService>;
  let authMock: MockAuthService;
  // Signals stand in for the RemoteConfigService computeds
  let freeLimit: ReturnType<typeof signal<number>>;
  let premiumLimit: ReturnType<typeof signal<number>>;

  beforeEach(() => {
    firestoreMock = jasmine.createSpyObj<FirestoreService>('FirestoreService', ['getCollection']);
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: 0 }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );

    freeLimit = signal(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    premiumLimit = signal(Number.POSITIVE_INFINITY);

    TestBed.configureTestingModule({
      providers: [
        ReceiptQuotaService,
        { provide: FirestoreService, useValue: firestoreMock },
        { provide: AuthService, useClass: MockAuthService },
        {
          provide: RemoteConfigService,
          useValue: { freeTierReceiptImageLimit: freeLimit, premiumReceiptImageLimit: premiumLimit },
        },
      ],
    });

    authMock = TestBed.inject(AuthService) as unknown as MockAuthService;
    authMock.setAuthenticated(true);
    service = TestBed.inject(ReceiptQuotaService);
  });

  it('defaults general users to the free tier with the 200-image limit', () => {
    expect(service.tier()).toBe('free');
    expect(service.imageLimit()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    expect(service.imageLimit()).toBe(200);
    expect(service.hasUnlimitedImages()).toBeFalse();
  });

  it('gives premium subscribers unlimited images', () => {
    authMock.setMockUser(createMockUser('u1', { subscription: { tier: 'premium' } }));
    expect(service.tier()).toBe('premium');
    expect(service.hasUnlimitedImages()).toBeTrue();
    expect(service.isAtLimit()).toBeFalse();
  });

  it('honors a remotely tuned free-tier limit', async () => {
    freeLimit.set(2);
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: 2 }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );

    expect(await service.canAddImages(1)).toBeFalse();
    expect(service.isAtLimit()).toBeTrue();

    // Raising the remote value immediately lifts the limit
    freeLimit.set(5);
    expect(service.isAtLimit()).toBeFalse();
    expect(service.remaining()).toBe(3);
  });

  it('honors a remotely tuned premium limit', async () => {
    authMock.setMockUser(createMockUser('u1', { subscription: { tier: 'premium' } }));
    premiumLimit.set(3);
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );

    expect(service.hasUnlimitedImages()).toBeFalse();
    expect(await service.canAddImages(1)).toBeFalse();
  });

  it('counts stored images via a receiptUrl aggregation query', async () => {
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: 42 }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );

    const count = await service.refreshCount();

    expect(count).toBe(42);
    expect(service.imageCount()).toBe(42);
    expect(service.remaining()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT - 42);
    expect(firestoreMock.getCollection).toHaveBeenCalledWith(
      'users/test-user-123/transactions',
      { where: [{ field: 'receiptUrl', op: '>', value: '' }] }
    );
  });

  it('allows uploads below the limit and blocks them at the limit', async () => {
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: FREE_TIER_RECEIPT_IMAGE_LIMIT - 1 }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );
    expect(await service.canAddImages(1)).toBeTrue();
    expect(service.isAtLimit()).toBeFalse();

    service.noteImagesAdded(1);
    expect(service.imageCount()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    expect(await service.canAddImages(1)).toBeFalse();
    expect(service.isAtLimit()).toBeTrue();
    expect(service.remaining()).toBe(0);
  });

  it('reuses the cached count instead of re-querying', async () => {
    await service.canAddImages(1);
    await service.canAddImages(1);
    expect(firestoreMock.getCollection).toHaveBeenCalledTimes(1);
  });

  it('re-queries after the count is invalidated', async () => {
    await service.canAddImages(1);
    service.invalidateCount();
    expect(service.imageCount()).toBeNull();
    await service.canAddImages(1);
    expect(firestoreMock.getCollection).toHaveBeenCalledTimes(2);
  });

  it('frees a slot when an image is removed', async () => {
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: FREE_TIER_RECEIPT_IMAGE_LIMIT }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );
    await service.refreshCount();
    expect(service.isAtLimit()).toBeTrue();

    service.noteImagesRemoved(1);
    expect(service.isAtLimit()).toBeFalse();
    expect(await service.canAddImages(1)).toBeTrue();
  });

  it('fails open when the count query errors', async () => {
    firestoreMock.getCollection.and.rejectWith(new Error('offline'));
    expect(await service.canAddImages(1)).toBeTrue();
  });

  it('does not go below zero when removals outnumber the cached count', async () => {
    await service.refreshCount();
    service.noteImagesRemoved(1);
    expect(service.imageCount()).toBe(0);
  });

  it('admits a batch only when every image in it fits', async () => {
    freeLimit.set(10);
    firestoreMock.getCollection.and.resolveTo(
      Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, receiptUrl: 'u', receiptCount: 1 })) as never
    );

    expect(await service.canAddImages(3)).toBeTrue();
    expect(await service.canAddImages(4)).toBeFalse();
  });

  describe('counting images rather than transactions', () => {
    it('sums the receiptUrls array where present, tombstones excluded', () => {
      // The array outranks a drifted denormalized count.
      firestoreMock.getCollection.and.resolveTo([
        { id: 'a', receiptUrl: 'u0', receiptUrls: ['u0', '', 'u2'], receiptCount: 3 },
        { id: 'b', receiptUrl: 'u', receiptCount: 1 },
      ] as never);

      return service.refreshCount().then(count => expect(count).toBe(3));
    });

    it('counts every image on a multi-image transaction', () => {
      // The quota limits images, and one transaction can hold several.
      firestoreMock.getCollection.and.resolveTo([
        { id: 'a', receiptUrl: 'u', receiptCount: 3 },
        { id: 'b', receiptUrl: 'u', receiptCount: 1 },
      ] as never);

      return service.refreshCount().then(count => expect(count).toBe(4));
    });

    it('counts a row written before receiptCount existed as one image', () => {
      // Treating it as zero would let the user exceed the limit, and would
      // make replacing its receipt consume a second slot for the same picture.
      firestoreMock.getCollection.and.resolveTo([
        { id: 'legacy', receiptUrl: 'https://example.test/r.jpg' },
      ] as never);

      return service.refreshCount().then(count => expect(count).toBe(1));
    });

    it('filters on receiptUrl, never on a field that can hold an array', () => {
      // Firestore orders arrays after strings, so an inequality against the
      // image field would match every document — including ones with no
      // images — and every user would hit the limit at once.
      firestoreMock.getCollection.and.resolveTo([] as never);

      return service.refreshCount().then(() => {
        const options = firestoreMock.getCollection.calls.mostRecent().args[1] as {
          where: { field: string }[];
        };
        expect(options.where[0].field).toBe('receiptUrl');
      });
    });
  });
});
