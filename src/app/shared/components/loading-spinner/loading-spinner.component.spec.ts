import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { LoadingSpinnerComponent } from './loading-spinner.component';

describe('LoadingSpinnerComponent', () => {
  let component: LoadingSpinnerComponent;
  let fixture: ComponentFixture<LoadingSpinnerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingSpinnerComponent, NoopAnimationsModule],
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
});
