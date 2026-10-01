import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentConfig, Role, roleHasPermission } from '@nexa/shared';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { redact } from '../common/redact';
import { AppConfig, CONFIG } from '../config/config';
import { DB, Database } from '../db/db.module';
import { memberships, toolCalls } from '../db/schema';
import type { LlmToolResultBlock, LlmToolUseBlock } from '../llm/llm.types';
import { defaultSleep } from '../llm/retry';
import { MailService } from '../mail/mail.service';
import { MetricsService } from '../metrics/metrics.service';
import { ToolRegistry } from '../tools/tool.registry';
import { ToolError, type ToolDefinition } from '../tools/tool.types';
import { ToolsService } from '../tools/tools.service';
import { ExecRef, ExecutionEventsService } from './execution-events.service';

export interface ToolRunContext extends ExecRef {
  triggeredById: string | null;
  traceId: string;
  config: AgentConfig;
}

type Outcome =
  | { status: 'SUCCEEDED'; result: unknown }
  | { status: 'DENIED' | 'INVALID' | 'FAILED'; code: string; message: string; details?: unknown };

const MAX_TOOL_RETRIES = 2;

class ToolTimeoutError extends Error {}

/**
 * Privileged subsystem: every model-requested tool call passes allowlist, org switch,
 * availability, caller-permission and schema checks before any handler runs.
 */
