import { VERIFY_FIELD_THRESHOLD, gradeNeedsVerification } from './import-history.model';

describe('gradeNeedsVerification', () => {
  it('sends a grade under the bar to review and passes one at the bar', () => {
    expect(gradeNeedsVerification(0)).withContext('an unreadable field, graded zero').toBeTrue();
    expect(gradeNeedsVerification(VERIFY_FIELD_THRESHOLD - 0.01))
      .withContext('a grade just under the bar')
      .toBeTrue();
    expect(gradeNeedsVerification(VERIFY_FIELD_THRESHOLD))
      .withContext('a grade exactly at the bar')
      .toBeFalse();
    expect(gradeNeedsVerification(1)).withContext('a grade above the bar').toBeFalse();
  });

  it('reads an ungraded field as nobody\'s doubt', () => {
    expect(gradeNeedsVerification(undefined)).toBeFalse();
  });
});
