import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "../../play-judge/node_modules/playwright/index.js";
import { TRACE_SCHEMA, type Run } from "@ledring/trace";
import { buildBranchTree, renderHtml, type ReviewRun } from "@ledring/flowchart";

const run = (id: string, sigs: string[]): Run => ({
  schema: TRACE_SCHEMA,
  id,
  source: "synthetic",
  instruction: "Fix the login bug in src/auth.",
  steps: sigs.map((signature, index) => ({ id: `${id}-${index}`, kind: "tool", name: signature, signature })),
});

describe("branch review", () => {
  it("coordinates the tree, the timeline and the source note on a narrow viewport", async () => {
    const runs = [run("alpha", ["Read(login.ts)", "Edit(login.ts)"]), run("beta", ["Read(login.ts)", "Grep"])];
    const tree = buildBranchTree(runs);
    const review: ReviewRun[] = [{
      id: "alpha",
      instructionStatus: "observed",
      omitted: 0,
      omittedSidechains: 2,
      truncated: true,
      findings: [],
      steps: [
        {
          stepId: "alpha-0", nodeId: "0.0", signature: "Read(login.ts)", kind: "tool",
          findings: [{ status: "unknown", code: "check.unknown", text: "The trace does not say whether it passed." }],
          provenance: { file: "alpha.jsonl", line: 2, eventId: "evt-2" },
          inputPreview: "{\"file_path\":\"src/auth/login.ts\"}",
        },
        {
          stepId: "alpha-1", nodeId: "0.0.0", signature: "Edit(login.ts)", kind: "tool", startedAt: "2026-10-01T10:00:16.000Z",
          findings: [{ status: "derived", code: "constraint.out-of-scope", text: "wrote outside scope src/auth" }],
          isError: false,
        },
      ],
    }];
    const html = renderHtml(tree, { title: "review", review });
    const file = join(mkdtempSync(join(tmpdir(), "ledring-review-")), "report.html");
    writeFileSync(file, html);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`file://${file}`);
      expect(await page.locator("#info").innerText()).toContain("Nothing selected");
      expect(await page.locator("#timeline").innerText()).toContain("This input ended mid-record");
      expect(await page.locator("#timeline").innerText()).toContain("2 sidechain records were left out of this run.");
      expect(await page.locator("#tree-limit").innerText()).toContain("previous signature");
      await page.locator('#timeline button[data-step="alpha-0"]').click();
      const selected = await page.locator("#info").innerText();
      expect(selected).toContain("time unknown");
      expect(selected).toContain("alpha.jsonl:2");
      expect(selected).toContain("The trace does not say whether it passed.");
      expect(selected).toContain("unknown");
      expect(await page.locator('.n[data-id="0.0"]').getAttribute("class")).toMatch(/sel/);
      await page.locator("summary").click();
      expect(await page.locator("pre.raw").innerText()).toContain("login.ts");
      await page.locator('#timeline button[data-step="alpha-0"]').focus();
      await page.keyboard.press("ArrowDown");
      expect(await page.locator('#timeline button[data-step="alpha-1"]').getAttribute("aria-current")).toBe("true");
      const next = await page.locator("#info").innerText();
      expect(next).toContain("wrote outside scope src/auth");
      expect(next).toContain("derived");
      await page.locator('.n[data-id="0.0.1"]').click();
      expect(await page.locator("#info").innerText()).toContain("not on the highlighted run");
      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: "/tmp/ledring-review-narrow.png", fullPage: true });
    } finally {
      await browser.close();
    }
  });
});
