import { readFileSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const testEnv = loadEnvFile('.env.test');

export default defineConfig({
  // SWC emits decorator metadata, which Nest dependency injection requires.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // Integration files share one database/Redis; run files sequentially.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          environment: 'node',
          env: { ...testEnv, ...pick(process.env, ['DATABASE_URL_TEST', 'REDIS_URL_TEST']) },
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

function pick(env: NodeJS.ProcessEnv, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (env[k]) out[k.replace('_TEST', '')] = env[k]!;
  return out;
}
