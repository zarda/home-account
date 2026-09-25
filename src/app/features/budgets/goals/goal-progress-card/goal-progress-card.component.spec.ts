import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';

import { GoalProgressCardComponent } from './goal-progress-card.component';
import { CurrencyService } from '../../../../core/services/currency.service';
import { Goal } from '../../../../models';
import { TranslationService } from '../../../../core/services/translation.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { createTranslationStub, createLocaleFormatStub } from '../../../../core/services/testing';

function goalOf(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'user123',
    kind: 'saving',
    name: 'Emergency fund',
    targetAmount: 3000,
    contributedAmount: 750,
    currency: 'USD',
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  };
}

describe('GoalProgressCardComponent', () => {
  let fixture: ComponentFixture<GoalProgressCardComponent>;
  let component: GoalProgressCardComponent;

  function goal(overrides: Partial<Goal> = {}): Goal {
    return {
      id: 'g1',
      userId: 'user123',
      kind: 'saving',
      name: 'Emergency fund',
      targetAmount: 3000,
      contributedAmount: 750,
      currency: 'USD',
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides
    };
  }

  beforeEach(async () => {
    const mockCurrency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrency.formatCurrency.and.callFake(
      (amount: number, code: string) => `${code} ${amount}`
    );

    await TestBed.configureTestingModule({
      imports: [GoalProgressCardComponent, NoopAnimationsModule],
      providers: [{ provide: CurrencyService, useValue: mockCurrency }],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(GoalProgressCardComponent, { set: { template: '<div></div>' } })
      .compileComponents();

    fixture = TestBed.createComponent(GoalProgressCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('goal', goal());
    fixture.detectChanges();
  });

  it('computes percentage, capped bar value, and remaining', () => {
    expect(component.percentage()).toBe(25);
    expect(component.barValue()).toBe(25);
    expect(component.remaining()).toBe(2250);
    expect(component.reached()).toBeFalse();
  });

  it('caps the bar at 100 but keeps the true percentage', () => {
    fixture.componentRef.setInput('goal', goal({ contributedAmount: 4500 }));
    fixture.detectChanges();

    expect(component.percentage()).toBe(150);
    expect(component.barValue()).toBe(100);
    expect(component.remaining()).toBe(0);
    expect(component.reached()).toBeTrue();
  });

  it('reads progress as manual plus linked, on every figure at once', () => {
    // 750 manual + 750 linked = 1500 of 3000: the percentage, the remaining
    // amount and the reached flag must all see the same total.
    fixture.componentRef.setInput('goal', goal({ linkedAmount: 750 }));
    fixture.detectChanges();

    expect(component.progressAmount()).toBe(1500);
    expect(component.percentage()).toBe(50);
    expect(component.remaining()).toBe(1500);
    expect(component.reached()).toBeFalse();
  });

  it('reaches the target on linked money alone', () => {
    fixture.componentRef.setInput('goal', goal({ contributedAmount: 0, linkedAmount: 3000 }));
    fixture.detectChanges();

    expect(component.reached()).toBeTrue();
    expect(component.remaining()).toBe(0);
  });

  it('exposes the linked share only when there is one', () => {
    expect(component.linkedAmount()).toBe(0); // pre-link document

    fixture.componentRef.setInput('goal', goal({ linkedAmount: 120 }));
    fixture.detectChanges();
    expect(component.linkedAmount()).toBe(120);
  });

  it('counts checked items for a project', () => {
    fixture.componentRef.setInput(
      'goal',
      goal({
        kind: 'project',
        items: [
          { name: 'Flights', amount: 800, done: true },
          { name: 'Hotel', amount: 1200, done: false }
        ]
      })
    );
    fixture.detectChanges();

    expect(component.doneCount()).toBe(1);
    expect(component.kindIcon()).toBe('flag');
  });

  it('emits viewTransactions when the button is activated', () => {
    let emitted = 0;
    component.viewTransactions.subscribe(() => emitted++);

    component.viewTransactions.emit();

    expect(emitted).toBe(1);
  });

  it('emits toggleItem with the item position and next state', () => {
    const emitted: { index: number; done: boolean }[] = [];
    component.toggleItem.subscribe(event => emitted.push(event));

    component.onItemToggled(1, true);

    expect(emitted).toEqual([{ index: 1, done: true }]);
  });
});

/**
 * The cases above override the template to `<div></div>`, so they prove the
 * computeds and nothing else: the four `@if` gates on the card (the target
 * date, the linked breakdown, the reached note, the checklist), the
 * "View transactions" button that only exists once linked money arrives, and
 * the five outputs each control emits are all unproven by them. This is the
 * card as a user meets it.
 */
describe('GoalProgressCardComponent, through its own template', () => {
  let fixture: ComponentFixture<GoalProgressCardComponent>;
  let component: GoalProgressCardComponent;

  function card(overrides: Partial<Goal> = {}): void {
    fixture.componentRef.setInput('goal', goalOf(overrides));
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (selector: string) => el().querySelector(selector)?.textContent?.trim() ?? null;
  const button = (label: string): HTMLButtonElement | undefined =>
    (Array.from(el().querySelectorAll('button')) as HTMLButtonElement[]).find(b =>
      (b.textContent ?? '').includes(label)
    );

  beforeEach(async () => {
    const mockCurrency = jasmine.createSpyObj('CurrencyService', ['formatCurrency']);
    mockCurrency.formatCurrency.and.callFake((amount: number, code: string) => `${code} ${amount}`);

    await TestBed.configureTestingModule({
      imports: [GoalProgressCardComponent, NoopAnimationsModule],
      providers: [
        { provide: CurrencyService, useValue: mockCurrency },
        { provide: TranslationService, useValue: createTranslationStub() },
        { provide: LocaleFormatService, useValue: createLocaleFormatStub() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GoalProgressCardComponent);
    component = fixture.componentInstance;
  });

  it('reads the goal on one line: contributed, target and percentage', () => {
    card();

    expect(text('.goal-name')).toBe('Emergency fund');
    expect(text('.contributed')).toBe('USD 750');
    expect(text('.target')).toBe('/ USD 3000');
    expect(text('.percentage')).toBe('25%');
    expect(text('.kind-icon')).toBe('savings');
  });

  it('carries a project goal\'s own icon', () => {
    card({ kind: 'project' });

    expect(text('.kind-icon')).toBe('flag');
  });

  it('shows the remaining amount until the goal is reached, then the note', () => {
    card();
    expect(text('.status')).toBe('goal.remaining:{"amount":"USD 2250"}');
    expect(el().querySelector('.reached-note')).toBeNull();
    expect(el().querySelector('.goal-card')?.classList).not.toContain('reached');

    card({ contributedAmount: 3000 });
    expect(text('.reached-note')).toContain('goal.reached');
    expect(el().querySelector('.goal-card')?.classList).toContain('reached');
  });

  it('clamps the bar while the number keeps the overshoot', () => {
    card({ contributedAmount: 4500 });

    const bar = el().querySelector('mat-progress-bar') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(text('.percentage')).toBe('150%');
  });

  it("names the progress bar with the goal's own name and percentage", () => {
    card();

    const bar = el().querySelector('mat-progress-bar') as HTMLElement;
    expect(bar.getAttribute('aria-label')).toBe('goals.progressLabel:{"name":"Emergency fund","percent":25}');
  });

  it('names the linked share and offers its transactions only once linked money exists', () => {
    card();
    expect(el().querySelector('.linked-breakdown')).toBeNull();
    expect(button('goal.viewTransactions')).toBeUndefined();

    card({ linkedAmount: 750 });
    expect(text('.linked-breakdown')).toBe(
      'goal.linkedBreakdown:{"manual":"USD 750","linked":"USD 750"}'
    );
    expect(button('goal.viewTransactions')).toBeDefined();
  });

  it('shows the target date only when the goal carries one', () => {
    card();
    expect(el().querySelector('.goal-date')).toBeNull();

    card({ targetDate: Timestamp.fromDate(new Date('2026-12-01T00:00:00Z')) });
    expect(text('.goal-date')).toContain('2026-12-01');
  });

  it('renders the checklist and reports its done count', () => {
    card({
      items: [
        { name: 'Deposit', amount: 100, done: true },
        { name: 'Transfer', amount: 200, done: false }
      ]
    });

    expect(text('.items-count')).toBe('goal.itemsDone:{"done":1,"total":2}');
    expect(
      Array.from(el().querySelectorAll('.item-label')).map(n => n.textContent?.trim())
    ).toEqual(['Deposit', 'Transfer']);
    expect(el().querySelectorAll('.item-label.done').length).toBe(1);
  });

  it('emits the item index and its new state when a checkbox is ticked', () => {
    const emitted: { index: number; done: boolean }[] = [];
    component.toggleItem.subscribe(e => emitted.push(e));
    card({
      items: [
        { name: 'Deposit', amount: 100, done: false },
        { name: 'Transfer', amount: 200, done: false }
      ]
    });

    const second = el().querySelectorAll('mat-checkbox input')[1] as HTMLInputElement;
    second.click();
    fixture.detectChanges();

    expect(emitted).toEqual([{ index: 1, done: true }]);
  });

  it('emits edit, delete and contribute from their own controls', () => {
    const seen: string[] = [];
    component.edit.subscribe(() => seen.push('edit'));
    component.delete.subscribe(() => seen.push('delete'));
    component.contribute.subscribe(() => seen.push('contribute'));
    card();

    (el().querySelector('[aria-label="common.edit"]') as HTMLButtonElement).click();
    (el().querySelector('[aria-label="common.delete"]') as HTMLButtonElement).click();
    button('goal.contribute')?.click();

    expect(seen).toEqual(['edit', 'delete', 'contribute']);
  });

  it('shows the note only when the goal carries one', () => {
    card();
    expect(el().querySelector('.goal-note')).toBeNull();

    card({ note: 'Three months of expenses' });
    expect(text('.goal-note')).toBe('Three months of expenses');
  });
});
