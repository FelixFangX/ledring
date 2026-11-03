import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

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

async function openWall(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __ledring: {
        show: (id: string) => void;
        redWall: (
          finds: Array<{ cat: string; ruleId: string; line: string }>,
          where: string,
        ) => Promise<{ v: string; by: string }>;
      };
      __wall: { v: string; by: string } | null;
    };
    w.__wall = null;
    w.__ledring.show("run");
    void w.__ledring
      .redWall([{ cat: "network", ruleId: "risk.network.fetch", line: "fetch('https://scores.example.net/api/submit')" }], "code")
      .then((res) => {
        w.__wall = res;
      });
  });
  await page.locator("#choicelayer.on.wall").waitFor({ state: "visible" });
}

describe.skipIf(!installed && !process.env.CI)("red wall hold", () => {
  it("keeps the snake demo wall up until Block or Allow", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(`${site.url}?idea=snake&mode=demo&fast&rm`, { waitUntil: "domcontentloaded" });
      await page.locator("#choicelayer.on.wall").waitFor({ state: "visible", timeout: 15_000 });
      const wallText = (await page.locator("#qbox").textContent()) || "";
      expect(wallText).toContain("network call");
      expect(wallText).not.toContain("will be allowed");
      const cover = await page.locator("#choicelayer.on.wall").boundingBox();
      expect(cover && cover.width).toBeGreaterThan(1200);
      expect(cover && cover.height).toBeGreaterThan(700);
      await page.waitForTimeout(3800);
      expect(await page.locator("#choicelayer.on.wall").count()).toBe(1);
      expect(await page.locator("#wb").count()).toBe(1);
      expect(await page.locator("#wa").count()).toBe(1);
      expect((await page.locator("#log").textContent()) || "").not.toContain("let through");
      expect(await page.locator("#relnum").textContent()).toBe("50");
      await page.locator("#wa").click();
      await page.waitForFunction(() => (document.querySelector("#log")?.textContent || "").includes("let through"));
      expect(await page.locator("#relnum").textContent()).toBe("40");
      const decision = await page.evaluate(() => {
        const run = (window as unknown as { __ledring: { run: () => { decs: Array<{ k: string; pick: string; auto: boolean }> } } }).__ledring.run();
        return run.decs.find((d) => d.k === "wall");
      });
      expect(decision).toMatchObject({ pick: "allow", auto: false });
      await ctx.close();

      const blockCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const blockPage = await blockCtx.newPage();
      await blockPage.goto(`${site.url}?fast&rm&mode=demo`, { waitUntil: "domcontentloaded" });
      await openWall(blockPage);
      await blockPage.waitForTimeout(3800);
      expect(await blockPage.evaluate(() => (window as unknown as { __wall: unknown }).__wall)).toBeNull();
      expect(await blockPage.locator("#choicelayer.held").count()).toBe(1);
      await blockPage.locator("#wb").click();
      await blockPage.waitForFunction(() => Boolean((window as unknown as { __wall?: unknown }).__wall));
      expect(await blockPage.evaluate(() => (window as unknown as { __wall: { v: string; by: string } }).__wall)).toEqual({
        v: "block",
        by: "human",
      });
      await blockCtx.close();
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 40_000);

  it("starts on the first click and keeps model cards from colliding", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const startCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const startPage = await startCtx.newPage();
      await startPage.goto(`${site.url}?fast&rm`, { waitUntil: "domcontentloaded" });
      await startPage.locator("#m-play").click();
      await startPage.locator("#onboard.on").waitFor({ state: "visible", timeout: 3000 });
      expect(await startPage.locator("#codec.on").count()).toBe(0);
      await startCtx.close();

      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ]) {
        const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
        const page = await ctx.newPage();
        await page.goto(`${site.url}?onboard&fast&rm`, { waitUntil: "domcontentloaded" });
        await page.locator("#ob-cards .ob-card").first().waitFor({ state: "visible" });
        const layout = await page.locator("#ob-cards").evaluate((root) => {
          const cards = [...root.querySelectorAll(".ob-card")].map((el) => el.getBoundingClientRect());
          const hit = (a: DOMRect, b: DOMRect) => {
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            return x > 1 && y > 1;
          };
          let cardsOverlap = false;
          for (let i = 0; i < cards.length; i++) {
            for (let j = i + 1; j < cards.length; j++) if (hit(cards[i]!, cards[j]!)) cardsOverlap = true;
          }
          const card = root.querySelector('.ob-card[data-choice="ledring"]');
          const title = card?.querySelector("b")?.getBoundingClientRect();
          const badge = card?.querySelector(".ob-badge")?.getBoundingClientRect();
          const badgeHit = title && badge ? hit(title, badge) : true;
          return { cardsOverlap, badgeHit, badge: badge ? badge.width : 0 };
        });
        expect(layout.cardsOverlap).toBe(false);
        expect(layout.badgeHit).toBe(false);
        expect(layout.badge).toBeGreaterThan(20);
        await ctx.close();
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);
});
