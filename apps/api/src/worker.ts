import { startTelemetry, stopTelemetry } from './otel';
startTelemetry('nexa-worker');

import 'reflect-metadata';
import http from 'node:http';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { CoreModule } from './core.module';
import { HealthService } from './health/health.service';
import { ExecutionQueue } from './runtime/execution.queue';
import { WorkerModule } from './runtime/worker.module';
import { MetricsService } from './metrics/metrics.service';

@Module({ imports: [CoreModule, WorkerModule], providers: [HealthService] })
class WorkerAppModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const health = app.get(HealthService);
  const metrics = app.get(MetricsService);
  app.get(ExecutionQueue);

  // Small internal HTTP server for container liveness/readiness and Prometheus scraping.
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 4001);
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
      } else if (req.url === '/health/ready') {
        const r = await health.report();
        res
          .writeHead(r.status === 'down' ? 503 : 200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: r.status }));
      } else if (
        req.url === '/metrics' &&
        process.env.METRICS_TOKEN &&
        req.headers.authorization === `Bearer ${process.env.METRICS_TOKEN}`
      ) {
        res
          .writeHead(200, { 'content-type': metrics.registry.contentType })
          .end(await metrics.registry.metrics());
      } else {
        res.writeHead(404).end();
      }
    })().catch(() => res.writeHead(500).end());
  });
  server.listen(port, '0.0.0.0');

  const shutdown = async () => {
    server.close();
    await app.close(); // waits for in-flight jobs
    await stopTelemetry();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Worker failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
