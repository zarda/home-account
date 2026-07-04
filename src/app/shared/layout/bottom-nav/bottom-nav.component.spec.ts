import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { BottomNavComponent } from './bottom-nav.component';
import { TranslationService } from '../../../core/services/translation.service';
import { TransactionFormComponent } from '../../../features/transactions/transaction-form/transaction-form.component';

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
});
