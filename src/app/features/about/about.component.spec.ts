import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Capacitor } from '@capacitor/core';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { AboutComponent } from './about.component';
import { FeedbackDialogComponent } from './feedback-dialog/feedback-dialog.component';
import { AuthService } from '../../core/services/auth.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { FeedbackService } from '../../core/services/feedback.service';
import { TranslationService } from '../../core/services/translation.service';
import { FeedbackEntry } from '../../models';
import packageJson from '../../../../package.json';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockFeedback: jasmine.SpyObj<FeedbackService>;

  beforeEach(async () => {
    const translation = jasmine.createSpyObj<TranslationService>('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);

    mockDialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    mockFeedback = jasmine.createSpyObj<FeedbackService>('FeedbackService', [
      'watchOwn',
      'delete',
    ]);
    mockFeedback.watchOwn.and.returnValue(of([]));
    mockFeedback.delete.and.resolveTo();
    const dateFormat = jasmine.createSpyObj<DateFormatService>('DateFormatService', ['formatDate']);
    dateFormat.formatDate.and.returnValue('2026-08-15');

    await TestBed.configureTestingModule({
      imports: [AboutComponent, NoopAnimationsModule],
      providers: [
        { provide: TranslationService, useValue: translation },
        { provide: MatDialog, useValue: mockDialog },
        { provide: FeedbackService, useValue: mockFeedback },
        { provide: DateFormatService, useValue: dateFormat },
        { provide: AuthService, useValue: { userId: () => 'user-1' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutComponent);
    component = fixture.componentInstance;
  });

  it('should create with version metadata', () => {
    expect(component).toBeTruthy();
    expect(component.appVersion).toBe(packageJson.version);
    expect(component.currentYear).toBe(new Date().getFullYear());
  });

  it('derives the Built With Angular version from the installed dependency', () => {
    const expectedMajor = parseInt(
      packageJson.dependencies['@angular/core'].replace(/^[^\d]*/, ''),
      10
    );
    expect(component.angularMajorVersion).toBe(expectedMajor);
    expect(component.angularMajorVersion).toBeGreaterThanOrEqual(22);
  });

  it('shows the real launcher icon in the app info card', () => {
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector('.app-icon img') as HTMLImageElement;
    expect(icon).toBeTruthy();
    expect(icon.getAttribute('src')).toBe('assets/icons/icon-128x128.png');
  });

  it('shows the donate section on web', () => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
    fixture = TestBed.createComponent(AboutComponent);
    expect(fixture.componentInstance.showDonateSection()).toBeTrue();
  });

  it('hides the donate section on native platforms', () => {
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    fixture = TestBed.createComponent(AboutComponent);
    expect(fixture.componentInstance.showDonateSection()).toBeFalse();
  });

  it('openDonateLink opens a configured url in a new tab', () => {
    const openSpy = spyOn(window, 'open');
    component.donationUrl = 'https://example.com/donate';
    component.openDonateLink();
    expect(openSpy).toHaveBeenCalledWith('https://example.com/donate', '_blank');
  });

  it('openDonateLink does nothing when no url is configured', () => {
    const openSpy = spyOn(window, 'open');
    component.donationUrl = '';
    component.openDonateLink();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('renders the feedback card with its open button', () => {
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.feedback-card');
    expect(card).toBeTruthy();
    expect(card.querySelector('.feedback-button')).toBeTruthy();
  });

  it('opens the feedback dialog from the card button', () => {
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.feedback-button') as HTMLButtonElement).click();
    expect(mockDialog.open).toHaveBeenCalledWith(FeedbackDialogComponent);
  });

  it('shows the empty note when nothing was sent', () => {
    fixture.detectChanges();
    const note = fixture.nativeElement.querySelector('.feedback-note');
    expect(note?.textContent).toContain('about.feedback.historyEmpty');
  });

  it('lists sent entries with their category and message', () => {
    const entry: FeedbackEntry = {
      id: 'f1',
      userId: 'user-1',
      category: 'idea',
      message: 'a widget would be nice',
      appVersion: packageJson.version,
      platform: 'web',
      locale: 'en',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    mockFeedback.watchOwn.and.returnValue(of([entry]));

    fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.feedback-item');
    expect(item).toBeTruthy();
    expect(item.querySelector('.feedback-item-category')?.textContent)
      .toContain('about.feedback.categoryIdea');
    expect(item.querySelector('.feedback-item-message')?.textContent)
      .toContain('a widget would be nice');
    expect(item.querySelector('.feedback-item-date')?.textContent).toContain('2026-08-15');
  });

  /**
   * The rules always permitted an owner delete; the list never offered one
   * (#306, ADR 0056).
   */
  describe('deleting an entry', () => {
    const entry: FeedbackEntry = {
      id: 'f1',
      userId: 'user-1',
      category: 'bug',
      message: 'the chart is upside down',
      appVersion: packageJson.version,
      platform: 'web',
      locale: 'en',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    function renderWithEntry(): void {
      mockFeedback.watchOwn.and.returnValue(of([entry]));
      fixture = TestBed.createComponent(AboutComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    }

    function answerConfirm(confirmed: boolean): void {
      mockDialog.open.and.returnValue({
        afterClosed: () => of(confirmed),
      } as ReturnType<MatDialog['open']>);
    }

    it('offers a delete control on every row', () => {
      renderWithEntry();

      const button = fixture.nativeElement.querySelector('.feedback-item-delete');
      expect(button).toBeTruthy();
      expect(button.getAttribute('aria-label')).toBe('about.feedback.deleteLabel');
    });

    it('deletes the entry once the confirm is accepted', () => {
      renderWithEntry();
      answerConfirm(true);

      (fixture.nativeElement.querySelector('.feedback-item-delete') as HTMLElement).click();

      expect(mockFeedback.delete).toHaveBeenCalledWith('f1');
    });

    it('leaves the entry alone when the confirm is cancelled', () => {
      renderWithEntry();
      answerConfirm(false);

      (fixture.nativeElement.querySelector('.feedback-item-delete') as HTMLElement).click();

      expect(mockFeedback.delete).not.toHaveBeenCalled();
    });

    // The operator was mailed a copy on create and it is not recalled, so
    // the confirm has to say so rather than read like an unsend.
    it('tells the user the sent mail is not recalled', () => {
      renderWithEntry();
      answerConfirm(false);

      (fixture.nativeElement.querySelector('.feedback-item-delete') as HTMLElement).click();

      const data = mockDialog.open.calls.mostRecent().args[1]?.data as { message: string };
      expect(data.message).toBe('about.feedback.deleteMessage');
    });
  });
});
