// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/app/dev/ui/Gallery', () => ({ Gallery: () => null }));

describe('/dev/ui production gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it('calls notFound in production without ENABLE_DEV_UI', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_DEV_UI', '');
    const { default: Page } = await import('../src/app/dev/ui/page');
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });
});
