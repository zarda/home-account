import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BottomNavComponent } from './bottom-nav.component';
import { QuickAddService } from '../../../core/services/quick-add.service';
import { TranslationService } from '../../../core/services/translation.service';
import { navItemFor } from '../nav-items';

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
  let mockQuickAdd: jasmine.SpyObj<QuickAddService>;

  beforeEach(async () => {
    mockQuickAdd = jasmine.createSpyObj('QuickAddService', [
      'openAddTransaction',
      'openScanReceipt',
      'openImportPhotos',
    ]);
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
        { provide: QuickAddService, useValue: mockQuickAdd },
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

  // The four real destinations resolve through navItemFor rather than
  // carrying their own labelKey/icon — the whole point of the shared list
  // is that the bottom nav and the sidebar can no longer say different
  // things about the same route (the old nav.budget/nav.budgets drift).
  it('resolves its real destinations through the shared nav-items list', () => {
    const items = component.navItems();
    for (const route of ['/dashboard', '/transactions', '/budgets', '/reports']) {
      const expected = navItemFor(route);
      const actual = items.find((i) => i.route === route);
      expect(actual?.labelKey).toBe(expected.labelKey);
      expect(actual?.icon).toBe(expected.icon);
    }
  });

  it('keeps its five-slot order: two links, the add action, then two more links', () => {
    const routes = component.navItems().map((i) => i.route);
    expect(routes).toEqual(['/dashboard', '/transactions', '', '/budgets', '/reports']);
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

  it('delegates add-transaction to the quick-add service', () => {
    component.openAddTransaction();
    expect(mockQuickAdd.openAddTransaction).toHaveBeenCalled();
  });

  it('delegates the scan entry to the quick-add service', () => {
    component.openScanReceipt();
    expect(mockQuickAdd.openScanReceipt).toHaveBeenCalled();
  });

  it('delegates the import entry to the quick-add service', () => {
    component.openImportPhotos();
    expect(mockQuickAdd.openImportPhotos).toHaveBeenCalled();
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
    (fixture.nativeElement.querySelector('button.action-button') as HTMLElement).click();
    fixture.detectChanges();
    const items = document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]');

    items[1].click();
    fixture.detectChanges();
    expect(mockQuickAdd.openScanReceipt).toHaveBeenCalled();

    (fixture.nativeElement.querySelector('button.action-button') as HTMLElement).click();
    fixture.detectChanges();
    const reopened = document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel button[mat-menu-item]');
    reopened[2].click();
    fixture.detectChanges();
    expect(mockQuickAdd.openImportPhotos).toHaveBeenCalled();
  });
});
