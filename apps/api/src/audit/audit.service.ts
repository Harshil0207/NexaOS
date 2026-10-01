import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lt, lte, or, SQL } from 'drizzle-orm';
import { decodeCursor, page } from '../common/pagination';
import { redact } from '../common/redact';
import type { AuthContext, OrgContext } from '../common/request-context';
import { DB, Database, DbOrTx } from '../db/db.module';
import { auditLogs } from '../db/schema';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export type AuditActor =
  | { kind: 'user'; ctx: AuthContext; orgId?: string | null }
  | { kind: 'agent'; orgId: string; executionId: string; requestId?: string | null }
  | { kind: 'system'; orgId?: string | null; requestId?: string | null };

export interface AuditQuery {
  limit: number;
  cursor?: string;
  action?: string;
  resourceType?: string;
  actorId?: string;
  q?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Append an audit event. Pass `tx` so the event commits atomically with the change it records. */
  async record(actor: AuditActor, entry: AuditEntry, tx: DbOrTx = this.db): Promise<void> {
    const base =
      actor.kind === 'user'
        ? {
            organizationId:
              actor.orgId ?? ('orgId' in actor.ctx ? (actor.ctx as OrgContext).orgId : null),
            actorType: 'USER' as const,
            actorId: actor.ctx.userId,
            requestId: actor.ctx.requestId,
            ip: actor.ctx.ip,
          }
        : actor.kind === 'agent'
          ? {
              organizationId: actor.orgId,
              actorType: 'AGENT' as const,
              actorId: actor.executionId,
              requestId: actor.requestId ?? null,
              ip: null,
            }
          : {
              organizationId: actor.orgId ?? null,
              actorType: 'SYSTEM' as const,
              actorId: null,
              requestId: actor.requestId ?? null,
              ip: null,
            };
    await tx.insert(auditLogs).values({
      ...base,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: (redact(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
    });
  }

  async list(ctx: OrgContext, q: AuditQuery) {
    const cursor = decodeCursor(q.cursor);
    const where: SQL[] = [eq(auditLogs.organizationId, ctx.orgId)];
    if (q.action) where.push(eq(auditLogs.action, q.action));
    if (q.resourceType) where.push(eq(auditLogs.resourceType, q.resourceType));
    if (q.actorId) where.push(eq(auditLogs.actorId, q.actorId));
    if (q.from) where.push(gte(auditLogs.createdAt, q.from));
    if (q.to) where.push(lte(auditLogs.createdAt, q.to));
    if (q.q) {
      const term = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      where.push(or(ilike(auditLogs.action, term), ilike(auditLogs.resourceId, term))!);
    }
    if (cursor) {
      where.push(
        or(
          lt(auditLogs.createdAt, cursor.createdAt),
          and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id)),
        )!,
      );
    }
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(and(...where))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(q.limit + 1);
    return page(rows, q.limit);
  }
}
