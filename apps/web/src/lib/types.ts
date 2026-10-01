import type { AgentConfig, AgentStatus, ExecutionStatus, Permission, Role } from '@nexa/shared';

export interface Me {
  user: { id: string; email: string; name: string };
  organizations: { id: string; name: string; slug: string; role: Role }[];
  activeOrganization: { id: string; name: string; slug: string; role: Role } | null;
  permissions: Permission[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  latestVersionNumber: number;
  publishedVersionId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ConfigIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface AgentDetail extends AgentSummary {
  draftConfig: AgentConfig;
  draftRevision: number;
  versions: { id: string; version: number; changelog: string; createdAt: string }[];
  issues: ConfigIssue[];
}

export interface ToolInfo {
  key: string;
  name: string;
  description: string;
  kind: 'READ' | 'MUTATION';
  risk: 'low' | 'medium' | 'high';
  permission: Permission;
  idempotent: boolean;
  enabled: boolean;
  available: boolean;
  unavailableReason: string | null;
  inputSchema: Record<string, unknown>;
}

export interface ModelCatalog {
  defaultProvider: string;
  defaultModel: string;
  providers: {
    id: string;
    name: string;
    configured: boolean;
    models: { id: string; pricing: { inputPerMTok: number; outputPerMTok: number } | null }[];
  }[];
}

export interface ExecutionSummary {
  id: string;
  agentId: string;
  agentName: string;
  status: ExecutionStatus;
  triggerSource: string;
  input: string;
  errorCode: string | null;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ToolCallRow {
  id: string;
  callId: string;
  toolKey: string;
  kind: 'READ' | 'MUTATION';
  status: 'DENIED' | 'INVALID' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  arguments: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  durationMs: number | null;
  createdAt: string;
}

export interface ExecutionDetail {
  id: string;
  agentId: string;
  agent: { id: string; name: string } | null;
  agentVersion: number | null;
  agentVersionId: string | null;
  status: ExecutionStatus;
  triggerSource: string;
  triggeredById: string | null;
  input: string;
  output: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryOfId: string | null;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  traceId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  model: { provider: string; model: string } | null;
  limits: { maxSteps: number; timeoutSeconds: number; maxTotalTokens: number } | null;
  toolCalls: ToolCallRow[];
  usage: {
    id: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    latencyMs: number;
    createdAt: string;
  }[];
  retryable: boolean;
  cancelRequested: boolean;
}

export interface TimelineEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status?: ExecutionStatus;
}

export interface AuditRow {
  id: string;
  actorType: 'USER' | 'AGENT' | 'SYSTEM';
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}
