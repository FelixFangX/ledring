import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const chunk = html.slice(html.indexOf("/* free-ai-fallback */"), html.indexOf("/* free-ai-fallback-end */"));

function loadFallbackHelpers(lang: "en" | "zh", mode: string) {
  return new Function(
    "LANG",
    "PROV",
    `${chunk}\nreturn { freeAiError, isFreeAiQuotaError };`,
  )(lang, { mode }) as {
    freeAiError: (code?: string, status?: number) => Error & { aiStatus: boolean; code: string; status: number; isQuota: boolean };
    isFreeAiQuotaError: (error: unknown, mode?: string) => boolean;
  };
}

describe("Free AI 429 -> cassette auto-fallback", () => {
  it("classifies HTTP 429, quota_exhausted, and rate_limited on LEDRING Free AI as quota fallback triggers", () => {
    const en = loadFallbackHelpers("en", "ledring");
    const quotaErr = en.freeAiError("quota_exhausted", 429);
    expect(quotaErr.message).toBe("Quota");
    expect(quotaErr.aiStatus).toBe(true);
    expect(quotaErr.status).toBe(429);
    expect(quotaErr.isQuota).toBe(true);
    expect(en.isFreeAiQuotaError(quotaErr)).toBe(true);

    const rateErr = en.freeAiError("rate_limited", 429);
    expect(rateErr.message).toBe("Limited");
    expect(rateErr.isQuota).toBe(true);
    expect(en.isFreeAiQuotaError(rateErr)).toBe(true);

    const raw429 = en.freeAiError(undefined, 429);
    expect(raw429.status).toBe(429);
    expect(raw429.isQuota).toBe(true);
    expect(en.isFreeAiQuotaError(raw429)).toBe(true);

    const offlineErr = en.freeAiError("unavailable", 503);
    expect(offlineErr.isQuota).toBe(false);
    expect(en.isFreeAiQuotaError(offlineErr)).toBe(false);

    // Non-Free-AI providers must not be treated as Free AI quota fallbacks.
    expect(en.isFreeAiQuotaError(quotaErr, "openai")).toBe(false);
    expect(en.isFreeAiQuotaError(quotaErr, "anthropic")).toBe(false);

    const zh = loadFallbackHelpers("zh", "ledring");
    expect(zh.freeAiError("quota_exhausted", 429).message).toBe("配额");
    expect(zh.freeAiError("rate_limited", 429).message).toBe("限流");
    expect(zh.isFreeAiQuotaError(zh.freeAiError("quota_exhausted", 429))).toBe(true);
  });

  it("wires 429 fallback to built-in cassette, calm bilingual notice, BYO key button, and dynamic RUN.preset", () => {
    expect(html).toContain('id="quota-notice"');
    expect(html).toContain('id="quota-byo"');
    expect(html).toContain('id="quota-dismiss"');
    expect(html).toContain("if(isFreeAiQuotaError(e)&&typeof demoText===\"function\")");
    expect(html).toContain("fallbackToCassette(e.code||\"quota_exhausted\")");
    expect(html).toContain("DEMO_PLAN[RUN.preset||\"pomo\"][LANG]");
    expect(html).toContain("demoHTML(RUN.preset||\"pomo\",RUN.st,LANG)");
    expect(html).toContain("Today's shared free AI quota is full");
    expect(html).toContain("今日免费 AI 公共额度已用完");
  });
});
