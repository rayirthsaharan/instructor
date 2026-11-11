import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '@/lib/config';

const prod = (extra: Record<string, string | undefined> = {}) => ({ NODE_ENV: 'production', ...extra });
const good = 'x'.repeat(32);

describe('loadConfig', () => {
  it('applies defaults in development and does not require a session secret', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ nodeEnv: 'development', databasePath: './data/instructor.db', storageRoot: './data/files', aiProvider: 'mock', workerPollMs: 1000, isProduction: false });
    expect(c.sessionSecret).toBeUndefined();
  });

  it('treats empty values as unset', () => {
    expect(loadConfig({ DATABASE_PATH: '', AI_PROVIDER: '', SESSION_SECRET: '' })).toMatchObject({ databasePath: './data/instructor.db', aiProvider: 'mock' });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['the placeholder', 'change-me'],
    ['a case-variant placeholder', 'Change-Me'],
    ['31 bytes', 'x'.repeat(31)],
  ])('rejects SESSION_SECRET in production when %s', (_name, secret) => {
    expect(() => loadConfig(prod({ SESSION_SECRET: secret }))).toThrow(ConfigError);
    expect(() => loadConfig(prod({ SESSION_SECRET: secret }))).toThrow(/SESSION_SECRET/);
  });

  it('measures the secret in bytes, not characters', () => {
    expect(loadConfig(prod({ SESSION_SECRET: 'é'.repeat(16) })).sessionSecret).toHaveLength(16); // 32 bytes
    expect(() => loadConfig(prod({ SESSION_SECRET: 'é'.repeat(15) }))).toThrow(/32 bytes/);
  });

  it('accepts a strong secret in production', () => {
    const c = loadConfig(prod({ SESSION_SECRET: good }));
    expect(c.isProduction).toBe(true);
    expect(c.sessionSecret).toBe(good);
  });

  it('does not echo the secret in error messages', () => {
    try {
      loadConfig(prod({ SESSION_SECRET: 'short-secret-value' }));
    } catch (e) {
      expect((e as Error).message).not.toContain('short-secret-value');
    }
  });

  it('rejects an unknown AI provider, a bad poll interval, and anthropic without a key', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'openai' })).toThrow(ConfigError);
    expect(() => loadConfig({ WORKER_POLL_MS: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ AI_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(loadConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).aiProvider).toBe('anthropic');
  });
});
