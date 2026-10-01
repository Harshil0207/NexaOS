import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { OrgContext } from '../common/request-context';
import { AppConfig, CONFIG } from '../config/config';
import { DB, Database } from '../db/db.module';
import { orgToolSettings } from '../db/schema';
import { ToolRegistry } from './tool.registry';

@Injectable()
export class ToolsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly registry: ToolRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Effective enabled flag per tool for an organisation (row overrides the registry default). */
  async enabledMap(orgId: string): Promise<Map<string, boolean>> {
    const rows = await this.db
      .select()
      .from(orgToolSettings)
      .where(eq(orgToolSettings.organizationId, orgId));
    const overrides = new Map(rows.map((r) => [r.toolKey, r.enabled]));
    return new Map(
      this.registry.list().map((t) => [t.key, overrides.get(t.key) ?? t.defaultEnabled]),
    );
  }

  async list(ctx: OrgContext) {
    const enabled = await this.enabledMap(ctx.orgId);
    return this.registry.list().map((t) => {
      const availability = t.availability(this.config);
      return {
        key: t.key,
        name: t.name,
        description: t.description,
        kind: t.kind,
        risk: t.risk,
        permission: t.permission,
        idempotent: t.idempotent,
        enabled: enabled.get(t.key) ?? false,
        available: availability.available,
        unavailableReason: availability.available ? null : availability.reason,
        inputSchema: this.registry.inputJsonSchema(t),
      };
    });
  }

  async setEnabled(ctx: OrgContext, key: string, enabled: boolean) {
    if (!this.registry.has(key)) throw Errors.notFound('Tool');
    await this.db.transaction(async (tx) => {
      await tx
        .insert(orgToolSettings)
        .values({ organizationId: ctx.orgId, toolKey: key, enabled, updatedById: ctx.userId })
        .onConflictDoUpdate({
          target: [orgToolSettings.organizationId, orgToolSettings.toolKey],
          set: { enabled, updatedById: ctx.userId },
        });
      await this.audit.record(
        { kind: 'user', ctx },
        {
          action: enabled ? 'tool.enabled' : 'tool.disabled',
          resourceType: 'tool',
          resourceId: key,
        },
        tx,
      );
    });
  }

  async isEnabled(orgId: string, key: string): Promise<boolean> {
    const tool = this.registry.get(key);
    if (!tool) return false;
    const row = await this.db.query.orgToolSettings.findFirst({
      where: and(eq(orgToolSettings.organizationId, orgId), eq(orgToolSettings.toolKey, key)),
    });
    return row?.enabled ?? tool.defaultEnabled;
  }
}
