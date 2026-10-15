import { describe, expect, it, vi } from "vitest";
import { reviewChecks, runChecks } from "../src/checks.js";
import type { Page } from "playwright";

describe("declarative checks", () => {
  it("rejects navigation, javascript, xpath, and unknown fields without accepting them", () => {
    const hostile = [
      { action: "navigate", url: "https://example.com/hostile" },
      { action: "click", target: "javascript:alert(1)" },
      { action: "click", target: "//button" },
      { action: "click", target: "button >> xpath=//a" },
      { action: "click", target: "button", goto: "https://example.com" },
    ];
    const reviewed = reviewChecks(hostile);
    expect(reviewed.accepted).toEqual([]);
    expect(reviewed.rejected).toHaveLength(5);
    expect(reviewed.rejected.every((item) => item.status === "rejected" && item.source === "model-proposed")).toBe(true);
    expect(reviewChecks({ action: "click", target: "button" }).rejected[0]?.reason).toMatch(/array/);
    expect(reviewChecks([1, 2, 3, 4, 5, 6]).rejected[0]?.reason).toMatch(/at most 5/);
  });

  it("accepts a has-text click and keeps the name out of the selector", async () => {
    const reviewed = reviewChecks([
      { action: "click", target: 'button:has-text("Go")', expect: { textChanges: "#count" } },
      { action: "wait", ms: 9000 },
      { action: "key", target: "canvas", key: "F5" },
    ]);
    expect(reviewed.accepted).toHaveLength(1);
    expect(reviewed.accepted[0]?.check.target).toEqual({ kind: "button-text", name: "Go" });
    expect(reviewed.rejected.map((item) => item.reason)).toEqual([
      "ms must be an integer from 0 to 500",
      "key is not in the allowlist",
    ]);

    const click = vi.fn(async () => undefined);
    const innerText = vi.fn().mockResolvedValueOnce("0").mockResolvedValueOnce("1");
    const page = {
      locator(selector: string, options?: { hasText?: string }) {
        expect(selector).not.toContain("has-text");
        expect(selector === "button" || selector === '[id="count"]').toBe(true);
        if (selector === "button") expect(options).toEqual({ hasText: "Go" });
        return { first: () => ({ click, fill: async () => undefined, innerText }) };
      },
      keyboard: { press: async () => undefined },
      waitForTimeout: async () => undefined,
    } as unknown as Page;
    const results = await runChecks(page, reviewed.accepted);
    expect(results).toEqual([{ index: 0, source: "model-proposed", action: "click", status: "passed" }]);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
