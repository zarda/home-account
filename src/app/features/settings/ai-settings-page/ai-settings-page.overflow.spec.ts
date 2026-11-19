import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, NO_ERRORS_SCHEMA, Provider, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { AiSettingsPageComponent } from './ai-settings-page.component';
import { AIStrategyService } from '../../../core/services/ai-strategy.service';
import { PwaService } from '../../../core/services/pwa.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { CloudLLMProviderService } from '../../../core/services/cloud-llm-provider.service';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryMemoryService } from '../../../core/services/category-memory.service';
import { TagMemoryService } from '../../../core/services/tag-memory.service';
import { ProviderKeyService } from '../../../core/services/provider-key.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslationService } from '../../../core/services/translation.service';
import { TEXT_MODELS, VISION_MODELS } from '../../../core/config/ai-models';
import { catalogTranslationStub, catalogTranslator, provideNoMotion, textLines } from '../../../core/services/testing';

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
class PageProbeComponent {
  width = MODEL_FIELD_WIDTH;
}

/** The page's collaborators, each answering what its template reads. */
function pageProviders(): Provider[] {
  const strategyServiceMock = jasmine.createSpyObj('AIStrategyService', [
    'preferences',
    'updatePreferences',
    'canUseCloud',
    'canUseNative',
    'canUseAppleIntelligence',
    'useNativeOCR',
    'platform',
    'applyProviderKey',
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
    'closedForUpgrade',
    'isSyncing',
    'syncQueue',
    'clearAll',
  ]);
  offlineQueueServiceMock.pendingCount.and.returnValue(0);
  // The page's own template reads these, so the probe has to answer them
  // even though the queue is not what it measures.
  offlineQueueServiceMock.closedForUpgrade.and.returnValue(false);
  offlineQueueServiceMock.isSyncing.and.returnValue(false);

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

  return [
    { provide: NotificationService, useValue: notifications },
    { provide: AIStrategyService, useValue: strategyServiceMock },
    { provide: PwaService, useValue: pwaServiceMock },
    { provide: OfflineQueueService, useValue: offlineQueueServiceMock },
    { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
    { provide: AuthService, useValue: authServiceMock },
    { provide: ProviderKeyService, useValue: providerKeysMock },
    { provide: CategoryMemoryService, useValue: categoryMemoryMock },
    { provide: TagMemoryService, useValue: tagMemoryMock },
    provideNoMotion(),
  ];
}

describe('overflow guard: the AI settings model selects', () => {
  let fixture: ComponentFixture<PageProbeComponent>;
  let host: HTMLElement;

  async function setUp(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [
        PageProbeComponent,
        RouterTestingModule,
        HttpClientTestingModule,
      ],
      providers: pageProviders(),
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(PageProbeComponent);
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

/**
 * The action rows of a provider card (Get API Key, Test Key) and of the
 * Offline Queue card (Sync Now, Clear Queue) at a phone's width. A card's
 * actions are a flex row that did not wrap, so its buttons shrank to share
 * it and a label took two lines: Test Key and Sync Now at 320 px in English,
 * both provider actions at 375 px in Japanese. The rows wrap, so a label that
 * fits a row on one line gets one, on a line of its own if need be.
 *
 * The widths are the page's own. The browser run's 375 px window gave the
 * page 335 px: less the main container's 8 px styled scrollbar (styles.scss)
 * and the layout's 16 px phone gutter a side (`.content-wrapper`,
 * main-layout.component.scss). A phone's overlay scrollbar takes no width and
 * would leave 343 px, so 335 is the stricter case. The run measured a
 * provider card's actions at 301 px there, which is that page less the main
 * content's 16 px a side and the card's 1 px outline a side; 320 px takes
 * 55 px off each. The Offline Queue card stands in a grid that holds two
 * columns from 600 px, and Karma's window is 756 px wide, so for that card
 * the page is sized for each column to be the one card a phone shows.
 *
 * The labels are the English catalog's, since the real translation service
 * has none loaded here, and the face is pinned as docs/testing.md *Karma
 * serves no fonts* says: on the host, and on the three tokens Material's
 * fields and buttons take their faces from.
 */
describe('overflow guard: the AI settings card actions at phone width', () => {
  const FACE = "Verdana, 'DejaVu Sans', sans-serif";
  /** The main container's styled scrollbar, in the browser run's window. */
  const SCROLLBAR_PX = 8;
  /** The layout's phone gutter, a side. */
  const LAYOUT_GUTTER_PX = 16;
  /** The page, by phone width. */
  const PAGE_WIDTH_PX = {
    375: 375 - SCROLLBAR_PX - 2 * LAYOUT_GUTTER_PX,
    320: 320 - SCROLLBAR_PX - 2 * LAYOUT_GUTTER_PX,
  } as const;
  /** `.main-content`'s padding a side, around each card. */
  const MAIN_CONTENT_PADDING_PX = 16;
  const GRID_GAP_PX = 16;
  let fixture: ComponentFixture<PageProbeComponent>;
  let host: HTMLElement;

  async function render(pageWidth: number): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [PageProbeComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        ...pageProviders(),
        { provide: TranslationService, useValue: catalogTranslationStub('en') },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(PageProbeComponent);
    fixture.componentInstance.width = pageWidth;
    host = fixture.nativeElement as HTMLElement;
    host.style.fontFamily = FACE;
    for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
      host.style.setProperty(token, FACE);
    }
    document.body.appendChild(host);
    fixture.detectChanges();
  }

  afterEach(() => host?.remove());

  /**
   * Each button in `row` holds its label on one line, inside the row's
   * padding. Returns the line each button stands on, by its top edge.
   */
  function expectOneLineEach(row: HTMLElement, labels: string[], where: string): number[] {
    const edges = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const start = edges.left + parseFloat(style.paddingLeft);
    const end = edges.right - parseFloat(style.paddingRight);
    const actions = Array.from(row.querySelectorAll<HTMLElement>('.mdc-button'));
    const label = (action: HTMLElement) => action.querySelector('.mdc-button__label') as HTMLElement;
    expect(actions.map(action => label(action).textContent?.trim())).withContext(`${where}: the actions`).toEqual(labels);
    for (const action of actions) {
      const shown = `${where}: ${label(action).textContent?.trim()}`;
      const box = action.getBoundingClientRect();
      expect(textLines(label(action))).withContext(`${shown}: label lines`).toBe(1);
      expect(box.left).withContext(`${shown}: start against the row's, px`).toBeGreaterThanOrEqual(start);
      expect(box.right).withContext(`${shown}: end against the row's, px`).toBeLessThanOrEqual(end);
    }
    return actions.map(action => Math.round(action.getBoundingClientRect().top));
  }

  /**
   * The two actions in `row` stand on lines of their own, given the lines
   * `expectOneLineEach` found them on, and the 48 px touch target Material
   * centres on each 40 px button stops short of the other's: Material's card
   * actions set no gap, so the row gap is all that keeps the two apart.
   */
  function expectStackedApart(row: HTMLElement, lines: number[], where: string): void {
    expect(new Set(lines).size).withContext(`${where}: lines the two actions stand on`).toBe(2);
    const targets = Array.from(row.querySelectorAll<HTMLElement>('.mdc-button .mat-mdc-button-touch-target'))
      .map(target => target.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    expect(targets.map(target => target.height)).withContext(`${where}: the touch targets, px`).toEqual([48, 48]);
    const [upper, lower] = targets;
    expect(lower.top)
      .withContext(`${where}: the lower touch target's top against the upper one's bottom, px`)
      .toBeGreaterThanOrEqual(upper.bottom - 0.5);
  }

  /** A provider card's actions, on the page a `phone` px screen lays out. */
  async function providerActions(phone: keyof typeof PAGE_WIDTH_PX): Promise<HTMLElement> {
    const card = PAGE_WIDTH_PX[phone] - 2 * MAIN_CONTENT_PADDING_PX;
    await render(PAGE_WIDTH_PX[phone]);
    const row = host.querySelector('.provider-card mat-card-actions') as HTMLElement;
    expect(row.getBoundingClientRect().width).withContext('the actions row, px').toBeCloseTo(card - 2, 0);
    return row;
  }

  /** The Offline Queue card's actions, in a card as wide as a `phone` px screen lays it out. */
  async function queueActions(phone: keyof typeof PAGE_WIDTH_PX): Promise<HTMLElement> {
    const card = PAGE_WIDTH_PX[phone] - 2 * MAIN_CONTENT_PADDING_PX;
    await render(2 * card + GRID_GAP_PX + 2 * MAIN_CONTENT_PADDING_PX);
    const queue = host.querySelector('.queue-icon')!.closest('mat-card') as HTMLElement;
    expect(queue.getBoundingClientRect().width).withContext('the card, px').toBeCloseTo(card, 0);
    return queue.querySelector('mat-card-actions') as HTMLElement;
  }

  it('puts each provider action on one line inside the card at 320 px, in English', async () => {
    const row = await providerActions(320);
    const lines = expectOneLineEach(row, ['Get API Key', 'Test Key'], '320 px provider card');
    expectStackedApart(row, lines, '320 px provider card');
  });

  it('puts each Offline Queue action on one line inside the card at 320 px, in English', async () => {
    const row = await queueActions(320);
    const lines = expectOneLineEach(row, ['Sync Now', 'Clear Queue'], '320 px Offline Queue');
    expectStackedApart(row, lines, '320 px Offline Queue');
  });

  // Pins: at 375 px the English labels fit the rows side by side, so the rows
  // that wrap at 320 px must not wrap here.
  it('keeps the provider actions side by side on one line each at 375 px, in English (pin)', async () => {
    const lines = expectOneLineEach(await providerActions(375), ['Get API Key', 'Test Key'], '375 px provider card');
    expect(new Set(lines).size).withContext('lines the two actions stand on').toBe(1);
  });

  it('keeps the Offline Queue actions side by side on one line each at 375 px, in English (pin)', async () => {
    const lines = expectOneLineEach(await queueActions(375), ['Sync Now', 'Clear Queue'], '375 px Offline Queue');
    expect(new Set(lines).size).withContext('lines the two actions stand on').toBe(1);
  });
});

/**
 * Each provider card's key field is labelled with its provider, by the short
 * name (`settings.apiKeyFor`: "Gemini API key"), and so is the model select
 * the OpenAI card and the Claude card show once their provider is configured
 * (`settings.modelFor`: "OpenAI model"). Material cuts a label longer than
 * its field with an ellipsis, at rest inside the field and floated into the
 * outline's notch once the field holds a value, as a model select always
 * does. At 320 px, on the page the card actions' guard above sizes for that
 * screen and in its face, every label fits whole in each locale, in each
 * place it stands.
 */
describe('overflow guard: the AI settings provider field labels at 320 px', () => {
  const FACE = "Verdana, 'DejaVu Sans', sans-serif";
  /** A 320 px screen less the main container's 8 px scrollbar and the layout's 16 px gutter a side. */
  const PAGE_WIDTH_PX = 320 - 8 - 2 * 16;
  const PROVIDERS = ['Gemini', 'OpenAI', 'Claude'];
  const LABELS = {
    en: ['Gemini API key', 'OpenAI API key', 'Claude API key'],
    ja: ['Gemini APIキー', 'OpenAI APIキー', 'Claude APIキー'],
    tc: ['Gemini API 金鑰', 'OpenAI API 金鑰', 'Claude API 金鑰'],
  } as const;
  /** The providers whose card holds one model select. */
  const MODEL_PROVIDERS = ['OpenAI', 'Claude'];
  const MODEL_LABELS = {
    en: ['OpenAI model', 'Claude model'],
    ja: ['OpenAI モデル', 'Claude モデル'],
    tc: ['OpenAI 模型', 'Claude 模型'],
  } as const;
  let fixture: ComponentFixture<PageProbeComponent>;
  let host: HTMLElement;

  async function render(locale: 'en' | 'ja' | 'tc'): Promise<AiSettingsPageComponent> {
    // Every provider configured, so the OpenAI and Claude cards show their model selects.
    const cloudLLMProviderMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'isProviderAvailable',
      'updateProviderApiKey',
    ]);
    cloudLLMProviderMock.isProviderAvailable.and.returnValue(true);
    await TestBed.configureTestingModule({
      imports: [PageProbeComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        ...pageProviders(),
        { provide: TranslationService, useValue: catalogTranslationStub(locale) },
        { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(PageProbeComponent);
    fixture.componentInstance.width = PAGE_WIDTH_PX;
    host = fixture.nativeElement as HTMLElement;
    host.style.fontFamily = FACE;
    for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-label-large-font']) {
      host.style.setProperty(token, FACE);
    }
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.debugElement.query(By.directive(AiSettingsPageComponent)).componentInstance as AiSettingsPageComponent;
  }

  afterEach(() => host?.remove());

  /**
   * Each label under `fields` reads `pinned` and holds its words whole,
   * unclipped, floated or not as `floated` says. Returns the words.
   */
  function expectLabelsFit(fields: string, pinned: readonly string[], floated: boolean, what: string): (string | undefined)[] {
    const where = `${what}, ${floated ? 'floated' : 'at rest'}`;
    const labels = Array.from(host.querySelectorAll<HTMLElement>(`${fields} .mdc-floating-label`));
    const words = labels.map(label => label.textContent?.trim());
    expect(words).withContext(`${where}: the labels, pinned`).toEqual([...pinned]);
    for (const label of labels) {
      const shown = `${where}: "${label.textContent?.trim()}"`;
      expect(label.classList.contains('mdc-floating-label--float-above')).withContext(`${shown} floated`).toBe(floated);
      expect(label.clientWidth).withContext(`${shown} has a width`).toBeGreaterThan(0);
      expect(label.scrollWidth).withContext(`${shown} scrollWidth against clientWidth`).toBeLessThanOrEqual(label.clientWidth);
    }
    return words;
  }

  /** Each key field's label holds its provider's words whole, floated or not as `floated` says. */
  function expectKeyLabelsFit(locale: 'en' | 'ja' | 'tc', floated: boolean): void {
    const words = expectLabelsFit('.api-key-field', LABELS[locale], floated, locale);
    const t = catalogTranslator(locale, { strict: true });
    expect(words).withContext(`${locale}: the labels`).toEqual(PROVIDERS.map(provider => t('settings.apiKeyFor', { provider })));
  }

  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`fits each key field's label whole at rest and floated, in ${locale}`, async () => {
      const page = await render(locale);
      expectKeyLabelsFit(locale, false);

      page.geminiApiKey.set('g-key');
      page.openaiApiKey.set('o-key');
      page.claudeApiKey.set('c-key');
      // NgModel writes the field's value a microtask after the change.
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expectKeyLabelsFit(locale, true);
    });

    it(`fits the OpenAI and Claude model selects' labels whole, floated over the model each holds, in ${locale}`, async () => {
      await render(locale);
      // The Gemini card's two model selects stand in a group of their own,
      // so the one select a card holds is its content's own child.
      const words = expectLabelsFit('mat-card-content > .model-field', MODEL_LABELS[locale], true, `${locale} model selects`);
      const t = catalogTranslator(locale, { strict: true });
      expect(words).withContext(`${locale}: the model labels`).toEqual(MODEL_PROVIDERS.map(provider => t('settings.modelFor', { provider })));
    });
  }
});

/**
 * The Gemini card's Recommended chip, shown while no Gemini key is set. It
 * was laid over the header's right end, out of the row, and at 320 px the
 * title reaches that far: the chip sat on "Google Gemini". In the row, it
 * stands beside the title where the two fit and on a line of its own where
 * they do not, never over the avatar, the title or the status under it.
 * The page and face are the provider field labels' guard's above.
 */
describe("overflow guard: the AI settings Recommended chip beside the provider's title", () => {
  const FACE = "Verdana, 'DejaVu Sans', sans-serif";
  /** A 320 px screen less the main container's 8 px scrollbar and the layout's 16 px gutter a side. */
  const PHONE_PAGE_PX = 320 - 8 - 2 * 16;
  /** As wide as `.ai-settings-page` grows, its 800 px cap. */
  const WIDE_PAGE_PX = 800;
  let host: HTMLElement;

  async function render(locale: 'en' | 'ja' | 'tc', width: number): Promise<void> {
    // No provider configured, so the Gemini card recommends itself.
    const cloudLLMProviderMock = jasmine.createSpyObj('CloudLLMProviderService', [
      'isProviderAvailable',
      'updateProviderApiKey',
    ]);
    cloudLLMProviderMock.isProviderAvailable.and.returnValue(false);
    await TestBed.configureTestingModule({
      imports: [PageProbeComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [
        ...pageProviders(),
        { provide: TranslationService, useValue: catalogTranslationStub(locale) },
        { provide: CloudLLMProviderService, useValue: cloudLLMProviderMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    const fixture = TestBed.createComponent(PageProbeComponent);
    fixture.componentInstance.width = width;
    host = fixture.nativeElement as HTMLElement;
    host.style.fontFamily = FACE;
    for (const token of ['--mat-sys-body-large-font', '--mat-sys-body-small-font', '--mat-sys-title-large-font']) {
      host.style.setProperty(token, FACE);
    }
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--app-font-scale');
    host?.remove();
  });

  /** The Gemini card's header and the parts the chip must stay clear of. */
  function geminiHeader(locale: 'en' | 'ja' | 'tc'): { header: HTMLElement; chip: HTMLElement; parts: [string, HTMLElement][] } {
    const header = host.querySelector('.provider-avatar.gemini')!.closest('mat-card-header') as HTMLElement;
    const chip = header.querySelector('.recommended-chip') as HTMLElement;
    expect(chip).withContext(`${locale}: the chip, shown with no Gemini key`).not.toBeNull();
    expect(chip.textContent?.trim())
      .withContext(`${locale}: the chip's words`)
      .toBe(catalogTranslator(locale, { strict: true })('aiPage.recommended'));
    const parts: [string, HTMLElement][] = [
      ['the avatar', header.querySelector('.provider-avatar') as HTMLElement],
      ['the title', header.querySelector('mat-card-title') as HTMLElement],
      ['the status', header.querySelector('mat-card-subtitle') as HTMLElement],
    ];
    return { header, chip, parts };
  }

  function overlaps(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  }

  /** The chip clear of every part, on one line, inside the header's padding. */
  function expectChipClear(header: HTMLElement, chip: HTMLElement, parts: [string, HTMLElement][], where: string): void {
    const box = chip.getBoundingClientRect();
    for (const [what, part] of parts) {
      const rect = part.getBoundingClientRect();
      expect(overlaps(box, rect))
        .withContext(`${where}: the chip [${Math.round(box.left)}, ${Math.round(box.right)}] x [${Math.round(box.top)}, ` +
          `${Math.round(box.bottom)}] against ${what} [${Math.round(rect.left)}, ${Math.round(rect.right)}] x ` +
          `[${Math.round(rect.top)}, ${Math.round(rect.bottom)}]`)
        .toBeFalse();
    }
    expect(textLines(chip)).withContext(`${where}: the chip's lines`).toBe(1);
    const edges = header.getBoundingClientRect();
    const style = getComputedStyle(header);
    expect(box.left).withContext(`${where}: the chip's start inside the header`).toBeGreaterThanOrEqual(edges.left + parseFloat(style.paddingLeft) - 0.5);
    expect(box.right).withContext(`${where}: the chip's end inside the header`).toBeLessThanOrEqual(edges.right - parseFloat(style.paddingRight) + 0.5);
  }

  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`keeps the chip off the avatar, the title and the status at 320 px, in ${locale}`, async () => {
      await render(locale, PHONE_PAGE_PX);
      const { header, chip, parts } = geminiHeader(locale);
      expectChipClear(header, chip, parts, `${locale} at 320 px`);
    });
  }

  // Where the title and the chip fit one row, the chip keeps its place at the
  // row's end, level with the avatar, and now inside the header's padding,
  // where the content under it ends, not flush with the card's edge.
  it('stands the chip at the end of the title row, inside the padding, where the two fit, in English', async () => {
    await render('en', WIDE_PAGE_PX);
    const { header, chip, parts } = geminiHeader('en');
    expectChipClear(header, chip, parts, 'en, wide');
    const box = chip.getBoundingClientRect();
    const avatar = parts[0][1].getBoundingClientRect();
    expect((box.top + box.bottom) / 2)
      .withContext("the chip's middle against the avatar's, px")
      .toBeCloseTo((avatar.top + avatar.bottom) / 2, 0);
    const edges = header.getBoundingClientRect();
    expect(box.right).withContext("the chip's end at the header's padding, px")
      .toBeCloseTo(edges.right - parseFloat(getComputedStyle(header).paddingRight), 0);
  });

  // Every provider's header row wraps, for the chip's sake, and a title block
  // wider than the room beside the avatar went onto a line of its own under
  // it: at 320 px "OpenAI (ChatGPT)" and "Anthropic Claude" did, in every
  // locale, as the titles are not translated, and Gemini's did at the largest
  // text size. Whatever the chip does, each title stays beside its avatar.
  const PROVIDERS = ['gemini', 'openai', 'claude'] as const;

  function expectTitleBesideAvatar(provider: (typeof PROVIDERS)[number], where: string): void {
    const header = host.querySelector(`.provider-avatar.${provider}`)!.closest('mat-card-header') as HTMLElement;
    const avatar = header.querySelector('.provider-avatar')!.getBoundingClientRect();
    const title = header.querySelector('mat-card-title')!.getBoundingClientRect();
    expect(title.left).withContext(`${where}: the title's start against the avatar's end, px`).toBeCloseTo(avatar.right, 0);
    expect(title.top).withContext(`${where}: the title's top above the avatar's bottom`).toBeLessThan(avatar.bottom);
  }

  for (const provider of PROVIDERS) {
    it(`keeps the ${provider} card's title beside its avatar at 320 px, in English`, async () => {
      await render('en', PHONE_PAGE_PX);
      expectTitleBesideAvatar(provider, `${provider} at 320 px`);
    });
  }

  it("keeps the gemini card's title beside its avatar at 320 px and the largest text size, in English", async () => {
    document.documentElement.style.setProperty('--app-font-scale', '1.3');
    await render('en', PHONE_PAGE_PX);
    expectTitleBesideAvatar('gemini', 'gemini at 320 px, scale 1.3');
    const { header, chip, parts } = geminiHeader('en');
    expectChipClear(header, chip, parts, 'en at 320 px, scale 1.3');
  });
});
