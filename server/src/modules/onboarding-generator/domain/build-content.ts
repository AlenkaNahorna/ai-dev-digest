import {
  ArchitectureSection,
  CriticalPathsSection,
  FirstTasksSection,
  LocalRunSection,
  ONBOARDING_LIMITS,
  OnboardingTourContent,
  ReadingPathSection,
  isSafeRelativePath,
  type OnboardingSectionKey,
} from '@devdigest/shared/contracts/onboarding-generator.js';
import type { z } from 'zod';
import { hasGraphEvidence, supportedEdges, edgeKey, type CapturedEvidence, type EvidenceDocument } from './evidence.js';
import type { ModelTourOutput } from './model-output.js';
import { clamp, stripUnsafeLinks, toSingleLine } from './sanitize.js';
import { containsSecret } from './secret-screen.js';

/**
 * Turn the model's lenient output into the strict, grounded tour contract —
 * section by section. A section that fails validation or grounding becomes an
 * explicit evidence-unavailable section; the others survive (AC-22).
 *
 * Grounding rules (never relaxed):
 *  - every path must be a member of the captured path inventory;
 *  - every setup row cites a captured doc/config source and its command is
 *    supported by that source's text (or by its package.json scripts);
 *  - diagram nodes anchored to a path must exist; an edge between two anchored
 *    nodes must be a relationship the graph evidence supports;
 *  - nothing that matches the secret rules is stored.
 */

export interface BuiltContent {
  content: OnboardingTourContent;
  /** Sections the MODEL produced but that failed validation/grounding. */
  degraded: OnboardingSectionKey[];
}

type Section = OnboardingTourContent['sections'][number];

function unavailable<K extends OnboardingSectionKey>(key: K, reason: string): Extract<Section, { key: K }> {
  return { key, status: 'unavailable', reason: clamp(reason, ONBOARDING_LIMITS.shortTextChars) } as Extract<
    Section,
    { key: K }
  >;
}

// ------------------------------------------------------------ evidence gates

/** Deterministic: a section with no supporting evidence is unavailable whatever the model says. */
export function sectionEvidenceGap(key: OnboardingSectionKey, e: CapturedEvidence): string | null {
  switch (key) {
    case 'architecture':
      return e.rankedFiles.length === 0 && e.symbols.length === 0 && e.documents.length === 0
        ? 'The index has no ranked files, symbols or documentation to describe the architecture.'
        : null;
    case 'critical_paths':
      return e.rankedFiles.length === 0 && e.criticalChains.length === 0
        ? 'The index has no ranked or connected files to identify critical paths.'
        : null;
    case 'local_run':
      return e.documents.length === 0
        ? 'No readable README, setup documentation or configuration was found at this revision.'
        : null;
    case 'reading_path':
      return e.rankedFiles.length === 0 && e.criticalChains.length === 0
        ? 'The index has no ranked or connected files to order a reading path.'
        : null;
    case 'first_tasks':
      return e.rankedFiles.length === 0 && e.criticalChains.length === 0 && e.symbols.length === 0
        ? 'The index has no code evidence to suggest grounded first tasks.'
        : null;
  }
}

// ---------------------------------------------------------------- path helpers

function groundedPath(p: string, e: CapturedEvidence): string | null {
  const path = p.trim();
  if (!isSafeRelativePath(path)) return null;
  return e.pathInventory.has(path) ? path : null;
}

