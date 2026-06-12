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

  it('should keep the Mac flag unchanged when the native plugin is missing', async () => {
    // On the web platform the Capacitor plugin rejects; the rejection is handled
    service.detectEnvironment();
    await new Promise(resolve => setTimeout(resolve));

    expect(service.isMacEnvironment()).toBeFalse();
  });
});
