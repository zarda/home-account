import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { StoredDataKind, StoredDataService } from '../../core/services/stored-data.service';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { TranslatePipe } from '../../shared/pipes/translate.pipe';
import { DataManagementComponent } from './data-management/data-management.component';

/**
 * What a row shows where its count would go.
 *
 * `unavailable` and `none` are deliberately distinct: the first is a count
 * that was attempted and could not be fetched, the second a kind that has no
 * count to fetch. Flat rather than a discriminated union so the template can
 * read `count` without narrowing a re-invoked call.
 */
export interface CountState {
  readonly status: 'loading' | 'ready' | 'unavailable' | 'none';
  readonly count: number | null;
}

/**
 * One page listing every kind of record the app has stored, how much of each,
 * and the door that manages it — including the two kinds that had no door at
 * all before it existed.
 *
 * The export, import, restore and danger-zone actions sit below the index
 * rather than behind another hop: they act on the same data the rows name.
 */
@Component({
  selector: 'app-data-hub',
  standalone: true,
  imports: [
    DataManagementComponent,
    MatIconModule,
    PageHeaderComponent,
    RouterLink,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-hub.component.html',
  styleUrl: './data-hub.component.scss'
})
export class DataHubComponent implements OnInit {
  private storedData = inject(StoredDataService);

  readonly kinds = this.storedData.kinds;

  /**
   * Counts by kind, in the catalogue's order. Read as a whole so a row
   * repaints the moment its own count lands, without waiting for the rest.
   */
  readonly states = computed<Record<string, CountState>>(() => {
    const counts = this.storedData.counts();
    const states: Record<string, CountState> = {};

    for (const kind of this.kinds) {
      const count = counts[kind.id];

      if (kind.subcollection === null) {
        states[kind.id] = { status: 'none', count: null };
      } else if (count === undefined) {
        states[kind.id] = { status: 'loading', count: null };
      } else if (count === null) {
        states[kind.id] = { status: 'unavailable', count: null };
      } else {
        states[kind.id] = { status: 'ready', count };
      }
    }
    return states;
  });

  ngOnInit(): void {
    void this.storedData.loadCounts();
  }

  stateFor(kind: StoredDataKind): CountState {
    return this.states()[kind.id];
  }
}