/** Normalize whitespace + case for command comparison. */
function normalizeCommand(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

const PM_RUN = /^(?:pnpm|npm|yarn|bun)(?:\s+run)?\s+([a-z0-9:_.-]+)(?:\s|$)/;
const PM_INSTALL = /^(?:pnpm|npm|yarn|bun)\s+(?:install|i|ci)(?:\s|$)/;
const COMPOSE = /^docker(?:\s+compose|-compose)\s/;

/**
 * Is `command` supported by the document it cites? Substring of the (screened)
 * document text, a script declared in the cited package.json, an install command
 * when a package manifest is cited, or a compose command when a compose file is.
 */
export function commandSupported(command: string, doc: EvidenceDocument): boolean {
  const cmd = normalizeCommand(command);
  if (cmd.length === 0) return false;
  if (normalizeCommand(doc.text).includes(cmd)) return true;
  const base = doc.path.split('/').pop()?.toLowerCase() ?? '';
  if (doc.kind === 'manifest' && base === 'package.json') {
    if (PM_INSTALL.test(cmd)) return true;
    const run = PM_RUN.exec(cmd);
    if (run) {
      try {
        const scripts = (JSON.parse(doc.text) as { scripts?: Record<string, unknown> }).scripts;
        if (scripts && Object.prototype.hasOwnProperty.call(scripts, run[1]!)) return true;
      } catch {
        // unparsable manifest: not support
      }
    }
  }
  if (doc.kind === 'manifest' && base === 'pnpm-workspace.yaml' && PM_INSTALL.test(cmd)) return true;
  if (doc.kind === 'config' && /compose/.test(base) && COMPOSE.test(cmd)) return true;
  return false;
}

// ----------------------------------------------------------- section builders

function buildArchitecture(m: ModelTourOutput['architecture'], e: CapturedEvidence): Section {
  const summary = stripUnsafeLinks(m.summary.trim());
  if (summary.length === 0) return unavailable('architecture', 'The model returned no architecture summary.');
  if (summary.length > ONBOARDING_LIMITS.textChars) {
    throw new Error('architecture summary exceeds the size limit');
  }

  const kinds = new Set(['client', 'service', 'module', 'datastore', 'external', 'other']);
  const nodes = m.diagram_nodes
    .map((n) => ({
      id: n.id.trim(),
      label: toSingleLine(n.label).slice(0, 60),
      kind: kinds.has(n.kind) ? n.kind : 'other',
      path: n.path === null ? null : groundedPath(n.path, e),
      claimedPath: n.path !== null,
    }))
    // An anchored node whose path does not exist in the revision is an invented node.
    .filter((n) => /^[a-z0-9][a-z0-9_-]{0,39}$/.test(n.id) && n.label.length > 0 && !(n.claimedPath && n.path === null));

  const ids = new Set<string>();
  const uniqueNodes = nodes.filter((n) => (ids.has(n.id) ? false : (ids.add(n.id), true)));
  const byId = new Map(uniqueNodes.map((n) => [n.id, n]));
  const supported = supportedEdges(e);

  const edges = m.diagram_edges
    .filter((edge) => byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to)
    .filter((edge) => {
      const a = byId.get(edge.from)!;
      const b = byId.get(edge.to)!;
      // Two file-anchored endpoints: the relationship must exist in the graph evidence.
      if (a.path !== null && b.path !== null) return supported.has(edgeKey(a.path, b.path));
      return true;
    })
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label ? toSingleLine(edge.label).slice(0, 40) || null : null,
    }));

  const dedupedEdges = edges.filter(
    (edge, i) => edges.findIndex((o) => o.from === edge.from && o.to === edge.to) === i,
  );

  let diagram: { nodes: unknown[]; edges: unknown[] } | null = null;
  let note: string | null = null;
  if (!hasGraphEvidence(e)) {
    note = 'No graph evidence in the index could support a diagram; see the summary above.';
  } else if (uniqueNodes.length < 2) {
    note = 'A diagram could not be grounded in the indexed files; see the summary above.';
  } else {
    // Keep only nodes that participate in an edge unless there are no edges at all.
    const used = new Set(dedupedEdges.flatMap((edge) => [edge.from, edge.to]));
    const kept = dedupedEdges.length > 0 ? uniqueNodes.filter((n) => used.has(n.id)) : uniqueNodes;
    if (kept.length < 2) {
      note = 'The relationships in the diagram could not be verified against the index; see the summary above.';
    } else {
      diagram = {
        nodes: kept.slice(0, ONBOARDING_LIMITS.diagramNodes).map(({ claimedPath: _c, ...n }) => n),
        edges: dedupedEdges.slice(0, ONBOARDING_LIMITS.diagramEdges),
      };
      const keptIds = new Set((diagram.nodes as { id: string }[]).map((n) => n.id));
      diagram.edges = (diagram.edges as { from: string; to: string }[]).filter(
        (edge) => keptIds.has(edge.from) && keptIds.has(edge.to),
      );
    }
  }

  return {
    key: 'architecture',
    status: 'available',
    summary,
    diagram: diagram as never,
    diagram_note: note,
  };
}

function buildCriticalPaths(m: ModelTourOutput['critical_paths'], e: CapturedEvidence): Section {
  const seen = new Set<string>();
  const entries = [];
  for (const entry of m.entries) {
    const path = groundedPath(entry.path, e);
    const role = clamp(stripUnsafeLinks(entry.role), ONBOARDING_LIMITS.shortTextChars);
    if (!path || seen.has(path) || role.length === 0) continue;
    seen.add(path);
    entries.push({ path, role });
    if (entries.length >= ONBOARDING_LIMITS.criticalPaths) break;
  }
  if (entries.length === 0) {
    throw new Error('no critical path could be grounded in the indexed files');
  }
  return { key: 'critical_paths', status: 'available', entries };
}

function buildLocalRun(m: ModelTourOutput['local_run'], e: CapturedEvidence): Section {
  const docs = new Map(e.documents.map((d) => [d.path, d]));
  const steps = [];
  for (const step of [...m.steps].sort((a, b) => a.order - b.order)) {
    const source = step.source.trim();
    const doc = docs.get(source);
    if (!doc) continue; // must cite a captured doc/config source
    const instruction = clamp(toSingleLine(stripUnsafeLinks(step.instruction)), ONBOARDING_LIMITS.shortTextChars);
    const command = step.command === null ? null : toSingleLine(step.command).slice(0, 300);
    if (instruction.length === 0) continue;
    if (command !== null && (command.length === 0 || !commandSupported(command, doc))) continue;
    steps.push({ order: steps.length + 1, instruction, command, source });
    if (steps.length >= ONBOARDING_LIMITS.setupSteps) break;
  }
  if (steps.length === 0) throw new Error('no setup step could be grounded in a repository document');
  return { key: 'local_run', status: 'available', steps };
}

