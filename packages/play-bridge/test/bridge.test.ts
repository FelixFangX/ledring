import { createServer, request as httpRequest } from "node:http";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatProviderConfig, readProviderHome, startBridge } from "@ledring/play-bridge";
import { JudgeRuntime } from "@ledring/play-judge";

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
      expect(judge.status).toBe(400);
    } finally {
      await bridge.close();
    }
  });

  it("judges a blank artifact when chromium is installed", async () => {
    const runtime = new JudgeRuntime();
    const bridge = await startBridge({ token: TOKEN, judgeRuntime: runtime });
    try {
      try {
        await runtime.browser();
      } catch (error) {
        if (process.env.CI) throw error;
        return;
      }
      const response = await fetch(new URL("/api/judge", bridge.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ html: "<!doctype html><html><body></body></html>" }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ending: string; blankScreen: boolean; screenshots: { name: string; bytes: number }[] };
      expect(body.ending).toBe("BROKEN");
      expect(body.blankScreen).toBe(true);
      expect(body.screenshots.map((shot) => shot.name)).toEqual(["desktop", "mobile"]);
      expect(runtime.launches).toBe(1);
    } finally {
      await bridge.close();
    }
  }, 20_000);
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

describe("session resume", () => {
  it("reloads events and a trace after the bridge process stops", async () => {
    const home = mkdtempSync(join(tmpdir(), "ledring-play-"));
    const first = await startBridge({ token: TOKEN, home });
    let id = "";
    try {
      const created = await fetch(new URL("/api/sessions", first.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN },
      });
      id = ((await created.json()) as { id: string }).id;
      const text = await sseText(await fetch(new URL(`/api/sessions/${id}/steps`, first.url), {
        method: "POST",
        headers: { "x-ledring-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ provider: "demo", system: "s", user: "u" }),
      }));
      expect(text).toContain("DEMO · synthetic cassette, not a live model recording");
      const trace = await fetch(new URL(`/api/sessions/${id}/trace`, first.url), { headers: { "x-ledring-token": TOKEN } });
      expect(trace.status).toBe(200);
      const body = (await trace.json()) as { schema: string; "x-ledring-play": { promptVersion: string } };
      expect(body.schema).toBe("ledring.trace.v1");
      expect(body["x-ledring-play"].promptVersion).toBeTruthy();
    } finally {
      await first.close();
    }

    const second = await startBridge({ token: TOKEN, home });
    try {
      const replay = await fetch(new URL(`/api/sessions/${id}/stream?from=0`, second.url), {
        headers: { "x-ledring-token": TOKEN },
      });
      expect(replay.status).toBe(200);
      expect(await replay.text()).toContain("DEMO · synthetic cassette, not a live model recording");
    } finally {
      await second.close();
    }
  });

  it("reloads mid-build and continues from the last event id", async () => {
    let release: (() => void) | undefined;
    const upstream = createServer((_req, res) => {
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
    const decoder = new TextDecoder();
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
      let buffered = "";
      while (!buffered.includes("he")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
      }
      const eventId = buffered.match(/id: (\d+)/)?.[1];
      expect(eventId).toBeTruthy();

      const continued = await fetch(new URL(`/api/sessions/${id}/stream?from=${eventId}`, bridge.url), { headers });
      const continuedReader = continued.body?.getReader();
      if (!continuedReader) throw new Error("no continuation");
      let rest = "";
      const follow = (async () => {
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          const chunk = await continuedReader.read();
          if (chunk.done) break;
          rest += decoder.decode(chunk.value, { stream: true });
          if (rest.includes("llo")) break;
        }
      })();
      const quietUntil = Date.now() + 40;
      while (!rest && Date.now() < quietUntil) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(rest).not.toContain('"he"');
      release?.();
      await follow;
      expect(rest).toContain("llo");
      expect(rest).not.toContain('"he"');

      const restored = await fetch(new URL(`/api/sessions/${id}/stream?from=0`, bridge.url), { headers });
      const restoredReader = restored.body?.getReader();
      if (!restoredReader) throw new Error("no restore");
      let full = "";
      const restoreDeadline = Date.now() + 1000;
      while (!full.includes("he") && Date.now() < restoreDeadline) {
        const chunk = await restoredReader.read();
        if (chunk.done) break;
        full += decoder.decode(chunk.value, { stream: true });
      }
      expect(full).toContain("he");
      await restoredReader.cancel();
      await continuedReader.cancel();
      await reader.cancel();
    } finally {
      release?.();
      await bridge.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("stops a partial build within 1s and restores that text after restart", async () => {
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
    const home = mkdtempSync(join(tmpdir(), "ledring-play-"));
    const bridge = await startBridge({
      token: TOKEN,
      home,
      config: { openai: { apiKey: SECRET, baseUrl: `http://127.0.0.1:${address.port}`, model: "m" } },
    });
    const headers = { "x-ledring-token": TOKEN, "content-type": "application/json" };
    let id = "";
    try {
      const created = await fetch(new URL("/api/sessions", bridge.url), { method: "POST", headers });
      id = ((await created.json()) as { id: string }).id;
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
      const stopped = await fetch(new URL(`/api/sessions/${id}/stop`, bridge.url), { method: "POST", headers });
      expect((await stopped.json()) as { stopped: boolean }).toEqual({ stopped: true });
      const began = Date.now();
      while (!closed && Date.now() - began < 1000) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(closed).toBe(true);
      expect(Date.now() - began).toBeLessThan(1000);
    } finally {
      release?.();
      await bridge.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    }

    const restored = await startBridge({ token: TOKEN, home });
    try {
      const replay = await fetch(new URL(`/api/sessions/${id}/stream?from=0`, restored.url), {
        headers: { "x-ledring-token": TOKEN },
      });
      const text = await replay.text();
      expect(text).toContain("he");
      expect(text).not.toContain("llo");
      const from = await fetch(new URL(`/api/sessions/${id}/stream?from=1`, restored.url), {
        headers: { "x-ledring-token": TOKEN },
      });
      const rest = await from.text();
      expect(rest).not.toContain("he");
      expect(rest).toContain("stopped");
    } finally {
      await restored.close();
    }
  });
});
