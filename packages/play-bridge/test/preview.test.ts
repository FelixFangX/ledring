import { describe, expect, it } from "vitest";
import { MULTI_FILE_PRESET, WEBCONTAINER_HEADERS } from "@ledring/play-sandbox";
import { startBridge } from "@ledring/play-bridge";

const TOKEN = "launch-token-0123456789abcdef";

describe("multi-file preview", () => {
  it("serves the preset on a loopback capability URL and keeps the iframe backend", async () => {
    const bridge = await startBridge({ token: TOKEN });
    try {
      const denied = await fetch(new URL("/api/preview", bridge.url), { method: "POST" });
      expect(denied.status).toBe(403);

      const created = await fetch(new URL("/api/preview", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ files: MULTI_FILE_PRESET.files }),
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { id: string; url: string; entry: string; backend: string };
      expect(body.backend).toBe("iframe");
      expect(body.entry).toBe("index.html");
      expect(body.url).toBe(`http://127.0.0.1:${bridge.port}/api/preview/${body.id}/index.html`);

      const script = await fetch(body.url.replace(/index\.html$/, "app.js"));
      expect(script.status).toBe(200);
      expect(await script.text()).toContain("ready");
      expect(script.headers.get("cross-origin-embedder-policy")).toBe(WEBCONTAINER_HEADERS["cross-origin-embedder-policy"]);
      expect(script.headers.get("cross-origin-opener-policy")).toBe(WEBCONTAINER_HEADERS["cross-origin-opener-policy"]);
      expect(script.headers.get("cross-origin-resource-policy")).toBe(WEBCONTAINER_HEADERS["cross-origin-resource-policy"]);

      const slipped = await fetch(new URL("/api/preview", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ files: [{ path: "../secret", contents: "no" }] }),
      });
      expect(slipped.status).toBe(400);
      expect(await fetch(new URL(`/api/preview/${body.id}/secret`, bridge.url))).toEqual(expect.objectContaining({ status: 404 }));
    } finally {
      await bridge.close();
    }
  });
});
