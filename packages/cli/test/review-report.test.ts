import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "../../play-judge/node_modules/playwright/index.js";
import { parseTrace } from "@ledring/trace";
import { buildBranchTree, renderHtml } from "@ledring/flowchart";
import { reviewOf } from "../src/review.js";

const dir = new URL("../../../fixtures/claude-code/", import.meta.url);

describe("evidence review report", () => {
  const runs = readdirSync(dir).sort().flatMap((file) => parseTrace(readFileSync(new URL(file, dir), "utf8"), { filename: file }));
  const tree = buildBranchTree(runs);
  const review = reviewOf(runs, new Map(tree.runs.map((run) => [run.id, run.path])));
  const first = review.find((run) => run.id.startsWith("run-1.jsonl"))!;
  const bash = first.steps.find((step) => step.signature === "Bash(npm test)")!;

  it("points a derived pass at the result event and keeps the recorded parent", () => {
    expect(bash.isError).toBe(false);
    expect(bash.parentId).toBe("00000000-0000-4000-8000-000000000005");
    expect(bash.provenance).toMatchObject({ file: "run-1.jsonl", line: 6, resultLine: 7, resultEventId: "00000000-0000-4000-8000-000000000007" });
    expect(bash.findings.find((finding) => finding.code === "check.passed")?.provenance).toEqual({
      file: "run-1.jsonl", line: 7, eventId: "00000000-0000-4000-8000-000000000007",
    });
  });

  it("keeps the all-runs count off a passing step and opens the result event", async () => {
    const html = renderHtml(tree, { title: "fix login bug", review });
    const file = join(mkdtempSync(join(tmpdir(), "ledring-evidence-")), "report.html");
    writeFileSync(file, html);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`file://${file}`);
      await page.locator("#timeline button", { hasText: "Bash(npm test)" }).click();
      const nodeId = await page.locator('#timeline button[aria-current="true"]').getAttribute("data-node");
      const plate = page.locator(`.n[data-id="${nodeId}"]`);
      expect(await plate.getAttribute("class")).toMatch(/\berror\b/);
      expect(await plate.getAttribute("class")).not.toMatch(/run-error/);
      expect(await plate.getAttribute("aria-label")).toContain("this run recorded no error");
      expect(await plate.getAttribute("aria-label")).toContain("with an error across runs");
      expect(await plate.locator(".tab").evaluate((el) => getComputedStyle(el).fill)).not.toBe("rgb(215, 38, 30)");
      const all = await page.locator("section.all").innerText();
      const one = await page.locator("section.one").innerText();
      expect(all).toMatch(/runs with an error\s+1/);
      expect(all).not.toContain("output says the check passed");
      expect(one).toMatch(/recorded error\s+no/);
      expect(one).toContain("output says the check passed");
      expect(one).toContain("previous signature in time order");
      expect(one).toContain("00000000-0000-4000-8000-000000000005");
      expect(await page.locator("#tree-limit").innerText()).toContain("Sidechain records are not plates");
      const link = page.locator('section.one a[data-source]', { hasText: "run-1.jsonl:7" }).first();
      expect(await link.getAttribute("href")).toMatch(/-result$/);
      const shots = "/tmp/ledring-review-shots";
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "after-npm-test-desktop.png"), fullPage: true });
      await link.click();
      const href = await link.getAttribute("href");
      const opened = await page.locator("details").evaluate((el) => (el as HTMLDetailsElement).open);
      expect(opened).toBe(true);
      const result = await page.locator(href!).innerText();
      expect(result).toContain("run-1.jsonl:7");
      expect(result).toContain("12 passing");
      expect(result).toContain("00000000-0000-4000-8000-000000000007");
      expect(result).not.toContain("run-1.jsonl:6");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(href!.slice(1));
      await page.screenshot({ path: join(shots, "after-source-event-desktop.png"), fullPage: true });

      const failed = review.find((run) => run.id.startsWith("run-3.jsonl"))!;
      await page.locator("#run").selectOption(failed.id);
      await page.locator("#timeline button", { hasText: "Bash(npm test)" }).first().click();
      const failedId = await page.locator('#timeline button[aria-current="true"]').getAttribute("data-node");
      const failedPlate = page.locator(`.n[data-id="${failedId}"]`);
      expect(await failedPlate.getAttribute("class")).toMatch(/run-error/);
      expect(await failedPlate.locator(".tab").evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(215, 38, 30)");
      expect(await page.locator("section.one").innerText()).toMatch(/recorded error\s+yes/);

      await page.setViewportSize({ width: 390, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: join(shots, "after-npm-test-narrow.png"), fullPage: true });
    } finally {
      await browser.close();
    }
  }, 20_000);
});
