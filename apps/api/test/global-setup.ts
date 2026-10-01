import Redis from 'ioredis';
import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';

/** Rebuilds the test database from migrations (proves migrations work on a clean DB). */
export default async function setup({ provide: _provide }: { provide: unknown }) {
  const url =
    process.env.DATABASE_URL_TEST ??
    process.env.DATABASE_URL ??
    'postgresql://nexa:nexa@localhost:5432/nexa_test';
  if (!/test/.test(url)) throw new Error(`Refusing to reset a non-test database: ${url}`);
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await client.end();
  await runMigrations(url);
  const redis = new Redis(
    process.env.REDIS_URL_TEST ?? process.env.REDIS_URL ?? 'redis://localhost:6379/1',
  );
  await redis.flushdb();
  await redis.quit();
}
