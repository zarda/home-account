import { TestBed } from '@angular/core/testing';
import { DeviceService } from './device.service';

describe('DeviceService', () => {
  let service: DeviceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DeviceService);
  });

  it('should not report a desktop browser as mobile', () => {
    // Karma runs in headless desktop Chrome
    expect(service.isMobile()).toBeFalse();
  });

  it('should tie camera capture support to mobile detection', () => {
    expect(service.supportsCameraCapture()).toBe(service.isMobile());
  });
});
