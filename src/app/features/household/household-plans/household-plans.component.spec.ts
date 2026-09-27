import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { HouseholdPlansComponent } from './household-plans.component';
import { FirestoreService } from '../../../core/services/firestore.service';
import { TranslationService } from '../../../core/services/translation.service';
import { createTranslationStub } from '../../../core/services/testing';

// Rendered (ADR 0144): what the section says, and that it says it inside
// the section at a phone's width, is the thing under test.
describe('HouseholdPlansComponent', () => {
  let fixture: ComponentFixture<HouseholdPlansComponent>;
  let firestore: jasmine.SpyObj<FirestoreService>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    // Anything the section read would go through here.
    firestore = jasmine.createSpyObj<FirestoreService>('FirestoreService', [
      'subscribeToCollection',
      'subscribeToCollectionWithMetadata',
      'getCollection',
      'getDocument'
    ]);

    await TestBed.configureTestingModule({
      imports: [HouseholdPlansComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FirestoreService, useValue: firestore },
        { provide: TranslationService, useValue: createTranslationStub() }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdPlansComponent);
    fixture.detectChanges();
  });

  it('says the household has no budgets or goals, under its own heading', () => {
    const heading = element().querySelector('h2');

    expect(heading?.id).toBe('household-plans-title');
    expect(heading?.textContent).toContain('household.plans.title');
    expect(element().querySelector('section')?.getAttribute('aria-labelledby')).toBe('household-plans-title');
    expect(element().querySelector('.plans-empty')?.textContent?.trim()).toBe('household.plans.empty');
  });

  it("shows no member's budgets or goals, reads nothing, and holds no control", () => {
    expect(element().querySelector('app-budget-progress-card, app-goal-progress-card, app-member-chip')).toBeNull();
    expect(element().querySelectorAll('button, a, [tabindex]').length).toBe(0);
    expect(firestore.subscribeToCollection).not.toHaveBeenCalled();
    expect(firestore.subscribeToCollectionWithMetadata).not.toHaveBeenCalled();
    expect(firestore.getCollection).not.toHaveBeenCalled();
    expect(firestore.getDocument).not.toHaveBeenCalled();
  });

  describe('at a phone width', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = fixture.nativeElement as HTMLElement;
      // 375px less the app shell's 16px gutters and the page's 16px gutters.
      host.style.width = '311px';
      // Karma serves none of the app's fonts, so each platform measures in its
      // own fallback. The Linux runner's is DejaVu Sans, which Verdana matches
      // to within a few pixels. Material takes its face from the --mat-sys
      // tokens rather than from the host.
      const face = "Verdana, 'DejaVu Sans', sans-serif";
      host.style.fontFamily = face;
      for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
        host.style.setProperty(token, face);
      }
      document.body.appendChild(host);
    });

    afterEach(() => host.remove());

    it('keeps the heading and the note inside the section', () => {
      const translation = TestBed.inject(TranslationService) as unknown as ReturnType<typeof createTranslationStub>;
      // Longer than any locale's copy, as one unbroken word.
      translation.t = key => (key === 'household.plans.empty' ? 'N'.repeat(120) : key);
      translation.translationsVersion.update(version => version + 1);
      fixture.detectChanges();

      const section = (element().querySelector('.plans') as HTMLElement).getBoundingClientRect();
      const parts = Array.from(element().querySelectorAll<HTMLElement>('.plans-title, .plans-empty'));
      expect(parts.length).toBe(2);
      expect(element().querySelector('.plans-empty')?.textContent).toContain('N'.repeat(120));
      for (const part of parts) {
        const label = part.className;
        expect(part.scrollWidth).withContext(`nothing overflows ${label}`).toBeLessThanOrEqual(part.clientWidth);
        const rect = part.getBoundingClientRect();
        expect(rect.left).withContext(`${label} starts inside`).toBeGreaterThanOrEqual(section.left - 0.5);
        expect(rect.right).withContext(`${label} ends inside`).toBeLessThanOrEqual(section.right + 0.5);
      }
    });
  });
});
