import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { QuickAddService } from './quick-add.service';
import { TransactionFormComponent } from '../../features/transactions/transaction-form/transaction-form.component';
import { CameraCaptureComponent } from '../../features/transactions/camera-capture/camera-capture.component';

describe('QuickAddService', () => {
  let service: QuickAddService;
  let dialog: jasmine.SpyObj<MatDialog>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    dialog = jasmine.createSpyObj('MatDialog', ['open']);
    router = jasmine.createSpyObj('Router', ['navigate'], { events: EMPTY });

    TestBed.configureTestingModule({
      providers: [
        QuickAddService,
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: router },
      ],
    });

    service = TestBed.inject(QuickAddService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('openAddTransaction opens the transaction form in add mode', () => {
    service.openAddTransaction();
    expect(dialog.open).toHaveBeenCalledWith(TransactionFormComponent, {
      width: '500px',
      maxWidth: '95vw',
      disableClose: true,
      data: { mode: 'add' },
    });
  });

  it('openScanReceipt opens the camera capture dialog with the same sizing', () => {
    service.openScanReceipt();
    expect(dialog.open).toHaveBeenCalledWith(CameraCaptureComponent, {
      width: '500px',
      maxWidth: '95vw',
    });
  });

  it('openImportPhotos navigates to the import wizard', () => {
    service.openImportPhotos();
    expect(router.navigate).toHaveBeenCalledWith(['/import/file']);
  });
});