@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly registry: ToolRegistry,
    private readonly settings: ToolsService,
    private readonly events: ExecutionEventsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly metrics: MetricsService,
  ) {}

  async run(
    ctx: ToolRunContext,
    call: LlmToolUseBlock,
    signal: AbortSignal,
  ): Promise<LlmToolResultBlock> {
    // Resume safety: a call that already reached a final state is never executed again.
    const prior = await this.db.query.toolCalls.findFirst({
      where: and(eq(toolCalls.executionId, ctx.id), eq(toolCalls.callId, call.id)),
    });
    if (prior && prior.status !== 'RUNNING') {
      return this.toBlock(
        call.id,
        prior.status === 'SUCCEEDED'
          ? { status: 'SUCCEEDED', result: prior.result }
          : {
              status: prior.status,
              code: prior.errorCode ?? 'ERROR',
              message: prior.errorMessage ?? 'Tool call failed',
            },
      );
    }

    const def = this.registry.get(call.name);
    if (!prior) {
      await this.events.append(ctx, 'tool.requested', {
        callId: call.id,
        tool: call.name,
        arguments: call.input,
      });
    }
    const gate = await this.gate(ctx, call, def);
    if (gate) return this.finalize(ctx, call, def, gate, null);

    const parsed = def!.input.safeParse(call.input);
    if (!parsed.success) {
      return this.finalize(
        ctx,
        call,
        def,
        {
          status: 'INVALID',
          code: 'INVALID_ARGUMENTS',
          message: 'Tool arguments failed validation',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        null,
      );
    }

    if (prior?.status === 'RUNNING' && !def!.idempotent) {
      // A previous worker crashed mid-call; the side effect may or may not have happened.
      return this.finalize(
        ctx,
        call,
        def,
        {
          status: 'FAILED',
          code: 'TOOL_OUTCOME_UNKNOWN',
          message: 'A previous attempt was interrupted and this tool cannot be safely retried',
        },
        null,
      );
    }

    await this.db
      .insert(toolCalls)
      .values({
        organizationId: ctx.organizationId,
        executionId: ctx.id,
        callId: call.id,
        toolKey: def!.key,
        kind: def!.kind,
        status: 'RUNNING',
        arguments: redact(parsed.data) as Record<string, unknown>,
        attempts: 1,
      })
      .onConflictDoUpdate({
        target: [toolCalls.executionId, toolCalls.callId],
        set: { attempts: sql`${toolCalls.attempts} + 1`, status: 'RUNNING' },
      });
    await this.events.append(ctx, 'tool.started', {
      callId: call.id,
      tool: def!.key,
      kind: def!.kind,
    });

    const started = Date.now();
    const outcome = await this.executeWithRetry(ctx, call, def!, parsed.data, signal);
    return this.finalize(ctx, call, def, outcome, Date.now() - started);
  }

  private async gate(
    ctx: ToolRunContext,
    call: LlmToolUseBlock,
    def: ToolDefinition | undefined,
  ): Promise<Outcome | null> {
    if (!def || !ctx.config.tools.includes(call.name)) {
      return {
        status: 'DENIED',
        code: 'TOOL_NOT_ALLOWED',
        message: `Tool "${call.name}" is not available to this agent`,
      };
    }
    if (!(await this.settings.isEnabled(ctx.organizationId, def.key))) {
      return {
        status: 'DENIED',
        code: 'TOOL_DISABLED',
        message: `${def.name} is disabled for this organisation`,
      };
    }
    const availability = def.availability(this.config);
    if (!availability.available) {
      return {
        status: 'DENIED',
        code: 'TOOL_UNAVAILABLE',
        message: `${def.name} is unavailable: ${availability.reason}`,
      };
    }
    // Agents act on behalf of the triggering user, with that user's *current* permissions.
    const role = ctx.triggeredById
      ? await this.currentRole(ctx.organizationId, ctx.triggeredById)
      : null;
    if (!role || !roleHasPermission(role, def.permission)) {
      return {
        status: 'DENIED',
        code: 'PERMISSION_DENIED',
        message: `The user who started this run does not have the "${def.permission}" permission required by ${def.name}`,
      };
    }
    if (
      typeof call.input !== 'object' ||
      call.input === null ||
      (call.input as Record<string, unknown>).__malformed
    ) {
      return {
        status: 'INVALID',
        code: 'MALFORMED_TOOL_CALL',
        message: 'Tool call arguments were not a valid JSON object',
      };
    }
    return null;
  }

  private async currentRole(orgId: string, userId: string): Promise<Role | null> {
    const m = await this.db.query.memberships.findFirst({
      where: and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId)),
      columns: { role: true },
    });
    return m?.role ?? null;
  }

  private async executeWithRetry(
    ctx: ToolRunContext,
    call: LlmToolUseBlock,
    def: ToolDefinition,
    input: unknown,
    signal: AbortSignal,
  ): Promise<Outcome> {
    for (let attempt = 0; ; attempt++) {
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(new ToolTimeoutError()),
        this.config.TOOL_TIMEOUT_MS,
      );
      const combined = AbortSignal.any([signal, timeout.signal]);
      try {
        const result = await Promise.race([
          def.execute(input, {
            orgId: ctx.organizationId,
            executionId: ctx.id,
            callId: call.id,
            idempotencyKey: `${ctx.id}:${call.id}`,
            triggeredByUserId: ctx.triggeredById,
            signal: combined,
            deps: { db: this.db, config: this.config, mail: this.mail },
          }),
          new Promise<never>((_, reject) => {
            combined.addEventListener('abort', () => reject(combined.reason), { once: true });
          }),
        ]);
        const out = def.output.safeParse(result);
        if (!out.success) {
          this.logger.error(
            { tool: def.key, issues: out.error.issues },
            'Tool returned invalid output',
          );
          return {
            status: 'FAILED',
            code: 'INVALID_TOOL_OUTPUT',
            message: 'Tool produced an unexpected result',
          };
        }
        return { status: 'SUCCEEDED', result: out.data };
      } catch (err) {
        if (signal.aborted) throw signal.reason; // cancellation/deadline: let the runtime decide
        const retryable =
          def.idempotent &&
          (err instanceof ToolTimeoutError || (err instanceof ToolError && err.retryable));
        if (retryable && attempt < MAX_TOOL_RETRIES) {
          await defaultSleep(250 * 2 ** attempt, signal);
          continue;
        }
        if (err instanceof ToolTimeoutError) {
          return {
            status: 'FAILED',
            code: 'TOOL_TIMEOUT',
            message: `${def.name} timed out after ${this.config.TOOL_TIMEOUT_MS}ms`,
          };
        }
        if (err instanceof ToolError)
          return { status: 'FAILED', code: err.code, message: err.message };
        this.logger.error({ err, tool: def.key }, 'Tool handler threw');
        return { status: 'FAILED', code: 'TOOL_ERROR', message: `${def.name} failed unexpectedly` };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async finalize(
    ctx: ToolRunContext,
    call: LlmToolUseBlock,
    def: ToolDefinition | undefined,
    outcome: Outcome,
    durationMs: number | null,
  ): Promise<LlmToolResultBlock> {
    const toolKey = def?.key ?? call.name.slice(0, 64);
    const failed = outcome.status !== 'SUCCEEDED';
    const values = {
      status: outcome.status,
      result: outcome.status === 'SUCCEEDED' ? (redact(outcome.result) as object) : null,
      errorCode: failed ? outcome.code : null,
      errorMessage: failed ? outcome.message : null,
      durationMs,
      finishedAt: new Date(),
    };
    await this.db
      .insert(toolCalls)
      .values({
        organizationId: ctx.organizationId,
        executionId: ctx.id,
        callId: call.id,
        toolKey,
        kind: def?.kind ?? 'READ',
        arguments: redact(call.input ?? {}) as Record<string, unknown>,
        ...values,
      })
      .onConflictDoUpdate({ target: [toolCalls.executionId, toolCalls.callId], set: values });

    const eventType =
      outcome.status === 'SUCCEEDED'
        ? 'tool.succeeded'
        : outcome.status === 'DENIED'
          ? 'tool.denied'
          : outcome.status === 'INVALID'
            ? 'tool.invalid'
            : 'tool.failed';
    await this.events.append(ctx, eventType, {
      callId: call.id,
      tool: toolKey,
      durationMs,
      ...(outcome.status === 'SUCCEEDED'
        ? { result: outcome.result }
        : { code: outcome.code, message: outcome.message, details: outcome.details }),
    });
    if (durationMs !== null) {
      this.metrics.toolDuration.observe(
        { tool: toolKey, outcome: outcome.status.toLowerCase() },
        durationMs / 1000,
      );
    }
    if (
      outcome.status === 'DENIED' ||
      (def?.kind === 'MUTATION' && outcome.status === 'SUCCEEDED')
    ) {
      await this.audit.record(
        { kind: 'agent', orgId: ctx.organizationId, executionId: ctx.id, requestId: ctx.traceId },
        {
          action: outcome.status === 'DENIED' ? 'tool.denied' : 'tool.executed',
          resourceType: 'tool',
          resourceId: toolKey,
          metadata: {
            executionId: ctx.id,
            callId: call.id,
            triggeredBy: ctx.triggeredById,
            ...(outcome.status === 'DENIED' ? { code: outcome.code } : {}),
          },
        },
      );
    }
    return this.toBlock(call.id, outcome);
  }

  private toBlock(callId: string, outcome: Outcome): LlmToolResultBlock {
    return outcome.status === 'SUCCEEDED'
      ? {
          type: 'tool_result',
          toolUseId: callId,
          content: JSON.stringify(outcome.result),
          isError: false,
        }
      : {
          type: 'tool_result',
          toolUseId: callId,
          content: JSON.stringify({
            error: { code: outcome.code, message: outcome.message, details: outcome.details },
          }),
          isError: true,
        };
  }
}
