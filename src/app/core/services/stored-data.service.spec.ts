import { TestBed } from '@angular/core/testing';
import en from '../../../assets/i18n/en.json';
import { BUDGET_TABS } from '../../features/budgets/budgets.component';
import { REPORT_TABS } from '../../features/reports/reports.component';
import { DELETION_STEPS } from './account-deletion.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import {
  NOT_A_RECORD_KIND,
  STORED_DATA_KINDS,
  StoredDataService
} from './stored-data.service';

describe('StoredDataService', () => {
  let service: StoredDataService;
  let mockFirestoreService: jasmine.SpyObj<FirestoreService>;
  let userIdSpy: jasmine.Spy;

  const countable = STORED_DATA_KINDS.filter(kind => kind.subcollection !== null);

  beforeEach(() => {
    mockFirestoreService = jasmine.createSpyObj('FirestoreService', ['countDocuments']);
    mockFirestoreService.countDocuments.and.returnValue(Promise.resolve(0));
    userIdSpy = jasmine.createSpy('userId').and.returnValue('user123');

    TestBed.configureTestingModule({
      providers: [
        StoredDataService,
        { provide: FirestoreService, useValue: mockFirestoreService },
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', [], { userId: userIdSpy }) }
      ]
    });
    service = TestBed.inject(StoredDataService);
  });

  describe('the catalogue and the deletion cascade', () => {
    // The whole point of the hub: a stored kind that the cascade erases but
    // nothing lists is a record with no door, which is the defect #232 filed.
    it('gives every cascade step either a door or a stated reason for not having one', () => {
      const catalogued = new Set(STORED_DATA_KINDS.map(kind => kind.id));
      const orphaned = DELETION_STEPS.filter(
        step => !catalogued.has(step) && !(step in NOT_A_RECORD_KIND)
      );

      expect(orphaned)
        .withContext(
          `Add these to STORED_DATA_KINDS, or to NOT_A_RECORD_KIND with a reason: ${orphaned.join(', ')}`
        )
        .toEqual([]);
    });

    it('does not both catalogue a step and excuse it', () => {
      const both = STORED_DATA_KINDS.filter(kind => kind.id in NOT_A_RECORD_KIND).map(k => k.id);

      expect(both).toEqual([]);
    });

    it('excuses only steps the cascade actually has', () => {
      const steps = new Set<string>(DELETION_STEPS);
      const unknown = Object.keys(NOT_A_RECORD_KIND).filter(step => !steps.has(step));

      expect(unknown).toEqual([]);
    });

    it('gives every excused step a non-empty reason', () => {
      for (const [step, reason] of Object.entries(NOT_A_RECORD_KIND)) {
        expect(reason.trim().length)
          .withContext(`${step} needs a reason`)
          .toBeGreaterThan(0);
      }
    });

    it('lists each kind once', () => {
      const ids = STORED_DATA_KINDS.map(kind => kind.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every kind a label, a description, an icon and a route', () => {
      for (const kind of STORED_DATA_KINDS) {
        expect(kind.labelKey).withContext(`${kind.id} label`).toBe(`data.kinds.${kind.id}.label`);
        expect(kind.descriptionKey)
          .withContext(`${kind.id} description`)
          .toBe(`data.kinds.${kind.id}.description`);
        expect(kind.icon).withContext(`${kind.id} icon`).toBeTruthy();
        expect(kind.route).withContext(`${kind.id} route`).toMatch(/^\//);
      }
    });

    // The hub reads these keys off the catalogue, so check-i18n.mjs counts
    // them as dynamic usages and skips them. Nothing else would notice a kind
    // whose strings were never written: t() renders the raw key and the
    // locale-parity spec only compares the catalogs against each other.
    it('has copy in the catalog for every kind', () => {
      const kinds = (en as { data: { kinds: Record<string, { label?: string; description?: string }> } })
        .data.kinds;

      for (const kind of STORED_DATA_KINDS) {
        expect(kinds[kind.id]?.label)
          .withContext(`${kind.labelKey} is missing from en.json`)
          .toBeTruthy();
        expect(kinds[kind.id]?.description)
          .withContext(`${kind.descriptionKey} is missing from en.json`)
          .toBeTruthy();
      }
    });

    // A row deep-links at a tab by name. A name the target page does not have
    // resolves to its first tab, so the link would silently land on the wrong
    // section rather than fail — nothing else would catch a rename.
    it('names tabs the target page actually has', () => {
      const known: Record<string, readonly string[]> = {
        '/budgets': BUDGET_TABS,
        '/reports': REPORT_TABS
      };

      for (const kind of STORED_DATA_KINDS) {
        const tab = kind.queryParams?.['tab'];
        if (!tab) continue;

        expect(known[kind.route])
          .withContext(`${kind.id} deep-links into ${kind.route}, which declares no tabs`)
          .toBeTruthy();
        expect(known[kind.route])
          .withContext(`${kind.id} asks ${kind.route} for a "${tab}" tab`)
          .toContain(tab);
      }
    });

    it('names panels the settings page actually has', () => {
      const panels = STORED_DATA_KINDS.filter(kind => kind.queryParams?.['panel']).map(
        kind => kind.queryParams?.['panel']
      );

      expect(panels).toEqual(['categories']);
    });

    it('has no copy for a kind the catalogue dropped', () => {
      const kinds = Object.keys(
        (en as { data: { kinds: Record<string, unknown> } }).data.kinds
      );
      const catalogued = new Set<string>(STORED_DATA_KINDS.map(kind => kind.id));

      expect(kinds.filter(id => !catalogued.has(id))).toEqual([]);
    });
  });

  describe('loadCounts', () => {
    it('counts every countable kind at its own subcollection', async () => {
      await service.loadCounts();

      const paths = mockFirestoreService.countDocuments.calls
        .allArgs()
        .map(args => args[0] as string);

      expect(paths.length).toBe(countable.length);
      for (const kind of countable) {
        expect(paths).toContain(`users/user123/${kind.subcollection}`);
      }
    });

    it('never reads the secrets document, which holds keys rather than records', async () => {
      await service.loadCounts();

      const paths = mockFirestoreService.countDocuments.calls
        .allArgs()
        .map(args => args[0] as string);

      expect(paths).not.toContain('users/user123/secrets');
    });

    it('publishes each count against its kind', async () => {
      mockFirestoreService.countDocuments.and.callFake((path: string) =>
        Promise.resolve(path.endsWith('/transactions') ? 42 : 7)
      );

      await service.loadCounts();

      expect(service.counts()['transactions']).toBe(42);
      expect(service.counts()['budgets']).toBe(7);
    });

    it('resolves a failed count to null and leaves the others intact', async () => {
      mockFirestoreService.countDocuments.and.callFake((path: string) =>
        path.endsWith('/imports')
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(3)
      );

      await service.loadCounts();

      expect(service.counts()['imports']).toBeNull();
      expect(service.counts()['transactions']).toBe(3);
      expect(service.counts()['searchAnswers']).toBe(3);
    });

    it('leaves an uncountable kind absent rather than null', async () => {
      await service.loadCounts();

      expect('secrets' in service.counts()).toBe(false);
    });

    it('reads nothing when signed out', async () => {
      userIdSpy.and.returnValue(null);

      await service.loadCounts();

      expect(mockFirestoreService.countDocuments).not.toHaveBeenCalled();
      expect(service.counts()).toEqual({});
    });

    it('clears the previous counts before reloading', async () => {
      await service.loadCounts();
      expect(service.counts()['transactions']).toBe(0);

      userIdSpy.and.returnValue(null);
      await service.loadCounts();

      expect(service.counts()).toEqual({});
    });

    // Twelve counts are in flight at once; a sign-out mid-flight must not land
    // one account's totals on the next account's page.
    it('drops a count that resolves after the session changed', async () => {
      mockFirestoreService.countDocuments.and.callFake(() => {
        userIdSpy.and.returnValue('someone-else');
        return Promise.resolve(99);
      });

      await service.loadCounts();

      expect(service.counts()).toEqual({});
    });
  });
});
