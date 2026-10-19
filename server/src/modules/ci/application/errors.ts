/**
 * Application-layer errors for the `ci` module. The HTTP adapter maps these to
 * status codes (422 for validation, 404 for not-found, 401 for ingest auth) so
 * the application stays free of Fastify/transport types (onion-architecture).
 */

export type CiErrorKind =
  | 'agent_not_found'
  | 'manifest_invalid'
  | 'export_unavailable'
  | 'github_failed'
  | 'unsupported_target'
  | 'repo_mismatch'
  | 'unauthorized';

export class CiError extends Error {
  constructor(
    public readonly kind: CiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CiError';
  }
}
