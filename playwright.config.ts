import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const PORT = 3100;
const chromiumPath = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: existsSync(chromiumPath) ? { executablePath: chromiumPath } : {},
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { AI_PROVIDER: 'mock' },
    timeout: 120_000,
  },
});
