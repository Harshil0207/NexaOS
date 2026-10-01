import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/config';
import { DB, Database } from '../db/db.module';
import { executions } from '../db/schema';
import { MetricsService } from '../metrics/metrics.service';
import { createRedis, REDIS } from '../redis/redis.module';
import { AgentRuntime } from './agent-runtime';
import { ExecutionEventsService } from './execution-events.service';
import { EXECUTION_QUEUE, ExecutionJob, ExecutionQueue } from './execution.queue';

const SWEEP_INTERVAL_MS = 30_000;
const QUEUED_GRACE_MS = 20_000;
const DEADLINE_GRACE_MS = 60_000;

/**
 * Consumer side. BullMQ lock renewal + stalled-job detection re-delivers work from a crashed
 * worker; the runtime resumes from persisted state. A leader-elected sweeper re-enqueues
 * orphaned QUEUED runs and times out runs whose deadline passed while no worker owned them.
 */
@Injectable()
export class ExecutionWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ExecutionWorker.name);
  private worker?: Worker<ExecutionJob>;
  private sweepTimer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly runtime: AgentRuntime,
    private readonly queue: ExecutionQueue,
    private readonly events: ExecutionEventsService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ExecutionJob>(
      EXECUTION_QUEUE,
      async (job) => {
        await this.runtime.run(job.data.executionId);
      },
      {
        connection: createRedis(this.config.REDIS_URL),
        concurrency: this.config.WORKER_CONCURRENCY,
        lockDuration: 60_000,
        maxStalledCount: 3,
      },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn(
        { jobId: job?.id, attempts: job?.attemptsMade, err: err.message },
        'Execution job failed',
      ),
    );
    this.worker.on('error', (err) => this.logger.error({ err }, 'Worker error'));
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    void this.sweep();
    this.logger.log(`Worker started (concurrency ${this.config.WORKER_CONCURRENCY})`);
  }

  async sweep(): Promise<void> {
    const lock = await this.redis.set(
      'nexa:sweeper-lock',
      process.pid.toString(),
      'PX',
      SWEEP_INTERVAL_MS - 1000,
      'NX',
    );
    if (!lock) return;
    try {
      const counts = await this.queue.counts();
      for (const [state, n] of Object.entries(counts)) this.metrics.queueDepth.set({ state }, n);

      const orphaned = await this.db
        .select({ id: executions.id })
        .from(executions)
        .where(
          and(
            eq(executions.status, 'QUEUED'),
            lt(executions.createdAt, new Date(Date.now() - QUEUED_GRACE_MS)),
          ),
        )
        .limit(200);
      for (const { id } of orphaned) await this.queue.enqueue(id);

      const overdue = await this.db
        .select({
          id: executions.id,
          organizationId: executions.organizationId,
          agentId: executions.agentId,
        })
        .from(executions)
        .where(
          and(
            inArray(executions.status, ['RUNNING', 'WAITING_FOR_TOOL']),
            lt(executions.deadlineAt, new Date(Date.now() - DEADLINE_GRACE_MS)),
          ),
        )
        .limit(200);
      for (const e of overdue) {
        await this.events.transition(
          e,
          'TIMED_OUT',
          {
            errorCode: 'EXECUTION_TIMEOUT',
            errorMessage: 'The run exceeded its time limit',
            finishedAt: new Date(),
            transcript: [],
          },
          'execution.timed_out',
          { code: 'EXECUTION_TIMEOUT', message: 'Timed out while no worker was processing it' },
        );
      }
      if (orphaned.length || overdue.length) {
        this.logger.log({ requeued: orphaned.length, timedOut: overdue.length }, 'Recovery sweep');
      }
    } catch (err) {
      this.logger.error({ err }, 'Recovery sweep failed');
    }
  }

  async onApplicationShutdown() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    // Waits for in-flight jobs to finish (graceful shutdown).
    await this.worker?.close();
  }
}
