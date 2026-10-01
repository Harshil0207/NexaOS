import { Inject, Injectable, Logger } from '@nestjs/common';
import { ExecutionEventType, ExecutionStatus, sourcesFor } from '@nexa/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { redact } from '../common/redact';
import { DB, Database, Tx } from '../db/db.module';
import { executionEvents, executions } from '../db/schema';
import { RealtimeBus } from '../realtime/realtime.bus';

export interface ExecRef {
  id: string;
  organizationId: string;
  agentId: string;
}

type ExecPatch = Partial<typeof executions.$inferInsert>;

/** Thrown when an atomic status transition loses a race (e.g. the run was cancelled). */
export class StateConflict extends Error {
  constructor(public readonly to: ExecutionStatus) {
    super(`Execution could not transition to ${to}`);
  }
}

/**
 * Append-only execution timeline. Each event gets a per-execution monotonically increasing
 * `seq`, allocated inside the same transaction as the insert, which lets SSE clients resume
 * with Last-Event-ID without gaps or duplicates.
 */
@Injectable()
export class ExecutionEventsService {
  private readonly logger = new Logger(ExecutionEventsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bus: RealtimeBus,
  ) {}

  async append(exec: ExecRef, type: ExecutionEventType, payload: Record<string, unknown> = {}) {
    const ev = await this.db.transaction((tx) => this.insertEvent(tx, exec, type, payload));
    await this.publish(exec, ev);
    return ev;
  }

  /**
   * Atomic state transition + timeline event. The UPDATE only matches rows whose current status
   * may legally move to `to`, so concurrent transitions cannot both win.
   */
  async transition(
    exec: ExecRef,
    to: ExecutionStatus,
    patch: ExecPatch,
    type?: ExecutionEventType,
    payload: Record<string, unknown> = {},
  ): Promise<boolean> {
    const ev = await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(executions)
        .set({ ...patch, status: to })
        .where(and(eq(executions.id, exec.id), inArray(executions.status, sourcesFor(to))))
        .returning({ id: executions.id });
      if (updated.length === 0) return null;
      return type ? this.insertEvent(tx, exec, type, { ...payload, status: to }) : { status: to };
    });
    if (!ev) return false;
    if ('seq' in ev) await this.publish(exec, ev);
    return true;
  }

  /** Ephemeral token stream: published but not persisted. */
  publishDelta(exec: ExecRef, step: number, text: string) {
    this.bus
      .publishOrg(exec.organizationId, { kind: 'delta', executionId: exec.id, step, text })
      .catch((err: unknown) => this.logger.warn({ err }, 'Delta publish failed'));
  }

  private async insertEvent(
    tx: Tx,
    exec: ExecRef,
    type: ExecutionEventType,
    payload: Record<string, unknown>,
  ) {
    const [row] = await tx
      .update(executions)
      .set({ lastEventSeq: sql`${executions.lastEventSeq} + 1` })
      .where(eq(executions.id, exec.id))
      .returning({ seq: executions.lastEventSeq, status: executions.status });
    if (!row) throw new Error('Execution not found while appending event');
    const [ev] = await tx
      .insert(executionEvents)
      .values({
        organizationId: exec.organizationId,
        executionId: exec.id,
        seq: row.seq,
        type,
        payload: redact(payload) as Record<string, unknown>,
      })
      .returning();
    return { ...ev!, status: row.status };
  }

  private async publish(
    exec: ExecRef,
    ev: { seq: number; type: string; payload: unknown; createdAt: Date; status: string },
  ) {
    try {
      await this.bus.publishOrg(exec.organizationId, {
        kind: 'event',
        executionId: exec.id,
        agentId: exec.agentId,
        seq: ev.seq,
        type: ev.type,
        payload: ev.payload,
        status: ev.status,
        createdAt: ev.createdAt.toISOString(),
      });
    } catch (err) {
      // The event is durable; clients recover it via replay on reconnect.
      this.logger.warn({ err }, 'Realtime publish failed');
    }
  }
}
