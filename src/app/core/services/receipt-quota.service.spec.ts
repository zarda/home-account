import { TestBed } from '@angular/core/testing';

import { ReceiptQuotaService } from './receipt-quota.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { MockAuthService, createMockUser } from './testing';
import { FREE_TIER_RECEIPT_IMAGE_LIMIT } from '../../models';

describe('ReceiptQuotaService', () => {
  let service: ReceiptQuotaService;
  let firestoreMock: jasmine.SpyObj<FirestoreService>;
  let authMock: MockAuthService;

  beforeEach(() => {
    firestoreMock = jasmine.createSpyObj<FirestoreService>('FirestoreService', ['countDocuments']);
    firestoreMock.countDocuments.and.resolveTo(0);

    TestBed.configureTestingModule({
      providers: [
        ReceiptQuotaService,
        { provide: FirestoreService, useValue: firestoreMock },
        { provide: AuthService, useClass: MockAuthService },
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

  it('counts stored images via a receiptUrl aggregation query', async () => {
    firestoreMock.countDocuments.and.resolveTo(42);

    const count = await service.refreshCount();

    expect(count).toBe(42);
    expect(service.imageCount()).toBe(42);
    expect(service.remaining()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT - 42);
    expect(firestoreMock.countDocuments).toHaveBeenCalledWith(
      'users/test-user-123/transactions',
      { where: [{ field: 'receiptUrl', op: '>', value: '' }] }
    );
  });

  it('allows uploads below the limit and blocks them at the limit', async () => {
    firestoreMock.countDocuments.and.resolveTo(FREE_TIER_RECEIPT_IMAGE_LIMIT - 1);
    expect(await service.canAddImage()).toBeTrue();
    expect(service.isAtLimit()).toBeFalse();

    service.noteImageAdded();
    expect(service.imageCount()).toBe(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    expect(await service.canAddImage()).toBeFalse();
    expect(service.isAtLimit()).toBeTrue();
    expect(service.remaining()).toBe(0);
  });

  it('reuses the cached count instead of re-querying', async () => {
    await service.canAddImage();
    await service.canAddImage();
    expect(firestoreMock.countDocuments).toHaveBeenCalledTimes(1);
  });

  it('re-queries after the count is invalidated', async () => {
    await service.canAddImage();
    service.invalidateCount();
    expect(service.imageCount()).toBeNull();
    await service.canAddImage();
    expect(firestoreMock.countDocuments).toHaveBeenCalledTimes(2);
  });

  it('frees a slot when an image is removed', async () => {
    firestoreMock.countDocuments.and.resolveTo(FREE_TIER_RECEIPT_IMAGE_LIMIT);
    await service.refreshCount();
    expect(service.isAtLimit()).toBeTrue();

    service.noteImageRemoved();
    expect(service.isAtLimit()).toBeFalse();
    expect(await service.canAddImage()).toBeTrue();
  });

  it('fails open when the count query errors', async () => {
    firestoreMock.countDocuments.and.rejectWith(new Error('offline'));
    expect(await service.canAddImage()).toBeTrue();
  });

  it('does not go below zero when removals outnumber the cached count', async () => {
    await service.refreshCount();
    service.noteImageRemoved();
    expect(service.imageCount()).toBe(0);
  });
});
