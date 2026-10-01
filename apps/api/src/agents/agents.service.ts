import { Inject, Injectable } from '@nestjs/common';
import {
  AgentConfig,
  agentConfigSchema,
  agentLimitsSchema,
  AgentStatus,
  CreateAgentInput,
  UpdateAgentInput,
} from '@nexa/shared';
import { and, desc, eq, ilike, ne, SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { OrgContext } from '../common/request-context';
import { AppConfig, CONFIG } from '../config/config';
import { DB, Database, DbOrTx } from '../db/db.module';
import { agents, agentVersions } from '../db/schema';
import { LlmRegistry } from '../llm/llm.registry';
import { ToolRegistry } from '../tools/tool.registry';
import { ToolsService } from '../tools/tools.service';

export interface ConfigIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly llm: LlmRegistry,
    private readonly tools: ToolRegistry,
    private readonly toolSettings: ToolsService,
  ) {}

  defaultConfig(): AgentConfig {
    return agentConfigSchema.parse({
      instructions: '',
      model: { provider: this.config.LLM_DEFAULT_PROVIDER, model: this.config.LLM_DEFAULT_MODEL },
      tools: [],
      limits: agentLimitsSchema.parse({}),
    });
  }

  async list(ctx: OrgContext, q: { status?: AgentStatus; q?: string }) {
    const where: SQL[] = [eq(agents.organizationId, ctx.orgId)];
    if (q.status) where.push(eq(agents.status, q.status));
    else where.push(ne(agents.status, 'ARCHIVED'));
    if (q.q) where.push(ilike(agents.name, `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
    return this.db
      .select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        status: agents.status,
        latestVersionNumber: agents.latestVersionNumber,
        publishedVersionId: agents.publishedVersionId,
        updatedAt: agents.updatedAt,
        createdAt: agents.createdAt,
      })
      .from(agents)
      .where(and(...where))
      .orderBy(desc(agents.updatedAt))
      .limit(200);
  }

  async create(ctx: OrgContext, input: CreateAgentInput) {
    return this.db.transaction(async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({
          organizationId: ctx.orgId,
          name: input.name,
          description: input.description,
          draftConfig: this.defaultConfig(),
          createdById: ctx.userId,
        })
        .returning();
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'agent.created',
          resourceType: 'agent',
          resourceId: agent!.id,
          metadata: { name: input.name },
        },
        tx,
      );
      return agent!;
    });
  }

  /** Tenant-scoped fetch: a foreign or missing id is indistinguishable (404). */
  async getOwned(ctx: Pick<OrgContext, 'orgId'>, id: string, tx: DbOrTx = this.db) {
    const agent = await tx.query.agents.findFirst({
      where: and(eq(agents.id, id), eq(agents.organizationId, ctx.orgId)),
    });
    if (!agent) throw Errors.notFound('Agent');
    return agent;
  }

  async get(ctx: OrgContext, id: string) {
    const agent = await this.getOwned(ctx, id);
    const versions = await this.db
      .select({
        id: agentVersions.id,
        version: agentVersions.version,
        changelog: agentVersions.changelog,
        createdAt: agentVersions.createdAt,
        createdById: agentVersions.createdById,
      })
      .from(agentVersions)
      .where(and(eq(agentVersions.agentId, id), eq(agentVersions.organizationId, ctx.orgId)))
      .orderBy(desc(agentVersions.version));
    const config = agentConfigSchema.parse(agent.draftConfig);
    return {
      ...agent,
      draftConfig: config,
      versions,
      issues: await this.validate(ctx.orgId, config),
    };
  }

  async getVersion(ctx: OrgContext, agentId: string, versionId: string) {
    await this.getOwned(ctx, agentId);
    const v = await this.db.query.agentVersions.findFirst({
      where: and(
        eq(agentVersions.id, versionId),
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.organizationId, ctx.orgId),
      ),
    });
    if (!v) throw Errors.notFound('Agent version');
    return v;
  }

  async update(ctx: OrgContext, id: string, input: UpdateAgentInput) {
    const agent = await this.getOwned(ctx, id);
    if (agent.status === 'ARCHIVED') throw Errors.conflict('Archived agents cannot be edited');
    if (input.config) this.assertConfigAcceptable(input.config);
    return this.db.transaction(async (tx) => {
      // Optimistic concurrency: only apply if nobody changed the draft since the client loaded it.
      const [updated] = await tx
        .update(agents)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.config ? { draftConfig: input.config } : {}),
          draftRevision: agent.draftRevision + 1,
        })
        .where(
          and(
            eq(agents.id, id),
            eq(agents.organizationId, ctx.orgId),
            eq(agents.draftRevision, input.revision),
          ),
        )
        .returning();
      if (!updated)
        throw Errors.conflict(
          'This agent was modified by someone else. Reload to see the latest changes.',
        );
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'agent.updated',
          resourceType: 'agent',
          resourceId: id,
          metadata: {
            revision: updated.draftRevision,
            fields: Object.keys(input).filter((k) => k !== 'revision'),
          },
        },
        tx,
      );
      return { ...updated, draftConfig: agentConfigSchema.parse(updated.draftConfig) };
    });
  }

  async publish(ctx: OrgContext, id: string, revision: number, changelog: string) {
    return this.db.transaction(async (tx) => {
      const [agent] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, id), eq(agents.organizationId, ctx.orgId)))
        .for('update');
      if (!agent) throw Errors.notFound('Agent');
      if (agent.status === 'ARCHIVED') throw Errors.conflict('Archived agents cannot be published');
      if (agent.draftRevision !== revision) {
        throw Errors.conflict(
          'The draft changed since you last loaded it. Review the latest draft before publishing.',
        );
      }
      const config = agentConfigSchema.parse(agent.draftConfig);
      const errors = (await this.validate(ctx.orgId, config)).filter((i) => i.severity === 'error');
      if (errors.length) {
        throw Errors.validation(
          errors.map((e) => ({ path: e.field, message: e.message })),
          'Agent configuration is not valid for publishing',
        );
      }
      const versionNumber = agent.latestVersionNumber + 1;
      const [version] = await tx
        .insert(agentVersions)
        .values({
          organizationId: ctx.orgId,
          agentId: id,
          version: versionNumber,
          config,
          changelog,
          createdById: ctx.userId,
        })
        .returning();
      await tx
        .update(agents)
        .set({
          status: 'PUBLISHED',
          publishedVersionId: version!.id,
          latestVersionNumber: versionNumber,
        })
        .where(eq(agents.id, id));
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: 'agent.published',
          resourceType: 'agent',
          resourceId: id,
          metadata: { version: versionNumber, versionId: version!.id },
        },
        tx,
      );
      return version!;
    });
  }

  async setArchived(ctx: OrgContext, id: string, archived: boolean) {
    await this.db.transaction(async (tx) => {
      const agent = await this.getOwned(ctx, id, tx);
      const status: AgentStatus = archived
        ? 'ARCHIVED'
        : agent.publishedVersionId
          ? 'PUBLISHED'
          : 'DRAFT';
      await tx
        .update(agents)
        .set({ status, archivedAt: archived ? new Date() : null })
        .where(and(eq(agents.id, id), eq(agents.organizationId, ctx.orgId)));
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: archived ? 'agent.archived' : 'agent.restored',
          resourceType: 'agent',
          resourceId: id,
        },
        tx,
      );
    });
  }

  /** Hard constraints enforced on every save. */
  private assertConfigAcceptable(config: AgentConfig) {
    const details: { path: string; message: string }[] = [];
    if (!this.llm.isModelAllowed(config.model.provider, config.model.model)) {
      details.push({ path: 'config.model.model', message: 'Model is not allowed on this server' });
    }
    config.tools.forEach((t, i) => {
      if (!this.tools.has(t))
        details.push({ path: `config.tools.${i}`, message: `Unknown tool "${t}"` });
    });
    if (new Set(config.tools).size !== config.tools.length) {
      details.push({ path: 'config.tools', message: 'Duplicate tools' });
    }
    if (details.length) throw Errors.validation(details);
  }

  /** Errors block publishing; warnings are configuration risks surfaced in the builder. */
  async validate(orgId: string, config: AgentConfig): Promise<ConfigIssue[]> {
    const issues: ConfigIssue[] = [];
    if (!config.instructions.trim()) {
      issues.push({
        severity: 'error',
        field: 'instructions',
        message: 'Instructions are required before publishing',
      });
    }
    if (!this.llm.isModelAllowed(config.model.provider, config.model.model)) {
      issues.push({
        severity: 'error',
        field: 'model',
        message: 'Selected model is not allowed on this server',
      });
    }
    const provider = this.llm.catalog().providers.find((p) => p.id === config.model.provider);
    if (provider && !provider.configured) {
      issues.push({
        severity: 'warning',
        field: 'model',
        message: `${provider.name} is not configured; runs will fail until an API key is set`,
      });
    }
    const enabled = await this.toolSettings.enabledMap(orgId);
    for (const key of config.tools) {
      const t = this.tools.get(key);
      if (!t) {
        issues.push({ severity: 'error', field: 'tools', message: `Unknown tool "${key}"` });
        continue;
      }
      if (!enabled.get(key))
        issues.push({
          severity: 'warning',
          field: 'tools',
          message: `${t.name} is disabled for this organisation`,
        });
      const a = t.availability(this.config);
      if (!a.available)
        issues.push({
          severity: 'warning',
          field: 'tools',
          message: `${t.name} is unavailable: ${a.reason}`,
        });
      if (t.kind === 'MUTATION') {
        issues.push({
          severity: 'warning',
          field: 'tools',
          message: `${t.name} changes data (${t.risk} risk)`,
        });
      }
    }
    if (config.limits.maxSteps > 15) {
      issues.push({
        severity: 'warning',
        field: 'limits',
        message: 'High step limits increase cost and latency',
      });
    }
    return issues;
  }
}
