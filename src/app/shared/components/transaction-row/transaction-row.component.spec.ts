import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TransactionRowComponent } from './transaction-row.component';
import { CurrencyService } from '../../../core/services/currency.service';
import { AuthService } from '../../../core/services/auth.service';
import { Transaction, Category, User } from '../../../models';
import { createTransaction, createCategory, createUser } from '../../../core/services/testing';

describe('TransactionRowComponent', () => {
  let fixture: ComponentFixture<TransactionRowComponent>;
  let component: TransactionRowComponent;
  let currentUser: ReturnType<typeof signal<User | null>>;

  const categories = new Map<string, Category>([
    ['food', createCategory({ id: 'food', name: 'Groceries', icon: 'shopping_cart', color: '#ff5722' })],
  ]);

  function setTransaction(overrides: Partial<Transaction> = {}): void {
    fixture.componentRef.setInput(
      'transaction',
      createTransaction({ categoryId: 'food', description: 'Weekly shop', ...overrides })
    );
    fixture.componentRef.setInput('categories', categories);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    const currency = jasmine.createSpyObj('CurrencyService', ['formatCurrency', 'amountInBase']);
    currency.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount.toFixed(2)}`
    );
    currency.amountInBase.and.callFake(
      (t: { amount: number; amountInBaseCurrency?: number }) => t.amountInBaseCurrency ?? t.amount
    );
    currentUser = signal<User | null>(
      createUser({ preferences: { baseCurrency: 'USD' } as User['preferences'] })
    );

    await TestBed.configureTestingModule({
      imports: [TransactionRowComponent],
      providers: [
        { provide: CurrencyService, useValue: currency },
        { provide: AuthService, useValue: { currentUser } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransactionRowComponent);
    component = fixture.componentInstance;
  });

  it('renders description, category name, and a signed expense amount', () => {
    setTransaction({ type: 'expense', amount: 42, currency: 'USD' });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.row-description')!.textContent).toContain('Weekly shop');
    expect(el.querySelector('.row-category')!.textContent).toContain('Groceries');
    const amount = el.querySelector('.amount')!;
    expect(amount.textContent).toContain('-USD 42.00');
    expect(amount.classList).toContain('expense');
  });

  it('marks income rows with a plus sign and income tone', () => {
    setTransaction({ type: 'income', amount: 100, currency: 'USD' });

    const amount = fixture.nativeElement.querySelector('.amount')!;
    expect(amount.textContent).toContain('+USD 100.00');
    expect(amount.classList).toContain('income');
  });

  it('shows a converted secondary line only for foreign-currency rows', () => {
    setTransaction({ currency: 'JPY', amount: 3800, amountInBaseCurrency: 25.42 } as Partial<Transaction>);
    expect(fixture.nativeElement.querySelector('.amount-converted')!.textContent)
      .toContain('≈ USD 25.42');

    setTransaction({ currency: 'USD', amount: 10 });
    expect(fixture.nativeElement.querySelector('.amount-converted')).toBeNull();
  });

  it('shows the receipt indicator only when the row has a receipt', () => {
    setTransaction({ receiptUrl: 'https://example.com/r.png' } as Partial<Transaction>);
    expect(fixture.nativeElement.querySelector('.receipt-indicator')).not.toBeNull();

    setTransaction({});
    expect(fixture.nativeElement.querySelector('.receipt-indicator')).toBeNull();
  });

  it('badges the indicator with the image count only past one image', () => {
    setTransaction({
      receiptUrl: 'https://example.com/r0.png',
      receiptUrls: ['https://example.com/r0.png', 'https://example.com/r1.png'],
      receiptCount: 2,
    } as Partial<Transaction>);
    expect(fixture.nativeElement.querySelector('.receipt-count-badge')?.textContent?.trim()).toBe('2');

    // A single image needs no count — including on a legacy row that
    // predates receiptUrls and carries only the url.
    setTransaction({ receiptUrl: 'https://example.com/r0.png' } as Partial<Transaction>);
    expect(fixture.nativeElement.querySelector('.receipt-count-badge')).toBeNull();

    setTransaction({});
    expect(fixture.nativeElement.querySelector('.receipt-count-badge')).toBeNull();
  });

  it('emits activate on click and keyboard activation', () => {
    setTransaction({});
    const emitted: Transaction[] = [];
    component.activate.subscribe((t: Transaction) => emitted.push(t));

    const row: HTMLElement = fixture.nativeElement.querySelector('.transaction-row');
    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(emitted.length).toBe(2);
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('tabindex')).toBe('0');
  });
});
