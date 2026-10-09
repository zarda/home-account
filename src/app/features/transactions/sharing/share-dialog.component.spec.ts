import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ShareDialogComponent, ShareDialogData } from './share-dialog.component';
import { PwaService } from '../../../core/services/pwa.service';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub, provideNoMotion } from '../../../core/services/testing';

describe('ShareDialogComponent', () => {
  let fixture: ComponentFixture<ShareDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<ShareDialogComponent, string[]>>;
  let online: ReturnType<typeof signal<boolean>>;

  const root = () => fixture.nativeElement as HTMLElement;
  const boxes = () => Array.from(root().querySelectorAll<HTMLInputElement>('.share-options input[type="checkbox"]'));
  const labels = () => Array.from(root().querySelectorAll<HTMLElement>('.share-options mat-checkbox'))
    .map(box => box.textContent?.trim());
  const note = () => root().querySelector('.share-offline-note');
  const goalNote = () => root().querySelector('.share-unshare-note');
  const button = (text: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('mat-dialog-actions button'))
    .find(candidate => candidate.textContent?.includes(text))!;

  function render(data: Partial<ShareDialogData> = {}): void {
    TestBed.overrideProvider(MAT_DIALOG_DATA, {
      useValue: {
        description: 'Dinner',
        targets: [{ householdId: 'h1', name: 'Home' }, { householdId: 'h2', name: 'Office' }],
        shared: ['h1'],
        ...data,
      },
    });
    fixture = TestBed.createComponent(ShareDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    online = signal(true);

    await TestBed.configureTestingModule({
      imports: [ShareDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: PwaService, useValue: { isOnline: online } },
        { provide: TranslationService, useValue: createTranslationStub() },
        provideNoMotion(),
      ],
    }).compileComponents();
  });

  it('names the row it shares, and offers each household as a checkbox pre-set from the row', () => {
    render();

    expect(root().textContent).toContain('Dinner');
    expect(labels()).toEqual(['Home', 'Office']);
    expect(boxes().map(box => box.checked)).toEqual([true, false]);
    const group = root().querySelector('.share-options')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('transactions.share.label');
    expect(root().textContent).toContain('transactions.share.hint');
  });

  it('closes with the households chosen', () => {
    render();

    boxes()[0].click();
    boxes()[1].click();
    fixture.detectChanges();
    button('common.save').click();

    expect(dialogRef.close).toHaveBeenCalledOnceWith(['h2']);
  });

  it('keeps a key the row holds for a household it no longer offers', () => {
    render({ shared: ['h1', 'h3'] });

    button('common.save').click();

    expect(dialogRef.close).toHaveBeenCalledOnceWith(['h1', 'h3']);
  });

  it('closes with nothing when cancelled', () => {
    render();

    boxes()[1].click();
    button('common.cancel').click();

    expect(dialogRef.close).toHaveBeenCalledOnceWith(undefined);
  });

  it('says, offline, that the household keeps seeing an unshared row until the device reconnects', () => {
    online.set(false);
    render();
    expect(note()).withContext('nothing unshared yet').toBeNull();

    boxes()[1].click();
    fixture.detectChanges();
    expect(note()).withContext('a share is no unshare').toBeNull();

    boxes()[0].click();
    fixture.detectChanges();
    expect(note()?.textContent?.trim()).toBe('transactions.share.offlineUnshare');

    online.set(true);
    fixture.detectChanges();
    expect(note()).toBeNull();
  });

  it('says, once a household is unchecked, that it stops seeing the row and none of its goals count it', () => {
    render();
    expect(goalNote()).withContext('nothing unshared yet').toBeNull();

    boxes()[1].click();
    fixture.detectChanges();
    expect(goalNote()).withContext('a share takes nothing out').toBeNull();

    boxes()[0].click();
    fixture.detectChanges();
    expect(goalNote()?.textContent?.trim()).toBe('transactions.share.unshareGoalLink');
    expect(note()).withContext('online, the unshare lands at once').toBeNull();

    boxes()[0].click();
    fixture.detectChanges();
    expect(goalNote()).withContext('checked again, nothing is taken out').toBeNull();
  });

  describe('for many selected rows', () => {
    const title = () => root().querySelector('app-dialog-header')?.textContent ?? '';
    const group = () => root().querySelector('.share-options')!;
    const confirm = () => root().querySelector<HTMLButtonElement>('mat-dialog-actions button.share-confirm')!;
    const shareNote = () => root().querySelector('.share-offline-share-note');

    it('asks which households to share them into, none chosen yet, and closes with only those', () => {
      render({ description: '3 selected', shared: [], mode: 'share' });

      expect(title()).toContain('transactions.share.title');
      expect(root().querySelector('.share-row')?.textContent?.trim()).toBe('3 selected');
      expect(group().getAttribute('aria-label')).toBe('transactions.select.shareLabel');
      expect(boxes().map(box => box.checked)).toEqual([false, false]);
      expect(root().textContent).withContext('what members see').toContain('transactions.share.hint');
      expect(confirm().textContent?.trim()).toBe('transactions.select.shareAction');
      expect(confirm().disabled).withContext('nothing chosen yet').toBeTrue();

      boxes()[1].click();
      fixture.detectChanges();
      expect(confirm().disabled).toBeFalse();
      confirm().click();

      expect(dialogRef.close).toHaveBeenCalledOnceWith(['h2']);
    });

    it('says, offline, that the households see the rows once the device is back online', () => {
      online.set(false);
      render({ description: '3 selected', shared: [], mode: 'share' });

      expect(shareNote()?.textContent?.trim()).toBe('transactions.select.offlineShare');
      expect(shareNote()?.getAttribute('role')).toBe('status');
      expect(goalNote()).toBeNull();

      online.set(true);
      fixture.detectChanges();
      expect(shareNote()).toBeNull();
    });

    it('asks which households to stop sharing them with, pre-set, and says what that takes away', () => {
      render({ description: '2 selected', shared: ['h1'], mode: 'unshare' });

      expect(title()).toContain('transactions.select.stopTitle');
      expect(group().getAttribute('aria-label')).toBe('transactions.select.stopLabel');
      expect(boxes().map(box => box.checked)).toEqual([true, false]);
      expect(root().textContent).not.toContain('transactions.share.hint');
      expect(goalNote()?.textContent?.trim()).toBe('transactions.select.unshareGoalLink');
      expect(note()).withContext('online').toBeNull();
      expect(confirm().textContent?.trim()).toBe('transactions.share.stop');

      boxes()[1].click();
      fixture.detectChanges();
      confirm().click();

      expect(dialogRef.close).toHaveBeenCalledOnceWith(['h1', 'h2']);
    });

    it('says, offline, that the households keep seeing the rows until the device reconnects', () => {
      online.set(false);
      render({ description: '2 selected', shared: [], mode: 'unshare' });
      expect(note()).withContext('nothing chosen').toBeNull();
      expect(goalNote()).withContext('nothing chosen').toBeNull();
      expect(confirm().disabled).toBeTrue();

      boxes()[0].click();
      fixture.detectChanges();

      expect(note()?.textContent?.trim()).toBe('transactions.select.offlineUnshare');
      expect(goalNote()?.textContent?.trim()).toBe('transactions.select.unshareGoalLink');
      expect(shareNote()).toBeNull();
    });
  });
});
