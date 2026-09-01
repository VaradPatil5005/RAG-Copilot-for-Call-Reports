import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 6.7 end-to-end tests: the full user journey (upload a document ->
 * see it processed -> search for it -> ask the Copilot a question about it
 * -> see a cited answer), per the spec's explicit requirement.
 *
 * NOT YET RUN. This was written without a networked environment available
 * to `npm install`/`npx playwright install` browsers or start a live
 * dev server + API instance -- see the root ADR 0007 for the full list of
 * things this phase built but could not execute. Whoever runs this next:
 *
 *   cd apps/web
 *   npm install
 *   npx playwright install --with-deps chromium
 *   # in one terminal: cd ../api && uvicorn app.main:app --port 8000
 *   # in another:      npm run dev
 *   npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000, // ingestion (layout extraction, embedding, indexing) is real work, not instant
  fullyParallel: false, // the full-journey test uploads real documents; keep it sequential and simple
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
