import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSiwc, ProviderError } from "@ledring/play-providers";

const root = fileURLToPath(new URL("../../../", import.meta.url));

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function homeDir(): string {
  return mkdtempSync(join(tmpdir(), "ledring-siwc-"));
}

async function textOf(provider: { stream: (req: { system: string; user: string }) => AsyncIterable<{ text: string }> }): Promise<string> {
  let text = "";
  for await (const delta of provider.stream({ system: "s", user: "u" })) text += delta.text;
  return text;
}

describe("Sign in with ChatGPT flag", () => {
  it("stays signed out when the flag is off and never calls the network", async () => {
    let called = 0;
    const client = createSiwc({
      enabled: false,
      authBase: "http://127.0.0.1:9",
      apiBase: "http://127.0.0.1:9",
      home: homeDir(),
      fetchImpl: async () => {
        called += 1;
        throw new Error("network");
      },
    });
    expect(client.provider.id).toBe("chatgpt-plan");
    const status = await client.provider.status();
    expect(status.ready).toBe(false);
    expect(JSON.stringify(status)).not.toMatch(/Using ChatGPT plan|Connected/);
    await expect(client.begin()).rejects.toMatchObject({ code: "unavailable" });
    expect(called).toBe(0);
    await client.close();
  });

  it("refuses to start OAuth when the operator has not set an auth base", async () => {
    const client = createSiwc({ enabled: true, home: homeDir() });
    const status = await client.provider.status();
    expect(status.ready).toBe(false);
    expect(status.warning).toMatch(/no production OAuth host is guessed/);
    expect(JSON.stringify(status)).not.toMatch(/Using ChatGPT plan|Connected/);
    await expect(client.begin()).rejects.toBeInstanceOf(ProviderError);
    await client.close();
  });

  it("exchanges a loopback code, masks the account, and streams without leaking the token", async () => {
    const home = homeDir();
    const upstream = await listen((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/oauth/authorize") {
        const location = `${url.searchParams.get("redirect_uri")}?code=authcode&state=${url.searchParams.get("state")}`;
        res.writeHead(302, { location });
        res.end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/oauth/token") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "access-token-value", refresh_token: "refresh-token-value" }));
        return;
      }
      if (url.pathname === "/account") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ name: "Ada", email: "adeline@example.com", sharing: true, models: ["gpt"] }));
        return;
      }
      if (url.pathname === "/responses") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"response.output_text.delta","delta":"hi"}\n\n');
        res.write('data: {"type":"response.completed"}\n\n');
        res.end();
        return;
      }
      if (url.pathname === "/oauth/revoke") {
        res.end("ok");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const client = createSiwc({ enabled: true, authBase: upstream.url, apiBase: upstream.url, home });
    try {
      const started = await client.begin();
      expect(started.url).toContain("client_id=dynamic_agent_client");
      expect(started.url).toContain("code_challenge_method=S256");
      expect(started.url).not.toContain("api.openai.com");
      expect((await fetch(started.url, { redirect: "follow" })).status).toBe(200);
      await client.waitUntilSignedIn();
      const status = await client.provider.status();
      expect(status.ready).toBe(true);
      expect(status.plan).toBe("Using ChatGPT plan");
      expect(status.account).toBe("Ada");
      expect(status.emailMasked).toBe("a***@example.com");
      expect(status.manageUsageUrl).toMatch(/^https:\/\/help\.openai\.com\//);
      const encoded = JSON.stringify(status);
      expect(encoded).not.toContain("adeline");
      expect(encoded).not.toContain("access-token-value");
      expect((statSync(join(home, "siwc-token.json")).mode & 0o777)).toBe(0o600);
      expect(await textOf(client.provider)).toBe("hi");
      await client.signOut();
      expect(statSync(join(home, "siwc-token.json"))).toBeUndefined();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      await client.close();
      await upstream.close();
    }
  });

  it("rejects a mismatched state and does not store a token", async () => {
    const home = homeDir();
    const upstream = await listen((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const client = createSiwc({ enabled: true, authBase: upstream.url, apiBase: upstream.url, home });
    try {
      const started = await client.begin();
      const redirect = new URL(started.url).searchParams.get("redirect_uri");
      expect(redirect).toBeTruthy();
      const bad = await fetch(`${redirect}?code=nope&state=wrong`);
      expect(bad.status).toBe(400);
      await expect(client.waitUntilSignedIn()).rejects.toMatchObject({ code: "auth" });
      expect(() => statSync(join(home, "siwc-token.json"))).toThrow();
    } finally {
      await client.close();
      await upstream.close();
    }
  });

  it("maps plan-off and usage-limit without retrying, and refreshes once on 401", async () => {
    const home = homeDir();
    writeFileSync(join(home, "siwc-token.json"), JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old" }));
    chmodSync(join(home, "siwc-token.json"), 0o600);
    let responses = 0;
    let tokenPosts = 0;
    const upstream = await listen((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/account") {
        const sharing = req.headers["x-test-sharing"];
        res.end(JSON.stringify({ name: "Ada", email: "adeline@example.com", sharing: sharing !== "off" }));
        return;
      }
      if (url.pathname === "/oauth/token") {
        tokenPosts += 1;
        res.end(JSON.stringify({ access_token: "access-new", refresh_token: "refresh-old" }));
        return;
      }
      if (url.pathname === "/responses") {
        responses += 1;
        const auth = req.headers.authorization;
        if (auth === "Bearer access-old") {
          res.writeHead(401);
          res.end("unauthorized");
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"response.output_text.delta","delta":"ok"}\n\n');
        res.end();
      }
    });
    const client = createSiwc({ enabled: true, authBase: upstream.url, apiBase: upstream.url, home });
    try {
      expect(await textOf(client.provider)).toBe("ok");
      expect(responses).toBe(2);
      expect(tokenPosts).toBe(1);
      expect(readFileSync(join(home, "siwc-token.json"), "utf8")).toContain("access-new");
      expect(readFileSync(join(home, "siwc-token.json"), "utf8")).not.toContain("access-old");
    } finally {
      await client.close();
      await upstream.close();
    }

    const limitedHome = homeDir();
    writeFileSync(join(limitedHome, "siwc-token.json"), JSON.stringify({ accessToken: "access-token-value" }));
    chmodSync(join(limitedHome, "siwc-token.json"), 0o600);
    let limitedHits = 0;
    const limited = await listen((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/account") {
        res.end(JSON.stringify({ name: "Ada", email: "adeline@example.com", sharing: false }));
        return;
      }
      limitedHits += 1;
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "usage_limit" } }));
    });
    const off = createSiwc({ enabled: true, authBase: limited.url, apiBase: limited.url, home: limitedHome });
    try {
      const status = await off.provider.status();
      expect(status.ready).toBe(false);
      expect(status.sharing).toBe(false);
      expect(status.plan).toBeUndefined();
      expect(JSON.stringify(status)).not.toMatch(/Using ChatGPT plan|Connected/);
      await expect(textOf(off.provider)).rejects.toMatchObject({ code: "plan_off" });
      expect(limitedHits).toBe(0);
    } finally {
      await off.close();
      await limited.close();
    }

    const quotaHome = homeDir();
    writeFileSync(join(quotaHome, "siwc-token.json"), JSON.stringify({ accessToken: "access-token-value" }));
    chmodSync(join(quotaHome, "siwc-token.json"), 0o600);
    let quotaHits = 0;
    const quota = await listen((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/account") {
        res.end(JSON.stringify({ name: "Ada", sharing: true }));
        return;
      }
      quotaHits += 1;
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "usage_limit", message: "access-token-value" } }));
    });
    const capped = createSiwc({ enabled: true, authBase: quota.url, apiBase: quota.url, home: quotaHome });
    try {
      await expect(textOf(capped.provider)).rejects.toMatchObject({ code: "usage_limit" });
      expect(quotaHits).toBe(1);
    } finally {
      await capped.close();
      await quota.close();
    }
  });

  it("has no code path that reads a Codex credential file or spawns codex", () => {
    const files = ["packages", "scripts"].flatMap((dir) => walk(join(root, dir)));
    const source = files.filter((path) => /\/src\/|\/scripts\//.test(path) && /\.(ts|js|mjs)$/.test(path)).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toContain(".codex/auth.json");
    expect(source).not.toMatch(/spawn(?:Sync)?\([^)]*codex/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
