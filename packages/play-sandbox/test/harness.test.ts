import { describe, expect, it } from "vitest";
import {
  ARTIFACT_CSP,
  DEGRADED_JUDGE_NOTICE,
  DEGRADED_JUDGE_NOTICE_ZH,
  IFRAME_SANDBOX,
  createNonce,
  harness,
  readHarnessMessage,
  withHarness,
} from "@ledring/play-sandbox";

describe("artifact sandbox", () => {
  it("keeps the iframe opaque and the page offline", () => {
    expect(IFRAME_SANDBOX).toBe("allow-scripts");
    expect(ARTIFACT_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:",
    );
    expect(DEGRADED_JUDGE_NOTICE).toContain("In-iframe harness");
    expect(DEGRADED_JUDGE_NOTICE).toContain("Playwright");
    expect(DEGRADED_JUDGE_NOTICE_ZH).toContain("Playwright");
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

  it("injects the harness into head, html, doctype, or a fragment", () => {
    const nonce = "abc";
    expect(withHarness("<head><title>t</title></head>", nonce)).toContain("<head>" + harness(nonce));
    expect(withHarness("<html><body>x</body></html>", nonce)).toContain("<html><head>" + harness(nonce));
    expect(withHarness("<!doctype html><body>x</body>", nonce)).toContain("<!doctype html>" + harness(nonce));
    expect(withHarness("<p>x</p>", nonce).startsWith(harness(nonce))).toBe(true);
  });
});
