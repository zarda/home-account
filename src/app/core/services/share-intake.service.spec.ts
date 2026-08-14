import { TestBed } from '@angular/core/testing';
import { ApplicationRef, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';

import { ShareIntakeService, isAcceptedShare } from './share-intake.service';
import { ShareStashStore, StashedShare } from './share-stash.store';
import { AuthService } from './auth.service';
import { NativeShareService } from './native-share.service';
import { SharedIntakeFile } from '../plugins/share-intake.plugin';

describe('ShareIntakeService', () => {
  let service: ShareIntakeService;
  let stash: jasmine.SpyObj<ShareStashStore>;
  let nativeShare: jasmine.SpyObj<NativeShareService>;
  let router: jasmine.SpyObj<Router>;
  let userId: ReturnType<typeof signal<string | null>>;

  function stashedRow(overrides: Partial<StashedShare> = {}): StashedShare {
    return {
      id: 's1',
      name: 'receipt.png',
      type: 'image/png',
      blob: new Blob(['x'], { type: 'image/png' }),
      receivedAt: 1,
      ...overrides
    };
  }

  beforeEach(() => {
    stash = jasmine.createSpyObj('ShareStashStore', ['count', 'consume', 'clearAll']);
    stash.count.and.resolveTo(0);
    stash.consume.and.resolveTo([]);
    stash.clearAll.and.resolveTo(undefined);

    nativeShare = jasmine.createSpyObj('NativeShareService', [
      'checkPendingShares',
      'consumePendingShares',
      'completePendingShares',
      'clearPendingShares',
      'addListener'
    ]);
    nativeShare.checkPendingShares.and.resolveTo({ count: 0 });
    nativeShare.consumePendingShares.and.resolveTo({ files: [] });
    nativeShare.completePendingShares.and.resolveTo(undefined);
    nativeShare.clearPendingShares.and.resolveTo(undefined);

    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.resolveTo(true);

    userId = signal<string | null>(null);

    TestBed.configureTestingModule({
      providers: [
        ShareIntakeService,
        { provide: ShareStashStore, useValue: stash },
        { provide: NativeShareService, useValue: nativeShare },
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: { userId } }
      ]
    });

    service = TestBed.inject(ShareIntakeService);
  });

  /** Flush the auth effect and the async stash checks behind it. */
  async function settle(): Promise<void> {
    TestBed.inject(ApplicationRef).tick();
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
    }
  }

  it('navigates to the wizard when a signed-in session finds a stash', async () => {
    stash.count.and.resolveTo(2);
    userId.set('user123');

    await settle();

    expect(router.navigate).toHaveBeenCalledWith(['/import/file'], {
      queryParams: { source: 'share' }
    });
  });

  it('does nothing while signed out', async () => {
    stash.count.and.resolveTo(2);

    await settle();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('stays put when the stash is empty', async () => {
    userId.set('user123');

    await settle();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('consumes the visible stash rows into files', async () => {
    stash.consume.and.resolveTo([
      stashedRow(),
      stashedRow({ id: 's2', name: 'doc.pdf', type: 'application/pdf' })
    ]);

    const files = await service.consumeAll();

    expect(files.map(f => f.name)).toEqual(['receipt.png', 'doc.pdf']);
    expect(files[0].type).toBe('image/png');
    expect(stash.consume).toHaveBeenCalled();
  });

  it('drops oversized and unsupported files', async () => {
    const oversized = stashedRow({
      id: 'big',
      name: 'huge.png',
      blob: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })
    });
    const executable = stashedRow({
      id: 'exe',
      name: 'run.exe',
      type: 'application/octet-stream',
      blob: new Blob(['MZ'], { type: 'application/octet-stream' })
    });
    stash.consume.and.resolveTo([stashedRow(), oversized, executable]);

    const files = await service.consumeAll();

    expect(files.map(f => f.name)).toEqual(['receipt.png']);
  });

  it('accepts a csv by extension when the mime type is blank', () => {
    expect(isAcceptedShare(new File(['a,b'], 'statement.csv', { type: '' }))).toBeTrue();
  });

  it('rejects an unknown type with an unknown extension', () => {
    expect(isAcceptedShare(new File(['x'], 'movie.mkv', { type: 'video/x-matroska' }))).toBeFalse();
  });

  describe('consumeNative', () => {
    function sidecarFile(overrides: Partial<SharedIntakeFile> = {}): SharedIntakeFile {
      return {
        id: 'e1',
        name: 'receipt.jpg',
        mimeType: 'image/jpeg',
        receivedAt: String(Date.now()),
        base64: btoa('hi'),
        ...overrides
      };
    }

    beforeEach(() => {
      spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    });

    it('builds a File carrying the mime type the sidecar recorded', async () => {
      nativeShare.consumePendingShares.and.resolveTo({ files: [sidecarFile()] });

      const files = await service.consumeAll();

      expect(files.length).toBe(1);
      expect(files[0].name).toBe('receipt.jpg');
      expect(files[0].type).toBe('image/jpeg');
    });

    it('claims only shares inside the freshness window', async () => {
      const stale = sidecarFile({
        id: 'stale',
        name: 'old.jpg',
        receivedAt: String(Date.now() - 31 * 60 * 1000)
      });
      nativeShare.consumePendingShares.and.resolveTo({ files: [sidecarFile(), stale] });

      const files = await service.consumeAll();

      expect(files.map(f => f.name)).toEqual(['receipt.jpg']);
    });

    it('completes every fetched share, claimed and expired alike', async () => {
      const stale = sidecarFile({
        id: 'stale',
        receivedAt: String(Date.now() - 31 * 60 * 1000)
      });
      nativeShare.consumePendingShares.and.resolveTo({ files: [sidecarFile(), stale] });

      await service.consumeAll();

      // A claimed share is consumed now; an expired one is deleted
      // unconsumed — either way the container must not re-offer it.
      expect(nativeShare.completePendingShares).toHaveBeenCalledWith({ ids: ['e1', 'stale'] });
    });

    it('treats a share with no receivedAt as expired', async () => {
      // A sidecar written before the field existed, mirroring the web
      // stash's drop of pre-ownership rows.
      nativeShare.consumePendingShares.and.resolveTo({
        files: [sidecarFile({ receivedAt: '' })]
      });

      const files = await service.consumeAll();

      expect(files).toEqual([]);
      expect(nativeShare.completePendingShares).toHaveBeenCalledWith({ ids: ['e1'] });
    });

    it('clears the native container on native', async () => {
      await service.clearAll();

      expect(nativeShare.clearPendingShares).toHaveBeenCalled();
      expect(stash.clearAll).not.toHaveBeenCalled();
    });
  });

  it('clears the web stash on web', async () => {
    await service.clearAll();

    expect(stash.clearAll).toHaveBeenCalled();
  });
});
