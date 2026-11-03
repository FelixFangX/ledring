import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { ProviderError, readSse, withRetry, type Delta, type Provider, type ProviderStatus, type RetryOptions, type StreamRequest } from "./provider.js";
import { redactSecrets } from "./redact.js";

/**
 * Public help page from the ChatGPT plan guidelines.
 * Shown by the UI for usage limits. It is not an OAuth endpoint.
 */
export const MANAGE_USAGE_URL = "https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites";

/**
 * TODO(#30): `@siwc/local` was not on npm (404 on 2026-10-15). These paths are
 * used only when LEDRING_SIWC_AUTH_BASE points at a server the operator chose.
 * No production OAuth host is guessed. Replace this client with the official
 * SDK when it can be installed.
 */
const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const REVOKE_PATH = "/oauth/revoke";
const ACCOUNT_PATH = "/account";
const CLIENT_ID = "dynamic_agent_client";

export interface SiwcConfig {
  /** Must be exactly true. A missing flag stays signed out. */
  enabled: boolean;
  /** Operator-supplied auth origin. Required before any OAuth request. */
  authBase?: string;
  /** Operator-supplied API origin for the Responses stream. Required before a run. */
  apiBase?: string;
  /** Directory for the 0600 token file. */
  home: string;
  fetchImpl?: typeof fetch;
  sleep?: RetryOptions["sleep"];
}

interface TokenFile {
  accessToken: string;
  refreshToken?: string;
}

interface Account {
  name?: string;
  email?: string;
  plan?: string;
  sharing?: boolean;
  models?: string[];
}

export interface SiwcHandle {
  provider: Provider;
  begin(): Promise<{ url: string; state: string }>;
  waitUntilSignedIn(): Promise<void>;
  signOut(): Promise<void>;
  close(): Promise<void>;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "[redacted]";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function tokenPath(home: string): string {
  return join(home, "siwc-token.json");
}

function readTokens(home: string): TokenFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(tokenPath(home), "utf8")) as Partial<TokenFile>;
    if (!parsed.accessToken) return undefined;
    return { accessToken: parsed.accessToken, ...(parsed.refreshToken ? { refreshToken: parsed.refreshToken } : {}) };
  } catch {
    return undefined;
  }
}

function writeTokens(home: string, tokens: TokenFile): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = tokenPath(home);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function disabledStatus(): ProviderStatus {
  return {
    ready: false,
    models: [],
    warning: "Sign in with ChatGPT is off. LEDRING_SIWC is not 1, so this process is not connected.",
  };
}

