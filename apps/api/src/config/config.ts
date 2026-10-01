import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Number of trusted reverse-proxy hops in front of the API (web proxy = 1, plus any load balancer). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().url(),

  /** Browser origins allowed for CORS and CSRF origin checks. */
  WEB_ORIGIN: csv,
  /** Public URL of the web app, used in emails (password reset links). */
  APP_URL: z.string().url().default('http://localhost:3000'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
  COOKIE_SECURE: bool.optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  LLM_DEFAULT_PROVIDER: z.string().default('anthropic'),
  LLM_DEFAULT_MODEL: z.string().default('claude-haiku-4-5'),
  /** Models users may select. Empty = only the default model. */
  LLM_ALLOWED_MODELS: csv,
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Optional JSON: {"model":{"inputPerMTok":1,"outputPerMTok":5}} to override/add pricing (USD). */
  LLM_PRICING_JSON: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  TOOL_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  /** Hosts the httpRequest tool may call. Empty = tool unavailable. */
  HTTP_TOOL_ALLOWED_HOSTS: csv,

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('NexaOS <no-reply@localhost>'),

  METRICS_TOKEN: z.string().min(16).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof envSchema> & { cookieSecure: boolean; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  if (isProd && c.WEB_ORIGIN.length === 0) {
    throw new Error('WEB_ORIGIN must be set in production');
  }
  return { ...c, isProd, cookieSecure: c.COOKIE_SECURE ?? isProd };
}

export const CONFIG = Symbol('CONFIG');
