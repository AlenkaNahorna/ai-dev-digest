/**
 * Application-level errors. The application layer cannot import `platform/`, so it
 * throws these and the HTTP adapter maps them onto the API error taxonomy
 * (forbidden → 403, not_found → 404, conflict → 409, unavailable → 409,
 * rate_limited → 429, invalid → 422).
 */
export type OnboardingErrorKind =
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'rate_limited'
  | 'invalid';

export class OnboardingError extends Error {
  constructor(
    readonly kind: OnboardingErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'OnboardingError';
  }
}
