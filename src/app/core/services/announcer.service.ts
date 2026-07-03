import { Injectable, inject } from '@angular/core';
import { AriaLivePoliteness, LiveAnnouncer } from '@angular/cdk/a11y';

/**
 * Thin wrapper around the CDK LiveAnnouncer so user feedback (snackbars,
 * list updates, empty states) is announced to assistive technology.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncerService {
  private liveAnnouncer = inject(LiveAnnouncer);

  announce(message: string, politeness: AriaLivePoliteness = 'polite'): void {
    if (!message) return;
    void this.liveAnnouncer.announce(message, politeness);
  }
}
