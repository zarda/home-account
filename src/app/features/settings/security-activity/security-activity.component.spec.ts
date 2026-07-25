import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

import { SecurityActivityComponent } from './security-activity.component';
import { SecurityLogService } from '../../../core/services/security-log.service';
import { AuthService } from '../../../core/services/auth.service';
import { DateFormatService } from '../../../core/services/date-format.service';
import { TranslationService } from '../../../core/services/translation.service';
import { SecurityEvent } from '../../../models';

describe('SecurityActivityComponent', () => {
  let component: SecurityActivityComponent;
  let fixture: ComponentFixture<SecurityActivityComponent>;
  let mockSecurityLog: jasmine.SpyObj<SecurityLogService>;
  let mockAuth: jasmine.SpyObj<AuthService>;
  let mockDateFormat: jasmine.SpyObj<DateFormatService>;
  let mockTranslation: jasmine.SpyObj<TranslationService>;

  const event = (overrides: Partial<SecurityEvent> = {}): SecurityEvent => ({
    id: 'event-1',
    userId: 'user-1',
    type: 'signIn',
    occurredAt: Timestamp.fromDate(new Date('2026-07-20T09:30:00Z')),
    platform: 'web',
    ...overrides,
  });

  async function setup(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [SecurityActivityComponent],
      providers: [
        { provide: SecurityLogService, useValue: mockSecurityLog },
        { provide: AuthService, useValue: mockAuth },
        { provide: DateFormatService, useValue: mockDateFormat },
        { provide: TranslationService, useValue: mockTranslation },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(SecurityActivityComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => {
    mockSecurityLog = jasmine.createSpyObj('SecurityLogService', ['watchRecent']);
    mockSecurityLog.watchRecent.and.returnValue(of([]));

    mockAuth = jasmine.createSpyObj('AuthService', [], { userId: signal('user-1') });

    mockDateFormat = jasmine.createSpyObj('DateFormatService', ['formatDate', 'formatRelativeDate']);
    mockDateFormat.formatRelativeDate.and.returnValue('Yesterday');
    mockDateFormat.formatDate.and.returnValue('07/20/2026');

    mockTranslation = jasmine.createSpyObj('TranslationService', ['t', 'getIntlLocale']);
    mockTranslation.getIntlLocale.and.returnValue('en-US');
    mockTranslation.t.and.callFake(
      (key: string, params?: Record<string, string | number>) =>
        params ? `${key}:${params['date']}:${params['time']}` : key
    );
  });

  it('creates', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('subscribes to the signed-in user log', async () => {
    await setup();
    fixture.detectChanges();

    expect(mockSecurityLog.watchRecent).toHaveBeenCalledWith('user-1');
  });

  it('shows the loaded entries', async () => {
    mockSecurityLog.watchRecent.and.returnValue(of([event(), event({ id: 'event-2' })]));
    await setup();
    fixture.detectChanges();

    expect(component.events().length).toBe(2);
    expect(component.isLoading()).toBe(false);
    expect(component.hasError()).toBe(false);
  });

  it('reports a failed read instead of spinning forever', async () => {
    mockSecurityLog.watchRecent.and.returnValue(throwError(() => new Error('permission-denied')));
    await setup();
    fixture.detectChanges();

    expect(component.hasError()).toBe(true);
    expect(component.isLoading()).toBe(false);
  });

  it('stops listening when destroyed', async () => {
    const stream = new Subject<SecurityEvent[]>();
    mockSecurityLog.watchRecent.and.returnValue(stream.asObservable());
    await setup();
    fixture.detectChanges();

    expect(stream.observed).toBe(true);
    fixture.destroy();
    expect(stream.observed).toBe(false);
  });

  describe('formatting', () => {
    beforeEach(async () => {
      await setup();
      fixture.detectChanges();
    });

    it('joins the relative day and clock time through a translated pattern', () => {
      const label = component.formatWhen(event());

      expect(mockDateFormat.formatRelativeDate).toHaveBeenCalled();
      expect(label.startsWith('settings.activityAt:Yesterday:')).toBe(true);
    });

    it('exposes the absolute date for the tooltip', () => {
      expect(component.absoluteWhen(event())).toBe('07/20/2026');
    });

    it('maps known platforms to their labels', () => {
      expect(component.platformLabelKey('web')).toBe('settings.platformWeb');
      expect(component.platformLabelKey('ios')).toBe('settings.platformIos');
      expect(component.platformLabelKey('android')).toBe('settings.platformAndroid');
    });

    it('falls back for a platform it does not know', () => {
      expect(component.platformLabelKey('windows')).toBe('settings.platformUnknown');
    });
  });
});
