import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

describe('ConfirmDialogComponent', () => {
  let component: ConfirmDialogComponent;
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<ConfirmDialogComponent>>;

  const data: ConfirmDialogData = {
    title: 'Delete item',
    message: 'Are you sure?',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    confirmColor: 'warn',
    icon: 'delete',
  };

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and expose the injected data', () => {
    expect(component).toBeTruthy();
    expect(component.data).toBe(data);
  });

  it('onConfirm closes the dialog with true', () => {
    component.onConfirm();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('onCancel closes the dialog with false', () => {
    component.onCancel();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('renders the provided action labels', () => {
    const buttons = fixture.nativeElement.querySelectorAll('mat-dialog-actions button');
    expect(buttons[0].textContent).toContain('Keep');
    expect(buttons[1].textContent).toContain('Delete');
  });

  describe('label fallbacks', () => {
    // Regression: the fallbacks were hardcoded English 'Cancel'/'Confirm',
    // which leaked into ja/tc locales whenever a caller omitted a label.
    // They now go through the translation pipe (raw keys render under Karma
    // because i18n assets are not served in tests).
    it('falls back to translated common.cancel / common.confirm keys', async () => {
      TestBed.resetTestingModule();
      const bareData: ConfirmDialogData = { title: 'T', message: 'M' };
      await TestBed.configureTestingModule({
        imports: [ConfirmDialogComponent, NoopAnimationsModule],
        providers: [
          { provide: MatDialogRef, useValue: dialogRef },
          { provide: MAT_DIALOG_DATA, useValue: bareData },
        ],
      }).compileComponents();
      const bareFixture = TestBed.createComponent(ConfirmDialogComponent);
      bareFixture.detectChanges();

      const buttons = bareFixture.nativeElement.querySelectorAll('mat-dialog-actions button');
      expect(buttons[0].textContent).toContain('common.cancel');
      expect(buttons[1].textContent).toContain('common.confirm');
      expect(buttons[0].textContent).not.toContain('Cancel');
      expect(buttons[1].textContent).not.toContain('Confirm');
    });
  });
});
