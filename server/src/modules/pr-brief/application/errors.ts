/**
 * Application-level errors. The application layer cannot import `platform/`, so
 * it throws these and the HTTP adapter maps them onto the API error taxonomy
 * (files_unavailable → 422, model_failed → 502). Messages are safe to return:
 * they never carry provider text, prompts or document text.
 */
export type BriefErrorKind = 'files_unavailable' | 'model_failed';

export class BriefError extends Error {
  constructor(
    readonly kind: BriefErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'BriefError';
  }
}
