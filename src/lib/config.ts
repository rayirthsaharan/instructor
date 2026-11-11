import { z } from 'zod';

/** Weak or placeholder values that must never be used to sign sessions in production. */
const PLACEHOLDER_SECRETS = new Set(['change-me', 'changeme', '']);
const MIN_SECRET_BYTES = 32;

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.preprocess(emptyToUndefined, z.string().default('./data/instructor.db')),
  STORAGE_ROOT: z.preprocess(emptyToUndefined, z.string().default('./data/files')),
  AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(['mock', 'anthropic']).default('mock')),
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL_ANALYSIS: optionalString,
  AI_MODEL_CHAT: optionalString,
  WORKER_POLL_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(10).max(3_600_000).default(1000)),
  SESSION_SECRET: optionalString,
  MOCK_AI_DELAY_MS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(120_000).default(0)),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  databasePath: string;
  storageRoot: string;
  aiProvider: 'mock' | 'anthropic';
  anthropicApiKey?: string;
  aiModelAnalysis?: string;
  aiModelChat?: string;
  workerPollMs: number;
  /** Artificial delay of the mock analysis so progress states are visible in local use. 0 in tests. */
  mockAiDelayMs: number;
  /** Always set in production; may be undefined in development/test, where callers must generate an ephemeral one. */
  sessionSecret?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration from an environment map. Throws ConfigError with every problem found.
 * Never log the returned object: it contains secrets.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const problems: string[] = [];

  if (production) {
    const secret = e.SESSION_SECRET;
    if (secret === undefined || PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
      problems.push('SESSION_SECRET must be set to a random value in production (it is missing or a placeholder)');
    } else if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
      problems.push(`SESSION_SECRET must be at least ${MIN_SECRET_BYTES} bytes in production`);
    }
  }
  if (e.AI_PROVIDER === 'anthropic' && !e.ANTHROPIC_API_KEY) problems.push('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
  if (problems.length > 0) throw new ConfigError(`Invalid configuration: ${problems.join('; ')}`);

  return {
    nodeEnv: e.NODE_ENV,
    isProduction: production,
    databasePath: e.DATABASE_PATH,
    storageRoot: e.STORAGE_ROOT,
    aiProvider: e.AI_PROVIDER,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    aiModelAnalysis: e.AI_MODEL_ANALYSIS,
    aiModelChat: e.AI_MODEL_CHAT,
    workerPollMs: e.WORKER_POLL_MS,
    mockAiDelayMs: e.MOCK_AI_DELAY_MS,
    sessionSecret: e.SESSION_SECRET,
  };
}

let cached: AppConfig | undefined;

/**
 * Process-wide config for server code. Call it at request/startup time, never at module load:
 * `next build` runs with NODE_ENV=production and must not need runtime secrets.
 */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test helper. */
export function resetConfigCache(): void {
  cached = undefined;
}
