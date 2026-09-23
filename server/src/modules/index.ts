import type { FastifyPluginAsync } from 'fastify';
import settings from './settings/adapters/inbound/http/routes.js';
import repos from './repos/adapters/inbound/http/routes.js';
import pulls from './pulls/adapters/inbound/http/routes.js';
import polling from './polling/adapters/inbound/http/routes.js';
import workspace from './workspace/adapters/inbound/http/routes.js';
import agents from './agents/adapters/inbound/http/routes.js';
import reviews from './reviews/adapters/inbound/http/routes.js';
import repoIntel from './repo-intel/adapters/inbound/http/routes.js';

/**
 * Module registry. Each feature module is a Fastify plugin in
 * `modules/<name>/adapters/inbound/http/routes.ts`. Registered here in one place.
 *
 * ADD A MODULE: create `modules/<name>/adapters/inbound/http/routes.ts` exporting
 * a default Fastify plugin, then add one import + one entry below. (We register statically rather
 * than via filesystem autoload so the same code path works under tsx, the
 * bundler, and vitest — native dynamic import() of .ts files is not portable.)
 *
 * This is the Part-0 starter set. Each course lesson adds its own module here
 * (skills, intent/smart-diff, blast, brief/context/onboarding, eval/ci/hooks,
 * memory, plugins, …) without touching any other module or the shared schema.
 */
export const modules: Record<string, FastifyPluginAsync> = {
  settings,
  repos,
  pulls,
  polling,
  workspace,
  agents,
  reviews,
  repoIntel,
};
