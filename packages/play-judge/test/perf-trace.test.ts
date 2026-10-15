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

  it("supports interrupting a scene wipe and picking during QTE stagger without leaving elements stuck, and starts no transform animations under prefers-reduced-motion", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const baseUrl = site.url.split("?")[0]!;

      // 1. Interruptibility check (full motion)
      const ctxFull = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
      const pageFull = await ctxFull.newPage();
      await pageFull.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await pageFull.locator("#menu").waitFor({ state: "visible" });

      const interruptedState = await pageFull.evaluate(async () => {
        const hook = (window as unknown as {
          __ledring: {
            show: (id: string, caption?: string) => void;
            qte: (v: number) => Promise<{ id: string; by: string }>;
          };
        }).__ledring;
        // Start a wipe to insp and immediately interrupt it with a wipe to missions
        hook.show("insp", "FIRST WIPE");
        hook.show("missions", "SECOND WIPE");
        await new Promise((r) => setTimeout(r, 900));
        const wipeOn = document.querySelector("#wipe")?.classList.contains("on") ?? false;
        const missionsOn = document.querySelector("#missions")?.classList.contains("on") ?? false;

        // Open QTE and pick immediately during stagger (at 30ms)
        hook.show("run");
        (window as unknown as { RUN: { st: { shortcut: number } } }).RUN = { st: { shortcut: 0 } };
        const p = hook.qte(2);
        await new Promise((r) => setTimeout(r, 30));
        const btn = document.querySelector('.qopt[data-id="tests"]') as HTMLElement | null;
        btn?.click();
        const res = await p;
        const layerOn = document.querySelector("#choicelayer")?.classList.contains("on") ?? false;
        return { wipeOn, missionsOn, picked: res.id, layerOn };
      });
      expect(interruptedState).toEqual({
        wipeOn: false,
        missionsOn: true,
        picked: "tests",
        layerOn: false,
      });
      await ctxFull.close();

      // 2. prefers-reduced-motion check: starts no transform animations
      const ctxRm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const pageRm = await ctxRm.newPage();
      await pageRm.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await pageRm.locator("#menu").waitFor({ state: "visible" });

      const rmCheck = await pageRm.evaluate(() => {
        const hasRmClass = document.documentElement.classList.contains("rm");
        const spinNodes = document.querySelectorAll("animateTransform").length;
        const el = document.querySelector("#m-play") as HTMLElement;
        const hook = (window as unknown as {
          __ledring: {
            motion: {
              run: (el: HTMLElement, kf: Keyframe[]) => Animation | null;
              shake: (el: HTMLElement, amt?: number) => Animation | null;
            };
          };
        }).__ledring;
        const anim = hook.motion.run(el, [
          { opacity: 0, transform: "translate3d(0, 30px, 0)" },
          { opacity: 1, transform: "none" },
        ]);
        const kf = (anim?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
        const hasTransformMove = kf.some((f) => f.transform && f.transform !== "none");
        const shook = hook.motion.shake(el, 10);
        return { hasRmClass, spinNodes, hasTransformMove, shook: Boolean(shook) };
      });
      expect(rmCheck).toEqual({
        hasRmClass: true,
        spinNodes: 0,
        hasTransformMove: false,
        shook: false,
      });
      await ctxRm.close();
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 20_000);
});
