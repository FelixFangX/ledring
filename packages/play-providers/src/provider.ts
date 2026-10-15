import { redactSecrets } from "./redact.js";

export const PROVIDER_IDS = ["demo", "chatgpt-plan", "openai-compat", "anthropic", "ollama"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface Delta {
  text: string;
}

export interface ModelInfo {
  id: string;
}

export interface ProviderStatus {
  ready: boolean;
  account?: string;
  emailMasked?: string;
  plan?: string;
  sharing?: boolean;
  models: ModelInfo[];
  warning?: string;
  manageUsageUrl?: string;
}

export interface StreamRequest {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Provider {
  id: ProviderId;
  status(): Promise<ProviderStatus>;
  stream(req: StreamRequest): AsyncIterable<Delta>;
}

export type ProviderErrorCode =
  | "auth"
  | "usage_limit"
  | "plan_off"
  | "rate_limit"
  | "upstream"
  | "abort"
  | "malformed"
  | "unavailable";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, code: ProviderErrorCode, extra?: { status?: number; retryAfterMs?: number }) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    if (extra?.status !== undefined) this.status = extra.status;
    if (extra?.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs;
  }
}

export interface RetryOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEMO_LABEL = "DEMO · synthetic cassette, not a live model recording";

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(value);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - now);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function asProviderError(error: unknown, signal?: AbortSignal): ProviderError {
  if (signal?.aborted || isAbortError(error)) return new ProviderError("aborted", "abort");
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : "upstream failed";
  return new ProviderError(message, "upstream");
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms === 0) {
    if (signal?.aborted) throw new ProviderError("aborted", "abort");
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("aborted", "abort"));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryable(error: ProviderError): boolean {
  if (error.code === "usage_limit" || error.code === "plan_off" || error.code === "auth" || error.code === "abort") return false;
  return error.status === 429 || (error.status !== undefined && error.status >= 500);
}

/** Retry 429 and 5xx before the first delta. Abort is never retried. */
export async function* withRetry(open: () => AsyncIterable<Delta>, opts: RetryOptions = {}): AsyncIterable<Delta> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (opts.signal?.aborted) throw new ProviderError("aborted", "abort");
    let yielded = false;
    try {
      for await (const delta of open()) {
        yielded = true;
        yield delta;
      }
      return;
    } catch (error) {
      const providerError = asProviderError(error, opts.signal);
      if (providerError.code === "abort" || yielded || attempt === maxAttempts || !retryable(providerError)) throw providerError;
      const wait = providerError.retryAfterMs ?? Math.min(200 * 2 ** (attempt - 1), 2_000);
      await sleep(wait);
    }
  }
}

interface SseBlock {
  event?: string;
  data: string;
}

export function parseSseBlock(raw: string): SseBlock | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return undefined;
  return { ...(event ? { event } : {}), data: data.join("\n") };
}

export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<SseBlock> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rejectAbort: ((error: ProviderError) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => undefined);
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
    rejectAbort?.(new ProviderError("aborted", "abort"));
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new ProviderError("aborted", "abort");
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await Promise.race([reader.read(), aborted]);
      } catch (error) {
        if (signal?.aborted || isAbortError(error) || (error instanceof ProviderError && error.code === "abort")) {
          throw new ProviderError("aborted", "abort");
        }
        throw error;
      }
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const parsed = parseSseBlock(part);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function errorFromStatus(status: number, retryAfter: string | null, body: string, secrets: readonly string[]): ProviderError {
  const retryAfterMs = parseRetryAfter(retryAfter);
  const safe = redactSecrets(body, secrets);
  const extra = { status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  if (status === 401 || status === 403) return new ProviderError(`HTTP ${status}`, "auth", extra);
  if (status === 429) return new ProviderError("HTTP 429", "rate_limit", extra);
  if (status >= 500) return new ProviderError(`HTTP ${status}`, "upstream", extra);
  return new ProviderError(`HTTP ${status} ${safe}`, "upstream", extra);
}

interface ChatConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

async function* postSse(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
  secrets: readonly string[],
): AsyncIterable<SseBlock> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, ...(signal ? { signal } : {}) });
  } catch (error) {
    throw asProviderError(error, signal);
  }
  if (!response.ok) {
    const body = await response.text();
    throw errorFromStatus(response.status, response.headers.get("retry-after"), body, secrets);
  }
  if (!response.body) throw new ProviderError("empty body", "malformed", { status: response.status });
  yield* readSse(response.body, signal);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function openAIDeltas(block: SseBlock): Delta | "stop" | undefined {
  if (block.data === "[DONE]") return "stop";
  let json: unknown;
  try {
    json = JSON.parse(block.data);
  } catch {
    throw new ProviderError("malformed SSE", "malformed");
  }
  const row = record(json);
  const error = record(row?.error);
  if (error) throw new ProviderError("upstream error", "upstream");
  const choice = record(Array.isArray(row?.choices) ? row.choices[0] : undefined);
  const delta = record(choice?.delta);
  const text = textOf(delta?.content);
  return text ? { text } : undefined;
}

