import { Injectable, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';

import { AuthService } from './auth.service';
import { ShareStashStore, StashedShare } from './share-stash.store';
import ShareIntake, { SharedIntakeFile } from '../plugins/share-intake.plugin';

/**
 * What a share may hand the import wizard — the dropzone's accepted set
 * (`file-dropzone.component.ts`), expressed as MIME types with an extension
 * fallback for the platforms that share CSVs with a blank or vendor type.
 */
export const SHARED_FILE_ACCEPT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/csv'
];
export const SHARED_FILE_ACCEPT_EXTENSIONS = ['.csv', '.pdf', '.png', '.jpg', '.jpeg', '.webp'];
export const SHARED_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Pure gate for one shared file; exported for the spec. */
export function isAcceptedShare(file: File): boolean {
  if (file.size === 0 || file.size > SHARED_FILE_MAX_BYTES) return false;
  if (SHARED_FILE_ACCEPT_TYPES.includes(file.type)) return true;
  const name = file.name.toLowerCase();
  return SHARED_FILE_ACCEPT_EXTENSIONS.some(ext => name.endsWith(ext));
}

/**
 * The receiving end of both share pipelines.
 *
 * Web: the share-target service worker stashes the POSTed files into
 * IndexedDB and redirects to the wizard; this service registers that worker
 * and, for shares that arrived while the app was closed or signed out,
 * navigates to the wizard once a session exists.
 *
 * Native iOS: the Share Extension saves files into the App Group container;
 * the ShareIntake plugin surfaces them, and app activation re-checks.
 *
 * Either way the wizard calls consumeAll() and the files enter the normal
 * import flow.
 */
@Injectable({ providedIn: 'root' })
export class ShareIntakeService {
  private authService = inject(AuthService);
  private router = inject(Router);
  private stash = inject(ShareStashStore);

  constructor() {
    // The wizard route is auth-guarded and a share can arrive signed out,
    // so the handoff waits for a session rather than racing the guard.
    effect(() => {
      const userId = this.authService.userId();
      if (!userId) return;
      untracked(() => void this.navigateIfPending());
    });
  }

  /** Called once at startup from an app initializer. */
  async init(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      // WKWebView has no service workers — the Share Extension is the iOS
      // pipeline. Activation is when a share made in another app can first
      // be noticed.
      void ShareIntake.addListener('pendingSharesChanged', () => {
        void this.navigateIfPending();
      });
      return;
    }

    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/share-target-sw.js');
      } catch (error) {
        // Without the worker the share target 404s, but the app itself is
        // fine — never let registration break startup.
        console.warn('[ShareIntake] Service worker registration failed:', error);
      }
    }
  }

  /** Every waiting shared file, filtered to the accepted set; clears the source. */
  async consumeAll(): Promise<File[]> {
    const files = Capacitor.isNativePlatform()
      ? await this.consumeNative()
      : await this.consumeWeb();
    return files.filter(isAcceptedShare);
  }

  private async pendingCount(): Promise<number> {
    if (Capacitor.isNativePlatform()) {
      return (await ShareIntake.checkPendingShares()).count;
    }
    return this.stash.count();
  }

  private async navigateIfPending(): Promise<void> {
    try {
      if ((await this.pendingCount()) === 0) return;
    } catch {
      return;
    }
    await this.router.navigate(['/import/file'], { queryParams: { source: 'share' } });
  }

  private async consumeWeb(): Promise<File[]> {
    const rows = await this.stash.readAll();
    await this.stash.clear();
    return rows.map((row: StashedShare) => new File([row.blob], row.name, { type: row.type }));
  }

  private async consumeNative(): Promise<File[]> {
    const { files } = await ShareIntake.consumePendingShares();
    return files.map((file: SharedIntakeFile) => {
      const bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0));
      return new File([bytes], file.name, { type: file.mimeType });
    });
  }
}
