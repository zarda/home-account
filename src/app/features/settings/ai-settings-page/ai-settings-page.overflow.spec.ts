import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { AiSettingsPageComponent } from './ai-settings-page.component';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { ProviderKeyService } from '../../../core/services/provider-key.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TEXT_MODELS, VISION_MODELS } from '../../../core/config/ai-models';

/**
 * The Gemini model selects at the Extra large font scale on a phone.
 *
 * Material's own select-value CSS (`white-space: nowrap; text-overflow:
 * ellipsis`) is a truncation `truncation:check` cannot see, because it never
 * appears as a rule this codebase wrote. It renders a real ellipsis on a long
 * model name at 1.3 regardless — the source scanner is blind to it, so only a
 * rendered probe catches it.
 *
 * The host is the field's own clientWidth at a 375px viewport, not the
 * viewport itself, the same shortcut accessibility-settings.overflow.spec.ts
 * takes for its toggle group.
 */
const MODEL_FIELD_WIDTH = 269;

@Component({
  standalone: true,
  imports: [AiSettingsPageComponent],
  template: `<div class="phone" [style.width.px]="width"><app-ai-settings-page /></div>`,
})
class ModelFieldOverflowProbeComponent {
  width = MODEL_FIELD_WIDTH;
}

describe('overflow guard: the AI settings model selects', () => {
  let fixture: ComponentFixture<ModelFieldOverflowProbeComponent>;
  let host: HTMLElement;

  async function setUp(): Promise<void> {
    const strategyServiceMock = jasmine.createSpyObj('AIStrategyService', [
      'preferences',
      'updatePreferences',
      'canUseCloud',
      'canUseNative',
      'canUseAppleIntelligence',
      'useNativeOCR',
      'platform',
    ]);
    strategyServiceMock.preferences.and.returnValue({ autoSync: true });
    strategyServiceMock.canUseCloud.and.returnValue(true);
    strategyServiceMock.canUseNative.and.returnValue(false);
    strategyServiceMock.canUseAppleIntelligence.and.returnValue(false);
    strategyServiceMock.useNativeOCR.and.returnValue(false);
    strategyServiceMock.platform.and.returnValue('web');

    const pwaServiceMock = jasmine.createSpyObj('PwaService', ['isOnline']);
    pwaServiceMock.isOnline.and.returnValue(true);

    const offlineQueueServiceMock = jasmine.createSpyObj('OfflineQueueService', [
      'pendingCount',
      'syncQueue',
      'clearAll',
    ]);
    offlineQueueServiceMock.pendingCount.and.returnValue(0);

    const geminiServiceMock = jasmine.createSpyObj('GeminiService', ['isAvailable']);
    geminiServiceMock.isAvailable.and.returnValue(true);

    // Gated true for Gemini alone: it is the only card this probe needs
    // rendered, and the fix under test applies to every `.model-field`
    // regardless of which provider it belongs to.
    const cloudLLMProviderMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'isProviderAvailable',
      'updateProviderApiKey',
    ]);
    cloudLLMProviderMock.isProviderAvailable.and.callFake((provider: string) => provider === 'gemini');

    const providerKeysMock = jasmine.createSpyObj<ProviderKeyService>(
      'ProviderKeyService',
      ['resolve', 'getKey', 'setKey'],
      { loadFailed: signal(false) }
    );
    providerKeysMock.resolve.and.resolveTo({});

    const categoryMemoryMock = jasmine.createSpyObj<CategoryMemoryService>(
      'CategoryMemoryService',
      ['ensureLoaded', 'clear'],
      { rememberedCount: signal(0) }
    );
    categoryMemoryMock.ensureLoaded.and.resolveTo(undefined);

    const tagMemoryMock = jasmine.createSpyObj<TagMemoryService>(
      'TagMemoryService',
      ['ensureLoaded', 'clear'],
      { rememberedCount: signal(0) }
    );
    tagMemoryMock.ensureLoaded.and.resolveTo(undefined);

    const authServiceMock = jasmine.createSpyObj('AuthService', ['currentUser', 'updateUserPreferences']);
    authServiceMock.currentUser.and.returnValue({
      preferences: {
        baseCurrency: 'USD',
        language: 'en',
        dateFormat: 'MM/DD/YYYY',
        theme: 'system',
        defaultCategories: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const notifications = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info']);

    await TestBed.configureTestingModule({
      imports: [
        ModelFieldOverflowProbeComponent,
        NoopAnimationsModule,
        RouterTestingModule,
        HttpClientTestingModule,
      ],
      providers: [
        { provide: NotificationService, useValue: notifications },
        { provide: AIStrategyService, useValue: strategyServiceMock },
        { provide: PwaService, useValue: pwaServiceMock },
        { provide: OfflineQueueService, useValue: offlineQueueServiceMock },
        { provide: GeminiService, useValue: geminiServiceMock },
        { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: ProviderKeyService, useValue: providerKeysMock },
        { provide: CategoryMemoryService, useValue: categoryMemoryMock },
        { provide: TagMemoryService, useValue: tagMemoryMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelFieldOverflowProbeComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-font-scale');
    host?.remove();
  });

  /**
   * `.mat-mdc-select-value-text` is a plain `<span>` — an inline box always
   * reports 0 for scrollWidth/clientWidth, fix or no fix — so the overflow
   * itself is read off `.mat-mdc-select-value`, the block-level ancestor
   * Material actually clips (both carry the same nowrap + ellipsis rule).
   * The white-space check stays on the span: that is the selector the fix
   * targets, and Material sets nowrap on both.
   */
  function selectValueBoxes(): { box: HTMLElement; text: HTMLElement }[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.model-field .mat-mdc-select-value')).map(
      (box) => ({ box, text: box.querySelector('.mat-mdc-select-value-text') as HTMLElement })
    );
  }

  /**
   * The catalog's own longest name, not a string copied out of it — a new
   * model id longer than today's would otherwise leave this probe silently
   * checking a shorter, already-safe string.
   */
  function longestModelId(): string {
    return [...TEXT_MODELS, ...VISION_MODELS].reduce((a, b) => (b.name.length > a.name.length ? b : a)).id;
  }

  for (const scale of ['1.3', '1.0'] as const) {
    it(`wraps the longest catalog model name instead of ellipsizing it at scale ${scale}`, async () => {
      document.documentElement.style.setProperty('--app-font-scale', scale);
      await setUp();

      // MatSelect resolves its initial displayed value in a microtask
      // (_initializeSelection), so the first paint always shows the
      // placeholder — a stable round trip is needed before the trigger text
      // reflects a value at all, and again after changing it.
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const page = fixture.debugElement.query(By.directive(AiSettingsPageComponent))
        .componentInstance as AiSettingsPageComponent;
      page.selectedTextModel.set(longestModelId());
      page.selectedVisionModel.set(longestModelId());
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const boxes = selectValueBoxes();
      expect(boxes.length).withContext('both Gemini model selects rendered').toBe(2);

      for (const { box, text } of boxes) {
        expect(box.scrollWidth)
          .withContext(`"${text.textContent?.trim()}" scrollWidth vs clientWidth at scale ${scale}`)
          .toBeLessThanOrEqual(box.clientWidth + 1);
        expect(getComputedStyle(text).whiteSpace)
          .withContext(`"${text.textContent?.trim()}" white-space at scale ${scale}`)
          .toBe('normal');
      }
    });
  }
});
