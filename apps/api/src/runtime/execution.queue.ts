import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfig, CONFIG } from '../config/config';
import { createRedis } from '../redis/redis.module';

export const EXECUTION_QUEUE = 'agent-executions';

export interface ExecutionJob {
  executionId: string;
}

/** Producer side. jobId = executionId makes enqueueing idempotent. */
@Injectable()
export class ExecutionQueue implements OnModuleDestroy {
  readonly queue: Queue<ExecutionJob>;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.queue = new Queue<ExecutionJob>(EXECUTION_QUEUE, {
      connection: createRedis(config.REDIS_URL),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 3600, count: 5000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  async enqueue(executionId: string): Promise<void> {
    await this.queue.add('run', { executionId }, { jobId: executionId });
  }

  async counts() {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
