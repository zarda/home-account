import { PendingFiltersService } from './pending-filters.service';
import { TransactionFilters } from '../../models';

describe('PendingFiltersService', () => {
  let service: PendingFiltersService;

  beforeEach(() => {
    service = new PendingFiltersService();
  });

  it('starts with nothing pending', () => {
    expect(service.pending()).toBeNull();
    expect(service.consume()).toBeNull();
  });

  it('stores a copy of the applied filters', () => {
    const filters: TransactionFilters = { categoryId: 'food' };
    service.apply(filters);
    filters.categoryId = 'mutated';

    expect(service.pending()?.filters.categoryId).toBe('food');
  });

  it('increments seq on every apply', () => {
    service.apply({});
    const first = service.pending()!.seq;
    service.apply({});
    expect(service.pending()!.seq).toBe(first + 1);
  });

  it('keeps incrementing seq across consume', () => {
    service.apply({});
    const first = service.pending()!.seq;
    service.consume();
    service.apply({});
    expect(service.pending()!.seq).toBe(first + 1);
  });

  it('consume returns the filters and clears the pending state', () => {
    service.apply({ searchQuery: 'coffee' });
    const consumed = service.consume();

    expect(consumed).toEqual({ searchQuery: 'coffee' });
    expect(service.pending()).toBeNull();
    expect(service.consume()).toBeNull();
  });
});
