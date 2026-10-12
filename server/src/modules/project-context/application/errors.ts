/**
 * Application-level errors. The application layer cannot import `platform/`, so
 * the inbound HTTP adapter maps these onto the API error taxonomy
 * (forbidden → 403, not_found → 404, invalid → 422).
 */
export type ContextErrorKind = 'forbidden' | 'not_found' | 'invalid';

export class ProjectContextError extends Error {
  constructor(
    public readonly kind: ContextErrorKind,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProjectContextError';
  }
}
