import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { menuFrameError, recordVisualFailure } from "../../../scripts/visual-diff.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const playDir = join(root, "docs/play");
const diffDir = join(root, "play-visual-diff");

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
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise((done, reject) => {
            server.closeAllConnections();
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

describe.skipIf(!installed && !process.env.CI)("play scaffold visual", () => {
  it("keeps the menu frame at desktop and phone widths", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    const shots: { name: string; png: Buffer; note: string }[] = [];
    try {
      browser = await chromium.launch({ headless: true });
      const page: Page = await browser.newPage();
      await page.goto(site.url, { waitUntil: "domcontentloaded" });
      await page.locator("#menu").waitFor({ state: "visible" });
      for (const viewport of [
        { width: 1280, height: 800, name: "menu-desktop" },
        { width: 390, height: 844, name: "menu-mobile" },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const box = await page.locator("#menu").boundingBox();
        const note = menuFrameError(box, viewport);
        if (note) shots.push({ name: viewport.name, png: await page.screenshot(), note });
      }
      if (shots.length > 0) {
        recordVisualFailure(diffDir, shots);
        expect(shots.map((shot) => shot.note)).toEqual([]);
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 20_000);
});
