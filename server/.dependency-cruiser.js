/**
 * Onion Architecture guardrails for the Fastify backend.
 *
 * Paths are relative to server/, because the check is run from this package.
 * Keep this file intentionally explicit: adding a layer should require an
 * intentional rule change rather than silently weakening the boundary.
 */
export default {
  forbidden: [
    {
      name: 'domain-cannot-depend-on-outer-layers',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain(?:/|$)' },
      to: {
        path: '^src/(modules/[^/]+/(application|adapters)|adapters|db|platform|vendor|infrastructure)(?:/|$)',
      },
    },
    {
      name: 'application-cannot-depend-on-framework-or-infrastructure',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application(?:/|$)' },
      to: {
        path: '(^src/(db|platform|adapters|infrastructure|vendor)(?:/|$)|(^|/)node_modules/(fastify|drizzle-orm|octokit|openai|@anthropic-ai|simple-git|postgres)(?:/|$))',
      },
    },
    {
      name: 'http-adapters-cannot-query-database-directly',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/adapters/inbound/http(?:/|$)',
      },
      to: {
        path: '(^src/db(?:/|$)|(^|/)node_modules/drizzle-orm(?:/|$))',
      },
    },
    {
      name: 'domain-and-application-cannot-import-fastify',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/(domain|application)(?:/|$)' },
      to: { path: '(^|/)node_modules/fastify(?:/|$)' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    exclude: ['^node_modules', '\\.test\\.ts$', '\\.it\\.test\\.ts$'],
    doNotFollow: {
      path: '^node_modules',
    },
  },
};
