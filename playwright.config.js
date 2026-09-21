// Playwright config for Electron E2E tests.
// These launch the real app (src/main.js) and drive the renderer DOM. They are kept OUT of
// `npm test` (plain Node unit tests) and run via `npm run test:e2e`.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: false,   // Electron instances are heavy; run serially
  workers: 1,
  // Retry once on CI only: Electron GUI tests can flake on shared runners (slow cold start,
  // xvfb timing). Locally a flake should fail loudly so it gets investigated.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'off' },
});
