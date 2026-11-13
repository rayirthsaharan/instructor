import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 3100);
// Isolated data for the un-mocked specs; web server and worker share it.
const dataDir = process.env.E2E_DATA_DIR ?? join(tmpdir(), 'instructor-e2e');
const chromiumPath = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: existsSync(chromiumPath) ? { executablePath: chromiumPath } : {},
  },
  webServer: {
    // Web server + job worker (uploads only progress while the worker runs).
    command: `rm -rf ${dataDir} && node scripts/dev-all.mjs`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      AI_PROVIDER: 'mock',
      DATABASE_PATH: join(dataDir, 'instructor.db'),
      STORAGE_ROOT: join(dataDir, 'files'),
      MOCK_AI_DELAY_MS: '300',
      WORKER_POLL_MS: '100',
    },
    timeout: 120_000,
  },
});
