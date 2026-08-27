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
    translationService.t.and.callFake((key: string) => key);

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

  it('renders one pane at a time and labels the step count for a screen reader', () => {
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.onboarding-pane').length).toBe(1);

    const indicator = element.querySelector('.step-indicator');
    expect(indicator?.getAttribute('aria-label')).toBe('onboarding.stepOf');
    expect(indicator?.textContent?.trim()).toBe('1/3');

    component.next();
    fixture.detectChanges();
    expect(element.querySelector('.step-indicator')?.textContent?.trim()).toBe('2/3');
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