export function createSiwc(config: SiwcConfig): SiwcHandle {
  const fetchImpl = config.fetchImpl ?? fetch;
  const secrets = () => {
    const tokens = readTokens(config.home);
    return [tokens?.accessToken, tokens?.refreshToken].filter((value): value is string => Boolean(value && value.length >= 6));
  };
  let loopback: ReturnType<typeof createServer> | undefined;
  let signedIn: Promise<void> = Promise.resolve();
  let resolveSignedIn: (() => void) | undefined;
  let rejectSignedIn: ((error: Error) => void) | undefined;
  let expectedState = "";

  const unavailable = (message: string, code: ProviderError["code"] = "unavailable") => new ProviderError(message, code);

  function configured(): boolean {
    return config.enabled && Boolean(config.authBase && config.apiBase);
  }

  async function postForm(path: string, body: URLSearchParams): Promise<Record<string, unknown>> {
    const base = config.authBase;
    if (!base) throw unavailable("auth base is not configured");
    const response = await fetchImpl(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new ProviderError(`HTTP ${response.status}`, response.status === 401 ? "auth" : "upstream", { status: response.status });
    const parsed = record(JSON.parse(text));
    if (!parsed) throw new ProviderError("malformed token response", "malformed");
    return parsed;
  }

  async function refresh(): Promise<void> {
    const current = readTokens(config.home);
    if (!current?.refreshToken) throw unavailable("not signed in", "auth");
    const parsed = await postForm(TOKEN_PATH, new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: CLIENT_ID,
    }));
    const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
    if (!accessToken) throw new ProviderError("malformed token response", "malformed");
    const next: TokenFile = { accessToken };
    const refreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : current.refreshToken;
    if (refreshToken) next.refreshToken = refreshToken;
    writeTokens(config.home, next);
  }

  async function account(accessToken: string): Promise<Account> {
    const base = config.authBase;
    if (!base) throw unavailable("auth base is not configured");
    const response = await fetchImpl(`${base.replace(/\/$/, "")}${ACCOUNT_PATH}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 401) throw new ProviderError("HTTP 401", "auth", { status: 401 });
    const text = await response.text();
    if (!response.ok) throw new ProviderError(`HTTP ${response.status}`, "upstream", { status: response.status });
    return (record(JSON.parse(text)) ?? {}) as Account;
  }

  async function loadAccount(): Promise<{ tokens: TokenFile; profile: Account } | undefined> {
    let tokens = readTokens(config.home);
    if (!tokens || !configured()) return undefined;
    try {
      return { tokens, profile: await account(tokens.accessToken) };
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== "auth" || !tokens.refreshToken) throw error;
      await refresh();
      tokens = readTokens(config.home);
      if (!tokens) return undefined;
      return { tokens, profile: await account(tokens.accessToken) };
    }
  }

  function statusFrom(profile: Account | undefined, signed: boolean): ProviderStatus {
    const manageUsageUrl = MANAGE_USAGE_URL;
    if (!config.enabled) return disabledStatus();
    if (!config.authBase || !config.apiBase) {
      return {
        ready: false,
        models: [],
        manageUsageUrl,
        warning: "Sign in with ChatGPT has no auth base configured. @siwc/local is not installed, and no production OAuth host is guessed.",
      };
    }
    if (!signed || !profile) return { ready: false, models: [], manageUsageUrl, warning: "Not signed in." };
    if (profile.sharing === false) {
      return { ready: false, models: [], sharing: false, manageUsageUrl, warning: "ChatGPT plan usage is off for this account." };
    }
    return {
      ready: true,
      ...(profile.name ? { account: profile.name } : {}),
      ...(profile.email ? { emailMasked: maskEmail(profile.email) } : {}),
      plan: "Using ChatGPT plan",
      sharing: true,
      manageUsageUrl,
      models: (profile.models ?? ["chatgpt-plan"]).map((id) => ({ id })),
    };
  }

  const provider: Provider = {
    id: "chatgpt-plan",
    async status() {
      if (!configured()) return statusFrom(undefined, false);
      try {
        const loaded = await loadAccount();
        return statusFrom(loaded?.profile, Boolean(loaded));
      } catch (error) {
        const message = redactSecrets(error instanceof Error ? error.message : "status failed", secrets());
        return { ready: false, models: [], warning: message };
      }
    },
    stream(req: StreamRequest) {
      return (async function* signedStream(): AsyncIterable<Delta> {
        if (!config.enabled) throw unavailable("Sign in with ChatGPT is off");
        if (!config.authBase || !config.apiBase) throw unavailable("Sign in with ChatGPT auth base is not configured");
        const loaded = await loadAccount();
        if (!loaded) throw unavailable("Not signed in");
        if (loaded.profile.sharing === false) throw new ProviderError("ChatGPT plan usage is off", "plan_off");
        let refreshed = false;
        while (true) {
          try {
            yield* withRetry(() => responses(req), { ...(req.signal ? { signal: req.signal } : {}), ...(config.sleep ? { sleep: config.sleep } : {}) });
            return;
          } catch (error) {
            if (error instanceof ProviderError && error.code === "auth" && !refreshed) {
              refreshed = true;
              await refresh();
              continue;
            }
            throw error;
          }
        }
      })();
    },
  };

  async function* responses(req: StreamRequest): AsyncIterable<Delta> {
    const tokens = readTokens(config.home);
    const apiBase = config.apiBase;
    if (!tokens || !apiBase) throw unavailable("Not signed in");
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokens.accessToken}`,
        },
        body: JSON.stringify({
          model: req.model ?? "chatgpt-plan",
          input: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          stream: true,
        }),
        ...(req.signal ? { signal: req.signal } : {}),
      });
    } catch (error) {
      if (req.signal?.aborted) throw new ProviderError("aborted", "abort");
      throw error;
    }
    if (!response.ok) {
      const text = await response.text();
      const parsed = (() => {
        try { return record(JSON.parse(text)); } catch { return undefined; }
      })();
      const code = String(record(parsed?.error)?.code ?? "");
      if (response.status === 429 && /usage_limit|insufficient_quota/.test(code)) {
        throw new ProviderError("usage limit", "usage_limit");
      }
      if (response.status === 401) throw new ProviderError("HTTP 401", "auth", { status: 401 });
      throw new ProviderError(`HTTP ${response.status}`, response.status === 429 ? "rate_limit" : "upstream", { status: response.status });
    }
    if (!response.body) throw new ProviderError("empty body", "malformed");
    for await (const block of readSse(response.body, req.signal)) {
      if (block.data === "[DONE]") return;
      let json: unknown;
      try { json = JSON.parse(block.data); } catch { throw new ProviderError("malformed SSE", "malformed"); }
      const row = record(json);
      const type = typeof row?.type === "string" ? row.type : "";
      if (type === "response.completed" || type === "response.output_text.done") return;
      if (type === "response.output_text.delta" && typeof row?.delta === "string" && row.delta) yield { text: row.delta };
    }
  }

  async function exchange(code: string, redirectUri: string, verifier: string): Promise<void> {
    const parsed = await postForm(TOKEN_PATH, new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }));
    const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
    if (!accessToken) throw new ProviderError("malformed token response", "malformed");
    const tokens: TokenFile = { accessToken };
    if (typeof parsed.refresh_token === "string") tokens.refreshToken = parsed.refresh_token;
    writeTokens(config.home, tokens);
    resolveSignedIn?.();
  }

  return {
    provider,
    async begin() {
      if (!config.enabled) throw unavailable("Sign in with ChatGPT is off");
      if (!config.authBase || !config.apiBase) throw unavailable("Sign in with ChatGPT auth base is not configured");
      await closeLoopback();
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      expectedState = randomBytes(16).toString("base64url");
      signedIn = new Promise<void>((resolve, reject) => {
        resolveSignedIn = resolve;
        rejectSignedIn = reject;
      });
      void signedIn.catch(() => undefined);
      const redirect = await new Promise<string>((resolve, reject) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          if (url.pathname !== "/callback") {
            res.writeHead(404);
            res.end();
            return;
          }
          const state = url.searchParams.get("state");
          const code = url.searchParams.get("code");
          if (!code || state !== expectedState) {
            res.writeHead(400);
            res.end("state mismatch");
            rejectSignedIn?.(new ProviderError("state mismatch", "auth"));
            return;
          }
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
          res.end("Signed in. You can close this tab.");
          const port = server.address();
          const redirectUri = port && typeof port !== "string" ? `http://127.0.0.1:${port.port}/callback` : "";
          void exchange(code, redirectUri, verifier).catch((error: Error) => rejectSignedIn?.(error));
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("loopback failed"));
            return;
          }
          loopback = server;
          resolve(`http://127.0.0.1:${address.port}/callback`);
        });
      });
      const auth = new URL(AUTHORIZE_PATH, config.authBase.endsWith("/") ? config.authBase : `${config.authBase}/`);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("client_id", CLIENT_ID);
      auth.searchParams.set("redirect_uri", redirect);
      auth.searchParams.set("code_challenge", challenge);
      auth.searchParams.set("code_challenge_method", "S256");
      auth.searchParams.set("scope", "offline_access chatgpt.tokens.use.direct");
      auth.searchParams.set("state", expectedState);
      return { url: auth.toString(), state: expectedState };
    },
    waitUntilSignedIn: () => signedIn,
    async signOut() {
      const tokens = readTokens(config.home);
      if (tokens && config.authBase) {
        await fetchImpl(`${config.authBase.replace(/\/$/, "")}${REVOKE_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Bearer ${tokens.accessToken}` },
          body: new URLSearchParams({ token: tokens.accessToken, client_id: CLIENT_ID }),
        }).catch(() => undefined);
      }
      rmSync(tokenPath(config.home), { force: true });
      await closeLoopback();
    },
    close: closeLoopback,
  };

  function closeLoopback(): Promise<void> {
    const server = loopback;
    loopback = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}
