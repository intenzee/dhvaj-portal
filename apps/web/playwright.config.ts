import { defineConfig, devices } from '@playwright/test';

/**
 * Browser flows against a running portal. The API must already be up with the
 * dev identities seeded (db/seeds/dev_identity.sql) and dev sign-in enabled.
 *
 *   PW_BASE_URL  the web app            (default http://localhost:3000; started with
 *                                        `npm run dev` when nothing is listening there)
 *   PW_API_URL   the API, for arranging (default http://localhost:3001/api/v1)
 *
 *   npx playwright test                                  # from apps/web
 *   PW_BASE_URL=http://localhost:3100 PW_API_URL=http://localhost:3101/api/v1 npx playwright test
 */
const baseURL = process.env.PW_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PW_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
