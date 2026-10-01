import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { LlmRegistry } from '../llm/llm.registry';
import { REDIS } from '../redis/redis.module';
import { ExecutionQueue } from '../runtime/execution.queue';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checks: {
    database: { ok: boolean; latencyMs?: number };
    redis: { ok: boolean; latencyMs?: number };
    queue: { ok: boolean; waiting?: number; active?: number; failed?: number };
    llm: { configured: boolean };
  };
}

const timed = async (fn: () => Promise<unknown>) => {
  const t = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000)),
    ]);
    return { ok: true, latencyMs: Date.now() - t };
  } catch {
    return { ok: false };
  }
};

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queue: ExecutionQueue,
    private readonly llm: LlmRegistry,
  ) {}

  async report(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      timed(() => this.pool.query('SELECT 1')),
      timed(() => this.redis.ping()),
    ]);
    let queue: HealthReport['checks']['queue'] = { ok: false };
    if (redis.ok) {
      try {
        const c = await this.queue.counts();
        queue = { ok: true, waiting: c.waiting, active: c.active, failed: c.failed };
      } catch {
        /* reported as not ok */
      }
    }
    const llmConfigured = this.llm.catalog().providers.some((p) => p.configured);
    const status =
      !database.ok || !redis.ok ? 'down' : !llmConfigured || !queue.ok ? 'degraded' : 'ok';
    return { status, checks: { database, redis, queue, llm: { configured: llmConfigured } } };
  }
}
