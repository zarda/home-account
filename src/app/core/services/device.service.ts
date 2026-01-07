import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DeviceService {
  /**
   * Check if the current device is a mobile device
   * Uses user agent detection for simple mobile check
   */
  isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
  }

  /**
   * Check if the device supports camera capture
   * Mobile devices with cameras support the capture attribute on file inputs
   */
  supportsCameraCapture(): boolean {
    return this.isMobile();
  }
}
