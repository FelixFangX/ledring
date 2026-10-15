import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anthropicProvider,
  createSiwc,
  demoProvider,
  MANAGE_USAGE_URL,
  ollamaProvider,
  openAICompatProvider,
  ProviderError,
  redactSecrets,
  type Delta,
  type Provider,
} from "@ledring/play-providers";
import { JudgeRuntime, JudgeUnavailableError, judgeArtifact, judgeBody } from "@ledring/play-judge";
import { streamTrace } from "@ledring/play-core";
import { z } from "zod";
import { providerSecrets, type BridgeConfig } from "./config.js";
import { appendSessionLog, listSessionIds, readSessionLog } from "./store.js";

const judgeSchema = z
  .object({
    html: z.string().max(1_500_000),
    wantTests: z.boolean().optional(),
    wantPolish: z.boolean().optional(),
    leakedDespiteBlock: z.boolean().optional(),
    checks: z.unknown().optional(),
  })
  .strict();

const stepSchema = z.object({
  provider: z.enum(["demo", "openai-compat", "anthropic", "ollama", "chatgpt-plan"]),
  system: z.string().max(100_000),
  user: z.string().max(100_000),
  model: z.string().max(200).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
}).strict();

type StepEvent = "delta" | "error" | "done" | "stopped";

interface StoredEvent {
  id: number;
  event: StepEvent;
  data: unknown;
}

interface Session {
  id: string;
  events: StoredEvent[];
  done: boolean;
  generation: number;
  resolvers: Array<() => void>;
  abort?: AbortController;
  /** Append one event to the on-disk log, when a home directory is set. */
  save?: (event: StoredEvent) => void;
}

export interface BridgeHandle {
  port: number;
  url: string;
  token: string;
  logs: string[];
  close: () => Promise<void>;
}

