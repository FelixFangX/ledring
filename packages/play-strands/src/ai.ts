import { blind } from "./handle.js";
import {
  AI_FIELDS,
  AI_GLOBAL_DAY_LIMIT,
  AI_IP_DAY_LIMIT,
  AI_MAX_BODY_BYTES,
  AI_MAX_MESSAGE_CHARS,
  AI_MAX_MESSAGES,
  AI_MAX_TOKENS,
  AI_MAX_TOTAL_CHARS,
  AI_MODEL,
  DAY_MS,
} from "./limits.js";
import type { StrandStore } from "./store.js";

export interface WorkersAi {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

const QUOTA_MESSAGE = "LEDRING Free AI has used today's shared quota. Try again tomorrow, or use your own key.";
const RATE_MESSAGE = "Too many free requests from this network today. Try again tomorrow, or use your own key.";
const TOO_BIG_MESSAGE = "That request is too large for LEDRING Free AI. Shorten it, or use your own key.";
const UNAVAILABLE_MESSAGE = "LEDRING Free AI is unavailable right now. Try again later, or use your own key.";

const AI_ROLES = new Set(["system", "user", "assistant"]);

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (origin === "https://felixfangx.github.io") return origin;
  if ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return origin;
  }
  return null;
}

function aiHeaders(origin: string | null, contentType: string): Headers {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "no-store",
    vary: "origin",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
  }
  return headers;
}

function aiJson(status: number, origin: string | null, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: aiHeaders(origin, "application/json; charset=utf-8") });
}

function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function suffix(text: string, accumulated: string): string {
  if (accumulated && text.startsWith(accumulated)) return text.slice(accumulated.length);
  return text;
}

function deltaFrom(parsed: unknown, accumulated: string): string {
  const record = asRecord(parsed);
  if (!record) return "";
  const choices = record.choices;
  if (Array.isArray(choices)) {
    const choice = asRecord(choices[0]);
    const delta = asRecord(choice?.delta);
    if (typeof delta?.content === "string") return delta.content;
    const message = asRecord(choice?.message);
    if (typeof message?.content === "string") return suffix(message.content, accumulated);
  }
  if (typeof record.response === "string") return suffix(record.response, accumulated);
  const nested = asRecord(record.response);
  if (typeof nested?.content === "string") return suffix(nested.content, accumulated);
  if (typeof nested?.response === "string") return suffix(nested.response, accumulated);
  return "";
}

function isErrorPayload(parsed: unknown): boolean {
  const record = asRecord(parsed);
  return Boolean(record && record.error != null);
}

async function readSse(stream: ReadableStream<Uint8Array>, onDelta: (delta: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let accumulated = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "").trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (isErrorPayload(parsed)) throw new Error("model error");
        const delta = deltaFrom(parsed, accumulated);
        if (!delta) continue;
        accumulated += delta;
        onDelta(delta);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function openAiChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}

function toOpenAiSse(result: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      try {
        if (result instanceof ReadableStream) await readSse(result, (delta) => push(openAiChunk(delta)));
        else if (result instanceof Response && result.body) await readSse(result.body, (delta) => push(openAiChunk(delta)));
        else {
          const delta = deltaFrom(result, "") || (typeof result === "string" ? result : "");
          if (delta) push(openAiChunk(delta));
        }
        push("data: [DONE]\n\n");
        controller.close();
      } catch {
        push(`data: ${JSON.stringify({ error: { message: UNAVAILABLE_MESSAGE, code: "unavailable" } })}\n\n`);
        push("data: [DONE]\n\n");
        controller.close();
      }
    },
  });
}

function invalid(origin: string | null): Response {
  return aiJson(400, origin, { error: { message: "invalid request", code: "invalid_request" } });
}

function tooBig(origin: string | null): Response {
  return aiJson(413, origin, { error: { message: TOO_BIG_MESSAGE, code: "input_too_large" } });
}