function anthropicDeltas(block: SseBlock): Delta | "stop" | undefined {
  let json: unknown;
  try {
    json = JSON.parse(block.data);
  } catch {
    throw new ProviderError("malformed SSE", "malformed");
  }
  const row = record(json);
  const type = textOf(row?.type);
  if (type === "message_stop") return "stop";
  if (type === "error") {
    const kind = textOf(record(row?.error)?.type) ?? "";
    if (kind.includes("rate_limit")) throw new ProviderError("HTTP 429", "rate_limit", { status: 429 });
    throw new ProviderError("upstream error", "upstream", { status: 500 });
  }
  const delta = record(row?.delta);
  if (textOf(delta?.type) !== "text_delta") return undefined;
  const text = textOf(delta?.text);
  return text ? { text } : undefined;
}

async function* decode(blocks: AsyncIterable<SseBlock>, pick: (block: SseBlock) => Delta | "stop" | undefined): AsyncIterable<Delta> {
  for await (const block of blocks) {
    const delta = pick(block);
    if (delta === "stop") return;
    if (delta) yield delta;
  }
}

function chatProvider(id: "openai-compat" | "ollama", config: ChatConfig, headers: (apiKey: string) => Record<string, string>): Provider {
  const secrets = config.apiKey ? [config.apiKey] : [];
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    id,
    async status() {
      const ready = id === "ollama" || Boolean(config.apiKey);
      return { ready, models: [{ id: config.model }], ...(ready ? {} : { warning: "API key is not configured" }) };
    },
    stream(req) {
      if (id !== "ollama" && !config.apiKey) throw new ProviderError("API key is not configured", "unavailable");
      const model = req.model ?? config.model;
      const body = JSON.stringify({
        model,
        stream: true,
        max_tokens: req.maxTokens ?? 1200,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      });
      return withRetry(
        () =>
          decode(
            postSse(
              joinUrl(config.baseUrl, "/chat/completions"),
              { method: "POST", headers: { "content-type": "application/json", ...headers(config.apiKey ?? "") }, body },
              req.signal,
              fetchImpl,
              secrets,
            ),
            openAIDeltas,
          ),
        { ...(req.signal ? { signal: req.signal } : {}), ...(config.sleep ? { sleep: config.sleep } : {}) },
      );
    },
  };
}

export function openAICompatProvider(config: ChatConfig): Provider {
  return chatProvider("openai-compat", config, (apiKey) => ({ authorization: `Bearer ${apiKey}` }));
}

export function ollamaProvider(config: ChatConfig): Provider {
  return chatProvider("ollama", config, (apiKey) => {
    const headers: Record<string, string> = {};
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return headers;
  });
}

export function anthropicProvider(config: Omit<ChatConfig, "apiKey"> & { apiKey?: string }): Provider {
  const secrets = config.apiKey ? [config.apiKey] : [];
  const fetchImpl = config.fetchImpl ?? fetch;
  return {
    id: "anthropic",
    async status() {
      return {
        ready: Boolean(config.apiKey),
        models: [{ id: config.model }],
        ...(config.apiKey ? {} : { warning: "API key is not configured" }),
      };
    },
    stream(req) {
      if (!config.apiKey) throw new ProviderError("API key is not configured", "unavailable");
      const apiKey = config.apiKey;
      const body = JSON.stringify({
        model: req.model ?? config.model,
        max_tokens: req.maxTokens ?? 1200,
        system: req.system,
        stream: true,
        messages: [{ role: "user", content: req.user }],
      });
      return withRetry(
        () =>
          decode(
            postSse(
              joinUrl(config.baseUrl, "/messages"),
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                  "anthropic-dangerous-direct-browser-access": "true",
                },
                body,
              },
              req.signal,
              fetchImpl,
              secrets,
            ),
            anthropicDeltas,
          ),
        { ...(req.signal ? { signal: req.signal } : {}), ...(config.sleep ? { sleep: config.sleep } : {}) },
      );
    },
  };
}

export function demoProvider(script: readonly Delta[] = [{ text: `${DEMO_LABEL}\n` }]): Provider {
  return {
    id: "demo",
    async status() {
      return { ready: true, models: [{ id: "demo" }], warning: DEMO_LABEL };
    },
    async *stream(req) {
      for (const delta of script) {
        if (req.signal?.aborted) throw new ProviderError("aborted", "abort");
        yield delta;
      }
    },
  };
}
