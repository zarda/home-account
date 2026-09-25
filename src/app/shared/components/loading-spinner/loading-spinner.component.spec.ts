import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { LoadingSpinnerComponent } from './loading-spinner.component';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing';

describe('LoadingSpinnerComponent', () => {
  let component: LoadingSpinnerComponent;
  let fixture: ComponentFixture<LoadingSpinnerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingSpinnerComponent, NoopAnimationsModule],
      providers: [{ provide: TranslationService, useValue: createTranslationStub() }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadingSpinnerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('maps the small size to a compact diameter/stroke', () => {
    component.size = 'sm';
    expect(component.diameter).toBe(24);
    expect(component.strokeWidth).toBe(2);
  });

  it('maps the large size to a wide diameter/stroke', () => {
    component.size = 'lg';
    expect(component.diameter).toBe(64);
    expect(component.strokeWidth).toBe(5);
  });

  it('defaults to the medium diameter/stroke', () => {
    expect(component.diameter).toBe(40);
    expect(component.strokeWidth).toBe(4);
  });

  // role="progressbar" (Material's own host role) carries no accessible name
  // of its own; this is the one site that names it for every caller at once.
  it("names the spinner from its own message, so the caller's copy is what a screen reader hears", () => {
    fixture.componentRef.setInput('message', 'settings.testApiKey');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mat-spinner').getAttribute('aria-label')).toBe(
      'settings.testApiKey'
    );
  });

  it('falls back to the generic loading label when no message is given', () => {
    expect(fixture.nativeElement.querySelector('mat-spinner').getAttribute('aria-label')).toBe(
      'common.loading'
    );
  });
});
