// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('/dev/ui production gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('calls notFound in production without ENABLE_DEV_UI', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_UI', '');
    const { default: Page } = await import('../src/app/dev/ui/page');
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });
  it('renders in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { default: Page } = await import('../src/app/dev/ui/page');
    await expect(Page({ searchParams: Promise.resolve({ theme: 'bogus' }) })).resolves.toBeTruthy();
  });
});
