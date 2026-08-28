import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Timestamp } from '@angular/fire/firestore';

import { ImportHistoryComponent } from './import-history.component';
import { ImportHistoryService } from '../../../../core/services/import-history.service';
import { TranslationService } from '../../../../core/services/translation.service';
import { AnnouncerService } from '../../../../core/services/announcer.service';
import { LocaleFormatService } from '../../../../core/services/locale-format.service';
import { ImportHistory } from '../../../../models';
import { NotificationService } from '../../../../core/services/notification.service';

describe('ImportHistoryComponent', () => {
  let component: ImportHistoryComponent;
  let fixture: ComponentFixture<ImportHistoryComponent>;
  let mockImportHistoryService: jasmine.SpyObj<ImportHistoryService>;
  let notifications: jasmine.SpyObj<NotificationService>;
  let mockTranslationService: jasmine.SpyObj<TranslationService>;
  let mockSnackBar: jasmine.SpyObj<MatSnackBar>;
  let mockAnnouncer: jasmine.SpyObj<AnnouncerService>;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let mockRouter: jasmine.SpyObj<Router>;

  const mockTimestamp = {
    seconds: 1704067200, // 2024-01-01 00:00:00 UTC
    nanoseconds: 0,
    toDate: () => new Date(1704067200 * 1000)
  } as Timestamp;

  const mockHistory: ImportHistory[] = [
    {
      id: 'import1',
      userId: 'user1',
      importedAt: mockTimestamp,
      source: 'csv',
      fileType: 'generic_csv',
      fileName: 'transactions.csv',
      fileSize: 2048,
      transactionCount: 10,
      successCount: 10,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 5000,
      totalExpenses: 1000,
      duplicatesSkipped: 0,
      status: 'completed'
    },
    {
      id: 'import2',
      userId: 'user1',
      importedAt: mockTimestamp,
      source: 'image',
      fileType: 'receipt_image',
      fileName: 'receipt.jpg',
      fileSize: 512000,
      transactionCount: 1,
      successCount: 1,
      skippedCount: 0,
      errorCount: 0,
      totalIncome: 0,
      totalExpenses: 50,
      duplicatesSkipped: 0,
      status: 'completed',
      door: 'camera', engine: 'cloud', fellBackFrom: 'native', provider: 'gemini', durationMs: 4321,
    }
  ];

  beforeEach(async () => {
    mockImportHistoryService = jasmine.createSpyObj('ImportHistoryService', [
      'getImportHistory',
      'deleteImportHistory',
      'clearImportHistory'
    ]);
    mockImportHistoryService.getImportHistory.and.returnValue(of(mockHistory));
    mockImportHistoryService.deleteImportHistory.and.returnValue(Promise.resolve());
    mockImportHistoryService.clearImportHistory.and.returnValue(Promise.resolve());

    mockTranslationService = jasmine.createSpyObj('TranslationService', ['t']);
    notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);
    mockTranslationService.t.and.callFake((key: string) => key);

    mockSnackBar = jasmine.createSpyObj('MatSnackBar', ['open']);
    mockAnnouncer = jasmine.createSpyObj('AnnouncerService', ['announce']);
    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [ImportHistoryComponent, NoopAnimationsModule],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: ImportHistoryService, useValue: mockImportHistoryService },
        { provide: TranslationService, useValue: mockTranslationService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: AnnouncerService, useValue: mockAnnouncer },
        { provide: MatDialog, useValue: mockDialog },
        { provide: Router, useValue: mockRouter }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(ImportHistoryComponent, {
        set: {
          template: '<div></div>',
          providers: [
        { provide: NotificationService, useValue: notifications },
            { provide: MatDialog, useValue: mockDialog },
            { provide: MatSnackBar, useValue: mockSnackBar },
            { provide: TranslationService, useValue: mockTranslationService }
          ]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(ImportHistoryComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load import history on init', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(mockImportHistoryService.getImportHistory).toHaveBeenCalled();
      expect(component.importHistory().length).toBe(2);
    }));

    it('should set isLoading to false after loading', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(component.isLoading()).toBeFalse();
    }));
  });

  describe('getStatusIcon', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should return check_circle for completed', () => {
      expect(component.getStatusIcon('completed')).toBe('check_circle');
    });

    it('should return warning for partial', () => {
      expect(component.getStatusIcon('partial')).toBe('warning');
    });

    it('should return error for failed', () => {
      expect(component.getStatusIcon('failed')).toBe('error');
    });

    it('should return hourglass_empty for processing', () => {
      expect(component.getStatusIcon('processing')).toBe('hourglass_empty');
    });
  });

  describe('getStatusClass', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should return status as class', () => {
      expect(component.getStatusClass('completed')).toBe('completed');
      expect(component.getStatusClass('failed')).toBe('failed');
    });
  });

  describe('getStatusLabel', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should return translated label for completed', () => {
      expect(component.getStatusLabel('completed')).toBe('import.statusCompleted');
    });

    it('should return translated label for partial', () => {
      expect(component.getStatusLabel('partial')).toBe('import.statusPartial');
    });

    it('should return translated label for failed', () => {
      expect(component.getStatusLabel('failed')).toBe('import.statusFailed');
    });

    it('should return translated label for processing', () => {
      expect(component.getStatusLabel('processing')).toBe('import.statusProcessing');
    });
  });

  describe('getFileTypeLabel', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('names each kind after what was actually processed', () => {
      // fileType is finer than source — receipts and statement screenshots
      // share source: 'image' and must not share a label.
      expect(component.getFileTypeLabel('receipt_image')).toBe('import.kindReceipt');
      expect(component.getFileTypeLabel('screenshot')).toBe('import.kindStatement');
      expect(component.getFileTypeLabel('bank_pdf')).toBe('import.kindPdf');
      expect(component.getFileTypeLabel('backup_json')).toBe('import.kindBackup');
      expect(component.getFileTypeLabel('generic_csv')).toBe('import.kindCsv');
      expect(component.getFileTypeLabel('bank_csv')).toBe('import.kindCsv');
    });
  });

  describe('getFileTypeIcon', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('pairs each kind with its icon', () => {
      expect(component.getFileTypeIcon('receipt_image')).toBe('receipt_long');
      expect(component.getFileTypeIcon('screenshot')).toBe('photo_library');
      expect(component.getFileTypeIcon('bank_pdf')).toBe('picture_as_pdf');
      expect(component.getFileTypeIcon('backup_json')).toBe('settings_backup_restore');
      expect(component.getFileTypeIcon('generic_csv')).toBe('table_view');
    });
  });

  describe('formatDate', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should format timestamp to date string', () => {
      const formatted = component.formatDate(mockTimestamp);
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe('string');
    });
  });

  describe('formatFileSize', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should return 0 B for 0 bytes', () => {
      expect(component.formatFileSize(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(component.formatFileSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(component.formatFileSize(2048)).toBe('2 KB');
    });

    it('should format megabytes', () => {
      expect(component.formatFileSize(512000)).toBe('500 KB');
    });
  });

  describe('deleteHistory', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should announce the deletion when confirmed', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.deleteHistory(mockHistory[0]);
      tick();

      expect(mockImportHistoryService.deleteImportHistory).toHaveBeenCalledWith('import1');
      expect(notifications.success).toHaveBeenCalledWith('import.historyDeleted');
    }));

    it('should announce failures assertively', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      mockImportHistoryService.deleteImportHistory.and.returnValue(Promise.reject(new Error('fail')));

      component.deleteHistory(mockHistory[0]);
      tick();

      expect(notifications.error).toHaveBeenCalledWith('import.deleteHistoryFailed');
    }));
  });

  describe('clearHistory', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should clear all history when confirmed', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);

      component.clearHistory();
      tick();

      expect(mockImportHistoryService.clearImportHistory).toHaveBeenCalled();
      expect(notifications.success).toHaveBeenCalledWith('import.historyCleared');
    }));

    it('should not clear history when cancelled', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(false) } as never);

      component.clearHistory();
      tick();

      expect(mockImportHistoryService.clearImportHistory).not.toHaveBeenCalled();
    }));

    it('should notify when clearing fails', fakeAsync(() => {
      mockDialog.open.and.returnValue({ afterClosed: () => of(true) } as never);
      mockImportHistoryService.clearImportHistory.and.returnValue(Promise.reject(new Error('fail')));

      component.clearHistory();
      tick();

      expect(notifications.error).toHaveBeenCalledWith('import.clearHistoryFailed');
    }));
  });

  describe('navigation', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should navigate to settings on goBack', () => {
      component.goBack();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/settings']);
    });

    it('should navigate to import on goToImport', () => {
      component.goToImport();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/settings/import']);
    });
  });

  describe('ngOnDestroy', () => {
    it('should unsubscribe from subscription', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      // Just ensure ngOnDestroy doesn't throw
      expect(() => component.ngOnDestroy()).not.toThrow();
    }));
  });

  describe('attempt chips', () => {
    beforeEach(() => { fixture.detectChanges(); });

    it('labels the engine, and the pair when one fell back', () => {
      expect(component.getEngineLabel({ engine: 'cloud' })).toBe('import.engineCloud');
      expect(component.getEngineLabel({ engine: 'native' })).toBe('import.engineNative');
      expect(component.getEngineLabel({ engine: 'cloud', fellBackFrom: 'native' })).toBe('import.engineCloudAfterNative');
      expect(component.getEngineLabel({ engine: 'native', fellBackFrom: 'cloud' })).toBe('import.engineNativeAfterCloud');
    });

    it('names the provider as it brands itself, untranslated', () => {
      expect(component.getProviderLabel('gemini')).toBe('Gemini');
      expect(component.getProviderLabel('openai')).toBe('OpenAI');
      expect(component.getProviderLabel('claude')).toBe('Claude');
    });

    it('shows the duration in whole seconds', () => {
      expect(component.formatDuration(4321)).toBe('import.durationSeconds');
      expect(mockTranslationService.t).toHaveBeenCalledWith('import.durationSeconds', { seconds: 4 });
    });

    it('says a sub-second pass was fast rather than rendering it as 0 s', () => {
      // A native pass often finishes in a few hundred milliseconds; a floored
      // "0 s" reads as instant, which is not what happened.
      expect(component.formatDuration(400)).toBe('import.durationUnderOneSecond');
      expect(mockTranslationService.t).not.toHaveBeenCalledWith('import.durationSeconds', jasmine.anything());
    });

    it('labels every failure class', () => {
      const classes = ['rate_limit', 'auth', 'network', 'quota', 'server', 'timeout',
        'no_provider', 'nothing_extracted', 'queue_write', 'unknown'] as const;
      const labels = classes.map(c => component.getFailureLabel(c));
      expect(labels).toEqual([
        'import.failureRateLimit', 'import.failureAuth', 'import.failureNetwork', 'import.failureQuota',
        'import.failureServer', 'import.failureTimeout', 'import.failureNoProvider',
        'import.failureNothingExtracted', 'import.failureQueueWrite', 'import.failureUnknown',
      ]);
    });
  });
});

