import { TestBed } from '@angular/core/testing';
import { ApplicationRef, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { EMPTY } from 'rxjs';

import {
  ConsumedShares,
  IMPORT_FILE_MAX_BYTES,
  ShareIntakeService,
  shareRefusal
} from './share-intake.service';
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

    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });
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

  /** A consumed batch by name, each refusal as its name and its reason. */
  function named(consumed: ConsumedShares) {
    return {
      accepted: consumed.accepted.map(f => f.name),
      refused: consumed.refused.map(x => [x.file.name, x.reason])
    };
  }

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

    const { accepted, refused } = await service.consumeAll();

    expect(accepted.map(f => f.name)).toEqual(['receipt.png', 'doc.pdf']);
    expect(accepted[0].type).toBe('image/png');
    expect(refused).toEqual([]);
    expect(stash.consume).toHaveBeenCalled();
  });

  it('hands back oversized, unsupported, backup and empty files as refused, each with its reason', async () => {
    const oversized = stashedRow({
      id: 'big',
      name: 'huge.png',
      blob: new Blob([new Uint8Array(IMPORT_FILE_MAX_BYTES + 1)], { type: 'image/png' })
    });
    const executable = stashedRow({
      id: 'exe',
      name: 'run.exe',
      type: 'application/octet-stream',
      blob: new Blob(['MZ'], { type: 'application/octet-stream' })
    });
    const empty = stashedRow({
      id: 'blank',
      name: 'blank.png',
      blob: new Blob([], { type: 'image/png' })
    });
    const backup = stashedRow({
      id: 'json',
      name: 'backup.json',
      type: 'application/json',
      blob: new Blob(['{}'], { type: 'application/json' })
    });
    stash.consume.and.resolveTo([stashedRow(), oversized, executable, empty, backup]);

    expect(named(await service.consumeAll())).toEqual({
      accepted: ['receipt.png'],
      refused: [
        ['huge.png', 'tooLarge'],
        ['run.exe', 'type'],
        ['blank.png', 'empty'],
        ['backup.json', 'backup']
      ]
    });
  });

  it('accepts a csv by extension when the mime type is blank', () => {
    expect(shareRefusal(new File(['a,b'], 'statement.csv', { type: '' }))).toBeNull();
  });

  it('rejects an unknown type with an unknown extension', () => {
    expect(shareRefusal(new File(['x'], 'movie.mkv', { type: 'video/x-matroska' }))).toBe('type');
  });

  it('refuses a file for the reason the dropzone would give before calling it empty', () => {
    // The dropzone asks the size, then the type; a file both refuse is
    // refused for the reason it would give.
    expect(shareRefusal(new File([], 'blank.exe', { type: '' }))).toBe('type');
    const huge = new File([new Uint8Array(IMPORT_FILE_MAX_BYTES + 1)], 'huge.exe', { type: '' });
    expect(shareRefusal(huge)).toBe('tooLarge');
    // A pin: the size is asked before the backup, so an oversized backup is
    // refused for its size, as the dropzone would refuse it. Mutation: the
    // JSON check above the size check.
    const hugeBackup = new File([new Uint8Array(IMPORT_FILE_MAX_BYTES + 1)], 'huge.json', {
      type: 'application/json'
    });
    expect(shareRefusal(hugeBackup)).toBe('tooLarge');
  });

  it('calls a JSON backup a backup, by its type or by its extension', () => {
    expect(shareRefusal(new File(['{}'], 'backup.json', { type: '' }))).toBe('backup');
    expect(shareRefusal(new File(['{}'], 'export', { type: 'application/json' }))).toBe('backup');
    // A pin: the backup is named before the emptiness, so an empty one is
    // still a backup. Mutation: the empty check above the JSON check.
    expect(shareRefusal(new File([], 'empty.json', { type: 'application/json' }))).toBe('backup');
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

      const files = (await service.consumeAll()).accepted;

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

      const files = (await service.consumeAll()).accepted;

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

      expect(await service.consumeAll()).toEqual({ accepted: [], refused: [] });
      expect(nativeShare.completePendingShares).toHaveBeenCalledWith({ ids: ['e1'] });
    });

    it('hands back a raw HEIC as refused for its type, and completes it', async () => {
      nativeShare.consumePendingShares.and.resolveTo({
        files: [sidecarFile({ id: 'h1', name: 'IMG_0001.HEIC', mimeType: 'image/heic' })]
      });

      expect(named(await service.consumeAll())).toEqual({
        accepted: [],
        refused: [['IMG_0001.HEIC', 'type']]
      });
      expect(nativeShare.completePendingShares).toHaveBeenCalledWith({ ids: ['h1'] });
    });

    it('names no share past the claim window among the refused', async () => {
      // An expired share may be another account's: its name is not this
      // session's to read, so it is in neither list.
      nativeShare.consumePendingShares.and.resolveTo({
        files: [sidecarFile({
          id: 'old',
          name: 'old.heic',
          mimeType: 'image/heic',
          receivedAt: String(Date.now() - 31 * 60 * 1000)
        })]
      });

      expect(await service.consumeAll()).toEqual({ accepted: [], refused: [] });
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
