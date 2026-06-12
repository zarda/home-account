import { TestBed } from '@angular/core/testing';
import { AppleIntelligenceService } from './apple-intelligence.service';

describe('AppleIntelligenceService', () => {
  let service: AppleIntelligenceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AppleIntelligenceService);
  });

  it('should report the model as unavailable before detection', () => {
    expect(service.isModelAvailable()).toBeFalse();
  });

  it('should stay unavailable when the native plugin is missing', async () => {
    // On the web platform the Capacitor plugin rejects; the rejection is handled
    service.detectAvailability();
    await new Promise(resolve => setTimeout(resolve));

    expect(service.isModelAvailable()).toBeFalse();
  });
});
