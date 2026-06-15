import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { BottomNavComponent } from './bottom-nav.component';
import { TransactionFormComponent } from '../../../features/transactions/transaction-form/transaction-form.component';

describe('BottomNavComponent', () => {
  let component: BottomNavComponent;
  let fixture: ComponentFixture<BottomNavComponent>;
  let mockDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [BottomNavComponent, NoopAnimationsModule],
      providers: [provideRouter([]), { provide: MatDialog, useValue: mockDialog }],
    }).compileComponents();

    fixture = TestBed.createComponent(BottomNavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('exposes an Add action among the nav items', () => {
    const addItem = component.navItems.find((i) => i.isAction);
    expect(addItem?.label).toBe('Add');
  });

  it('opens the transaction form in add mode', () => {
    component.openAddTransaction();
    expect(mockDialog.open).toHaveBeenCalledWith(
      TransactionFormComponent,
      jasmine.objectContaining({ data: { mode: 'add' } }),
    );
  });
});
