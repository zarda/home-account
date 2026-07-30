import {
  ANALYTICS_EVENTS,
  ANALYTICS_EVENT_NAMES,
  validateAnalyticsParams,
} from './analytics-events';

describe('the analytics taxonomy', () => {
  it('should use snake_case event names within the GA4 length limit', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(name).withContext(name).toMatch(/^[a-z][a-z0-9_]*$/);
      // GA4 truncates event names past 40 characters, silently splitting one
      // event into two in the reports.
      expect(name.length).withContext(name).toBeLessThanOrEqual(40);
    }
  });

  it('should stay inside the GA4 event and parameter ceilings', () => {
    expect(ANALYTICS_EVENT_NAMES.length).toBeLessThanOrEqual(500);

    for (const [name, definition] of Object.entries(ANALYTICS_EVENTS)) {
      const params = Object.keys(definition.params);
      expect(params.length).withContext(name).toBeLessThanOrEqual(25);

      for (const param of params) {
        expect(param).withContext(`${name}.${param}`).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(param.length).withContext(`${name}.${param}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it('should enumerate every parameter value', () => {
    // This is the privacy boundary, not a formality: an empty enumeration
    // would mean a parameter whose values are not known in advance, which is
    // how user-entered text gets into a property.
    for (const [name, definition] of Object.entries(ANALYTICS_EVENTS)) {
      for (const [param, values] of Object.entries(definition.params)) {
        expect(values.length).withContext(`${name}.${param}`).toBeGreaterThan(0);

        for (const value of values) {
          // GA4 truncates parameter values past 100 characters.
          expect(value.length).withContext(`${name}.${param}=${value}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('should record the release each event shipped in', () => {
    for (const [name, definition] of Object.entries(ANALYTICS_EVENTS)) {
      expect(definition.since).withContext(name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('validateAnalyticsParams', () => {
  it('should accept a payload that matches the taxonomy', () => {
    expect(
      validateAnalyticsParams('transaction_add', {
        method: 'manual',
        type: 'expense',
        has_tags: 'false',
        has_location: 'false',
        receipt_image_count: '0',
      })
    ).toEqual({
      method: 'manual',
      type: 'expense',
      has_tags: 'false',
      has_location: 'false',
      receipt_image_count: '0',
    });
  });

  it('should accept an event that declares no parameters', () => {
    expect(validateAnalyticsParams('budget_create', {})).toEqual({});
  });

  it('should reject an unknown event', () => {
    expect(validateAnalyticsParams('transaction_deleted', {})).toBeNull();
  });

  it('should reject a parameter the taxonomy does not declare', () => {
    // Dropping it silently would let an undocumented dimension accumulate in
    // the property with nothing in the registry describing it.
    expect(
      validateAnalyticsParams('transaction_add', {
        method: 'manual',
        type: 'expense',
        has_tags: 'false',
        has_location: 'false',
        receipt_image_count: '0',
        merchant: 'Blue Bottle Coffee',
      })
    ).toBeNull();
  });

  it('should reject a value outside the enumeration', () => {
    expect(validateAnalyticsParams('receipt_import', { outcome: 'partially_ok' })).toBeNull();
  });

  it('should reject free text even in a declared parameter', () => {
    // The case that matters: a call site passing something derived from user
    // data into a slot that only ever holds enumerated values.
    expect(
      validateAnalyticsParams('settings_change', { setting: 'note: bought coffee' })
    ).toBeNull();
  });

  it('should reject objects, and numbers whose stringified value is not enumerated', () => {
    // Numbers are stringified before the check (like booleans), so rejection
    // happens at the enumeration: '1' is not a declared method value.
    expect(
      validateAnalyticsParams('transaction_add', {
        method: 1,
        type: 'expense',
        has_tags: false,
        has_location: false,
        receipt_image_count: 0,
      })
    ).toBeNull();
    expect(
      validateAnalyticsParams('transaction_add', {
        method: { toString: () => 'manual' },
        type: 'expense',
        has_tags: false,
        has_location: false,
        receipt_image_count: 0,
      })
    ).toBeNull();
  });

  it('should accept a boolean for an enumerated true/false parameter', () => {
    // has_filters is naturally a boolean at the call site; coercing it here
    // keeps the caller from stringifying by hand and getting it wrong.
    expect(validateAnalyticsParams('transaction_search', { has_filters: true })).toEqual({
      has_filters: 'true',
    });
    expect(validateAnalyticsParams('transaction_search', { has_filters: false })).toEqual({
      has_filters: 'false',
    });
  });

  it('should coerce the transaction_add usage flags and image count', () => {
    expect(
      validateAnalyticsParams('transaction_add', {
        method: 'manual',
        type: 'expense',
        has_tags: true,
        has_location: false,
        receipt_image_count: 5,
      })
    ).toEqual({
      method: 'manual',
      type: 'expense',
      has_tags: 'true',
      has_location: 'false',
      receipt_image_count: '5',
    });
  });

  it('should accept an already-stringified image count', () => {
    expect(
      validateAnalyticsParams('transaction_add', {
        method: 'manual',
        type: 'expense',
        has_tags: false,
        has_location: false,
        receipt_image_count: '3',
      })
    ).toEqual(
      jasmine.objectContaining({ receipt_image_count: '3' })
    );
  });

  it('should reject an image count outside the enumerated range', () => {
    // The enumeration stays the boundary after coercion: 6 stringifies to '6',
    // which the taxonomy does not list.
    expect(
      validateAnalyticsParams('transaction_add', {
        method: 'manual',
        type: 'expense',
        has_tags: false,
        has_location: false,
        receipt_image_count: 6,
      })
    ).toBeNull();
  });

  it('should reject a payload missing a declared parameter', () => {
    // GA4 shows the gap as a legitimate "(not set)" bucket rather than as an
    // error, so a half-filled event quietly corrupts the report.
    expect(validateAnalyticsParams('transaction_add', { method: 'manual' })).toBeNull();
  });
});
