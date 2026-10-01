/**
 * NexaOS relational schema (Drizzle ORM).
 *
 * Tenant boundary: every organisation-owned table carries `organization_id`, and every
 * service query filters on it (ADR-0003). Identifiers are UUIDv4.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const roleEnum = pgEnum('role', ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']);
export const agentStatusEnum = pgEnum('agent_status', ['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const executionStatusEnum = pgEnum('execution_status', [
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_TOOL',
  'WAITING_FOR_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);
export const triggerSourceEnum = pgEnum('trigger_source', [
  'TEST_CONSOLE',
  'MANUAL',
  'API',
  'WORKFLOW',
  'RETRY',
]);
export const toolKindEnum = pgEnum('tool_kind', ['READ', 'MUTATION']);
export const toolCallStatusEnum = pgEnum('tool_call_status', [
  'DENIED',
  'INVALID',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);
export const actorTypeEnum = pgEnum('actor_type', ['USER', 'AGENT', 'SYSTEM']);
export const orderStatusEnum = pgEnum('order_status', [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
]);
export const ticketStatusEnum = pgEnum('ticket_status', ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']);

// ---------- Identity ----------

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  /** Bumped on password change/reset; sessions created before it are invalid. */
  credentialsChangedAt: ts('credentials_changed_at').notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
);

// ---------- Tenancy ----------

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    organizationId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_uq').on(t.organizationId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

// ---------- Agents ----------

export const agents = pgTable(
  'agents',
  {
    id: id(),
    organizationId: orgId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: agentStatusEnum('status').notNull().default('DRAFT'),
    /** Mutable draft configuration, validated by agentConfigSchema. */
    draftConfig: jsonb('draft_config').notNull(),
    /** Optimistic-concurrency counter for draft edits. */
    draftRevision: integer('draft_revision').notNull().default(0),
    latestVersionNumber: integer('latest_version_number').notNull().default(0),
    publishedVersionId: uuid('published_version_id').references(
      (): AnyPgColumn => agentVersions.id,
    ),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [index('agents_org_status_idx').on(t.organizationId, t.status, t.updatedAt)],
);

/** Immutable snapshot of an agent configuration. Never updated after insert. */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: id(),
    organizationId: orgId(),
    agentId: uuid('agent_id')
      .notNull()
      .references((): AnyPgColumn => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    config: jsonb('config').notNull(),
    changelog: text('changelog').notNull().default(''),
    createdById: uuid('created_by_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('agent_versions_agent_version_uq').on(t.agentId, t.version),
    index('agent_versions_org_idx').on(t.organizationId),
  ],
);

/** Organisation-level on/off switch per registry tool. Absent row = registry default. */
export const orgToolSettings = pgTable(
  'org_tool_settings',
  {
    id: id(),
    organizationId: orgId(),
    toolKey: text('tool_key').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedById: uuid('updated_by_id'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('org_tool_settings_org_tool_uq').on(t.organizationId, t.toolKey)],
);

// ---------- Execution ----------

export const executions = pgTable(
  'executions',
  {
    id: id(),
    organizationId: orgId(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersionId: uuid('agent_version_id').references(() => agentVersions.id),
    /** Frozen configuration for this run (from a version, or the draft at trigger time). */
    config: jsonb('config').notNull(),
    status: executionStatusEnum('status').notNull().default('QUEUED'),
    triggerSource: triggerSourceEnum('trigger_source').notNull(),
    triggeredById: uuid('triggered_by_id'),
    input: text('input').notNull(),
    output: text('output'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    idempotencyKey: text('idempotency_key'),
    retryOfId: uuid('retry_of_id').references((): AnyPgColumn => executions.id),
    /** Persisted model transcript so a restarted worker resumes instead of starting over. */
    transcript: jsonb('transcript')
      .notNull()
      .default(sql`'[]'::jsonb`),
    stepCount: integer('step_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicros: integer('cost_micros').notNull().default(0),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    traceId: text('trace_id').notNull(),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    deadlineAt: ts('deadline_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('executions_org_idem_uq').on(t.organizationId, t.idempotencyKey),
    index('executions_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('executions_org_status_idx').on(t.organizationId, t.status),
    index('executions_agent_created_idx').on(t.agentId, t.createdAt.desc()),
  ],
);

export const executionEvents = pgTable(
  'execution_events',
  {
    id: id(),
    organizationId: orgId(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    /** Redacted, client-safe payload. */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('execution_events_exec_seq_uq').on(t.executionId, t.seq)],
);

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: id(),
    organizationId: orgId(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    /** Model-assigned id; (executionId, callId) is the idempotency key for the call. */
    callId: text('call_id').notNull(),
    toolKey: text('tool_key').notNull(),
    kind: toolKindEnum('kind').notNull(),
    status: toolCallStatusEnum('status').notNull(),
    arguments: jsonb('arguments')
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    uniqueIndex('tool_calls_exec_call_uq').on(t.executionId, t.callId),
    index('tool_calls_org_tool_idx').on(t.organizationId, t.toolKey, t.createdAt),
  ],
);

export const modelUsage = pgTable(
  'model_usage',
  {
    id: id(),
    organizationId: orgId(),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costMicros: integer('cost_micros').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('model_usage_org_created_idx').on(t.organizationId, t.createdAt)],
);

/** Append-only; UPDATE/DELETE are rejected by a trigger (see migration 0001). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestId: text('request_id'),
    ip: text('ip'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('audit_logs_org_action_idx').on(t.organizationId, t.action),
    index('audit_logs_org_resource_idx').on(t.organizationId, t.resourceType, t.resourceId),
  ],
);

// ---------- Business records used by tools ----------

export const customers = pgTable(
  'customers',
  {
    id: id(),
    organizationId: orgId(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('customers_org_email_uq').on(t.organizationId, t.email)],
);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    organizationId: orgId(),
    orderNumber: text('order_number').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    status: orderStatusEnum('status').notNull().default('PENDING'),
    totalCents: integer('total_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    estimatedDelivery: date('estimated_delivery', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_org_number_uq').on(t.organizationId, t.orderNumber),
    index('orders_org_customer_idx').on(t.organizationId, t.customerId),
  ],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    organizationId: orgId(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: ticketStatusEnum('status').notNull().default('OPEN'),
    priority: ticketPriorityEnum('priority').notNull().default('NORMAL'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    createdByExecutionId: uuid('created_by_execution_id'),
    createdByUserId: uuid('created_by_user_id'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('support_tickets_org_idem_uq').on(t.organizationId, t.idempotencyKey),
    index('support_tickets_org_created_idx').on(t.organizationId, t.createdAt.desc()),
  ],
);
