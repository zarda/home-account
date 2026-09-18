import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { SplitPartsComponent } from './split-parts.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { Category, SplitPart } from '../../../../models';
import { createCategory } from '../../../../core/services/testing';

/** What formatCurrency answers here, so a footer assertion pins the call, not Intl. */
const FORMATTED = '<money>';

/**
 * Bindings move through signals: an undeclared change-detection strategy is
 * OnPush, so a host that reassigns a plain field would never re-render.
 */
@Component({
  standalone: true,
  imports: [SplitPartsComponent],
  template: `
    <app-split-parts
      [categories]="categories()"
      [currency]="currency()"
      [total]="total()"
      [(parts)]="parts"
    />
  `,
})
class HostComponent {
  readonly categories = signal<Category[]>([]);
  readonly currency = signal('USD');
  readonly total = signal(100);
  readonly parts = signal<SplitPart[]>([]);
}

describe('SplitPartsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let formatCurrency: jasmine.Spy;

  const food = createCategory({ id: 'cat-food', name: 'categoryNames.food', type: 'expense' });
  const home = createCategory({ id: 'cat-home', name: 'categoryNames.home', type: 'expense' });

  // Params are folded into the output, so an assertion on a string also pins
  // what the key was filled with.
  const t = (key: string, params?: Record<string, string | number>): string =>
    params ? `${key}${JSON.stringify(params)}` : key;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const addButton = (): HTMLButtonElement => element().querySelector<HTMLButtonElement>('[data-split-add]')!;
  const rows = (): HTMLElement[] => Array.from(element().querySelectorAll<HTMLElement>('[data-split-row]'));
  const removeButtons = (): HTMLButtonElement[] =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('[data-split-remove]'));
  const footer = (): HTMLElement | null => element().querySelector<HTMLElement>('[data-split-footer]');
  const amountInput = (index: number): HTMLInputElement =>
    rows()[index].querySelector<HTMLInputElement>('input[type="number"]')!;

  function render(): void {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.categories.set([food, home]);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    formatCurrency = jasmine.createSpy('formatCurrency').and.returnValue(FORMATTED);

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TranslationService, useValue: { t } },
        // The real service resolves a locale off TranslationService and
        // fetches rates from its constructor; neither belongs in here.
        { provide: CurrencyService, useValue: { formatCurrency } },
      ],
    }).compileComponents();
  });

  describe('with no parts', () => {
    it('offers the split and shows no rows', () => {
      render();

      expect(addButton().textContent).toContain('transactions.splitAcross');
      expect(rows().length).toBe(0);
    });

    it('shows no remainder line', () => {
      render();

      expect(footer()).toBeNull();
    });
  });

  describe('adding a part', () => {
    it('adds one empty row', () => {
      render();

      addButton().click();
      fixture.detectChanges();

      expect(host.parts()).toEqual([{ categoryId: '', amount: 0 }]);
      expect(rows().length).toBe(1);
      expect(amountInput(0).value).toBe('');
    });

    it("moves focus to the new row's category select", async () => {
      render();

      addButton().click();
      await fixture.whenStable();
      // The row renders, then afterNextRender fires — both on the app's own
      // tick, which detectChanges alone does not run.
      TestBed.tick();

      expect(document.activeElement).toBe(rows()[0].querySelector('mat-select'));
    });

    it('lists only the categories it was handed', fakeAsync(() => {
      render();
      addButton().click();
      fixture.detectChanges();

      rows()[0].querySelector<HTMLElement>('.mat-mdc-select-trigger')!.click();
      fixture.detectChanges();
      flush();

      // Options render into the overlay container, outside the fixture; the
      // name is read past the icon the option also carries.
      const options = Array.from(document.querySelectorAll<HTMLElement>('mat-option'));
      expect(options.map(option => option.querySelector('.category-option span')?.textContent?.trim()))
        .toEqual(['categoryNames.food', 'categoryNames.home']);
    }));
  });

  describe('removing a part', () => {
    it('names the remove button by its key', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 30 }]);
      fixture.detectChanges();

      expect(removeButtons()[0].getAttribute('aria-label')).toBe('transactions.splitRemovePart');
    });

    it('gives the remove button a 40px box', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 30 }]);
      fixture.detectChanges();

      const box = removeButtons()[0].getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    });

    it('takes the last row and its remainder line away', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 30 }]);
      fixture.detectChanges();

      removeButtons()[0].click();
      fixture.detectChanges();

      expect(host.parts()).toEqual([]);
      expect(rows().length).toBe(0);
      expect(footer()).toBeNull();
    });
  });

  describe('the remainder line', () => {
    it('says what stays on the main category', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 30 }]);
      fixture.detectChanges();

      expect(formatCurrency).toHaveBeenCalledWith(70, 'USD');
      expect(footer()!.textContent).toContain(
        `transactions.splitRemainder${JSON.stringify({ amount: FORMATTED })}`
      );
      expect(footer()!.getAttribute('role')).toBeNull();
    });

    it('alerts when the parts leave nothing behind', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 100 }]);
      fixture.detectChanges();

      expect(footer()!.textContent).toContain('transactions.splitRemainderInvalid');
      expect(footer()!.getAttribute('role')).toBe('alert');
    });

    it('alerts while a part has no amount', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 0 }]);
      fixture.detectChanges();

      expect(footer()!.textContent).toContain('transactions.splitRemainderInvalid');
      expect(footer()!.getAttribute('role')).toBe('alert');
    });

    it('alerts that a category is missing, even with a usable amount', () => {
      render();
      host.parts.set([{ categoryId: '', amount: 30 }]);
      fixture.detectChanges();

      expect(footer()!.textContent).toContain('transactions.splitPartCategoryRequired');
      expect(footer()!.getAttribute('role')).toBe('alert');
    });

    it('names the missing category ahead of the amount when both are wrong', () => {
      render();
      host.parts.set([{ categoryId: '', amount: 100 }]);
      fixture.detectChanges();

      expect(footer()!.textContent).toContain('transactions.splitPartCategoryRequired');
      expect(footer()!.textContent).not.toContain('transactions.splitRemainderInvalid');
    });
  });

  describe('an amount typed in', () => {
    it("rounds to the currency's minor unit", () => {
      render();
      host.currency.set('JPY');
      host.parts.set([{ categoryId: 'cat-food', amount: 0 }]);
      fixture.detectChanges();

      amountInput(0).value = '30.4';
      amountInput(0).dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(host.parts()).toEqual([{ categoryId: 'cat-food', amount: 30 }]);
    });

    it('reads a cleared field as no amount', () => {
      render();
      host.parts.set([{ categoryId: 'cat-food', amount: 30 }]);
      fixture.detectChanges();

      amountInput(0).value = '';
      amountInput(0).dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(host.parts()).toEqual([{ categoryId: 'cat-food', amount: 0 }]);
    });
  });
});
