import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { safeEqual } from '../common/crypto';
import { Inject } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { MetricsService } from '../metrics/metrics.service';
import { ExecutionQueue } from '../runtime/execution.queue';
import { HealthService } from './health.service';

@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly metrics: MetricsService,
    private readonly queue: ExecutionQueue,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: the process is up. */
  @Public()
  @Get('health')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. 503 when the database or Redis is down. */
  @Public()
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const r = await this.health.report();
    if (r.status === 'down') res.status(503);
    return {
      status: r.status,
      checks: { database: r.checks.database.ok, redis: r.checks.redis.ok },
    };
  }

  /** Prometheus scrape endpoint. Disabled unless METRICS_TOKEN is set; requires Bearer token. */
  @Public()
  @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = this.config.METRICS_TOKEN;
    if (!token || !auth || !safeEqual(auth, `Bearer ${token}`)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    try {
      const c = await this.queue.counts();
      for (const [state, n] of Object.entries(c)) this.metrics.queueDepth.set({ state }, n);
    } catch {
      /* queue depth best effort */
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
