import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { DialogHeaderComponent } from './dialog-header.component';
import { TranslationService } from '../../../core/services/translation.service';

describe('DialogHeaderComponent', () => {
  let fixture: ComponentFixture<DialogHeaderComponent>;
  let component: DialogHeaderComponent;

  const el = (selector: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => `t:${key}`);

    await TestBed.configureTestingModule({
      imports: [DialogHeaderComponent],
      providers: [
        { provide: TranslationService, useValue: translation },
        // The header renders mat-dialog-title, which needs a dialog ref.
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogHeaderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('titleKey', 'budget.createBudget');
    fixture.detectChanges();
  });

  it('renders the translated title', () => {
    expect(el('.dialog-header-text')!.textContent).toContain('t:budget.createBudget');
  });

  it('omits the icon unless one is given', () => {
    expect(el('.dialog-header-icon')).toBeNull();

    fixture.componentRef.setInput('icon', 'download');
    fixture.detectChanges();
    expect(el('.dialog-header-icon')!.textContent).toContain('download');
  });

  it('gives the close button an aria-label', () => {
    expect(el('.dialog-header-close')!.getAttribute('aria-label')).toBe('t:common.close');
  });

  it('emits closed when the close button is pressed', () => {
    let count = 0;
    component.closed.subscribe(() => count++);

    el('.dialog-header-close')!.click();
    expect(count).toBe(1);
  });
});
