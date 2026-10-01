import type { Permission } from '@nexa/shared';
import type { z } from 'zod';
import type { AppConfig } from '../config/config';
import type { Database } from '../db/db.module';
import type { MailService } from '../mail/mail.service';

export interface ToolRuntimeDeps {
  db: Database;
  config: AppConfig;
  mail: MailService;
}

export interface ToolContext {
  orgId: string;
  executionId: string;
  callId: string;
  /** Stable key for this logical call; mutation handlers must use it to dedupe side effects. */
  idempotencyKey: string;
  triggeredByUserId: string | null;
  signal: AbortSignal;
  deps: ToolRuntimeDeps;
}

export type ToolAvailability = { available: true } | { available: false; reason: string };

export interface ToolDefinition<I = unknown, O = unknown> {
  key: string;
  name: string;
  description: string;
  kind: 'READ' | 'MUTATION';
  /** Permission the triggering user must hold for the agent to use this tool on their behalf. */
  permission: Permission;
  /** Safe to retry automatically on transient failure. Mutations must dedupe via idempotencyKey. */
  idempotent: boolean;
  defaultEnabled: boolean;
  risk: 'low' | 'medium' | 'high';
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  availability(config: AppConfig): ToolAvailability;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

/** Structured, model-safe tool failure. */
export class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export const defineTool = <I, O>(def: ToolDefinition<I, O>) => def as unknown as ToolDefinition;
