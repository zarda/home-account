import { Component } from '@angular/core';
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

/** Somewhere for the test router to land; the nav is what is under test. */
@Component({ standalone: true, template: '' })
class StubPage {}

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
        provideRouter([
          { path: 'dashboard', component: StubPage },
          { path: 'dashboard/detail', component: StubPage },
          { path: 'transactions', component: StubPage },
          { path: 'transactions/:id', component: StubPage },
          { path: 'budgets', component: StubPage },
          { path: 'reports', component: StubPage },
        ]),
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

  /**
   * The active route reached assistive tech as a CSS class and nothing else,
   * so every link announced identically (#274, ADR 0055).
   */
  describe('the current route', () => {
    async function goTo(url: string): Promise<void> {
      await TestBed.inject(Router).navigateByUrl(url);
      fixture.detectChanges();
    }

    function marked(): string[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('a.nav-item[aria-current="page"]'),
        (el) => (el as HTMLElement).getAttribute('aria-label') ?? '',
      );
    }

    it('marks the current link, and only it', async () => {
      await goTo('/budgets');
      expect(marked()).toEqual(['Budgets']);

      // Moving the mark is the part a static attribute would fail.
      await goTo('/reports');
      expect(marked()).toEqual(['Reports']);
    });

    it('marks nothing on a route no link owns', async () => {
      await goTo('/dashboard/detail');
      expect(marked()).toEqual([]);
    });

    it('still marks a parent link on its own child route', async () => {
      // Only /dashboard matches exactly; the rest mark their subtrees.
      await goTo('/transactions/abc');
      expect(marked()).toEqual(['Transactions']);
    });

    it('leaves the centre Add button unmarked', async () => {
      await goTo('/dashboard');
      expect(marked()).toEqual(['Dashboard']);
      expect(
        fixture.nativeElement.querySelector('button.action-button[aria-current]'),
      ).toBeNull();
    });

    it('keeps the accessible name to the label alone', async () => {
      // The state belongs in aria-current, not folded into the name — the
      // accessible name has to keep matching the visible text.
      await goTo('/budgets');
      const active = fixture.nativeElement.querySelector(
        'a.nav-item[aria-current="page"]',
      ) as HTMLElement;
      expect(active.getAttribute('aria-label')).toBe('Budgets');
    });
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
