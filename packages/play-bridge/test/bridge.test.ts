import { createServer, request as httpRequest } from "node:http";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatProviderConfig, readProviderHome, startBridge } from "@ledring/play-bridge";

const SECRET = "super-secret-key";
const TOKEN = "launch-token-0123456789abcdef";

function raw(port: number, headers: Record<string, string>, path = "/api/status"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function sseText(response: Response): Promise<string> {
  return response.text();
}

describe("bridge security", () => {
  it("binds 127.0.0.1, rejects a bad host, a foreign origin, and a missing token", async () => {
    const opened: string[] = [];
    const bridge = await startBridge({ token: TOKEN, open: (url) => opened.push(url) });
    try {
      expect(bridge.url).toBe(`http://127.0.0.1:${bridge.port}/`);
      expect(opened).toEqual([bridge.url]);
      const status = await fetch(new URL("/api/status", bridge.url));
      expect(status.status).toBe(200);
      expect(status.headers.get("access-control-allow-origin")).toBe("*");
      expect(await status.json()).toEqual({ ok: true, service: "ledring-play" });
      expect(JSON.stringify(await (await fetch(new URL("/api/status", bridge.url))).json())).not.toContain(TOKEN);

      const badHost = await raw(bridge.port, { host: "evil.example" });
      expect(badHost.status).toBe(421);

      const foreign = await fetch(new URL("/api/providers", bridge.url), {
        headers: { origin: "https://evil.example", "x-ledring-token": TOKEN },
      });
      expect(foreign.status).toBe(403);

      const missing = await fetch(new URL("/api/providers", bridge.url));
      expect(missing.status).toBe(403);
      expect(missing.headers.get("access-control-allow-origin")).toBeNull();

      const providers = await fetch(new URL("/api/providers", bridge.url), { headers: { "x-ledring-token": TOKEN } });
      const body = await providers.text();
      expect(providers.status).toBe(200);
      expect(body).toContain("synthetic cassette");
      expect(body).toContain("chatgpt-plan");
      expect(body).not.toContain(TOKEN);
      expect(body).not.toMatch(/Using ChatGPT plan|Connected/);
      const begin = await fetch(new URL("/api/providers/chatgpt-plan/begin", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN },
      });
      expect(begin.status).toBe(409);
      expect(await begin.text()).not.toMatch(/Using ChatGPT plan|Connected/);

      const quiet = await startBridge({ token: TOKEN });
      expect(quiet.logs.join("\n")).not.toContain(TOKEN);
      await quiet.close();
    } finally {
      await bridge.close();
    }
  });

  it("does not echo a key from a rejected body or an error log", async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(400);
      res.end(`nope ${SECRET}`);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const bridge = await startBridge({
      token: TOKEN,
      config: { openai: { apiKey: SECRET, baseUrl: `http://127.0.0.1:${address.port}`, model: "m" } },
    });
    try {
      const created = await fetch(new URL("/api/sessions", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN },
      });
      const { id } = (await created.json()) as { id: string };
      const leaked = await fetch(new URL(`/api/sessions/${id}/steps`, bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai-compat", system: "s", user: "u", apiKey: SECRET }),
      });
      expect(leaked.status).toBe(400);
      expect(await leaked.text()).not.toContain(SECRET);

      const step = await sseText(await fetch(new URL(`/api/sessions/${id}/steps`, bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai-compat", system: "s", user: "u" }),
      }));
      expect(step).toContain("error");
      expect(step).not.toContain(SECRET);
      expect(bridge.logs.join("\n")).not.toContain(SECRET);

      const junk = await fetch(new URL(`/api/sessions/${id}/steps`, bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: `not json ${SECRET}`,
      });
      expect(junk.status).toBe(400);
      expect(await junk.text()).not.toContain(SECRET);
      expect(bridge.logs.join("\n")).not.toContain(SECRET);
    } finally {
      await bridge.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe("bridge streaming", () => {
  it("streams a mock upstream, resumes from an event id, and aborts within 1s", async () => {
    let release: (() => void) | undefined;
    let closed = false;
    const upstream = createServer((req, res) => {
      req.on("close", () => {
        if (!res.writableEnded) closed = true;
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
      void new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => {
        if (res.writableEnded) return;
        res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const bridge = await startBridge({
      token: TOKEN,
      config: { openai: { apiKey: SECRET, baseUrl: `http://127.0.0.1:${address.port}`, model: "m" } },
    });
    const headers = { "x-ledring-token": TOKEN, "content-type": "application/json" };
    try {
      const created = await fetch(new URL("/api/sessions", bridge.url), { method: "POST", headers });
      const { id } = (await created.json()) as { id: string };
      const live = await fetch(new URL(`/api/sessions/${id}/steps`, bridge.url), {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: "openai-compat", system: "s", user: "build a page", model: "m" }),
      });
      const reader = live.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      let buffered = "";
      while (!buffered.includes("he")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
      }
      expect(buffered).toContain("he");
      expect(buffered).not.toContain(SECRET);

      const replay = await fetch(new URL(`/api/sessions/${id}/stream?from=0`, bridge.url), { headers });
      const replayReader = replay.body?.getReader();
      if (!replayReader) throw new Error("no replay body");
      let replayText = "";
      while (!replayText.includes("he")) {
        const chunk = await replayReader.read();
        if (chunk.done) break;
        replayText += decoder.decode(chunk.value, { stream: true });
      }
      expect(replayText).toContain("he");

      const stopped = await fetch(new URL(`/api/sessions/${id}/stop`, bridge.url), { method: "POST", headers });
      expect((await stopped.json())).toEqual({ stopped: true });
      const began = Date.now();
      while (!closed && Date.now() - began < 1000) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(closed).toBe(true);
      expect(Date.now() - began).toBeLessThan(1000);
      release?.();
    } finally {
      release?.();
      await bridge.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("serves the demo provider without calling a model", async () => {
    const bridge = await startBridge({ token: TOKEN });
    try {
      const created = await fetch(new URL("/api/sessions", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN },
      });
      const { id } = (await created.json()) as { id: string };
      const text = await sseText(await fetch(new URL(`/api/sessions/${id}/steps`, bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "demo", system: "s", user: "u" }),
      }));
      expect(text).toContain("DEMO · synthetic cassette, not a live model recording");
      expect(text).toContain("event: done");
      const judge = await fetch(new URL("/api/judge", bridge.url), { method: "POST", headers: { "x-ledring-token": TOKEN } });
      expect(judge.status).toBe(501);
    } finally {
      await bridge.close();
    }
  });
});

describe("provider config", () => {
  it("prints a redacted summary and warns when the file is group-readable", () => {
    const config = { openai: { apiKey: SECRET, baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" } };
    const summary = formatProviderConfig(config);
    expect(summary).toContain("openai-compat: configured @ https://openrouter.ai/api/v1");
    expect(summary).not.toContain(SECRET);
    expect(summary).toContain("bind: 127.0.0.1");

    const dir = mkdtempSync(join(tmpdir(), "ledring-play-"));
    const path = join(dir, "providers.json");
    writeFileSync(path, JSON.stringify(config));
    chmodSync(path, 0o644);
    const loose = readProviderHome(dir);
    expect(loose.warning).toMatch(/chmod 600/);
    expect(formatProviderConfig(loose.config, loose.warning)).not.toContain(SECRET);
    chmodSync(path, 0o600);
    expect(readProviderHome(dir).warning).toBeUndefined();
  });
});
