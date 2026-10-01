/* Applies SQL migrations. Used by `pnpm db:migrate` (dev) and `pnpm db:deploy` (prod). */
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    // In dist the folder is copied next to this file; in dev it lives at apps/api/drizzle.
    const candidates = [path.join(__dirname, '../drizzle'), path.join(__dirname, '../../drizzle')];
    const fs = await import('node:fs');
    const folder = candidates.find((c) => fs.existsSync(path.join(c, 'meta/_journal.json')));
    if (!folder) throw new Error('Migrations folder not found');
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      process.stdout.write('Migrations applied\n');
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `Migration failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
