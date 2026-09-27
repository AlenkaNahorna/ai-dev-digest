import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../../../../_shared/context.js';
import { IdParams } from '../../../../_shared/schemas.js';
import { NotFoundError } from '../../../../../platform/errors.js';
import { SkillsService } from '../../../service.js';

const MAX_SKILL_BODY_CHARS = 256 * 1024;
const SkillBody = z.object({ name: z.string().min(1), description: z.string().default(''), type: SkillType, body: z.string().min(1).max(MAX_SKILL_BODY_CHARS), source: SkillSource.optional(), enabled: z.boolean().optional() });
const SkillPatch = SkillBody.partial();
const LinkBody = z.object({ skills: z.array(z.object({ skill_id: z.string().uuid(), order: z.number().int().nonnegative(), enabled: z.boolean().optional() })) }).superRefine((value, ctx) => {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const [index, skill] of value.skills.entries()) {
    if (ids.has(skill.skill_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['skills', index, 'skill_id'], message: 'A skill may appear only once.' });
    if (orders.has(skill.order)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['skills', index, 'order'], message: 'Skill order values must be unique.' });
    ids.add(skill.skill_id);
    orders.add(skill.order);
  }
});
const ImportBody = z.object({ filename: z.string().min(1), content: z.string().min(1).max(MAX_SKILL_BODY_CHARS), name: z.string().optional(), description: z.string().optional(), type: SkillType.default('custom') });

export default async function skillsRoutes(base: FastifyInstance) {
  const app = base.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);
  app.get('/skills', async (req) => { const { workspaceId } = await getContext(app.container, req); return service.list(workspaceId); });
  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => { const { workspaceId } = await getContext(app.container, req); const skill = await service.get(workspaceId, req.params.id); if (!skill) throw new NotFoundError('Skill not found'); return skill; });
  app.post('/skills', { schema: { body: SkillBody } }, async (req, reply) => { const { workspaceId } = await getContext(app.container, req); reply.status(201); return service.create(workspaceId, req.body); });
  app.put('/skills/:id', { schema: { params: IdParams, body: SkillPatch } }, async (req) => { const { workspaceId } = await getContext(app.container, req); const skill = await service.update(workspaceId, req.params.id, req.body); if (!skill) throw new NotFoundError('Skill not found'); return skill; });
  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => { const { workspaceId } = await getContext(app.container, req); if (!(await service.delete(workspaceId, req.params.id))) throw new NotFoundError('Skill not found'); return { ok: true }; });
  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => { const { workspaceId } = await getContext(app.container, req); const versions = await service.versions(workspaceId, req.params.id); if (!versions) throw new NotFoundError('Skill not found'); return versions; });
  app.post('/skills/import/preview', { schema: { body: ImportBody } }, async (req) => { await getContext(app.container, req); return { filename: req.body.filename, name: req.body.name ?? req.body.content.match(/^#\s+(.+)$/m)?.[1] ?? req.body.filename.replace(/\.md$/i, ''), description: req.body.description ?? '', type: req.body.type, source: 'extracted', body: req.body.content, executable_files_ignored: [] }; });
  app.post('/skills/import', { schema: { body: ImportBody } }, async (req, reply) => { const { workspaceId } = await getContext(app.container, req); reply.status(201); return service.create(workspaceId, { name: req.body.name ?? req.body.filename.replace(/\.md$/i, ''), description: req.body.description ?? '', type: req.body.type, body: req.body.content, source: 'extracted', enabled: false }); });
  app.put('/agents/:id/skills', { schema: { params: IdParams, body: LinkBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    if (!(await app.container.agentsRepo.getById(workspaceId, req.params.id))) throw new NotFoundError('Agent not found');
    for (const link of req.body.skills) if (!(await service.get(workspaceId, link.skill_id))) throw new NotFoundError('Skill not found');
    return service.setLinks(req.params.id, req.body.skills);
  });
}
