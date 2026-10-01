import { HouseholdError } from '../../core/services/household.service';

/**
 * What a failed household write says. The household services word every
 * refusal in the reader's language already, so theirs is shown as it is;
 * any other failure is a generic one.
 */
export function writeFailureMessage(error: unknown, t: (key: string) => string): string {
  return error instanceof HouseholdError ? error.message : t('errors.generic');
}
