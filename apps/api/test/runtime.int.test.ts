import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentConfig } from '@nexa/shared';
import { and, asc, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONFIG, AppConfig } from '../src/config/config';
import { CoreModule } from '../src/core.module';
import { DB, Database } from '../src/db/db.module';
import {
  auditLogs,
  executionEvents,
  executions,
  modelUsage,
  supportTickets,
  toolCalls,
} from '../src/db/schema';
import { LlmRegistry } from '../src/llm/llm.registry';
import { LlmError } from '../src/llm/llm.types';
import { AgentRuntime } from '../src/runtime/agent-runtime';
import { CancellationRegistry } from '../src/runtime/cancellation.registry';
import { ToolExecutor } from '../src/runtime/tool-executor';
import { ToolRegistry } from '../src/tools/tool.registry';
import { defineTool, ToolError } from '../src/tools/tool.types';
import { FakeLlmProvider, hang, text, toolUse } from './fake-llm';
import { createOrg, orgWithMember, registerUser, startApp, type Client } from './helpers';

let app: INestApplication;
let worker: INestApplicationContext;
let db: Database;
let runtime: AgentRuntime;
let fake: FakeLlmProvider;
const redis = new Redis(process.env.REDIS_URL!);

let owner: Client;
let orgId: string;
let agentId: string;

// A slow tool registered only for tests, to exercise timeouts.
const slowTool = defineTool({
  key: 'slowTestTool',
  name: 'Slow test tool',
  description: 'test only',
  kind: 'READ',
  permission: 'records:read',
  idempotent: false,
  defaultEnabled: true,
  risk: 'low',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  availability: () => ({ available: true }),
  execute: (_i, ctx) =>
    new Promise((_, reject) =>
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason)),
    ),
});
const flakyCalls = { n: 0 };
const flakyTool = defineTool({
  key: 'flakyTestTool',
  name: 'Flaky test tool',
  description: 'test only',
  kind: 'READ',
  permission: 'records:read',
  idempotent: true,
  defaultEnabled: true,
  risk: 'low',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  availability: () => ({ available: true }),
  async execute() {
    if (flakyCalls.n++ < 1) throw new ToolError('UPSTREAM', 'transient', true);
    return { ok: true };
  },
});

beforeAll(async () => {
  app = await startApp();
  const moduleRef = await Test.createTestingModule({
    imports: [CoreModule],
    providers: [AgentRuntime, ToolExecutor],
  })
    .overrideProvider(CONFIG)
    .useFactory({
      factory: () => ({
        ...(app.get(CONFIG) as AppConfig),
        TOOL_TIMEOUT_MS: 300,
        LLM_MAX_RETRIES: 2,
      }),
    })
    .compile();
  worker = await moduleRef.init();
  db = worker.get(DB);
  runtime = worker.get(AgentRuntime);
  fake = new FakeLlmProvider(() => text('unused'));
  worker.get(LlmRegistry).register(fake);
  const registry = worker.get(ToolRegistry);
  registry.register(slowTool);
  registry.register(flakyTool);

  owner = await registerUser(app, 'Owner');
  orgId = await createOrg(owner, 'Runtime Org');
  agentId = (await owner.post('/api/v1/agents').send({ name: 'Support Agent' }).expect(201)).body
    .id;
  const cust = (
    await owner
      .post('/api/v1/records/customers')
      .send({ name: 'Jane Doe', email: 'jane@example.com' })
      .expect(201)
  ).body;
  await owner
    .post('/api/v1/records/orders')
    .send({
      orderNumber: '1234',
      customerId: cust.id,
      status: 'SHIPPED',
      totalCents: 4999,
      carrier: 'UPS',
      trackingNumber: '1Z999',
      estimatedDelivery: '2026-10-01',
    })
    .expect(201);
});
beforeEach(async () => {
  await redis.flushdb();
  fake.calls = [];
});
afterAll(async () => {
  await worker.close();
  await app.close();
  await redis.quit();
});

const baseConfig = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  instructions: 'You are a support agent.',
  model: { provider: 'fake', model: 'fake-model', temperature: 0, maxOutputTokens: 256 },
  tools: ['getOrder', 'createSupportTicket'],
  limits: { maxSteps: 6, timeoutSeconds: 60, maxTotalTokens: 50_000 },
  ...over,
});

