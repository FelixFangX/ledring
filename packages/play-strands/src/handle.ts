import { scanPlan } from "@ledring/play-risk";
import { briefBucket, nearBuckets } from "./bucket.js";
import { ENDING_IDS, type EndingId } from "./endings.js";
import {
  DAY_MS,
  HOUR_MS,
  LIKE_DEVICE_LIMIT,
  LIKE_FIELDS,
  LIST_LIMIT,
  POST_DEVICE_LIMIT,
  POST_IP_LIMIT,
  STRAND_FIELDS,
} from "./limits.js";
import { handleAiChat, type WorkersAi } from "./ai.js";
import type { Strand, StrandStore } from "./store.js";

const PII = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|sk-[A-Za-z0-9]{8,}/i;

export async function blind(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function unexpected(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).some((key) => !allowed.includes(key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOk(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max && !PII.test(value);
}

function publicStrand(strand: Strand): Record<string, unknown> {
  return {
    id: strand.id,
    traceHash: strand.traceHash,
    title: strand.title,
    ending: strand.ending,
    brief: strand.brief,
    signatures: strand.signatures,
    lang: strand.lang,
    bucket: strand.bucket,
    likes: strand.likes,
    createdAt: strand.createdAt,
  };
}

async function postStrand(request: Request, store: StrandStore, now: number): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return json(400, { error: "invalid request" });
  }
  const body = asRecord(parsed);
  if (!body) return json(400, { error: "invalid request" });
  if (unexpected(body, STRAND_FIELDS)) return json(400, { error: "unexpected field" });
  if (body.optIn !== true) return json(403, { error: "opt-in required" });
  if (!textOk(body.traceHash, 16, 128) || !/^[a-f0-9]+$/i.test(body.traceHash)) return json(400, { error: "invalid request" });
  if (!textOk(body.title, 1, 80) || !textOk(body.brief, 1, 280) || !textOk(body.deviceKey, 8, 80)) {
    return json(400, { error: "invalid request" });
  }
  if (body.lang !== "en" && body.lang !== "zh") return json(400, { error: "invalid request" });
  if (typeof body.ending !== "string" || !ENDING_IDS.includes(body.ending as EndingId)) return json(400, { error: "invalid request" });
  if (!Array.isArray(body.signatures) || body.signatures.length > 8 || body.signatures.some((item) => !textOk(item, 1, 40) || !/^[a-z0-9:-]+$/i.test(item))) {
    return json(400, { error: "invalid request" });
  }
  const signatures = body.signatures.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  const title = body.title.trim();
  const brief = body.brief.trim();
  const findings = scanPlan(`${title}\n${brief}`);
  if (findings.length > 0) {
    return json(422, { error: "moderation rejected", categories: [...new Set(findings.map((finding) => finding.category))] });
  }
  const deviceHash = await blind(`device:${body.deviceKey}`);
  const ipHash = await blind(`ip:${clientIp(request)}`);
  const day = now - (now % DAY_MS);
  if ((await store.takeQuota(deviceHash, "post", day, POST_DEVICE_LIMIT)) === "limited") return json(429, { error: "rate limited" });
  if ((await store.takeQuota(ipHash, "post", day, POST_IP_LIMIT)) === "limited") return json(429, { error: "rate limited" });
  const strand: Strand = {
    id: crypto.randomUUID(),
    traceHash: body.traceHash.toLowerCase(),
    title,
    ending: body.ending,
    brief,
    signatures,
    lang: body.lang,
    bucket: briefBucket(brief),
    likes: 0,
    createdAt: now,
  };
  await store.insert(strand);
  return json(201, { id: strand.id, bucket: strand.bucket });
}

async function likeStrand(request: Request, store: StrandStore, id: string, now: number): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(404, { error: "not found" });
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return json(400, { error: "invalid request" });
  }
  const body = asRecord(parsed);
  if (!body || unexpected(body, LIKE_FIELDS) || !textOk(body.deviceKey, 8, 80)) return json(400, { error: "invalid request" });
  const deviceHash = await blind(`device:${body.deviceKey}`);
  const hour = now - (now % HOUR_MS);
  if ((await store.takeQuota(deviceHash, "like", hour, LIKE_DEVICE_LIMIT)) === "limited") return json(429, { error: "rate limited" });
  const result = await store.like(id, deviceHash, now);
  if (result === "missing") return json(404, { error: "not found" });
  const fresh = await store.get(id, now);
  if (!fresh) return json(404, { error: "not found" });
  return json(200, { likes: fresh.likes });
}


const OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "ledring-play-strands",
    version: "0.1.0",
    description: "Strands, likes, and free AI chat for LEDRING Play. near is a 2-hex lexical bucket (00–ff), not an embedding.",
  },
  servers: [{ url: "https://api.ledring.dev" }],
  paths: {
    "/health": {
      get: {
        summary: "Health",
        responses: { "200": { description: "ok" } },
      },
    },
    "/strands": {
      get: {
        summary: "List strands near a bucket",
        parameters: [
          {
            name: "near",
            in: "query",
            required: true,
            schema: { type: "string", pattern: "^[0-9a-fA-F]{2}$" },
            example: "a7",
            description: "Center bucket (2 hex chars). Returns that bucket and its two neighbours.",
          },
        ],
        responses: {
          "200": { description: "strands list" },
          "400": { description: "invalid near" },
        },
      },
      post: {
        summary: "Publish a strand (opt-in required)",
        responses: {
          "201": { description: "created" },
          "400": { description: "invalid request" },
          "403": { description: "opt-in required" },
          "429": { description: "rate limited" },
        },
      },
      options: { summary: "CORS preflight", responses: { "204": { description: "no content" } } },
    },
    "/strands/{id}/like": {
      post: {
        summary: "Like a strand",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: { "200": { description: "likes count" }, "404": { description: "not found" } },
      },
    },
    "/ai/chat": {
      post: {
        summary: "Free AI chat (daily quota)",
        responses: {
          "200": { description: "chat completion" },
          "429": { description: "quota exhausted" },
        },
      },
      options: { summary: "CORS preflight", responses: { "204": { description: "no content" } } },
    },
    "/openapi.json": {
      get: { summary: "OpenAPI document", responses: { "200": { description: "OpenAPI 3 JSON" } } },
    },
  },
} as const;

const DOCS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ledring-play-strands</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#16181A;background:#F3F2EE}a{color:#2F5BEA}code{font:13px ui-monospace,Menlo,monospace;background:#E8E6E0;padding:.1em .35em;border-radius:4px}pre{background:#E8E6E0;padding:12px;overflow:auto;border-radius:8px}h1{font-size:1.6rem;letter-spacing:-.02em}</style></head><body><h1>ledring-play-strands</h1><p>Play backend for strands, likes, and free AI chat.</p><ul><li><a href="/openapi.json">/openapi.json</a></li><li><code>GET /strands?near=a7</code> — 2-hex bucket + neighbours</li><li><code>POST /strands</code> · <code>POST /strands/:id/like</code> · <code>POST /ai/chat</code></li></ul><p><a href="https://ledring.dev/">ledring.dev</a> · <a href="https://play.ledring.dev/">play</a></p></body></html>`;

export async function handleStrands(request: Request, store: StrandStore, now = Date.now(), ai?: WorkersAi): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/ai/chat") return handleAiChat(request, store, now, ai);
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store",
      },
    });
  }
  if (request.method === "GET" && (url.pathname === "/openapi.json")) {
    return json(200, OPENAPI);
  }
  if (request.method === "GET" && (url.pathname === "/docs" || url.pathname === "/docs/")) {
    return new Response(DOCS_HTML, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    });
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json(200, {
      ok: true,
      service: "ledring-play-strands",
      routes: ["GET /health", "GET /strands?near=<bucket>", "POST /strands", "POST /strands/:id/like", "POST /ai/chat", "GET /openapi.json", "GET /docs"],
      nearExample: "/strands?near=a7",
    });
  }
  await store.purge(now);
  if (request.method === "POST" && url.pathname === "/strands") return postStrand(request, store, now);
  if (request.method === "GET" && url.pathname === "/strands") {
    const near = nearBuckets(url.searchParams.get("near") ?? "");
    if (!near) return json(400, { error: "invalid request" });
    const strands = await store.listNear(near, now, LIST_LIMIT);
    return json(200, { strands: strands.map(publicStrand) });
  }
  const like = url.pathname.match(/^\/strands\/([^/]+)\/like$/);
  if (request.method === "POST" && like?.[1]) return likeStrand(request, store, like[1], now);
  return json(404, { error: "not found" });
}
