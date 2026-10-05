import { isPrNumber, parseRepoRef } from '../../domain/input.js';
import { matchAgent, matchPull, matchRepo } from '../../domain/match.js';
import { clipText } from '../../domain/text.js';
import { HintError } from '../errors.js';
import type { AgentRow, DevDigestApi, PullRow, RepoRow } from '../ports/devdigest-api.js';

/** Only the port methods the resolver calls — keeps test doubles tiny. */
export type ResolverApi = Pick<DevDigestApi, 'listAgents' | 'listRepos' | 'listPulls'>;

export interface ResolvedPull {
  readonly repo: RepoRow;
  readonly pull: PullRow;
}

/**
 * Turns agent-friendly arguments (`owner/name`, PR number, agent name) into the
 * API's ids. Arguments are validated BEFORE any request is made. Every miss
 * throws a `HintError` that says what is wrong and what to do next.
 */
export interface Resolver {
  resolveRepo(repo: string): Promise<RepoRow>;
  resolvePull(repo: string, pr: number): Promise<ResolvedPull>;
  resolveAgent(name: string): Promise<AgentRow>;
}

const KNOWN_REPOS_SHOWN = 20;
const ECHO_MAX = 60;

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function createResolver(api: ResolverApi): Resolver {
  async function resolveRepo(repo: string): Promise<RepoRow> {
    const ref = parseRepoRef(repo);
    if (ref === null) {
      throw new HintError(
        `Repo '${clipText(repo, ECHO_MAX)}' is not valid. Use the form owner/name, for example acme/payments-api.`,
      );
    }
    const repos = await api.listRepos();
    const match = matchRepo(repos, ref);
    if (match.kind === 'one') return match.item;
    const asked = `${ref.owner}/${ref.name}`;
    if (match.kind === 'many') {
      const ids = match.items.map((r) => shortId(r.id)).join(', ');
      throw new HintError(
        `Repo '${asked}' matches ${match.items.length} repos in DevDigest (ids ${ids}). Ask the user to remove the duplicate in the DevDigest UI.`,
      );
    }
    const known = repos.slice(0, KNOWN_REPOS_SHOWN).map((r) => clipText(r.full_name, 100));
    const more = repos.length > KNOWN_REPOS_SHOWN ? ', …' : '';
    const list = known.length > 0 ? `${known.join(', ')}${more}` : 'none';
    throw new HintError(
      `Repo '${asked}' is not added to DevDigest. Known repos: ${list}. Ask the user to add it in the DevDigest UI.`,
    );
  }

  async function resolvePull(repo: string, pr: number): Promise<ResolvedPull> {
    if (!isPrNumber(pr)) {
      throw new HintError(
        `PR number must be a positive integer, got '${clipText(String(pr), 20)}'. Pass the number shown in the PR list.`,
      );
    }
    const repoRow = await resolveRepo(repo);
    const pulls = await api.listPulls(repoRow.id);
    const match = matchPull(pulls, pr);
    if (match.kind === 'one') return { repo: repoRow, pull: match.item };
    if (match.kind === 'many') {
      throw new HintError(
        `PR #${pr} appears ${match.items.length} times for ${repoRow.full_name}. Ask the user to re-import pull requests in DevDigest.`,
      );
    }
    throw new HintError(
      `PR #${pr} is not imported for ${repoRow.full_name}. Ask the user to import pull requests in DevDigest.`,
    );
  }

  async function resolveAgent(name: string): Promise<AgentRow> {
    if (name.trim() === '') {
      throw new HintError('Agent name is required. Call list_agents for valid ids or names.');
    }
    const agents = await api.listAgents();
    const match = matchAgent(agents, name);
    if (match.kind === 'one') return match.item;
    const asked = clipText(name, ECHO_MAX);
    if (match.kind === 'many') {
      const options = match.items
        .map((a) => `${clipText(a.name, 60)} [${shortId(a.id)}]`)
        .join(', ');
      throw new HintError(
        `Agent name '${asked}' is ambiguous: it matches ${match.items.length} agents (${options}). Pass the agent id from list_agents instead of the name.`,
      );
    }
    throw new HintError(`Agent '${asked}' not found. Call list_agents for valid ids or names.`);
  }

  return { resolveRepo, resolvePull, resolveAgent };
}
