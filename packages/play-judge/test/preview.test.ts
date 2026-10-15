import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { startBridge } from "@ledring/play-bridge";
import { JudgeRuntime, judgeArtifact } from "@ledring/play-judge";
import { MULTI_FILE_PRESET } from "@ledring/play-sandbox";

const TOKEN = "launch-token-0123456789abcdef";

function browserInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const installed = browserInstalled();

describe.skipIf(!installed && !process.env.CI)("preview URL judge", () => {
  const runtime = new JudgeRuntime();

  afterAll(async () => {
    await runtime.close();
  });

  it("runs against the bridge preview and ignores a non-loopback URL", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const bridge = await startBridge({ token: TOKEN });
    try {
      const created = await fetch(new URL("/api/preview", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ files: MULTI_FILE_PRESET.files }),
      });
      const body = (await created.json()) as { url: string };
      const entry = MULTI_FILE_PRESET.files[0]?.contents ?? "";
      const verdict = await judgeArtifact({ html: entry, previewUrl: body.url }, { runtime });
      expect(verdict.ending).toBe("SHIPPED");
      expect(verdict.blankScreen).toBe(false);
      expect(verdict.errors).toEqual([]);
      expect(verdict.networkAttempts).toEqual([]);

      const foreign = await judgeArtifact(
        {
          html: "<!doctype html><html><body><p>ready</p></body></html>",
          previewUrl: "https://example.com/api/preview/abc/index.html",
        },
        { runtime },
      );
      expect(foreign.ending).toBe("SHIPPED");
      expect(foreign.networkAttempts.some((attempt) => attempt.url.includes("example.com"))).toBe(false);
    } finally {
      await bridge.close();
    }
  }, 20_000);
});
