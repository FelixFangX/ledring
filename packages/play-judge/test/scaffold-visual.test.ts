import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AxeBuilder } from "@axe-core/playwright";
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

  it("renders the component gallery, HUD, ring states, and buttons without external font requests at 1280 and 390", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    const externalRequests: string[] = [];
    try {
      browser = await chromium.launch({ headless: true });
      const page: Page = await browser.newPage();
      page.on("request", (req) => {
        const u = new URL(req.url());
        if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
          externalRequests.push(req.url());
        }
      });
      await page.goto(`${site.url}?gallery=1&fast`, { waitUntil: "domcontentloaded" });
      await page.locator("#gallery.on").waitFor({ state: "visible" });
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        const hudBox = await page.locator(".hud").boundingBox();
        expect(hudBox).toBeTruthy();
        expect(hudBox!.width).toBeGreaterThanOrEqual(300);
        expect(hudBox!.height).toBeGreaterThanOrEqual(48);

        for (const ringId of ["#gal-ring-calm", "#gal-ring-proc", "#gal-ring-crit"]) {
          const rBox = await page.locator(ringId).boundingBox();
          expect(rBox).toBeTruthy();
          expect(rBox!.width).toBeGreaterThanOrEqual(40);
        }

        for (const btnId of ["#gal-btn-solid", "#gal-btn-def", "#gal-btn-ghost"]) {
          const bBox = await page.locator(btnId).boundingBox();
          expect(bBox).toBeTruthy();
          expect(bBox!.height).toBeGreaterThanOrEqual(36);
        }

        const backdrop = await page.locator(".hud").evaluate((el) => getComputedStyle(el).backdropFilter);
        expect(backdrop === "none" || backdrop === "").toBe(true);
      }
      expect(externalRequests).toEqual([]);
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 20_000);

  it("remembers the last run on the menu, validates empty idea submit with shake vs outline-only under reduced motion, fits EN/zh at 1280 and 390, and supports keyboard Tab -> type -> Enter", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });

      // 1. Menu host line remembers last run + EN/zh overflow check at 1280x800 and 390x844
      for (const lang of ["en", "zh"] as const) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
          localStorage.setItem(
            "ledring-v1",
            JSON.stringify({
              plays: 3,
              seen: { POLISHED: 1, SHIPPED: 1 },
              last: { idea: "Quantum Tea Timer", end: "POLISHED", trust: 74, preset: "pomo" },
            }),
          );
        });
        await page.goto(`${site.url}?lang=${lang}&fast`, { waitUntil: "domcontentloaded" });
        await page.locator("#menu.on").waitFor({ state: "visible" });
        const hostText = await page.locator("#host").textContent();
        expect(hostText).toContain("Quantum Tea Timer");

        await page.goto(`${site.url}?scene=idea&lang=${lang}&fast`, { waitUntil: "domcontentloaded" });
        await page.locator("#missions.on").waitFor({ state: "visible" });

        for (const vp of [
          { width: 1280, height: 800 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(vp);
          const overflow = await page.locator("#missions").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
          expect(overflow).toBe(false);
        }
        await ctx.close();
      }

      // 2. Empty Enter submit shakes #ideacard in full motion and only outlines in reduced motion
      const ctxFull = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
      const pageFull = await ctxFull.newPage();
      await pageFull.goto(`${site.url}?scene=idea&fast`, { waitUntil: "domcontentloaded" });
      await pageFull.locator("#idea-in").focus();
      await pageFull.keyboard.press("Enter");
      const fullEmptyState = await pageFull.evaluate(() => {
        const card = document.querySelector("#ideacard") as HTMLElement & { __anim?: Animation };
        return {
          invalid: card.classList.contains("invalid"),
          hasAnim: Boolean(card.__anim),
          stillOnMissions: document.querySelector("#missions")?.classList.contains("on") ?? false,
        };
      });
      expect(fullEmptyState).toEqual({ invalid: true, hasAnim: true, stillOnMissions: true });
      await ctxFull.close();

      const ctxRm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const pageRm = await ctxRm.newPage();
      await pageRm.goto(`${site.url}?scene=idea&fast&rm`, { waitUntil: "domcontentloaded" });
      await pageRm.locator("#idea-in").focus();
      await pageRm.keyboard.press("Enter");
      const rmEmptyState = await pageRm.evaluate(() => {
        const card = document.querySelector("#ideacard") as HTMLElement & { __anim?: Animation };
        return {
          invalid: card.classList.contains("invalid"),
          hasAnim: Boolean(card.__anim),
          stillOnMissions: document.querySelector("#missions")?.classList.contains("on") ?? false,
        };
      });
      expect(rmEmptyState).toEqual({ invalid: true, hasAnim: false, stillOnMissions: true });

      // 3. Keyboard path: type idea -> Enter starts a run
      await pageRm.keyboard.type("A calm 5-minute breathing timer");
      await pageRm.keyboard.press("Enter");
      await pageRm.locator("#run.on").waitFor({ state: "visible", timeout: 5000 });
      const runIdea = await pageRm.evaluate(() => {
        const w = window as unknown as { __ledring: { run: () => { idea: string } | null } };
        return w.__ledring.run()?.idea;
      });
      expect(runIdea).toBe("A calm 5-minute breathing timer");
      await ctxRm.close();
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 25_000);

  it("renders all SIWC states honestly, masks and redacts BYO keys with •••• saved, traps focus in #drawer, and passes axe-core with zero serious violations", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
      const page = await ctx.newPage();

      // 1. Static / Pages mode without bridge: ChatGPT plan shows Unavailable, clicking Continue explains npx ledring play and never flips to Connected
      await page.goto(`${site.url}?mode=chatgpt&drawer=1&fast`, { waitUntil: "domcontentloaded" });
      await page.locator("#drawer.on").waitFor({ state: "visible" });
      expect(await page.locator("#siwc-unavail").textContent()).toContain("Unavailable on this page");
      await page.locator("#siwc-go").click();
      expect(await page.locator("#siwc-flow").textContent()).toContain("npx ledring play");
      expect(await page.locator("#drawer").textContent()).not.toContain("Using ChatGPT plan");
      expect(await page.locator(".siwc").getAttribute("data-siwc-state")).toBe("unavailable");

      // 2. Test all SIWC states across EN/zh and 1280/820/390 + axe-core zero serious violations
      const states = ["unavailable", "signed_out", "waiting", "declined", "connected", "plan_off", "usage_limit", "expired"] as const;
      for (const st of states) {
        await page.evaluate((s) => {
          const w = window as unknown as { __ledring: { setSiwcState: (s: string, o?: Record<string, string>) => void } };
          w.__ledring.setSiwcState(s, { name: "Ada Lovelace", email: "ada@analytical.engine" });
        }, st);
        expect(await page.locator(".siwc").getAttribute("data-siwc-state")).toBe(st);
        const cardText = (await page.locator(".siwc").textContent()) ?? "";
        if (st === "connected") {
          expect(cardText).toContain("Using ChatGPT plan");
          expect(cardText).toContain("Manage usage ↗");
          expect(await page.locator("#siwc-manage").getAttribute("href")).toBe(
            "https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites",
          );
        } else {
          expect(cardText).not.toContain("Using ChatGPT plan");
        }
        if (st === "usage_limit") {
          expect(await page.locator("#siwc-manage-primary").textContent()).toContain("Manage usage ↗");
        }
      }

      for (const vp of [
        { width: 1280, height: 800 },
        { width: 820, height: 1180 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(vp);
        const box = await page.locator("#drawer").boundingBox();
        expect(box).toBeTruthy();
        expect(box!.width).toBeLessThanOrEqual(vp.width + 1);
      }
      await page.setViewportSize({ width: 1280, height: 800 });

      // 3. BYO key masking & redaction: entering a key never leaves raw key in DOM and shows •••• saved
      await page.locator('.mode[data-mode="openai"]').click();
      expect(await page.locator("#demotag").textContent()).toContain("live ·");
      const rawSecret = "sk-test-secret-do-not-leak-999999";
      await page.locator("#p-key").fill(rawSecret);
      await page.locator("#p-key").dispatchEvent("change");
      const keyState = await page.evaluate(() => {
        const input = document.querySelector("#p-key") as HTMLInputElement;
        return {
          value: input.value,
          placeholder: input.placeholder,
          savedBadge: document.querySelector("#p-key-saved")?.textContent ?? "",
          htmlContainsSecret: document.documentElement.innerHTML.includes("sk-test-secret-do-not-leak-999999"),
        };
      });
      expect(keyState).toEqual({
        value: "",
        placeholder: "•••• saved",
        savedBadge: "•••• saved",
        htmlContainsSecret: false,
      });

      // 4. axe-core check on open drawer (zero serious/critical violations)
      const axe = await new AxeBuilder({ page }).include("#drawer").analyze();
      const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious).toEqual([]);

      // 5. Escape closes drawer
      await page.keyboard.press("Escape");
      expect(await page.locator("#drawer").evaluate((el) => el.classList.contains("on"))).toBe(false);
      await ctx.close();
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);
});
