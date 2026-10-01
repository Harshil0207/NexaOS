import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'nexa_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  readonly llmDuration = new Histogram({
    name: 'nexa_llm_request_duration_seconds',
    help: 'Model provider latency',
    labelNames: ['provider', 'model', 'outcome'] as const,
    buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 40, 60, 120],
    registers: [this.registry],
  });
  readonly llmTokens = new Counter({
    name: 'nexa_llm_tokens_total',
    help: 'Tokens consumed',
    labelNames: ['provider', 'model', 'direction'] as const,
    registers: [this.registry],
  });
  readonly llmCostMicros = new Counter({
    name: 'nexa_llm_cost_microdollars_total',
    help: 'Estimated model cost in micro-dollars',
    labelNames: ['provider', 'model'] as const,
    registers: [this.registry],
  });
  readonly toolDuration = new Histogram({
    name: 'nexa_tool_duration_seconds',
    help: 'Tool execution latency',
    labelNames: ['tool', 'outcome'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });
  readonly executionsFinished = new Counter({
    name: 'nexa_executions_finished_total',
    help: 'Executions reaching a terminal state',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  readonly executionDuration = new Histogram({
    name: 'nexa_execution_duration_seconds',
    help: 'End-to-end execution duration',
    labelNames: ['status'] as const,
    buckets: [1, 2, 5, 10, 20, 40, 60, 120, 300, 900],
    registers: [this.registry],
  });
  readonly queueDepth = new Gauge({
    name: 'nexa_queue_jobs',
    help: 'Jobs in the execution queue by state',
    labelNames: ['state'] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'nexa_' });
  }
}
