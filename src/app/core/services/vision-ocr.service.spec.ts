import { TestBed } from '@angular/core/testing';
import { VisionOcrService } from './vision-ocr.service';

describe('VisionOcrService', () => {
  let service: VisionOcrService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VisionOcrService);
  });

  it('should not report a Mac environment on the web platform', () => {
    expect(service.isMacEnvironment()).toBeFalse();
  });

  it('should report no recognition languages before detection', () => {
    // Empty means "not asked yet", never "this device reads nothing" — callers
    // routing on it have to treat it as unknown rather than as a refusal.
    expect(service.supportedLanguages()).toEqual([]);
  });

  it('should keep the Mac flag unchanged when the native plugin is missing', async () => {
    // On the web platform the Capacitor plugin rejects; the rejection is handled
    service.detectEnvironment();
    await new Promise(resolve => setTimeout(resolve));

    expect(service.isMacEnvironment()).toBeFalse();
    expect(service.supportedLanguages()).toEqual([]);
  });
});
