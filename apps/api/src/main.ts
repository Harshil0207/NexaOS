import { startTelemetry, stopTelemetry } from './otel';
startTelemetry('nexa-api');

import 'reflect-metadata';
import { createApp } from './bootstrap';
import { AppConfig, CONFIG } from './config/config';

async function main() {
  const app = await createApp();
  const config = app.get<AppConfig>(CONFIG);
  await app.listen(config.PORT, '0.0.0.0');
  const shutdown = async () => {
    await app.close();
    await stopTelemetry();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  process.stderr.write(
    `API failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
