import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const playDir = join(root, "docs/play");
const tracePath = join(root, "play-perf-trace/trace.zip");

function browserInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const installed = browserInstalled();

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serve(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = normalize(join(dir, relative));
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}/?fast&rm`,
        close: () =>
          new Promise((done, reject) => {
            server.closeAllConnections();
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

describe.skipIf(!installed && !process.env.CI)("play perf trace", () => {
  it("records a trace of the menu and keeps it when the check fails", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    let failed = false;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.tracing.start({ screenshots: true, snapshots: true });
      try {
        const page = await context.newPage();
        await page.goto(site.url, { waitUntil: "domcontentloaded" });
        await page.locator("#menu").waitFor({ state: "visible" });
        const transition = await page.locator(".bar > i").evaluate((node) => getComputedStyle(node).transitionProperty);
        expect(transition.split(",").map((part) => part.trim())).not.toContain("width");
      } catch (error) {
        failed = true;
        mkdirSync(join(root, "play-perf-trace"), { recursive: true });
        await context.tracing.stop({ path: tracePath });
        throw error;
      }
      await context.tracing.stop();
    } finally {
      await browser?.close();
      await site.close();
      if (!failed) expect(existsSync(tracePath)).toBe(false);
    }
  }, 20_000);
});
