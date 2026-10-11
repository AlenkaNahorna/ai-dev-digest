import type { GitClient } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { ProjectContextFacade } from './application/facade.js';
import type { ProjectContextSettings, TokenCounter } from './application/ports/project-context-ports.js';
import { createCountUsage } from './application/use-cases/count-usage.js';
import { createGetDoc } from './application/use-cases/get-doc.js';
import { createListContext } from './application/use-cases/list-context.js';
import { createGetAttachments, createPutAttachments } from './application/use-cases/attachments.js';
import { createResolveForRun } from './application/use-cases/resolve-for-run.js';
import { ProjectContextRepository } from './adapters/outbound/persistence/repository.js';
import { CloneDocScanner } from './adapters/outbound/providers/clone-scanner.js';

export interface ProjectContextDeps {
  db: Db;
  /** Thunks so container overrides (tests) apply at call time. */
  git: () => GitClient;
  tokenizer: () => TokenCounter;
  settings: ProjectContextSettings;
}

/** Module wiring only: binds the use cases to concrete adapters. No business logic. */
export function createProjectContext(deps: ProjectContextDeps): ProjectContextFacade {
  const repository = new ProjectContextRepository(deps.db);
  const clone = new CloneDocScanner(deps.git);
  const tokenizer: TokenCounter = { count: (text) => deps.tokenizer().count(text) };
  const countUsage = createCountUsage({ usage: repository });
  const base = { repos: repository, scanner: clone, settings: deps.settings };

  const list = createListContext({ ...base, reader: clone, countUsage, tokenizer });
  const getDoc = createGetDoc({ ...base, reader: clone, countUsage, tokenizer });
  const attach = { ...base, attachments: repository };
  const getAttachments = createGetAttachments(attach);
  const putAttachments = createPutAttachments(attach);
  const resolveForRun = createResolveForRun({ attachments: repository, reader: clone, tokenizer, settings: deps.settings });

  return { list, getDoc, getAttachments, putAttachments, resolveForRun };
}
