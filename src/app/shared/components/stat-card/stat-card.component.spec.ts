import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatCardComponent } from './stat-card.component';

@Component({
  standalone: true,
  imports: [StatCardComponent],
  template: `
    <app-stat-card
      [label]="'Total Income'"
      [labelSuffix]="'USD'"
      [value]="'$1,234.00'"
      [icon]="'trending_up'"
      [tone]="'income'"
      [delta]="delta()"
      [deltaCaption]="'vs previous period'"
      [invertDelta]="invert()"
      [detail]="detail()"
      [detailTone]="'positive'"
    />
  `,
})
class HostComponent {
  delta = signal<number | null>(null);
  invert = signal(false);
  detail = signal('');
}

describe('StatCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = <T extends HTMLElement>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders label, suffix, value, and a toned icon tile', () => {
    expect(el('.stat-label')!.textContent).toContain('Total Income');
    expect(el('.stat-label-suffix')!.textContent).toContain('USD');
    expect(el('.stat-value')!.textContent).toContain('$1,234.00');
    expect(el('.stat-icon')!.classList).toContain('tone-income');
    expect(el('.stat-value')!.classList).toContain('tone-income');
  });

  it('hides delta chip and detail line by default', () => {
    expect(el('.delta-chip')).toBeNull();
    expect(el('.stat-detail')).toBeNull();
  });

  it('shows a positive tinted chip for a rise on a normal metric', () => {
    host.delta.set(12.34);
    fixture.detectChanges();

    const chip = el('.delta-chip')!;
    expect(chip.classList).toContain('positive');
    expect(chip.textContent).toContain('12.3%');
    expect(chip.textContent).toContain('arrow_upward');
    expect(el('.delta-caption')!.textContent).toContain('vs previous period');
  });

  it('inverts chip colors for metrics where a rise is bad', () => {
    host.delta.set(5);
    host.invert.set(true);
    fixture.detectChanges();
    expect(el('.delta-chip')!.classList).toContain('negative');

    host.delta.set(-5);
    fixture.detectChanges();
    expect(el('.delta-chip')!.classList).toContain('positive');
  });

  it('renders the toned detail line when provided', () => {
    host.detail.set('+$120.00');
    fixture.detectChanges();

    const detail = el('.stat-detail')!;
    expect(detail.textContent).toContain('+$120.00');
    expect(detail.classList).toContain('detail-positive');
  });
});
