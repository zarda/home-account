import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { BottomNavComponent } from './bottom-nav.component';
import { TranslationService } from '../../../core/services/translation.service';
import { TransactionFormComponent } from '../../../features/transactions/transaction-form/transaction-form.component';
import { CameraCaptureComponent } from '../../../features/transactions/camera-capture/camera-capture.component';

const LABELS: Record<string, string> = {
  'nav.dashboard': 'Dashboard',
  'nav.transactions': 'Transactions',
  'nav.add': 'Add',
  'nav.budgets': 'Budgets',
  'nav.reports': 'Reports',
};

describe('BottomNavComponent', () => {
  let component: BottomNavComponent;
  let fixture: ComponentFixture<BottomNavComponent>;
  let mockDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    const mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    mockTranslationService.t.and.callFake((key: string) => LABELS[key] ?? key);

    await TestBed.configureTestingModule({
      imports: [BottomNavComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: MatDialog, useValue: mockDialog },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BottomNavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('exposes an Add action among the nav items', () => {
    const addItem = component.navItems().find((i) => i.isAction);
    expect(addItem?.label).toBe('Add');
  });

  it('renders a visible translated label under every nav icon', () => {
    const labels: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('.nav-label'),
      (el) => (el as HTMLElement).textContent!.trim(),
    );
    expect(labels).toEqual(['Dashboard', 'Transactions', 'Budgets', 'Reports']);
  });

  it('gives every item an aria-label', () => {
    const unlabeled = Array.from(
      fixture.nativeElement.querySelectorAll('a.nav-item, button.action-button'),
    ).filter((el) => !(el as HTMLElement).getAttribute('aria-label'));
    expect(unlabeled).toEqual([]);
  });

  it('opens the transaction form in add mode', () => {
    component.openAddTransaction();
    expect(mockDialog.open).toHaveBeenCalledWith(
      TransactionFormComponent,
      jasmine.objectContaining({ data: { mode: 'add' } }),
    );
  });

  it('opens the camera capture dialog from the scan entry', () => {
    component.openScanReceipt();
    expect(mockDialog.open).toHaveBeenCalledWith(
      CameraCaptureComponent,
      jasmine.any(Object),
    );
  });

  it('routes to the import wizard from the import entry', () => {
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate');
    component.openImportPhotos();
    expect(navigate).toHaveBeenCalledWith(['/import/file']);
  });

  it('the center action button opens a menu with the three add entries', () => {
    const actionButton = fixture.nativeElement.querySelector('button.action-button') as HTMLElement;
    actionButton.click();
    fixture.detectChanges();

    const items = Array.from(
      document.querySelectorAll('.mat-mdc-menu-panel button[mat-menu-item]'),
      (el) => (el as HTMLElement).textContent!.trim(),
    );
    expect(items.length).toBe(3);
    expect(items[0]).toContain('transactions.addManually');
    expect(items[1]).toContain('ai.scanReceipt');
    expect(items[2]).toContain('import.importPhotos');
  });

  it('the menu entries trigger their actions', () => {
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate');

    (fixture.nativeElement.querySelector('button.action-button') as HTMLElement).click();
    fixture.detectChanges();
    const items = document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]');

    items[1].click();
    fixture.detectChanges();
    expect(mockDialog.open).toHaveBeenCalledWith(CameraCaptureComponent, jasmine.any(Object));

    (fixture.nativeElement.querySelector('button.action-button') as HTMLElement).click();
    fixture.detectChanges();
    const reopened = document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]');
    reopened[2].click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/import/file']);
  });
});