export interface StartBridgeOptions {
  port?: number;
  token?: string;
  config?: BridgeConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  open?: (url: string) => void;
  siwc?: { enabled?: boolean; authBase?: string; apiBase?: string; home?: string };
  /** Closed when the bridge closes. Defaults to a runtime owned by this process. */
  judgeRuntime?: JudgeRuntime;
  /** Session JSONL is stored at `<home>/sessions`. Omit for an in-memory bridge. */
  home?: string;
}

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>LEDRING Play</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem;color:#0E1114;background:#EEF1F3}</style>
<h1>LEDRING Play</h1>
<p>The local bridge is running. Model keys stay on this machine.</p>
<p>DEMO · synthetic cassette, not a live model recording. A configured key is required for a live model.</p>
</html>
`;

function createSession(id: string): Session {
  return { id, events: [], done: true, generation: 0, resolvers: [] };
}

function wake(session: Session): void {
  session.generation += 1;
  const waiting = session.resolvers.splice(0);
  for (const resolve of waiting) resolve();
}

function push(session: Session, event: StepEvent, data: unknown): void {
  const stored: StoredEvent = { id: session.events.length + 1, event, data };
  session.events.push(stored);
  session.save?.(stored);
  wake(session);
}

function finish(session: Session): void {
  session.abort = undefined;
  session.done = true;
  wake(session);
}

function wait(session: Session, seen: number): Promise<void> {
  if (session.done || session.generation !== seen) return Promise.resolve();
  return new Promise((resolve) => session.resolvers.push(resolve));
}

async function pipe(session: Session, start: number, res: ServerResponse): Promise<void> {
  let index = start;
  let seen = session.generation;
  while (!res.writableEnded) {
    while (index < session.events.length) {
      const event = session.events[index];
      index += 1;
      if (!event) continue;
      res.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
    if (session.done) break;
    seen = session.generation;
    await wait(session, seen);
  }
  if (!res.writableEnded) res.end();
}

function tokenMatches(got: string | undefined, expected: string): boolean {
  if (!got) return false;
  const left = Buffer.from(got);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function cookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const value = host.toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

function originAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

async function readBody(req: IncomingMessage, max = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > max) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function providersFor(
  config: BridgeConfig,
  deps: Pick<StartBridgeOptions, "fetchImpl" | "sleep">,
  chatgpt: Provider,
): Record<z.infer<typeof stepSchema>["provider"], Provider> {
  const shared = {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  };
  return {
    demo: demoProvider(),
    "openai-compat": openAICompatProvider({
      ...(config.openai?.apiKey ? { apiKey: config.openai.apiKey } : {}),
      baseUrl: config.openai?.baseUrl ?? "https://api.openai.com/v1",
      model: config.openai?.model ?? "gpt-4o-mini",
      ...shared,
    }),
    anthropic: anthropicProvider({
      ...(config.anthropic?.apiKey ? { apiKey: config.anthropic.apiKey } : {}),
      baseUrl: config.anthropic?.baseUrl ?? "https://api.anthropic.com/v1",
      model: config.anthropic?.model ?? "claude-sonnet-4-5",
      ...shared,
    }),
    ollama: ollamaProvider({
      baseUrl: config.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1",
      model: config.ollama?.model ?? "qwen2.5-coder:7b",
      ...shared,
    }),
    "chatgpt-plan": chatgpt,
  };
}

async function runStep(session: Session, provider: Provider, input: z.infer<typeof stepSchema>, secrets: readonly string[]): Promise<void> {
  const controller = new AbortController();
  session.abort = controller;
  try {
    const req: { system: string; user: string; signal: AbortSignal; model?: string; maxTokens?: number } = {
      system: input.system,
      user: input.user,
      signal: controller.signal,
    };
    if (input.model) req.model = input.model;
    if (input.maxTokens) req.maxTokens = input.maxTokens;
    for await (const delta of provider.stream(req) as AsyncIterable<Delta>) {
      if (!delta.text) continue;
      push(session, "delta", { text: delta.text });
    }
    push(session, "done", {});
  } catch (error) {
    if (controller.signal.aborted) push(session, "stopped", {});
    else {
      const coded = error instanceof ProviderError ? error : new ProviderError("upstream failed", "upstream");
      push(session, "error", {
        code: coded.code,
        message: redactSecrets(coded.message, secrets),
        ...(coded.code === "usage_limit" || coded.code === "plan_off" ? { manageUsageUrl: MANAGE_USAGE_URL } : {}),
      });
    }
  } finally {
    finish(session);
  }
}

export async function startBridge(opts: StartBridgeOptions = {}): Promise<BridgeHandle> {
  const token = opts.token ?? randomBytes(24).toString("hex");
  const judgeRuntime = opts.judgeRuntime ?? new JudgeRuntime();
  const config = opts.config ?? {};
  const secrets = [token, ...providerSecrets(config)];
  const siwc = createSiwc({
    enabled: opts.siwc?.enabled === true,
    ...(opts.siwc?.authBase ? { authBase: opts.siwc.authBase } : {}),
    ...(opts.siwc?.apiBase ? { apiBase: opts.siwc.apiBase } : {}),
    home: opts.siwc?.home ?? join(tmpdir(), "ledring-play-siwc-off"),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  });
  const providers = providersFor(config, opts, siwc.provider);
  const sessionDir = opts.home ? join(opts.home, "sessions") : undefined;
  const sessions = new Map<string, Session>();
  const attach = (session: Session): Session => {
    if (sessionDir) session.save = (stored) => appendSessionLog(sessionDir, session.id, stored);
    return session;
  };
  if (sessionDir) {
    for (const id of listSessionIds(sessionDir)) {
      const session = attach(createSession(id));
      session.events = readSessionLog(sessionDir, id) as StoredEvent[];
      sessions.set(id, session);
    }
  }
  const logs: string[] = [];
  const log = (line: string) => {
    logs.push(redactSecrets(line, secrets));
  };

  let port = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const method = req.method ?? "GET";
    const pathname = url.pathname;
    const finishLog = (status: number, note = "") => log(`${method} ${pathname} ${status}${note ? ` ${note}` : ""}`);

    if (!hostAllowed(req.headers.host, port)) {
      send(res, 421, { error: "bad host" });
      finishLog(421);
      return;
    }

    const statusProbe = (method === "GET" || method === "OPTIONS") && pathname === "/api/status";
    if (!statusProbe && !originAllowed(req.headers.origin, port)) {
      send(res, 403, { error: "forbidden" });
      finishLog(403);
      return;
    }

    if (method === "OPTIONS" && pathname === "/api/status") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "cache-control": "no-store",
      });
      res.end();
      finishLog(204);
      return;
    }

    if (method === "GET" && pathname === "/api/status") {
      send(res, 200, { ok: true, service: "ledring-play" }, { "access-control-allow-origin": "*" });
      finishLog(200);
      return;
    }

    if (method === "GET" && pathname === "/favicon.ico") {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end();
      finishLog(404);
      return;
    }

    const presented = req.headers["x-ledring-token"];
    const headerToken = Array.isArray(presented) ? presented[0] : presented;
    const authed = tokenMatches(headerToken, token) || tokenMatches(cookie(req.headers.cookie, "ledring_token"), token);
    if (!authed) {
      send(res, 403, { error: "forbidden" });
      finishLog(403);
      return;
    }

    try {
      if (method === "GET" && pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "set-cookie": `ledring_token=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        res.end(PAGE);
        finishLog(200);
        return;
      }

      if (method === "POST" && pathname === "/api/providers/chatgpt-plan/begin") {
        try {
          const started = await siwc.begin();
          send(res, 200, { url: started.url });
          finishLog(200);
        } catch (error) {
          const message = redactSecrets(error instanceof Error ? error.message : "unavailable", secrets);
          send(res, 409, { error: message });
          finishLog(409, message);
        }
        return;
      }

      if (method === "POST" && pathname === "/api/providers/chatgpt-plan/sign-out") {
        await siwc.signOut();
        send(res, 200, { signedOut: true });
        finishLog(200);
        return;
      }

      if (method === "GET" && pathname === "/api/providers") {
        const statuses = await Promise.all(
          (Object.keys(providers) as Array<keyof typeof providers>).map(async (id) => ({ id, ...(await providers[id].status()) })),
        );
        send(res, 200, { providers: statuses });
        finishLog(200);
        return;
      }

      if (method === "POST" && pathname === "/api/sessions") {
        const session = attach(createSession(randomUUID()));
        sessions.set(session.id, session);
        send(res, 201, { id: session.id });
        finishLog(201);
        return;
      }

      const parts = pathname.split("/").filter(Boolean);
      const session = parts[0] === "api" && parts[1] === "sessions" ? sessions.get(parts[2] ?? "") : undefined;
      if (parts[0] === "api" && parts[1] === "sessions" && !session) {
        send(res, 404, { error: "not found" });
        finishLog(404);
        return;
      }

      if (session && method === "POST" && parts[3] === "steps" && parts.length === 4) {
        if (!session.done) {
          send(res, 409, { error: "a step is already running" });
          finishLog(409);
          return;
        }
        const parsed = stepSchema.safeParse(JSON.parse(await readBody(req) || "{}"));
        if (!parsed.success) {
          send(res, 400, { error: "invalid request" });
          finishLog(400);
          return;
        }
        const start = session.events.length;
        session.done = false;
        const task = runStep(session, providers[parsed.data.provider], parsed.data, secrets);
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        await pipe(session, start, res);
        await task;
        finishLog(200);
        return;
      }

      if (session && method === "GET" && parts[3] === "stream" && parts.length === 4) {
        const from = Number(url.searchParams.get("from") ?? "0");
        const start = session.events.findIndex((event) => event.id > from);
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
        await pipe(session, start === -1 ? session.events.length : start, res);
        finishLog(200);
        return;
      }

      if (session && method === "POST" && parts[3] === "stop" && parts.length === 4) {
        const running = Boolean(session.abort);
        session.abort?.abort();
        send(res, 200, { stopped: running });
        finishLog(200);
        return;
      }

      if (session && method === "GET" && parts[3] === "trace" && parts.length === 4) {
        send(res, 200, streamTrace(session.id, session.events));
        finishLog(200);
        return;
      }

      if (method === "POST" && pathname === "/api/judge") {
        const parsed = judgeSchema.safeParse(JSON.parse((await readBody(req, 1_500_000)) || "{}"));
        if (!parsed.success) {
          send(res, 400, { error: "invalid request" });
          finishLog(400);
          return;
        }
        try {
          const verdict = await judgeArtifact(
            {
              html: parsed.data.html,
              wantTests: parsed.data.wantTests ?? false,
              wantPolish: parsed.data.wantPolish ?? false,
              leakedDespiteBlock: parsed.data.leakedDespiteBlock ?? false,
              ...(parsed.data.checks !== undefined ? { checks: parsed.data.checks } : {}),
            },
            { runtime: judgeRuntime },
          );
          send(res, 200, judgeBody(verdict));
          finishLog(200);
        } catch (error) {
          const unavailable = error instanceof JudgeUnavailableError;
          const message = redactSecrets(error instanceof Error ? error.message : "judge failed", secrets);
          send(res, unavailable ? 503 : 500, {
            error: unavailable ? "judge browser is unavailable" : message.slice(0, 180),
          });
          finishLog(unavailable ? 503 : 500);
        }
        return;
      }

      send(res, 404, { error: "not found" });
      finishLog(404);
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : "failed", secrets);
      if (!res.headersSent) send(res, 400, { error: "invalid request" });
      else res.end();
      finishLog(res.statusCode || 400, message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const listening = server.address();
      if (!listening || typeof listening === "string") {
        reject(new Error("bridge failed to bind"));
        return;
      }
      port = listening.port;
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bridge failed to bind");
  const handle: BridgeHandle = {
    port,
    url: `http://127.0.0.1:${address.port}/`,
    token,
    logs,
    close: async () => {
      for (const session of sessions.values()) session.abort?.abort();
      await siwc.close();
      await judgeRuntime.close();
      await new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
  if (address.address !== "127.0.0.1") throw new Error(`bridge bound ${address.address}, expected 127.0.0.1`);
  opts.open?.(handle.url);
  log(`listen ${handle.url}`);
  return handle;
}
