import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const playDir = join(root, "docs/play");

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
        url: `http://127.0.0.1:${address.port}/?fast`,
        close: () =>
          new Promise((done, reject) => {
            server.closeAllConnections();
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  const slop = 1;
  return a.x + slop < b.x + b.width && a.x + a.width > b.x + slop && a.y + slop < b.y + b.height && a.y + a.height > b.y + slop;
}

describe.skipIf(!installed && !process.env.CI)("scan pins", () => {
  it("pins every finding, keeps them while the wall is open, and sweeps only the code at 390px", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(site.url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => {
        const hook = (window as unknown as { __ledring?: { scanPulse?: unknown } }).__ledring;
        return typeof hook?.scanPulse === "function";
      });
      const lineA = "fetch('https://example.test/board');";
      const lineB = "eval('no');";
      await page.evaluate(
        async ({ a, b }) => {
          const hook = (window as unknown as {
            __ledring: {
              show: (id: string) => void;
              setCode: (html: string) => void;
              scanPulse: (finds: { line: string; cat: string }[], where: string) => Promise<void>;
            };
          }).__ledring;
          hook.show("run");
          hook.setCode(`const ready = 1;\n${a}\n${b}\n`);
          await hook.scanPulse(
            [
              { line: a, cat: "network" },
              { line: b, cat: "eval" },
            ],
            "code",
          );
          document.querySelector("#choicelayer")?.classList.add("on", "wall");
        },
        { a: lineA, b: lineB },
      );
      const pins = page.locator("#odradek .pin");
      expect(await pins.count()).toBe(2);
      const labels = await pins.allTextContents();
      expect(labels.some((label) => label.includes("L2"))).toBe(true);
      expect(labels.some((label) => label.includes("L3"))).toBe(true);
      expect(await page.locator("#choicelayer.wall").count()).toBe(1);
      const boxes = await page.evaluate(() => {
        const read = (selector: string) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        return { sweep: read("#odradek"), preview: read(".previewwrap"), code: read("#code") };
      });
      expect(boxes.sweep).toBeTruthy();
      expect(boxes.preview).toBeTruthy();
      expect(boxes.code).toBeTruthy();
      if (!boxes.sweep || !boxes.preview || !boxes.code) throw new Error("missing boxes");
      expect(overlaps(boxes.sweep, boxes.preview)).toBe(false);
      expect(Math.abs(boxes.sweep.y - boxes.code.y)).toBeLessThan(2);
      expect(Math.abs(boxes.sweep.height - boxes.code.height)).toBeLessThan(2);
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 20_000);
});
