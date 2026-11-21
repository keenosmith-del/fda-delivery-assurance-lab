import { defineConfig, devices } from '@playwright/test';
import { privateFixture } from './tests/support/private-fixture.ts';

const liveOrigin = process.env.LAB_SMOKE_ORIGIN;
if (liveOrigin && (!process.env.LAB_SMOKE_OPERATOR_PASSWORD || !process.env.LAB_SMOKE_VIEWER_PASSWORD ||
  new URL(liveOrigin).protocol !== 'https:' || new URL(liveOrigin).origin !== liveOrigin)) {
  throw new Error('Live browser verification requires an HTTPS origin and dedicated staging credentials.');
}

export default defineConfig({
  testDir: './tests/staging',
  use: { ...devices['Desktop Chrome'], baseURL: liveOrigin ?? privateFixture.origin, trace: 'off' },
  webServer: liveOrigin ? undefined : {
    command: 'npm run build -w frontend && node tests/support/private-browser-server.ts',
    url: privateFixture.origin + '/api/ready',
    timeout: 45_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
