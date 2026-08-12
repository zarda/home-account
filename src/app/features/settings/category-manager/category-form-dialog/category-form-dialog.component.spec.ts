import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { CategoryFormDialogComponent } from './category-form-dialog.component';
import { TranslationService } from '../../../../core/services/translation.service';
import { Category } from '../../../../models';

describe('CategoryFormDialogComponent', () => {
  let fixture: ComponentFixture<CategoryFormDialogComponent>;
  let component: CategoryFormDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CategoryFormDialogComponent>>;

  // Sentinels rather than the English catalog text: if the template ever goes
  // back to hard-coding "Category Name", asserting the sentinel fails, where
  // asserting the English string would keep passing for the wrong reason.
  const translations: Record<string, string> = {
    'settings.categoryName': 'name-label-t',
    'settings.categoryNamePlaceholder': 'name-placeholder-t',
    'settings.icon': 'icon-label-t',
    'settings.color': 'color-label-t',
    'settings.preview': 'preview-label-t',
    'settings.saveChanges': 'save-changes-t',
    'settings.createCategory': 'create-category-t',
    'settings.iconSelection': 'icon-group-t',
    'settings.colorSelection': 'color-group-t',
    'common.cancel': 'cancel-t',
  };

  async function setup(data: { category?: Category; type: 'expense' | 'income' }): Promise<void> {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const translationService = jasmine.createSpyObj('TranslationService', ['t']);
    translationService.t.and.callFake((key: string) => translations[key] ?? key);

    await TestBed.configureTestingModule({
      imports: [CategoryFormDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: TranslationService, useValue: translationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('translated rendering', () => {
    it('renders every label and section heading through the catalog', async () => {
      await setup({ type: 'expense' });
      const text = fixture.nativeElement.textContent;
      expect(text).toContain('name-label-t');
      expect(text).toContain('icon-label-t');
      expect(text).toContain('color-label-t');
      expect(text).toContain('preview-label-t');
      expect(text).toContain('cancel-t');
    });

    it('translates the name input placeholder', async () => {
      await setup({ type: 'expense' });
      const input = fixture.nativeElement.querySelector('input[matInput]') as HTMLInputElement;
      expect(input.getAttribute('placeholder')).toBe('name-placeholder-t');
    });

    it('gives both radiogroups translated aria-labels', async () => {
      await setup({ type: 'expense' });
      const groups = fixture.nativeElement.querySelectorAll('[role="radiogroup"]');
      const labels = Array.from(groups, (el: Element) => el.getAttribute('aria-label'));
      expect(labels).toEqual(['icon-group-t', 'color-group-t']);
    });

    it('falls back to the translated name label in the preview when the name is empty', async () => {
      await setup({ type: 'expense' });
      expect(
        (fixture.nativeElement.querySelector('.preview-name') as HTMLElement).textContent!.trim()
      ).toBe('name-label-t');
    });

    it('shows the typed name in the preview once there is one', async () => {
      await setup({ type: 'expense' });
      component.name = 'Coffee';
      fixture.detectChanges();
      expect(
        (fixture.nativeElement.querySelector('.preview-name') as HTMLElement).textContent!.trim()
      ).toBe('Coffee');
    });

    it('labels the submit button per mode: create', async () => {
      await setup({ type: 'expense' });
      expect(fixture.nativeElement.textContent).toContain('create-category-t');
      expect(fixture.nativeElement.textContent).not.toContain('save-changes-t');
    });

    it('labels the submit button per mode: edit', async () => {
      await setup({
        type: 'expense',
        category: { id: 'c1', name: 'Food', icon: 'restaurant', color: '#ef4444', type: 'expense' } as Category,
      });
      expect(fixture.nativeElement.textContent).toContain('save-changes-t');
    });
  });

  describe('save and cancel', () => {
    it('refuses to save a blank name', async () => {
      await setup({ type: 'expense' });
      component.name = '   ';
      component.save();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('closes with the trimmed name and the selected icon and color', async () => {
      await setup({ type: 'expense' });
      component.name = '  Coffee  ';
      component.selectIcon('local_cafe');
      component.selectColor('#f97316');
      component.save();
      expect(dialogRef.close).toHaveBeenCalledWith({
        name: 'Coffee',
        icon: 'local_cafe',
        color: '#f97316',
      });
    });

    it('cancel closes without a result', async () => {
      await setup({ type: 'expense' });
      component.cancel();
      expect(dialogRef.close).toHaveBeenCalledWith();
    });
  });
});