function messagesFrom(body: Record<string, unknown>, origin: string | null): { role: string; content: string }[] | Response {
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > AI_MAX_MESSAGES) return invalid(origin);
  const messages: { role: string; content: string }[] = [];
  let total = 0;
  for (const item of body.messages) {
    const message = asRecord(item);
    if (!message || typeof message.role !== "string" || !AI_ROLES.has(message.role) || typeof message.content !== "string") return invalid(origin);
    if (message.content.length > AI_MAX_MESSAGE_CHARS) return tooBig(origin);
    total += message.content.length;
    if (total > AI_MAX_TOTAL_CHARS) return tooBig(origin);
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

function cappedTokens(value: unknown, origin: string | null): number | Response {
  if (value === undefined) return AI_MAX_TOKENS;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return invalid(origin);
  return Math.min(AI_MAX_TOKENS, Math.floor(value));
}

function cappedTemperature(value: unknown, origin: string | null): number | Response {
  if (value === undefined) return 0.6;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) return invalid(origin);
  return value;
}

export async function handleAiChat(request: Request, store: StrandStore, now: number, ai?: WorkersAi): Promise<Response> {
  const origin = allowedOrigin(request.headers.get("origin"));
  if (request.headers.get("origin") && !origin) return aiJson(403, null, { error: { message: "origin not allowed", code: "origin" } });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: aiHeaders(origin, "text/plain; charset=utf-8") });
  }
  if (request.method !== "POST") return aiJson(405, origin, { error: { message: "method not allowed", code: "method" } });
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > AI_MAX_BODY_BYTES) {
    return aiJson(413, origin, { error: { message: TOO_BIG_MESSAGE, code: "input_too_large" } });
  }
  const raw = await request.text();
  if (raw.length > AI_MAX_BODY_BYTES) return aiJson(413, origin, { error: { message: TOO_BIG_MESSAGE, code: "input_too_large" } });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return aiJson(400, origin, { error: { message: "invalid request", code: "invalid_request" } });
  }
  const body = asRecord(parsed);
  const fields: readonly string[] = AI_FIELDS;
  if (!body || Object.keys(body).some((key) => !fields.includes(key))) return invalid(origin);
  const messages = messagesFrom(body, origin);
  if (messages instanceof Response) return messages;
  const maxTokens = cappedTokens(body.max_tokens, origin);
  if (maxTokens instanceof Response) return maxTokens;
  const temperature = cappedTemperature(body.temperature, origin);
  if (temperature instanceof Response) return temperature;
  if (!ai) return aiJson(503, origin, { error: { message: UNAVAILABLE_MESSAGE, code: "unavailable" } });

  const day = now - (now % DAY_MS);
  const ipHash = await blind(`ip:${clientIp(request)}`);
  if ((await store.takeQuota(ipHash, "ai", day, AI_IP_DAY_LIMIT)) === "limited") {
    return aiJson(429, origin, { error: { message: RATE_MESSAGE, code: "rate_limited" } });
  }
  const globalHash = await blind("global:ai");
  if ((await store.takeQuota(globalHash, "ai", day, AI_GLOBAL_DAY_LIMIT)) === "limited") {
    return aiJson(429, origin, { error: { message: QUOTA_MESSAGE, code: "quota_exhausted" } });
  }

  let result: unknown;
  try {
    result = await ai.run(AI_MODEL, { messages, stream: true, max_tokens: maxTokens, temperature });
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    const quota = /neuron|quota|429|capacity/i.test(text);
    return aiJson(quota ? 429 : 503, origin, {
      error: { message: quota ? QUOTA_MESSAGE : UNAVAILABLE_MESSAGE, code: quota ? "quota_exhausted" : "unavailable" },
    });
  }
  return new Response(toOpenAiSse(result), { status: 200, headers: aiHeaders(origin, "text/event-stream; charset=utf-8") });
}
