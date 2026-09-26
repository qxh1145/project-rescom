import {
  DEMOGRAPHIC_PROFILE_REQUIRED_CODE,
  DemographicProfileField,
} from '@rescom/schemas';

/**
 * Raised when an earning feature is requested before the Mandatory
 * Demographic Survey is complete (Story 7.1, FR-6). Mapped to 403 with the
 * missing fields so clients can route the user to onboarding.
 */
export class DemographicProfileRequiredException extends Error {
  readonly code = DEMOGRAPHIC_PROFILE_REQUIRED_CODE;

  constructor(
    public readonly missingFields: DemographicProfileField[] = [],
    message = 'Complete the mandatory demographic survey before accessing the Marketplace or starting surveys.',
  ) {
    super(message);
    this.name = 'DemographicProfileRequiredException';
  }
}