async function newExecution(
  opts: {
    config?: AgentConfig;
    userId?: string;
    org?: string;
    agent?: string;
    input?: string;
    patch?: Partial<typeof executions.$inferInsert>;
  } = {},
) {
  const [row] = await db
    .insert(executions)
    .values({
      organizationId: opts.org ?? orgId,
      agentId: opts.agent ?? agentId,
      config: opts.config ?? baseConfig(),
      triggerSource: 'TEST_CONSOLE',
      triggeredById: opts.userId ?? owner.userId!,
      input: opts.input ?? 'Where is order #1234?',
      traceId: 'test-trace',
      ...opts.patch,
    })
    .returning();
  return row!;
}

const load = (id: string) => db.query.executions.findFirst({ where: eq(executions.id, id) });
const eventsOf = async (id: string) =>
  (
    await db
      .select()
      .from(executionEvents)
      .where(eq(executionEvents.executionId, id))
      .orderBy(asc(executionEvents.seq))
  ).map((e) => e.type);
const callsOf = (id: string) =>
  db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.executionId, id))
    .orderBy(asc(toolCalls.createdAt));

describe('agent runtime', () => {
  it('answers "Where is order #1234?" via the getOrder tool and records a full timeline', async () => {
    fake.script = (req, i) => {
      if (i === 0)
        return toolUse([{ id: 'c1', name: 'getOrder', input: { orderNumber: '#1234' } }]);
      const result = req.messages.at(-1)!.content[0] as {
        type: string;
        content: string;
        isError: boolean;
      };
      expect(result.type).toBe('tool_result');
      expect(result.isError).toBe(false);
      const data = JSON.parse(result.content);
      return text(
        `Order ${data.order.orderNumber} is ${data.order.status} via ${data.order.carrier}.`,
      );
    };
    const exec = await newExecution();
    await runtime.run(exec.id);
    const done = await load(exec.id);
    expect(done).toMatchObject({
      status: 'COMPLETED',
      output: 'Order 1234 is SHIPPED via UPS.',
      stepCount: 2,
      inputTokens: 200,
      outputTokens: 40,
    });
    expect(done!.transcript).toEqual([]); // transient context is not retained after completion
    expect(await eventsOf(exec.id)).toEqual([
      'execution.started',
      'llm.request',
      'llm.response',
      'tool.requested',
      'tool.started',
      'tool.succeeded',
      'llm.request',
      'llm.response',
      'execution.completed',
    ]);
    const calls = await callsOf(exec.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ toolKey: 'getOrder', status: 'SUCCEEDED', kind: 'READ' });
    const usage = await db.select().from(modelUsage).where(eq(modelUsage.executionId, exec.id));
    expect(usage).toHaveLength(2);
    // Tools were exposed to the model with JSON Schemas, and the system prompt carries guardrails.
    expect(fake.calls[0]!.tools.map((t) => t.name)).toEqual(['getOrder', 'createSupportTicket']);
    expect(fake.calls[0]!.system).toMatch(/untrusted data/);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, exec.id), eq(auditLogs.action, 'execution.completed')));
    expect(audit).toHaveLength(1);
  });

  it('denies a mutation tool when the triggering user lacks permission, and tells the model', async () => {
    const { member, orgId: org2 } = await orgWithMember(app, 'MEMBER');
    const agent2 = (
      await db.execute<{ id: string }>(
        // Agent created directly: members cannot create agents via the API.
        (await import('drizzle-orm'))
          .sql`insert into agents (organization_id, name, draft_config, created_by_id) values (${org2}, 'A', '{}'::jsonb, ${member.userId}) returning id`,
      )
    ).rows[0]!.id;
    fake.script = (req, i) => {
      if (i === 0)
        return toolUse([
          {
            id: 'd1',
            name: 'createSupportTicket',
            input: { subject: 'Refund', body: 'Please refund' },
          },
        ]);
      const r = req.messages.at(-1)!.content[0] as { content: string; isError: boolean };
      expect(r.isError).toBe(true);
      expect(JSON.parse(r.content).error.code).toBe('PERMISSION_DENIED');
      return text('I am not allowed to create tickets.');
    };
    const exec = await newExecution({ org: org2, agent: agent2, userId: member.userId });
    await runtime.run(exec.id);
    expect((await load(exec.id))!.status).toBe('COMPLETED');
    expect((await callsOf(exec.id))[0]).toMatchObject({
      status: 'DENIED',
      errorCode: 'PERMISSION_DENIED',
    });
    expect(
      await db.select().from(supportTickets).where(eq(supportTickets.organizationId, org2)),
    ).toHaveLength(0);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org2), eq(auditLogs.action, 'tool.denied')));
    expect(audit).toHaveLength(1);
  });

  it('denies tools not attached to the agent, and rejects invalid and malformed arguments', async () => {
    fake.script = (_req, i) =>
      i === 0
        ? toolUse([
            {
              id: 'x1',
              name: 'sendCustomerEmail',
              input: { to: 'a@b.co', subject: 's', body: 'b' },
            },
            { id: 'x2', name: 'getOrder', input: { orderNumber: "1234'; DROP TABLE orders;--" } },
            { id: 'x3', name: 'getOrder', input: { __malformed: true } },
            { id: 'x4', name: 'noSuchTool', input: {} },
          ])
        : text('done');
    const exec = await newExecution();
    await runtime.run(exec.id);
    const calls = await callsOf(exec.id);
    const byId = Object.fromEntries(calls.map((c) => [c.callId, c]));
    expect(byId.x1).toMatchObject({ status: 'DENIED', errorCode: 'TOOL_NOT_ALLOWED' });
    expect(byId.x2).toMatchObject({ status: 'INVALID', errorCode: 'INVALID_ARGUMENTS' });
    expect(byId.x3).toMatchObject({ status: 'INVALID', errorCode: 'MALFORMED_TOOL_CALL' });
    expect(byId.x4).toMatchObject({ status: 'DENIED', errorCode: 'TOOL_NOT_ALLOWED' });
    expect((await load(exec.id))!.status).toBe('COMPLETED');
  });

  it('denies tools disabled at the organisation level', async () => {
    await owner.patch('/api/v1/tools/getOrder').send({ enabled: false }).expect(200);
    try {
      fake.script = (_r, i) =>
        i === 0
          ? toolUse([{ id: 'o1', name: 'getOrder', input: { orderNumber: '1234' } }])
          : text('ok');
      const exec = await newExecution();
      await runtime.run(exec.id);
      expect((await callsOf(exec.id))[0]).toMatchObject({
        status: 'DENIED',
        errorCode: 'TOOL_DISABLED',
      });
    } finally {
      await owner.patch('/api/v1/tools/getOrder').send({ enabled: true }).expect(200);
    }
  });

  it('reports tool failures to the model without failing the run', async () => {
    fake.script = (_r, i) =>
      i === 0
        ? toolUse([
            {
              id: 'f1',
              name: 'createSupportTicket',
              input: { subject: 'Late', body: 'Order late', orderNumber: '9999' },
            },
          ])
        : text('That order does not exist.');
    const exec = await newExecution();
    await runtime.run(exec.id);
    expect((await callsOf(exec.id))[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'ORDER_NOT_FOUND',
    });
    expect(await eventsOf(exec.id)).toContain('tool.failed');
    expect((await load(exec.id))!.status).toBe('COMPLETED');
  });

  it('times out slow tools and retries transient failures only for idempotent tools', async () => {
    fake.script = (_r, i) =>
      i === 0
        ? toolUse([
            { id: 's1', name: 'slowTestTool', input: {} },
            { id: 's2', name: 'flakyTestTool', input: {} },
          ])
        : text('ok');
    const exec = await newExecution({
      config: baseConfig({ tools: ['slowTestTool', 'flakyTestTool'] }),
    });
    await runtime.run(exec.id);
    const calls = await callsOf(exec.id);
    expect(calls.find((c) => c.callId === 's1')).toMatchObject({
      status: 'FAILED',
      errorCode: 'TOOL_TIMEOUT',
    });
    expect(calls.find((c) => c.callId === 's2')).toMatchObject({ status: 'SUCCEEDED' });
    expect(flakyCalls.n).toBe(2);
  });

  it('retries transient LLM errors, then fails with a clear code when they persist', async () => {
    let n = 0;
    fake.script = () => {
      n++;
      throw new LlmError('PROVIDER_TIMEOUT', 'timed out', true);
    };
    const exec = await newExecution();
    await runtime.run(exec.id);
    const done = await load(exec.id);
    expect(n).toBe(3); // initial + LLM_MAX_RETRIES
    expect(done).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_TIMEOUT', output: null });
    const types = await eventsOf(exec.id);
    expect(types.filter((t) => t === 'llm.retry')).toHaveLength(2);
    expect(types).toContain('llm.error');
    expect(types.at(-1)).toBe('execution.failed');
  });

  it('fails immediately on non-retryable provider errors', async () => {
    let n = 0;
    fake.script = () => {
      n++;
      throw new LlmError('PROVIDER_REQUEST_REJECTED', 'bad key', false);
    };
    const exec = await newExecution();
    await runtime.run(exec.id);
    expect(n).toBe(1);
    expect(await load(exec.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_REQUEST_REJECTED',
    });
  });

  it('fails when the provider is not configured (never fakes a response)', async () => {
    const exec = await newExecution({
      config: baseConfig({
        model: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          temperature: 0,
          maxOutputTokens: 256,
        },
      }),
    });
    await runtime.run(exec.id);
    expect(await load(exec.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_NOT_CONFIGURED',
      output: null,
    });
  });

  it('rejects malformed model responses (duplicate tool call ids, empty content)', async () => {
    fake.script = () =>
      toolUse([
        { id: 'dup', name: 'getOrder', input: {} },
        { id: 'dup', name: 'getOrder', input: {} },
      ]);
    const e1 = await newExecution();
    await runtime.run(e1.id);
    expect(await load(e1.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_INVALID_RESPONSE',
    });

    fake.script = () => ({
      content: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 0 },
      model: 'fake-model',
      latencyMs: 1,
    });
    const e2 = await newExecution();
    await runtime.run(e2.id);
    expect(await load(e2.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_INVALID_RESPONSE',
    });
  });

  it('enforces the token budget', async () => {
    fake.script = () =>
      toolUse([{ id: `t${Math.random()}`, name: 'getOrder', input: { orderNumber: '1234' } }], {
        inputTokens: 30_000,
        outputTokens: 1_000,
      });
    const exec = await newExecution({
      config: baseConfig({ limits: { maxSteps: 10, timeoutSeconds: 60, maxTotalTokens: 50_000 } }),
    });
    await runtime.run(exec.id);
    expect(await load(exec.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'TOKEN_BUDGET_EXCEEDED',
      stepCount: 2,
    });
  });

  it('stops runaway tool loops at maxSteps', async () => {
    let i = 0;
    fake.script = () =>
      toolUse([{ id: `loop${i++}`, name: 'getOrder', input: { orderNumber: '1234' } }]);
    const exec = await newExecution({
      config: baseConfig({ limits: { maxSteps: 3, timeoutSeconds: 60, maxTotalTokens: 50_000 } }),
    });
    await runtime.run(exec.id);
    expect(await load(exec.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'MAX_STEPS_EXCEEDED',
      stepCount: 3,
    });
    expect(fake.calls.length).toBeGreaterThan(0);
  });

  it('cancels an in-flight model call', async () => {
    fake.script = (req) => hang(req);
    const exec = await newExecution();
    const running = runtime.run(exec.id);
    await new Promise((r) => setTimeout(r, 150));
    await owner.post(`/api/v1/executions/${exec.id}/cancel`).expect(200);
    worker.get(CancellationRegistry).abort(exec.id); // same effect as the broadcast reaching this worker
    await running;
    const done = await load(exec.id);
    expect(done).toMatchObject({ status: 'CANCELLED', cancelRequested: true });
    expect(await eventsOf(exec.id)).toEqual(
      expect.arrayContaining(['execution.cancel_requested', 'execution.cancelled']),
    );
  });

  it('times out when the deadline passes', async () => {
    fake.script = (req) => hang(req);
    const exec = await newExecution({
      patch: { status: 'RUNNING', startedAt: new Date(), deadlineAt: new Date(Date.now() + 200) },
    });
    await runtime.run(exec.id);
    expect(await load(exec.id)).toMatchObject({
      status: 'TIMED_OUT',
      errorCode: 'EXECUTION_TIMEOUT',
    });
  });

  it('resumes after a worker crash without repeating completed side effects', async () => {
    // Simulate: the model requested a ticket, the ticket was created, then the worker died
    // before the transcript recorded the result.
    const exec = await newExecution({
      patch: {
        status: 'WAITING_FOR_TOOL',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60_000),
        stepCount: 1,
        transcript: [
          { role: 'user', content: [{ type: 'text', text: 'Open a ticket for order 1234' }] },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'r1',
                name: 'createSupportTicket',
                input: { subject: 'Help', body: 'Order 1234 issue', orderNumber: '1234' },
              },
            ],
          },
        ],
      },
    });
    // First "attempt" created the ticket and was interrupted mid-call (row left RUNNING).
    await db.insert(supportTickets).values({
      organizationId: orgId,
      subject: 'Help',
      body: 'Order 1234 issue',
      idempotencyKey: `${exec.id}:r1`,
    });
    await db.insert(toolCalls).values({
      organizationId: orgId,
      executionId: exec.id,
      callId: 'r1',
      toolKey: 'createSupportTicket',
      kind: 'MUTATION',
      status: 'RUNNING',
      attempts: 1,
    });

    fake.script = () => text('Ticket created.');
    await runtime.run(exec.id);
    const done = await load(exec.id);
    expect(done!.status).toBe('COMPLETED');
    const tickets = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.idempotencyKey, `${exec.id}:r1`));
    expect(tickets).toHaveLength(1); // deduplicated, not duplicated
    const call = (await callsOf(exec.id))[0]!;
    expect(call).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
    expect((call.result as { deduplicated: boolean }).deduplicated).toBe(true);
    expect(await eventsOf(exec.id)).toContain('execution.resumed');
    expect(fake.calls).toHaveLength(1); // no extra model call for the already-requested tool
  });

  it('never re-runs a non-idempotent tool whose outcome is unknown after a crash', async () => {
    const exec = await newExecution({
      config: baseConfig({ tools: ['slowTestTool'] }),
      patch: {
        status: 'WAITING_FOR_TOOL',
        startedAt: new Date(),
        deadlineAt: new Date(Date.now() + 60_000),
        stepCount: 1,
        transcript: [
          { role: 'user', content: [{ type: 'text', text: 'go' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'u1', name: 'slowTestTool', input: {} }],
          },
        ],
      },
    });
    await db.insert(toolCalls).values({
      organizationId: orgId,
      executionId: exec.id,
      callId: 'u1',
      toolKey: 'slowTestTool',
      kind: 'READ',
      status: 'RUNNING',
      attempts: 1,
    });
    fake.script = () => text('ok');
    await runtime.run(exec.id);
    expect((await callsOf(exec.id))[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'TOOL_OUTCOME_UNKNOWN',
    });
  });

  it('is a no-op for executions already in a terminal state (duplicate job delivery)', async () => {
    const exec = await newExecution({ patch: { status: 'COMPLETED', output: 'done' } });
    fake.script = () => {
      throw new Error('must not be called');
    };
    await runtime.run(exec.id);
    expect(await load(exec.id)).toMatchObject({ status: 'COMPLETED', output: 'done' });
  });

  it('isolates tool data between tenants', async () => {
    const other = await registerUser(app, 'Other');
    const otherOrg = await createOrg(other, 'Other Org');
    const otherAgent = (await other.post('/api/v1/agents').send({ name: 'Snoop' }).expect(201)).body
      .id;
    fake.script = (req, i) => {
      if (i === 0)
        return toolUse([{ id: 'iso', name: 'getOrder', input: { orderNumber: '1234' } }]);
      const r = JSON.parse((req.messages.at(-1)!.content[0] as { content: string }).content);
      expect(r).toEqual({ found: false, order: null });
      return text('Not found');
    };
    const exec = await newExecution({ org: otherOrg, agent: otherAgent, userId: other.userId });
    await runtime.run(exec.id);
    expect((await load(exec.id))!.status).toBe('COMPLETED');
  });
});
