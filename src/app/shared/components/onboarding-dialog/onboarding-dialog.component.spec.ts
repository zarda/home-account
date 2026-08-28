import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef } from '@angular/material/dialog';

import { OnboardingDialogComponent } from './onboarding-dialog.component';
import { TranslationService } from '../../../core/services/translation.service';

describe('OnboardingDialogComponent', () => {
  let fixture: ComponentFixture<OnboardingDialogComponent>;
  let component: OnboardingDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<OnboardingDialogComponent>>;

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    // Echoes the params, the way command-palette.component.spec's fake does.
    // A fake that dropped them would pass whether or not the template passed
    // `{ current, total }` — and with nothing passed, production renders the
    // literal "Step {{current}} of {{total}}", which is exactly the string
    // these assertions exist to check.
    translationService.t.and.callFake((key: string, params?: Record<string, string | number>) =>
      params ? `${key} ${JSON.stringify(params)}` : key
    );

    await TestBed.configureTestingModule({
      imports: [OnboardingDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: TranslationService, useValue: translationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens on the welcome step', () => {
    expect(component.step()).toBe(0);
    expect(component.isFirstStep()).toBeTrue();
    expect(component.isLastStep()).toBeFalse();
  });

  it('walks forward to the last step and stops there', () => {
    component.next();
    expect(component.step()).toBe(1);

    component.next();
    expect(component.step()).toBe(2);
    expect(component.isLastStep()).toBeTrue();

    component.next();
    expect(component.step()).toBe(2);
  });

  it('walks back to the first step and stops there', () => {
    component.next();
    component.next();

    component.back();
    expect(component.step()).toBe(1);

    component.back();
    expect(component.step()).toBe(0);

    component.back();
    expect(component.step()).toBe(0);
  });

  it('offers a skip only while there is something left to read', () => {
    expect(component.canSkip()).toBeTrue();
    component.next();
    expect(component.canSkip()).toBeTrue();
    component.next();
    expect(component.canSkip()).toBeFalse();
  });

  it('closes with no result when skipped', () => {
    component.skip();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });

  it('closes with no result when finished', () => {
    component.done();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });

  it('closes asking for an add-transaction flow', () => {
    component.addFirst();
    expect(dialogRef.close).toHaveBeenCalledWith('add');
  });

  it('closes asking for a receipt scan', () => {
    component.scanFirst();
    expect(dialogRef.close).toHaveBeenCalledWith('scan');
  });

  it('renders one pane at a time', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.onboarding-pane').length).toBe(1);
  });

  /**
   * The step indicator is a live region, not a labelled span. A bare <span>
   * is `generic`, whose name from author is prohibited, so the old
   * aria-label could be dropped outright; and advancing a pane swapped the
   * content while focus stayed on Next, which was silent to a screen reader.
   * role="status" is an implicit polite live region and permits a name, so
   * one attribute answers both.
   */
  it('announces the localized step count from a status region', () => {
    const element: HTMLElement = fixture.nativeElement;
    const indicator = element.querySelector('.step-indicator');

    expect(indicator?.getAttribute('role')).toBe('status');
    expect(indicator?.hasAttribute('aria-label')).toBeFalse();

    // What is read is the translated sentence, with the step numbers in it —
    // not the raw glyph, and not an un-interpolated key.
    expect(indicator?.querySelector('.sr-only')?.textContent?.trim()).toBe(
      'onboarding.stepOf {"current":1,"total":3}'
    );

    // The glyph is the visual half, kept out of the reading so the same fact
    // is not announced twice.
    const glyph = indicator?.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent?.trim()).toBe('1/3');
  });

  it('re-announces the step count when the pane advances', () => {
    const element: HTMLElement = fixture.nativeElement;

    component.next();
    fixture.detectChanges();

    const indicator = element.querySelector('.step-indicator');
    expect(indicator?.querySelector('.sr-only')?.textContent?.trim()).toBe(
      'onboarding.stepOf {"current":2,"total":3}'
    );
    expect(indicator?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('2/3');
  });

  it('exposes both starting actions only on the last step', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.start-add')).toBeNull();

    component.next();
    component.next();
    fixture.detectChanges();

    expect(element.querySelector('.start-add')).not.toBeNull();
    expect(element.querySelector('.start-scan')).not.toBeNull();
  });
});
