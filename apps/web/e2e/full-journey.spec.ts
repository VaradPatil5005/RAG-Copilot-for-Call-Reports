import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * The full user journey the Phase 6 spec asks for: upload a document ->
 * see it processed -> search for it -> ask the Copilot a question about
 * it -> see a cited answer. One end-to-end test, not split into unit
 * steps, because the point is exercising the real seams between the
 * upload API, the ingestion pipeline, the search index, and the Copilot
 * -- seams that per-layer unit tests (the pytest suite in apps/api/tests)
 * don't exercise together.
 *
 * NOT YET RUN -- see playwright.config.ts's module docstring for why and
 * what running it requires. `test.skip()` guards against a confusing
 * failure if the fixture PDF hasn't been generated yet (see
 * e2e/fixtures/README.md) rather than failing on a missing file.
 */

const FIXTURE_PATH = path.join(__dirname, "fixtures", "sample-call-report.pdf");
const CUSTOMER_NAME = `E2E-${Date.now()}`; // unique per run so repeated runs don't collide in search results

test.describe("full user journey", () => {
  test.skip(!fs.existsSync(FIXTURE_PATH), "Generate the fixture PDF first -- see e2e/fixtures/README.md");

  test("upload a document, see it processed, search for it, ask the Copilot, see a cited answer", async ({ page }) => {
    // --- 1. Upload -----------------------------------------------------
    await page.goto("/documents");
    const fileInput = page.getByTestId("document-upload-input");
    await fileInput.setInputFiles(FIXTURE_PATH);

    // The upload panel's metadata fields (customer_name etc.) -- filled
    // so the document is uniquely findable by CUSTOMER_NAME in the search
    // step below, independent of whatever else is already in the corpus.
    await page.getByLabel("Customer").fill(CUSTOMER_NAME);

    await page.getByRole("button", { name: /upload & process/i }).click();

    // --- 2. See it processed --------------------------------------------
    // Ingestion (malware scan, layout extraction, multimodal routing,
    // chunking, embedding, indexing, graph extraction) is real work --
    // poll the document list until the new document's status badge says
    // "Indexed", not a fixed sleep.
    await expect(page.getByText(CUSTOMER_NAME)).toBeVisible({ timeout: 30_000 });
    const documentRow = page.locator("tr", { hasText: CUSTOMER_NAME }).first();
    await expect(documentRow.getByText(/indexed/i)).toBeVisible({ timeout: 90_000 });

    // --- 3. Search for it -------------------------------------------------
    await page.goto("/search");
    const searchInput = page.getByTestId("search-input");
    await searchInput.fill(`risks raised for ${CUSTOMER_NAME}`);
    await page.getByRole("button", { name: /^search$/i }).click();

    await expect(page.getByText(/implementation timeline/i)).toBeVisible({ timeout: 15_000 });

    // --- 4. Ask the Copilot a question about it ---------------------------
    await page.goto("/copilot");
    const chatInput = page.getByTestId("copilot-input");
    await chatInput.fill(`What risks were raised for ${CUSTOMER_NAME}?`);
    await chatInput.press("Enter");

    // --- 5. See a cited answer ---------------------------------------------
    // The answer must actually reference the source document, not just
    // produce prose -- this is the whole point of the citation pipeline
    // (generation.py -> citation_validator.py) being exercised end to end.
    await expect(page.getByText(/implementation timeline/i)).toBeVisible({ timeout: 30_000 });
    const citation = page.getByTestId("citation").first();
    await expect(citation).toBeVisible({ timeout: 5_000 });
  });
});
