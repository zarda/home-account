import { TestBed } from '@angular/core/testing';
import { MLWorkerService } from './ml-worker.service';

describe('MLWorkerService', () => {
  let service: MLWorkerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MLWorkerService],
    });

    service = TestBed.inject(MLWorkerService);
  });

  afterEach(() => {
    service.terminate();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should not be ready initially', () => {
      expect(service.isReady()).toBeFalse();
    });

    it('should not be loading initially', () => {
      expect(service.isLoading()).toBeFalse();
    });

    it('should have no error initially', () => {
      expect(service.error()).toBeNull();
    });

    it('should have zero progress initially', () => {
      expect(service.progress()).toBe(0);
    });

    it('should have empty status initially', () => {
      expect(service.status()).toBe('');
    });

    it('should report Web Worker support', () => {
      // In a browser environment with Worker support
      expect(service.isSupported()).toEqual(typeof Worker !== 'undefined');
    });
  });

  describe('model size', () => {
    it('should return model size in bytes', () => {
      expect(service.modelSize()).toBe(65 * 1024 * 1024);
    });

    it('should have MODEL_SIZE_MB constant', () => {
      expect(service.MODEL_SIZE_MB).toBe(65);
    });
  });

  describe('canProcessOffline', () => {
    it('should return false when not ready', () => {
      expect(service.canProcessOffline()).toBeFalse();
    });
  });

  describe('terminate', () => {
    it('should reset state after termination', () => {
      service.terminate();

      expect(service.isReady()).toBeFalse();
      expect(service.isLoading()).toBeFalse();
      expect(service.status()).toBe('');
      expect(service.progress()).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return status when no worker', async () => {
      const status = await service.getStatus();

      expect(status.isReady).toBeFalse();
      expect(status.isInitializing).toBeFalse();
    });
  });

  // Note: Full integration tests with actual Worker would require
  // a more complex test setup with Worker mocking
});
