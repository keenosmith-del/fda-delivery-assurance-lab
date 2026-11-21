import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5179', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node tests/support/browser-server.ts',
      url: 'http://127.0.0.1:3300/api/ready',
      timeout: 45_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: 'npm run dev:frontend -- --host 127.0.0.1 --port 5179 --strictPort',
      url: 'http://127.0.0.1:5179',
      env: { PORT: '3300' },
    },
  ],
});
