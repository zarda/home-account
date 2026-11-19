import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { By } from '@angular/platform-browser';
import { RouterLink, provideRouter } from '@angular/router';

import { DataHubComponent } from './data-hub.component';
import {
  STORED_DATA_KINDS,
  StoredDataCounts,
  StoredDataService
} from '../../core/services/stored-data.service';
import { SupportedLocale, TranslationService } from '../../core/services/translation.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import {
  PALETTES,
  accessibleDescription,
  accessibleName,
  catalogTranslationStub,
  catalogTranslator,
  expectPainted,
  hoverValue,
  inPalette,
  paintedBackground,
  paintedColor,
  ratio,
  standOnThePage,
  textLines,
  withTheme
} from '../../core/services/testing';

describe('DataHubComponent', () => {
  let fixture: ComponentFixture<DataHubComponent>;
  let counts: ReturnType<typeof signal<StoredDataCounts>>;
  let loadCounts: jasmine.Spy;

  const countable = STORED_DATA_KINDS.filter(kind => kind.subcollection !== null);
  const uncountable = STORED_DATA_KINDS.filter(kind => kind.subcollection === null);

  const rows = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.kind-row'));

  const countCellFor = (id: string): HTMLElement | null => {
    const index = STORED_DATA_KINDS.findIndex(kind => kind.id === id);
    return rows()[index]?.querySelector('.kind-count') ?? null;
  };

  beforeEach(async () => {
    counts = signal<StoredDataCounts>({});
    loadCounts = jasmine.createSpy('loadCounts').and.resolveTo(undefined);

    await TestBed.configureTestingModule({
      imports: [DataHubComponent],
      providers: [
        provideRouter([]),
        {
          provide: StoredDataService,
          useValue: { kinds: STORED_DATA_KINDS, counts, loadCounts }
        },
        { provide: TranslationService, useValue: { t: (key: string) => key } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(DataHubComponent, {
        set: {
          imports: [MatIconModule, PageHeaderComponent, RouterLink, TranslatePipe],
          schemas: [NO_ERRORS_SCHEMA]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(DataHubComponent);
    fixture.detectChanges();
  });

  // A kind's glyph is a graphic beside its label, so its floor is 3:1 (WCAG
  // 1.4.11), on the row at rest and as hovering repaints the row under it.
  it('paints each kind glyph at 3:1 or better at rest and on hover, in both themes', () => {
    const link = fixture.nativeElement.querySelector('.kind-link') as HTMLElement;
    const icon = link.querySelector('.kind-icon mat-icon') as HTMLElement;
    const hovered = hoverValue(link, '.kind-link', 'background');

    for (const theme of ['light', 'dark'] as const) {
      withTheme(theme, () => {
        expect(ratio(paintedColor(icon), paintedBackground(icon)))
          .withContext(`${theme} at rest`)
          .toBeGreaterThanOrEqual(3);
        link.style.background = hovered;
        try {
          expect(ratio(paintedColor(icon), paintedBackground(icon)))
            .withContext(`${theme} on hover`)
            .toBeGreaterThanOrEqual(3);
        } finally {
          link.style.background = '';
        }
      });
    }
  });

  it('asks for the counts once on open', () => {
    expect(loadCounts).toHaveBeenCalledTimes(1);
  });

  it('lists every catalogued kind', () => {
    expect(rows().length).toBe(STORED_DATA_KINDS.length);
  });

  it('labels and describes each row from the catalogue', () => {
    const first = rows()[0];

    expect(first.querySelector('.kind-label')?.textContent).toContain(
      STORED_DATA_KINDS[0].labelKey
    );
    expect(first.querySelector('.kind-description')?.textContent).toContain(
      STORED_DATA_KINDS[0].descriptionKey
    );
  });

  it('routes each row at the surface that manages that kind', () => {
    const links = fixture.debugElement.queryAll(By.directive(RouterLink));

    for (const kind of STORED_DATA_KINDS) {
      const link = links.find(el => el.injector.get(RouterLink).href?.startsWith(kind.route));

      expect(link).withContext(`${kind.id} links to ${kind.route}`).toBeTruthy();
    }
  });

  it('carries the query params that open the right tab or panel', () => {
    const recurring = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .find(el => el.injector.get(RouterLink).href === '/budgets?tab=recurring');

    expect(recurring).withContext('the recurring row deep-links into the budgets tab').toBeTruthy();
  });

  describe('counts', () => {
    it('shows a placeholder until a count lands', () => {
      const cell = countCellFor(countable[0].id);

      expect(cell?.classList).toContain('is-loading');
      expect(cell?.textContent?.trim()).toBe('');
    });

    it('shows the number once it lands', () => {
      counts.set({ [countable[0].id]: 128 });
      fixture.detectChanges();

      const cell = countCellFor(countable[0].id);

      expect(cell?.textContent?.trim()).toBe('128');
      expect(cell?.classList).not.toContain('is-loading');
    });

    it('shows zero as a number rather than as a placeholder', () => {
      counts.set({ [countable[0].id]: 0 });
      fixture.detectChanges();

      expect(countCellFor(countable[0].id)?.textContent?.trim()).toBe('0');
    });

    it('shows a dash when the count could not be fetched', () => {
      counts.set({ [countable[0].id]: null });
      fixture.detectChanges();

      const cell = countCellFor(countable[0].id);

      expect(cell?.textContent?.trim()).toBe('—');
      expect(cell?.classList).toContain('is-unavailable');
    });

    it('leaves one kind loading while another has resolved', () => {
      counts.set({ [countable[0].id]: 5 });
      fixture.detectChanges();

      expect(countCellFor(countable[0].id)?.textContent?.trim()).toBe('5');
      expect(countCellFor(countable[1].id)?.classList).toContain('is-loading');
    });

    // A kind with nothing countable behind it must not sit on a placeholder
    // forever, which is what a single number-or-null model would have done.
    it('shows nothing at all for a kind that has no count', () => {
      expect(uncountable.length).withContext('secrets is the uncountable kind').toBeGreaterThan(0);
      expect(countCellFor(uncountable[0].id)).toBeNull();
    });
  });

  it('hosts the data management actions below the index', () => {
    expect(fixture.nativeElement.querySelector('app-data-management')).toBeTruthy();
  });
});

/**
 * The index in each catalog's own words, measured: the face is pinned as
 * docs/testing.md *Karma serves no fonts* says, and the host is the page a
 * screen lays out, less the main container's 8px scrollbar and the layout's
 * 16px gutter a side.
 */
describe('DataHubComponent, in the words a reader sees', () => {
  const FACE = "Verdana, 'DejaVu Sans', sans-serif";
  const PHONE_PAGE_PX = 320 - 8 - 2 * 16;
  /** Karma's frame is narrower than the page's 1024px cap; a tablet's page. */
  const WIDE_PAGE_PX = 720;
  const countable = STORED_DATA_KINDS.filter(kind => kind.subcollection !== null);
  let fixture: ComponentFixture<DataHubComponent>;
  let counts: ReturnType<typeof signal<StoredDataCounts>>;

  async function render(locale: SupportedLocale, width: number, set: StoredDataCounts): Promise<HTMLElement> {
    counts = signal<StoredDataCounts>(set);
    await TestBed.configureTestingModule({
      imports: [DataHubComponent],
      providers: [
        provideRouter([]),
        {
          provide: StoredDataService,
          useValue: { kinds: STORED_DATA_KINDS, counts, loadCounts: () => Promise.resolve() }
        },
        { provide: TranslationService, useValue: catalogTranslationStub(locale) }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .overrideComponent(DataHubComponent, {
        set: {
          imports: [MatIconModule, PageHeaderComponent, RouterLink, TranslatePipe],
          schemas: [NO_ERRORS_SCHEMA]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(DataHubComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.display = 'block';
    host.style.width = `${width}px`;
    host.style.fontFamily = FACE;
    fixture.detectChanges();
    return host;
  }

  /** Every countable kind counted, with a four-digit count, the widest the index shows in its tests. */
  const allCounted = (): StoredDataCounts =>
    Object.fromEntries(countable.map(kind => [kind.id, 1234])) as StoredDataCounts;

  const rowsIn = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.kind-link'));

  function contentBox(el: HTMLElement): { left: number; right: number } {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
  }

  function overlaps(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  }

  // At 320px the label, the count and the chevron took their room beside
  // the description, which was left a column of 51 to 62px: a word or two a
  // line, and longer words ("Transactions", "Categories") ran out of it.
  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`gives each row's description at least half the row at a 320px page, nothing running out of its box, in ${locale}`, async () => {
      const host = await render(locale, PHONE_PAGE_PX, allCounted());
      const rows = rowsIn(host);
      expect(rows.length).withContext('a row per kind').toBe(STORED_DATA_KINDS.length);

      for (const row of rows) {
        const label = row.querySelector('.kind-label') as HTMLElement;
        const description = row.querySelector('.kind-description') as HTMLElement;
        const what = `${locale}, ${label.textContent?.trim()}`;
        const inner = contentBox(row);
        const room = inner.right - inner.left;

        expect(description.getBoundingClientRect().width)
          .withContext(`${what}: the description's width against half the row's ${Math.round(room)}px`)
          .toBeGreaterThanOrEqual(room / 2);
        for (const [part, el] of [['label', label], ['description', description]] as const) {
          expect(el.scrollWidth).withContext(`${what}: the ${part}'s scroll width against its client width`)
            .toBeLessThanOrEqual(el.clientWidth);
        }

        const parts: [string, HTMLElement | null][] = [
          ['the label', label],
          ['the description', description],
          ['the count', row.querySelector<HTMLElement>('.kind-count')],
          ['the chevron', row.querySelector<HTMLElement>('.kind-arrow')],
        ];
        const shown = parts.filter((part): part is [string, HTMLElement] => part[1] !== null);
        for (const [name, el] of shown) {
          const box = el.getBoundingClientRect();
          expect(box.left).withContext(`${what}: ${name}'s start inside the row`).toBeGreaterThanOrEqual(inner.left - 0.5);
          expect(box.right).withContext(`${what}: ${name}'s end inside the row`).toBeLessThanOrEqual(inner.right + 0.5);
        }
        for (const [i, [name, el]] of shown.entries()) {
          for (const [other, against] of shown.slice(i + 1)) {
            expect(overlaps(el.getBoundingClientRect(), against.getBoundingClientRect()))
              .withContext(`${what}: ${name} against ${other}`)
              .toBeFalse();
          }
        }
      }
    });
  }

  // Pin: where the row has the room, the count stays at its end beside the
  // chevron, level with the row's middle, and the description beside the icon.
  it('keeps the count at the row\'s end, level with its middle, at a tablet\'s page (pin)', async () => {
    const host = await render('en', WIDE_PAGE_PX, allCounted());
    for (const row of rowsIn(host)) {
      const count = row.querySelector<HTMLElement>('.kind-count');
      if (!count) continue;
      const what = row.querySelector('.kind-label')?.textContent?.trim();
      const box = count.getBoundingClientRect();
      const arrow = row.querySelector('.kind-arrow')!.getBoundingClientRect();
      const link = row.getBoundingClientRect();
      const description = row.querySelector('.kind-description')!.getBoundingClientRect();
      expect(box.right).withContext(`${what}: the count ends before the chevron`).toBeLessThanOrEqual(arrow.left);
      expect(box.left).withContext(`${what}: the count after the description`).toBeGreaterThanOrEqual(description.right);
      expect((box.top + box.bottom) / 2).withContext(`${what}: the count's middle against the row's`)
        .toBeCloseTo((link.top + link.bottom) / 2, 0);
    }
  });

  // A count that could not be fetched shows a dash. Its reason was a title
  // on the dash: shown to a pointer that rests there, to no keyboard and to
  // no screen reader, the dash itself read out as a bare symbol.
  for (const locale of ['en', 'ja', 'tc'] as const) {
    it(`explains an unavailable count on the page, and to the row's link as its description, in ${locale}`, async () => {
      const t = catalogTranslator(locale, { strict: true });
      const [lost, counted] = countable;
      const host = await render(locale, PHONE_PAGE_PX, { [lost.id]: null, [counted.id]: 7 } as StoredDataCounts);
      const row = (id: string) => rowsIn(host)[STORED_DATA_KINDS.findIndex(kind => kind.id === id)];

      const note = host.querySelector<HTMLElement>('.count-note');
      expect(note).withContext('the note, with a count unavailable').not.toBeNull();
      if (!note) return;
      expect(note.textContent?.trim()).withContext('the note\'s words').toBe(t('data.countUnavailable'));
      expect(note.getBoundingClientRect().width).withContext('the note, shown').toBeGreaterThan(0);
      expect(textLines(note)).withContext('the note, laid out as text').toBeGreaterThan(0);

      const link = row(lost.id);
      expect(link.querySelector('.kind-count')?.textContent?.trim()).withContext('the dash, still shown').toBe('—');
      expect(link.querySelector('.kind-count')?.hasAttribute('title')).withContext('no title on the dash').toBeFalse();
      expect(accessibleDescription(link)).withContext("the row's description").toBe(t('data.countUnavailable'));
      expect(accessibleName(link)).withContext("the row's name, read without the dash").not.toContain('—');
      expect(accessibleName(link)).withContext("the row's name").toContain(t(lost.labelKey));

      expect(accessibleDescription(row(counted.id))).withContext('a counted row, described by nothing').toBe('');
      expect(accessibleName(row(counted.id))).withContext("a counted row's name, its count in it").toContain('7');
    });
  }

  it('shows no note while no count is unavailable, the loading ones included', async () => {
    const host = await render('en', PHONE_PAGE_PX, { [countable[0].id]: 3 } as StoredDataCounts);
    expect(host.querySelector('.count-note')).withContext('the note, with one count in and the rest loading').toBeNull();

    counts.set({ [countable[0].id]: null } as StoredDataCounts);
    fixture.detectChanges();
    expect(host.querySelector('.count-note')).withContext('the note, once one is unavailable').not.toBeNull();
  });

  it('paints the note in --text-secondary, at AA on the page, in the four palettes', async () => {
    const host = await render('en', PHONE_PAGE_PX, { [countable[0].id]: null } as StoredDataCounts);
    standOnThePage(host);
    const note = host.querySelector<HTMLElement>('.count-note');
    for (const { name, classes } of PALETTES) {
      inPalette(classes, () => expectPainted(note, '--text-secondary', `${name}: the note`));
    }
  });
});