function buildReadingPath(m: ModelTourOutput['reading_path'], e: CapturedEvidence): Section {
  const seen = new Set<string>();
  const entries = [];
  for (const entry of [...m.entries].sort((a, b) => a.order - b.order)) {
    const path = groundedPath(entry.path, e);
    const reason = clamp(stripUnsafeLinks(entry.reason), ONBOARDING_LIMITS.shortTextChars);
    if (!path || seen.has(path) || reason.length === 0) continue;
    seen.add(path);
    entries.push({ order: entries.length + 1, path, reason });
    if (entries.length >= ONBOARDING_LIMITS.readingEntries) break;
  }
  if (entries.length === 0) throw new Error('no reading-path file could be grounded in the indexed files');
  return { key: 'reading_path', status: 'available', entries };
}

function buildFirstTasks(m: ModelTourOutput['first_tasks'], e: CapturedEvidence): Section {
  const tasks = [];
  for (const task of m.tasks) {
    const files = [...new Set(task.files.map((f) => groundedPath(f, e)).filter((f): f is string => f !== null))].slice(
      0,
      ONBOARDING_LIMITS.taskFiles,
    );
    const title = clamp(toSingleLine(task.title), 120);
    const description = clamp(stripUnsafeLinks(task.description), ONBOARDING_LIMITS.shortTextChars);
    const outcome = clamp(stripUnsafeLinks(task.outcome), ONBOARDING_LIMITS.shortTextChars);
    // AC-17: suggestions must carry relevant files and a checkable outcome.
    if (files.length === 0 || title.length === 0 || description.length === 0 || outcome.length === 0) continue;
    tasks.push({ title, description, files, outcome });
    if (tasks.length >= ONBOARDING_LIMITS.firstTasks) break;
  }
  if (tasks.length === 0) throw new Error('no first task could be grounded in the indexed files');
  return { key: 'first_tasks', status: 'available', tasks };
}

// ------------------------------------------------------------------ top level

const SCHEMAS: Record<OnboardingSectionKey, z.ZodTypeAny> = {
  architecture: ArchitectureSection,
  critical_paths: CriticalPathsSection,
  local_run: LocalRunSection,
  reading_path: ReadingPathSection,
  first_tasks: FirstTasksSection,
};

type BuilderMap = {
  [K in OnboardingSectionKey]: (m: ModelTourOutput[K], e: CapturedEvidence) => Section;
};
const BUILDERS: BuilderMap = {
  architecture: buildArchitecture,
  critical_paths: buildCriticalPaths,
  local_run: buildLocalRun,
  reading_path: buildReadingPath,
  first_tasks: buildFirstTasks,
};

const DEGRADED_REASON = 'The generated content for this section could not be validated against the repository evidence.';
const MODEL_UNAVAILABLE_FALLBACK = 'The model reported no supporting evidence for this section.';

function buildOne<K extends OnboardingSectionKey>(
  key: K,
  model: ModelTourOutput,
  e: CapturedEvidence,
  degraded: OnboardingSectionKey[],
): Section {
  const gap = sectionEvidenceGap(key, e);
  if (gap) return unavailable(key, gap);

  const m = model[key];
  if (m.unavailable_reason !== null && m.unavailable_reason.trim().length > 0) {
    // The model itself says there is no support: honour it, safely worded.
    return unavailable(key, clamp(toSingleLine(m.unavailable_reason), 300) || MODEL_UNAVAILABLE_FALLBACK);
  }
  try {
    const built = (BUILDERS[key] as (m: ModelTourOutput[K], e: CapturedEvidence) => Section)(m as never, e);
    const parsed = SCHEMAS[key]!.safeParse(built);
    if (!parsed.success) throw new Error('section failed the strict contract');
    if (containsSecret(JSON.stringify(parsed.data))) throw new Error('section contained secret-like content');
    return parsed.data as Section;
  } catch {
    degraded.push(key);
    return unavailable(key, DEGRADED_REASON);
  }
}

/** Build the strict tour content from lenient model output. Never throws. */
export function buildTourContent(model: ModelTourOutput, evidence: CapturedEvidence): BuiltContent {
  const degraded: OnboardingSectionKey[] = [];
  const sections = [
    buildOne('architecture', model, evidence, degraded),
    buildOne('critical_paths', model, evidence, degraded),
    buildOne('local_run', model, evidence, degraded),
    buildOne('reading_path', model, evidence, degraded),
    buildOne('first_tasks', model, evidence, degraded),
  ] as OnboardingTourContent['sections'];
  return { content: OnboardingTourContent.parse({ sections }), degraded };
}

/**
 * Request-level verdict (plan 3a): the request fails with `invalid_output` only
 * when no section survived, or architecture AND reading path are both unusable.
 */
export function isUsableTour(content: OnboardingTourContent): boolean {
  const available = new Set(content.sections.filter((s) => s.status === 'available').map((s) => s.key));
  if (available.size === 0) return false;
  return available.has('architecture') || available.has('reading_path');
}
