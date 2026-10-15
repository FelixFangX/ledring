import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { anthropicProvider, demoProvider, ollamaProvider, openAICompatProvider, ProviderError } from "@ledring/play-providers";

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    hits: () => hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function collect(provider: { stream: (req: { system: string; user: string; signal?: AbortSignal }) => AsyncIterable<{ text: string }> }, signal?: AbortSignal): Promise<string> {
  let text = "";
  for await (const delta of provider.stream({ system: "s", user: "u", ...(signal ? { signal } : {}) })) text += delta.text;
  return text;
}

function sse(res: ServerResponse, chunks: string[]): void {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const chunk of chunks) res.write(chunk);
  res.end();
}

describe("openai-compat", () => {
  it("streams deltas and stops on [DONE]", async () => {
    let auth = "";
    const upstream = await listen((req, res) => {
      auth = String(req.headers.authorization);
      sse(res, [
        'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    });
    try {
      const provider = openAICompatProvider({ apiKey: "sk-testkey", baseUrl: upstream.url, model: "m" });
      expect(await collect(provider)).toBe("hello");
      expect(auth).toBe("Bearer sk-testkey");
      expect((await provider.status()).ready).toBe(true);
    } finally {
      await upstream.close();
    }
  });

  it("rejoins a delta split across TCP chunks", async () => {
    const provider = openAICompatProvider({
      apiKey: "sk-testkey",
      baseUrl: "http://upstream.invalid",
      model: "m",
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":'));
              controller.enqueue(encoder.encode('"yo"}}]}\n\n'));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });
    expect(await collect(provider)).toBe("yo");
  });

  it("retries 429 using retry-after, then 5xx, and does not retry 401 or malformed SSE", async () => {
    const waits: number[] = [];
    let rateHits = 0;
    const rate = await listen((_req, res) => {
      rateHits += 1;
      if (rateHits === 1) {
        res.writeHead(429, { "retry-after": "0" });
        res.end("slow down sk-testkey");
        return;
      }
      sse(res, ['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: [DONE]\n\n"]);
    });
    let serverHits = 0;
    const server = await listen((_req, res) => {
      serverHits += 1;
      if (serverHits === 1) {
        res.writeHead(502);
        res.end("bad gateway");
        return;
      }
      sse(res, ['data: {"choices":[{"delta":{"content":"up"}}]}\n\n', "data: [DONE]\n\n"]);
    });
    const denied = await listen((_req, res) => {
      res.writeHead(401);
      res.end("nope sk-testkey");
    });
    const broken = await listen((_req, res) => {
      sse(res, ["data: NOTJSON\n\n"]);
    });
    try {
      const sleep = async (ms: number) => {
        waits.push(ms);
      };
      expect(await collect(openAICompatProvider({ apiKey: "sk-testkey", baseUrl: rate.url, model: "m", sleep }))).toBe("ok");
      expect(waits).toEqual([0]);
      expect(await collect(openAICompatProvider({ apiKey: "sk-testkey", baseUrl: server.url, model: "m", sleep }))).toBe("up");
      expect(waits).toEqual([0, 200]);
      await expect(collect(openAICompatProvider({ apiKey: "sk-testkey", baseUrl: denied.url, model: "m", sleep }))).rejects.toMatchObject({ code: "auth" });
      await expect(collect(openAICompatProvider({ apiKey: "sk-testkey", baseUrl: broken.url, model: "m", sleep }))).rejects.toBeInstanceOf(ProviderError);
      await expect(collect(openAICompatProvider({ apiKey: "sk-testkey", baseUrl: broken.url, model: "m", sleep }))).rejects.toMatchObject({ code: "malformed" });
      expect(denied.hits()).toBe(1);
    } finally {
      await Promise.all([rate.close(), server.close(), denied.close(), broken.close()]);
    }
  });

  it("aborts the upstream request and does not retry", async () => {
    let closed = false;
    const upstream = await listen((req, res) => {
      req.on("close", () => {
        closed = true;
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
    });
    try {
      const provider = openAICompatProvider({ apiKey: "sk-testkey", baseUrl: upstream.url, model: "m" });
      const controller = new AbortController();
      const iter = provider.stream({ system: "s", user: "u", signal: controller.signal })[Symbol.asyncIterator]();
      expect((await iter.next()).value).toEqual({ text: "x" });
      controller.abort();
      await expect(iter.next()).rejects.toMatchObject({ code: "abort" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(true);
      expect(upstream.hits()).toBe(1);
    } finally {
      await upstream.close();
    }
  });

  it("stays unavailable without a key and never claims a ChatGPT plan", async () => {
    const provider = openAICompatProvider({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    const status = await provider.status();
    expect(status.ready).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/Using ChatGPT plan|Connected/);
    await expect(collect(provider)).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("anthropic and ollama", () => {
  it("sends the Anthropic browser header and reads text deltas", async () => {
    const headers: IncomingMessage["headers"] = {};
    const upstream = await listen((req, res) => {
      Object.assign(headers, req.headers);
      sse(res, [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ]);
    });
    try {
      const provider = anthropicProvider({ apiKey: "sk-ant-test", baseUrl: upstream.url, model: "claude" });
      expect(await collect(provider)).toBe("hi");
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    } finally {
      await upstream.close();
    }
  });

  it("talks to Ollama with the OpenAI stream and no invented key", async () => {
    let auth: string | undefined;
    const upstream = await listen((req, res) => {
      auth = req.headers.authorization;
      expect(req.url).toBe("/chat/completions");
      sse(res, ['data: {"choices":[{"delta":{"content":"local"}}]}\n\n', "data: [DONE]\n\n"]);
    });
    try {
      const provider = ollamaProvider({ baseUrl: upstream.url, model: "qwen" });
      expect((await provider.status()).ready).toBe(true);
      expect(await collect(provider)).toBe("local");
      expect(auth).toBeUndefined();
    } finally {
      await upstream.close();
    }
  });
});

describe("demo", () => {
  it("replays a labelled synthetic cassette and does not call fetch", async () => {
    const provider = demoProvider([{ text: "DEMO · synthetic cassette, not a live model recording" }]);
    const status = await provider.status();
    expect(status.warning).toBe("DEMO · synthetic cassette, not a live model recording");
    expect(await collect(provider)).toContain("synthetic cassette");
  });
});
