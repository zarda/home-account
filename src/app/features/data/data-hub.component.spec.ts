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
import { TranslationService } from '../../core/services/translation.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';

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
