import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CSP,
  DEGRADED_JUDGE_NOTICE,
  DEGRADED_JUDGE_NOTICE_ZH,
  IFRAME_SANDBOX,
  MULTI_FILE_PRESET,
  bootWebcontainer,
  createNonce,
  harness,
  normalizeFilePlan,
  readHarnessMessage,
  resolveSandboxBackend,
  withHarness,
} from "@ledring/play-sandbox";

describe("artifact sandbox", () => {
  it("keeps the iframe opaque and the page offline", () => {
    expect(IFRAME_SANDBOX).toBe("allow-scripts");
    expect(ARTIFACT_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:",
    );
    expect(DEGRADED_JUDGE_NOTICE).toContain("self-tests");
    expect(DEGRADED_JUDGE_NOTICE).toContain("No separate browser tests ran");
    expect(DEGRADED_JUDGE_NOTICE_ZH).toContain("未运行独立浏览器测试");
  });

  it("binds the harness to one nonce and rejects every other message", () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(createNonce()).not.toBe(nonce);
    const html = harness(nonce);
    expect(html).toContain(ARTIFACT_CSP);
    expect(html).toContain(JSON.stringify(nonce));
    expect(readHarnessMessage({ __lr: nonce, t: "err", d: "boom" }, nonce)).toEqual({ type: "err", data: "boom" });
    expect(readHarnessMessage({ __lr: "other", t: "err", d: "boom" }, nonce)).toBeNull();
    expect(readHarnessMessage({ __lr: nonce, t: "nope", d: 1 }, nonce)).toBeNull();
    expect(readHarnessMessage(null, nonce)).toBeNull();
  });

  it("keeps the iframe as the default and describes one multi-file preset", () => {
    const previous = process.env.LEDRING_WEBCONTAINER;
    delete process.env.LEDRING_WEBCONTAINER;
    try {
      expect(resolveSandboxBackend()).toBe("iframe");
      expect(resolveSandboxBackend("webcontainer")).toBe("iframe");
      expect(IFRAME_SANDBOX).toBe("allow-scripts");
      expect(bootWebcontainer().booted).toBe(false);
      const names = MULTI_FILE_PRESET.files.map((file) => file.path);
      expect(names).toEqual(["index.html", "app.js", "app.css"]);
      expect(MULTI_FILE_PRESET.files[1]?.contents).toContain("ready");
      expect(normalizeFilePlan(MULTI_FILE_PRESET.files).ok).toBe(true);
      expect(normalizeFilePlan([{ path: "../secret", contents: "x" }]).ok).toBe(false);
      expect(normalizeFilePlan([{ path: "app.js", contents: "x" }]).ok).toBe(false);
      expect(normalizeFilePlan([{ path: "https://example.com/app.js", contents: "x" }]).ok).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.LEDRING_WEBCONTAINER;
      else process.env.LEDRING_WEBCONTAINER = previous;
    }
  });

  it("injects the harness into head, html, doctype, or a fragment", () => {
    const nonce = "abc";
    expect(withHarness("<head><title>t</title></head>", nonce)).toContain("<head>" + harness(nonce));
    expect(withHarness("<html><body>x</body></html>", nonce)).toContain("<html><head>" + harness(nonce));
    expect(withHarness("<!doctype html><body>x</body>", nonce)).toContain("<!doctype html>" + harness(nonce));
    expect(withHarness("<p>x</p>", nonce).startsWith(harness(nonce))).toBe(true);
  });
});
