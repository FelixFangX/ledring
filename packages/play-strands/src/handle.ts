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

export async function handleStrands(request: Request, store: StrandStore, now = Date.now(), ai?: WorkersAi): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/ai/chat") return handleAiChat(request, store, now, ai);
  if (request.method === "OPTIONS") return json(204, {});
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    return json(200, {
      ok: true,
      service: "ledring-play-strands",
      routes: ["GET /health", "GET /strands?near=<bucket>", "POST /strands", "POST /strands/:id/like", "POST /ai/chat"],
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
