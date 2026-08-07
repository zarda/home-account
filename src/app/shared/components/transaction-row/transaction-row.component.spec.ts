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

  it('renders up to three tag chips and folds the rest into +N', () => {
    setTransaction({ tags: ['a', 'b', 'c', 'd', 'e'] } as Partial<Transaction>);
    const chips = Array.from(
      fixture.nativeElement.querySelectorAll('.tag-chip')
    ).map(chip => (chip as HTMLElement).textContent?.trim());
    expect(chips).toEqual(['a', 'b', 'c', '+2']);

    setTransaction({ tags: ['solo'] } as Partial<Transaction>);
    expect(fixture.nativeElement.querySelectorAll('.tag-chip').length).toBe(1);

    setTransaction({});
    expect(fixture.nativeElement.querySelectorAll('.tag-chip').length).toBe(0);
  });

  it('links the location to a map only when coordinates exist', () => {
    setTransaction({
      location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 },
    } as Partial<Transaction>);
    const link = fixture.nativeElement.querySelector('.location-link') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.href).toBe('https://www.google.com/maps/search/?api=1&query=35.66,139.71');

    // A name-only location renders as plain text — a typed name must not
    // become a confidently wrong maps destination.
    setTransaction({ location: { name: 'Aoyama Market' } } as Partial<Transaction>);
    expect(fixture.nativeElement.querySelector('.location-link')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.location-chip')?.textContent
    ).toContain('Aoyama Market');

    setTransaction({});
    expect(fixture.nativeElement.querySelector('.location-chip')).toBeNull();
  });

  it('a maps link click does not activate the row', () => {
    setTransaction({
      location: { name: 'Aoyama Market', lat: 35.66, lng: 139.71 },
    } as Partial<Transaction>);
    const emitted: Transaction[] = [];
    component.activate.subscribe((t: Transaction) => emitted.push(t));

    const link = fixture.nativeElement.querySelector('.location-link') as HTMLAnchorElement;
    // Neuter navigation, keep propagation semantics.
    link.addEventListener('click', event => event.preventDefault());
    link.click();

    expect(emitted.length).toBe(0);
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

  it('pins the projected actions slot to the surface corner, out of the flow', () => {
    setTransaction({});

    // The slot is absolutely positioned against the surface, so wherever the
    // text stack reflows, the menu sits at the same corner of every row. The
    // old leading column bought that same property by stacking the menu under
    // the tile — at the price of setting every row's height (issue #219).
    expect(fixture.nativeElement.querySelector('.row-leading'))
      .withContext('leading column dismantled')
      .toBeNull();
    const actions = fixture.nativeElement.querySelector('.row-surface > .row-actions') as HTMLElement;
    expect(actions).withContext('actions slot on the surface').not.toBeNull();
    expect(getComputedStyle(actions).position).toBe('absolute');
    // Where it ends up on screen is measured in overflow-guard.spec.ts,
    // against the real cascade at a real width. This one is the structure the
    // guarantee rests on.
  });

  it('stacks description, strip, and meta line inside the body', () => {
    setTransaction({ currency: 'JPY', amount: 3800, amountInBaseCurrency: 25.42 } as Partial<Transaction>);

    const root: HTMLElement = fixture.nativeElement;
    const head = root.querySelector('.row-body > .row-head') as HTMLElement;
    const meta = root.querySelector('.row-body > .row-meta') as HTMLElement;
    expect(head).withContext('first line present').not.toBeNull();
    expect(meta).withContext('meta line present').not.toBeNull();
    expect(head.querySelector('.row-description')).withContext('description on line 1').not.toBeNull();
    expect(head.querySelector('.row-amount .amount')).withContext('amount on line 1').not.toBeNull();
    expect(root.querySelector('.row-body > .row-category')).withContext('strip is line 2').not.toBeNull();
    expect(meta.querySelector('.row-date')).withContext('date on the meta line').not.toBeNull();
    expect(meta.querySelector('.amount-converted'))
      .withContext('converted amount rides the meta line, not the amount stack')
      .not.toBeNull();

    setTransaction({ currency: 'USD', amount: 10 });
    expect(fixture.nativeElement.querySelector('.row-meta .amount-converted'))
      .withContext('no converted line for base-currency rows')
      .toBeNull();
  });

  it('opens the transaction on an ordinary click on the category strip', () => {
    setTransaction({});
    const emitted: Transaction[] = [];
    component.activate.subscribe((t) => emitted.push(t));

    const strip = fixture.nativeElement.querySelector('.row-category') as HTMLElement;
    const onText = new MouseEvent('click');
    Object.defineProperty(onText, 'target', { value: strip });
    Object.defineProperty(onText, 'offsetY', { value: 2 });

    component.onActivate(onText);
    expect(emitted.length).withContext('a click on the strip itself still opens the row').toBe(1);
  });

  it('ignores a click on the category strip scrollbar', () => {
    setTransaction({});
    const emitted: Transaction[] = [];
    component.activate.subscribe((t) => emitted.push(t));

    // `.row-category` scrolls horizontally, and on a platform with classic
    // scrollbars that scrollbar sits inside the row's hit area. Dragging it is
    // a scroll, not a tap, but the click still bubbles to the row — which
    // would open the editor under the reader's cursor. offsetY past the
    // content box is what identifies it.
    const strip = fixture.nativeElement.querySelector('.row-category') as HTMLElement;
    const onScrollbar = new MouseEvent('click');
    Object.defineProperty(onScrollbar, 'target', { value: strip });
    Object.defineProperty(onScrollbar, 'offsetY', { value: strip.clientHeight + 4 });

    component.onActivate(onScrollbar);
    expect(emitted.length).withContext('scrollbar click swallowed').toBe(0);
  });

  it('still activates on keyboard, which passes no event at all', () => {
    setTransaction({});
    const emitted: Transaction[] = [];
    component.activate.subscribe((t) => emitted.push(t));

    component.onActivate();
    expect(emitted.length).toBe(1);
  });

  it('collapses the trailing actions slot when nothing is projected into it', () => {
    setTransaction({});

    // The slot exists so this component can promise the overflow menu is
    // never squeezed out — projected content carries the *host's*
    // encapsulation attribute, so the guarantee cannot live in the caller's
    // stylesheet. The dashboard card projects nothing, and an empty pinned
    // box must not sit over the amount as a dead hover target — nor keep the
    // reserved corner alive, which the :not(:empty) reserve rules key off.
    const actions = fixture.nativeElement.querySelector('.row-actions') as HTMLElement;
    expect(actions).withContext('slot wrapper is present').not.toBeNull();
    expect(getComputedStyle(actions).display).toBe('none');
  });
});