// A sibling suite, not a nested describe: the outer file overrides the
// template with a bare div (see its beforeEach above) so its own
// TestBed.createComponent runs before any nested beforeEach could
// reconfigure the module — mat-menu items only ever exist in the DOM once
// the trigger is clicked and the CDK overlay attaches them to document.body,
// so this needs the real, un-stubbed template. Mirrors the technique
// add-affordance.spec.ts uses for TransactionsComponent.
describe('ImportHistoryComponent transaction shortcut', () => {
  let fixture: ComponentFixture<ImportHistoryComponent>;
  let historyService: jasmine.SpyObj<ImportHistoryService>;
  let router: jasmine.SpyObj<Router>;

  const baseRecord: ImportHistory = {
    id: 'import1',
    userId: 'user1',
    importedAt: { seconds: 1704067200, nanoseconds: 0, toDate: () => new Date(1704067200 * 1000) } as Timestamp,
    source: 'csv',
    fileType: 'generic_csv',
    fileName: 'transactions.csv',
    fileSize: 2048,
    transactionCount: 3,
    successCount: 3,
    skippedCount: 0,
    errorCount: 0,
    totalIncome: 0,
    totalExpenses: 300,
    duplicatesSkipped: 0,
    status: 'completed'
  };

  function itemWith(transactionIds: string[] | undefined): ImportHistory {
    return { ...baseRecord, transactionIds };
  }

  function render(items: ImportHistory[]): void {
    historyService.getImportHistory.and.returnValue(of(items));
    fixture.detectChanges();
  }

  function actionButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('mat-card-actions button'));
  }

  beforeEach(async () => {
    historyService = jasmine.createSpyObj('ImportHistoryService', ['getImportHistory']);
    historyService.getImportHistory.and.returnValue(of([]));
    const translation = jasmine.createSpyObj('TranslationService', ['t']);
    translation.t.and.callFake((key: string) => key);
    router = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [ImportHistoryComponent, NoopAnimationsModule],
      providers: [
        { provide: ImportHistoryService, useValue: historyService },
        { provide: TranslationService, useValue: translation },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']) },
        { provide: LocaleFormatService, useValue: { locale: 'en-US', formatDate: () => '' } },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: Router, useValue: router }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ImportHistoryComponent);
  });

  it('shows no shortcut for a record without transaction ids', () => {
    render([itemWith(undefined)]);

    // Delete is always there; nothing else should join it.
    expect(actionButtons().length).toBe(1);
  });

  it('a single-transaction record gets a direct view button that navigates with the tx param', () => {
    render([itemWith(['tx-1'])]);

    const buttons = actionButtons();
    expect(buttons.length).toBe(2);
    const viewButton = buttons.find(b => b.textContent?.includes('import.viewTransaction'));
    expect(viewButton).withContext('a view-transaction button').toBeTruthy();

    viewButton!.click();

    expect(router.navigate).toHaveBeenCalledWith(['/transactions'], { queryParams: { tx: 'tx-1' } });
  });

  it('a batch record gets a menu with one entry per created transaction, each navigating with its id', () => {
    render([itemWith(['tx-1', 'tx-2', 'tx-3'])]);

    const buttons = actionButtons();
    expect(buttons.length).toBe(2);
    const trigger = buttons.find(b => b.textContent?.includes('import.viewTransactions'));
    expect(trigger).withContext('a view-transactions menu trigger').toBeTruthy();

    trigger!.click();
    fixture.detectChanges();

    const items = document.querySelectorAll<HTMLButtonElement>('.mat-mdc-menu-panel button[mat-menu-item]');
    expect(items.length).toBe(3);

    items[1].click();

    expect(router.navigate).toHaveBeenCalledWith(['/transactions'], { queryParams: { tx: 'tx-2' } });
  });
});
