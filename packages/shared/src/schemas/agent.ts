import { z } from 'zod';
import { safeText } from './common';

export const AGENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const toolKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/);

export const agentLimitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(25).default(8),
  timeoutSeconds: z.number().int().min(10).max(900).default(120),
  maxTotalTokens: z.number().int().min(1_000).max(1_000_000).default(50_000),
});
export type AgentLimits = z.infer<typeof agentLimitsSchema>;

export const modelConfigSchema = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(100),
  temperature: z.number().min(0).max(1).default(0.2),
  maxOutputTokens: z.number().int().min(64).max(8192).default(1024),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

/** The mutable draft configuration of an agent. Publishing snapshots it into an immutable version. */
export const agentConfigSchema = z.object({
  instructions: z.string().max(20_000).default(''),
  model: modelConfigSchema,
  tools: z.array(toolKey).max(32).default([]),
  limits: agentLimitsSchema,
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const createAgentSchema = z.object({
  name: safeText(80),
  description: z.string().trim().max(500).default(''),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z.object({
  name: safeText(80).optional(),
  description: z.string().trim().max(500).optional(),
  config: agentConfigSchema.optional(),
  /** Optimistic concurrency: the draft revision the client edited. */
  revision: z.number().int().min(0),
});
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const publishAgentSchema = z.object({
  revision: z.number().int().min(0),
  changelog: z.string().trim().max(500).default(''),
});

export const runAgentSchema = z.object({
  input: z.string().trim().min(1).max(8_000),
  /** 'draft' runs the current draft config (test console); otherwise the latest published version. */
  target: z.enum(['draft', 'published']).default('published'),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type RunAgentInput = z.infer<typeof runAgentSchema>;

export const listAgentsQuery = z.object({
  status: z.enum(AGENT_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
});
