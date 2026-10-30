import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENDING_IDS as CORE_ENDINGS } from "@ledring/play-core";
import {
  AI_GLOBAL_DAY_LIMIT,
  AI_IP_DAY_LIMIT,
  AI_MAX_BODY_BYTES,
  AI_MAX_TOKENS,
  AI_MODEL,
  ENDING_IDS,
  LIKE_DEVICE_LIMIT,
  LIST_LIMIT,
  POST_DEVICE_LIMIT,
  POST_IP_LIMIT,
  STRAND_TTL_MS,
  briefBucket,
  createD1Store,
  handleStrands,
  memoryStore,
  nearBuckets,
  type D1Database,
  type D1Prepared,
  type StrandStore,
  type WorkersAi,
} from "@ledring/play-strands";

const DEVICE = "device-key-1";
const IP = "203.0.113.10";

function postBody(extra: Record<string, unknown> = {}, device = DEVICE): Record<string, unknown> {
  return {
    traceHash: "ab".repeat(16),
    title: "A quiet timer",
    ending: "SHIPPED",
    brief: "timer stop",
    signatures: ["loop:trust"],
    lang: "en",
    optIn: true,
    deviceKey: device,
    ...extra,
  };
}

function request(method: string, path: string, body?: unknown, ip = IP): Request {
  return new Request(`https://strands.ledring.test${path}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function post(store: StrandStore, now: number, extra: Record<string, unknown> = {}, device = DEVICE, ip = IP) {
  const response = await handleStrands(request("POST", "/strands", postBody(extra, device), ip), store, now);
  return { status: response.status, body: (await response.json()) as { id?: string; bucket?: string; error?: string; categories?: string[] } };
}

describe("lexical buckets", () => {
  it("hashes the same words to one bucket and lists neighbours", () => {
    expect(briefBucket("timer stop")).toBe(briefBucket("stop   timer"));
    expect(nearBuckets("00")).toEqual(["ff", "00", "01"]);
    expect(nearBuckets("nope")).toBeNull();
  });
});

describe("strands worker", () => {

  it("serves health on GET / and /health", async () => {
    const store = memoryStore();
    for (const path of ["/", "/health"]) {
      const response = await handleStrands(request("GET", path), store, 1);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.service).toBe("ledring-play-strands");
      expect(body.routes).toContain("POST /ai/chat");
    }
  });

  it("posts, lists the near bucket, and likes once", async () => {
    const store = memoryStore();
    const created = await post(store, 1_000);
    expect(created.status).toBe(201);
    expect(created.body.bucket).toBe(briefBucket("timer stop"));
    const listed = await handleStrands(request("GET", `/strands?near=${created.body.bucket}`), store, 1_000);
    const page = (await listed.json()) as { strands: { id: string; title: string; likes: number }[] };
    expect(page.strands.map((strand) => strand.id)).toEqual([created.body.id]);
    const liked = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), store, 1_000);
    expect(await liked.json()).toEqual({ likes: 1 });
    const again = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), store, 1_000);
    expect(await again.json()).toEqual({ likes: 1 });
  });

  it("drops an unliked strand after 30 days and keeps a liked one", async () => {
    const store = memoryStore();
    const kept = await post(store, 0, { brief: "timer stop", title: "Kept" }, "device-kept");
    const dropped = await post(store, 0, { brief: "timer stop", title: "Dropped" }, "device-drop");
    await handleStrands(request("POST", `/strands/${kept.body.id}/like`, { deviceKey: "device-kept" }), store, 0);
    const later = STRAND_TTL_MS + 1;
    const listed = await handleStrands(request("GET", `/strands?near=${kept.body.bucket}`), store, later);
    const page = (await listed.json()) as { strands: { id: string }[] };
    expect(page.strands.map((strand) => strand.id)).toEqual([kept.body.id]);
    expect(page.strands.map((strand) => strand.id)).not.toContain(dropped.body.id);
    const missed = await handleStrands(request("POST", `/strands/${dropped.body.id}/like`, { deviceKey: "device-drop" }), store, later);
    expect(missed.status).toBe(404);
  });

  it("rate-limits posts per device and per address, and likes per device", async () => {
    const store = memoryStore();
    for (let i = 0; i < POST_DEVICE_LIMIT; i += 1) {
      const created = await post(store, 5, { traceHash: `${i.toString(16).padStart(16, "0")}` });
      expect(created.status).toBe(201);
    }
    expect((await post(store, 5, { traceHash: "ff".repeat(16) })).status).toBe(429);

    const addresses = memoryStore();
    for (let i = 0; i < POST_IP_LIMIT; i += 1) {
      const created = await post(addresses, 5, { traceHash: `${i.toString(16).padStart(16, "a")}` }, `device-${i.toString(16).padStart(8, "0")}`);
      expect(created.status).toBe(201);
    }
    expect((await post(addresses, 5, { traceHash: "bb".repeat(16) }, "device-overflow")).status).toBe(429);

    const likes = memoryStore();
    const created = await post(likes, 9);
    for (let i = 0; i < LIKE_DEVICE_LIMIT; i += 1) {
      const response = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), likes, 9);
      expect(response.status).toBe(200);
    }
    const blocked = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), likes, 9);
    expect(blocked.status).toBe(429);
  });

  it("rejects a missing opt-in, a lexicon hit, and any code or PII field", async () => {
    const store = memoryStore();
    expect((await post(store, 1, { optIn: false })).status).toBe(403);
    const flagged = await post(store, 1, { brief: "fetch the leaderboard" });
    expect(flagged.status).toBe(422);
    expect(flagged.body.categories).toContain("network");
    expect((await post(store, 1, { code: "<script>alert(1)</script>" })).status).toBe(400);
    expect((await post(store, 1, { email: "person@example.com" })).status).toBe(400);
    expect((await post(store, 1, { title: "Write person@example.com" })).status).toBe(400);
    const listed = await handleStrands(request("GET", `/strands?near=${briefBucket("timer stop")}`), store, 1);
    expect(await listed.json()).toEqual({ strands: [] });
    expect(await store.persisted()).not.toContain(DEVICE);
    expect(await store.persisted()).not.toContain(IP);
    expect(await store.persisted()).not.toContain("person@example.com");
    expect(await store.persisted()).not.toContain("<script>");
  });

  it("returns at most 20 strands", async () => {
    const store = memoryStore();
    const bucket = briefBucket("timer stop");
    for (let i = 0; i < LIST_LIMIT + 3; i += 1) {
      await store.insert({
        id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
        traceHash: "ab".repeat(16),
        title: `Timer ${i}`,
        ending: "SHIPPED",
        brief: "timer stop",
        signatures: [],
        lang: "en",
        bucket,
        likes: 0,
        createdAt: i,
      });
    }
    const listed = await handleStrands(request("GET", `/strands?near=${bucket}`), store, 100);
    const page = (await listed.json()) as { strands: unknown[] };
    expect(page.strands).toHaveLength(LIST_LIMIT);
  });

  it("matches Play endings and documents deploy without a secret or pgvector", () => {
    expect([...ENDING_IDS]).toEqual([...CORE_ENDINGS]);
    const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
    const schema = readFileSync(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8");
    expect(readme).toContain("npx wrangler d1 create ledring-play-strands");
    expect(readme).toContain("npx wrangler d1 execute ledring-play-strands --remote --file=schema.sql");
    expect(readme).toContain("npx wrangler deploy");
    expect(readme).toContain("does not deploy");
    expect(readme).toContain("no pgvector");
    expect(schema.toLowerCase()).not.toMatch(/\b(email|password|ip|html|code|embedding)\b/);
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS strands");
    const wrangler = readFileSync(fileURLToPath(new URL("../wrangler.toml", import.meta.url)), "utf8");
    expect(wrangler).toContain('binding = "AI"');
    expect(readme).toContain("POST /ai/chat");
    expect(readme).toContain("npx wrangler deploy");
    expect(readme).toContain(AI_MODEL);
    expect(readme).toContain("does not deploy");
  });
});

describe("free AI chat", () => {
  const prompt = "do-not-store-this-prompt";

  function sse(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  function ai(chunks: string[], seen: { inputs?: Record<string, unknown>; calls: number } = { calls: 0 }): WorkersAi {
    return {
      async run(_model, inputs) {
        seen.calls += 1;
        seen.inputs = inputs;
        return sse(chunks);
      },
    };
  }

  function chat(body: unknown, extra: { origin?: string; ip?: string; method?: string } = {}): Request {
    const headers = new Headers({ "content-type": "application/json", "cf-connecting-ip": extra.ip ?? IP });
    if (extra.origin) headers.set("origin", extra.origin);
    return new Request("https://strands.ledring.test/ai/chat", {
      method: extra.method ?? "POST",
      headers,
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  }

  const okBody = { messages: [{ role: "user", content: prompt }], max_tokens: 99_999, temperature: 0.6, stream: true };

  it("streams Workers AI text as OpenAI SSE and caps max_tokens", async () => {
    const seen = { calls: 0 } as { inputs?: Record<string, unknown>; calls: number };
    const store = memoryStore();
    const response = await handleStrands(
      chat(okBody, { origin: "https://felixfangx.github.io" }),
      store,
      1_000,
      ai(['data: {"response":"O"}\n\n', 'data: {"response":"OK"}\n\ndata: [DONE]\n\n'], seen),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-limit")).toBe(String(AI_IP_DAY_LIMIT));
    expect(response.headers.get("access-control-expose-headers")).toContain("X-RateLimit-Limit");
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://felixfangx.github.io");
    const text = await response.text();
    expect(text).toContain('"content":"O"');
    expect(text).toContain('"content":"K"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    expect(seen.inputs).toMatchObject({ stream: true, max_tokens: AI_MAX_TOKENS, messages: [{ role: "user", content: prompt }] });
    expect(seen.inputs && "model" in seen.inputs).toBe(false);
    expect(await store.persisted()).not.toContain(IP);
    expect(await store.persisted()).not.toContain(prompt);
  });

  it("allows localhost and refuses every other origin", async () => {
    const store = memoryStore();
    const model = ai(['data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', "data: [DONE]\n\n"]);
    const local = await handleStrands(chat(okBody, { origin: "http://localhost:4173" }), store, 2_000, model);
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:4173");
    const loopback = await handleStrands(chat(okBody, { origin: "http://127.0.0.1:8787", ip: "203.0.113.11" }), store, 2_000, model);
    expect(loopback.status).toBe(200);
    expect(loopback.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:8787");
    const custom = await handleStrands(chat(okBody, { origin: "https://play.ledring.dev", ip: "203.0.113.12" }), store, 2_000, model);
    expect(custom.status).toBe(200);
    expect(custom.headers.get("access-control-allow-origin")).toBe("https://play.ledring.dev");
    const denied = await handleStrands(chat(okBody, { origin: "https://evil.example" }), store, 2_000, model);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await handleStrands(
      new Request("https://strands.ledring.test/ai/chat", { method: "OPTIONS", headers: { origin: "https://felixfangx.github.io" } }),
      store,
      2_000,
      model,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://felixfangx.github.io");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
    const strands = await handleStrands(new Request("https://strands.ledring.test/strands"), store, 2_000);
    expect(strands.status).toBe(400);
    expect(strands.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers OPTIONS on /strands with empty 204", async () => {
    const res = await handleStrands(new Request("https://strands.ledring.test/strands", { method: "OPTIONS", headers: { origin: "https://play.ledring.dev" } }), memoryStore());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves openapi.json and docs", async () => {
    const openapi = await handleStrands(new Request("https://strands.ledring.test/openapi.json"), memoryStore());
    expect(openapi.status).toBe(200);
    const body = await openapi.json() as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toMatch(/^3\./);
    expect(body.paths["/strands"]).toBeTruthy();
    const chatDocs = body.paths["/ai/chat"] as { post: { responses: Record<string, { headers: Record<string, unknown> }> } };
    for (const status of ["200", "400", "403", "405", "413", "429", "503"]) {
      expect(chatDocs.post.responses[status]?.headers["X-RateLimit-Limit"]).toBeTruthy();
    }
    expect(chatDocs.post.responses["429"]?.headers["Retry-After"]).toBeTruthy();
    const docs = await handleStrands(new Request("https://strands.ledring.test/docs"), memoryStore());
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toMatch(/text\/html/);
    const docsText = await docs.text();
    for (const term of ["rate_limited", "quota_exhausted", "unavailable", "invalid_request", "origin", "method", "input_too_large", "X-RateLimit-Limit", "Retry-After", "Access-Control-Expose-Headers", "2-hex bucket + neighbours"]) expect(docsText).toContain(term);
  });

  it("documents a valid near example on health", async () => {
    const res = await handleStrands(new Request("https://strands.ledring.test/health"), memoryStore());
    const body = await res.json() as { nearExample: string };
    expect(body.nearExample).toBe("/strands?near=a7");
  });


  it("rejects an oversized body before calling the model", async () => {
    const seen = { calls: 0 };
    const store = memoryStore();
    const huge = "x".repeat(AI_MAX_BODY_BYTES + 1);
    const response = await handleStrands(chat(huge), store, 3_000, ai([], seen));
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("input_too_large");
    expect(seen.calls).toBe(0);
  });

  it("rate-limits one address and then the shared daily quota without calling the model", async () => {
    const seen = { calls: 0 };
    const store = memoryStore();
    const model = ai(['data: {"response":"OK"}\n\n'], seen);
    for (let i = 0; i < AI_IP_DAY_LIMIT; i += 1) {
      const response = await handleStrands(chat(okBody), store, 4_000, model);
      expect(response.status).toBe(200);
    }
    const limited = await handleStrands(chat(okBody), store, 4_000, model);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-ratelimit-limit")).toBe(String(AI_IP_DAY_LIMIT));
    expect(limited.headers.get("retry-after")).toBe("86396");
    expect(limited.headers.get("access-control-expose-headers")).toContain("Retry-After");
    const limitedBody = (await limited.json()) as { error: { code: string; message: string } };
    expect(limitedBody.error.code).toBe("rate_limited");
    expect(limitedBody.error.message).toContain("your own key");
    expect(seen.calls).toBe(AI_IP_DAY_LIMIT);

    let globalCalls = AI_IP_DAY_LIMIT;
    for (let n = AI_IP_DAY_LIMIT; n < AI_GLOBAL_DAY_LIMIT; n += 1) {
      const response = await handleStrands(chat(okBody, { ip: `203.0.113.${20 + Math.floor(n / 10)}` }), store, 4_000, model);
      expect(response.status).toBe(200);
      globalCalls += 1;
    }
    const exhausted = await handleStrands(chat(okBody, { ip: "198.51.100.9" }), store, 4_000, model);
    expect(exhausted.status).toBe(429);
    expect(exhausted.headers.get("x-ratelimit-limit")).toBe(String(AI_IP_DAY_LIMIT));
    expect(exhausted.headers.get("retry-after")).toBe("86396");
    const exhaustedBody = (await exhausted.json()) as { error: { code: string; message: string } };
    expect(exhaustedBody.error.code).toBe("quota_exhausted");
    expect(exhaustedBody.error.message).toContain("shared quota");
    expect(seen.calls).toBe(globalCalls);
  });

  it("turns a model failure into the shared-quota error and never needs a key", async () => {
    const store = memoryStore();
    const failing: WorkersAi = {
      async run() {
        throw new Error("neurons exceeded for account");
      },
    };
    const response = await handleStrands(chat(okBody), store, 5_000, failing);
    expect(response.status).toBe(429);
    expect(response.headers.get("x-ratelimit-limit")).toBe(String(AI_IP_DAY_LIMIT));
    expect(response.headers.get("retry-after")).toBe("86395");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("quota_exhausted");
    expect(body.error.message).not.toContain("account");
    const missing = await handleStrands(chat(okBody, { ip: "198.51.100.8" }), store, 5_000);
    expect(missing.status).toBe(503);
  });
});

describe("D1 adapter", () => {
  it("writes the public columns and no address", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const statement = (sql: string): D1Prepared => {
      const values: unknown[] = [];
      const prepared: D1Prepared = {
        bind(...next: unknown[]) {
          values.push(...next);
          return prepared;
        },
        async all<T>() {
          calls.push({ sql, values: [...values] });
          return { results: [] as T[] };
        },
        async run() {
          calls.push({ sql, values: [...values] });
          return { meta: { changes: 1 } };
        },
        async first<T>() {
          calls.push({ sql, values: [...values] });
          return null as T | null;
        },
      };
      return prepared;
    };
    const db: D1Database = { prepare: statement };
    const store = createD1Store(db);
    await store.insert({
      id: "00000000-0000-4000-8000-000000000001",
      traceHash: "ab".repeat(16),
      title: "A quiet timer",
      ending: "SHIPPED",
      brief: "timer stop",
      signatures: ["loop:trust"],
      lang: "en",
      bucket: "0a",
      likes: 0,
      createdAt: 10,
    });
    const inserted = calls.find((call) => call.sql.startsWith("INSERT INTO strands"));
    expect(inserted?.sql).toContain("trace_hash");
    expect(inserted?.sql.toLowerCase()).not.toMatch(/\b(email|ip|html|code)\b/);
    expect(JSON.stringify(inserted?.values)).not.toContain(DEVICE);
    expect(JSON.stringify(inserted?.values)).not.toContain(IP);
    await store.listNear(["09", "0a", "0b"], 10, 20);
    expect(calls.some((call) => call.sql.includes("bucket IN (?, ?, ?)"))).toBe(true);
  });
});
