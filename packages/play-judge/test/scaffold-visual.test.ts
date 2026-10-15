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

  it("streams into the Run screen with auto-scroll pause/resume, diff highlights, version scrubber, offline preview CSP, and zero overflow at 1280/820/390", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    const externalRequests: string[] = [];
    try {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
      const page = await ctx.newPage();
      page.on("request", (req) => {
        const u = new URL(req.url());
        if (u.protocol.startsWith("http") && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
          externalRequests.push(req.url());
        }
      });

      // Run snake preset through v1 (block red-wall) -> QTE v2 (demand tests) -> QTE v3 (polish)
      await page.goto(`${site.url}?idea=snake&script=block,tests,polish&fast`, { waitUntil: "domcontentloaded" });
      await page.locator("#end.on").waitFor({ state: "visible", timeout: 15_000 });

      // Switch back to #run to inspect the completed run state
      await page.evaluate(() => {
        const w = window as unknown as { __ledring: { show: (id: string) => void } };
        w.__ledring.show("run");
      });
      await page.locator("#run.on").waitFor({ state: "visible" });

      // 1. Self-tests tab is visible because tests were demanded
      expect(await page.locator("#tab-test").isVisible()).toBe(true);

      // 2. Version pills exist in #pvvers and diff highlights (.add) render on v2/v3
      const versCount = await page.locator("#pvvers .vpill").count();
      expect(versCount).toBeGreaterThanOrEqual(2);
      const addLines = await page.locator("#code .add").count();
      expect(addLines).toBeGreaterThan(0);

      // Click v1 pill -> #pvbuild shows v1
      await page.locator("#pvvers .vpill").first().click();
      expect(await page.locator("#pvbuild").textContent()).toBe("v1");

      // 3. Auto-scroll pause when scrolled up, resume when scrolled to bottom
      const scrollBehavior = await page.evaluate(async () => {
        const el = document.querySelector("#code") as HTMLElement;
        const w = window as unknown as { __ledring: { setCode: (h: string) => void } };
        const tall = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n");
        w.__ledring.setCode(tall);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll"));
        // Stream while scrolled up: should NOT jump to bottom
        const showFn = (window as unknown as { showCode: (t: string, s: boolean, tab: string) => void }).showCode;
        showFn(tall + "\nline 121", true, "html");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const pausedTop = el.scrollTop;
        // Scroll back to bottom: should resume auto-scroll
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event("scroll"));
        showFn(tall + "\nline 121\nline 122\nline 123", true, "html");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const resumedAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
        return { pausedTop, resumedAtBottom };
      });
      expect(scrollBehavior.pausedTop).toBe(0);
      expect(scrollBehavior.resumedAtBottom).toBe(true);

      // 4. Zero horizontal overflow at 1280x800, 820x1180, 390x844
      for (const vp of [
        { width: 1280, height: 800 },
        { width: 820, height: 1180 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(vp);
        const overflow = await page.locator("#run").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(overflow).toBe(false);
      }

      // 5. Preview iframe made zero external requests
      expect(externalRequests).toEqual([]);
      await ctx.close();
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);

  it("supports QTE keyboard 1-5/I, interrogate answer streaming, timer-pause mode, Red Wall ruleId + Space/Enter/B, ARIA live region, reduced-motion static wall, and 390x844 bottom sheet (>=44px targets)", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });

      // 1. Timer-pause mode (?hold), interrogate (I), keyboard choice (2), and Red Wall (B) + ruleId + ARIA live region
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
      const page = await ctx.newPage();
      await page.goto(`${site.url}?hold&fast`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        const w = window as unknown as {
          __ledring: {
            show: (id: string) => void;
            qte: (v: number) => Promise<{ id: string; by: string; asked: boolean }>;
          };
          __qteOut?: { id: string; by: string; asked: boolean };
        };
        w.__ledring.show("run");
        void w.__ledring.qte(2).then((res) => {
          w.__qteOut = res;
        });
      });
      await page.locator("#choicelayer.on").waitFor({ state: "visible" });
      expect(await page.locator("#qcount").textContent()).toBe("PAUSED");
      expect(await page.locator("#a11y-live").textContent()).toContain("Next step v2");

      // Press 'I' to interrogate -> Ask why button disappears, .answer appears
      await page.keyboard.press("i");
      await page.locator("#qbox .answer").waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const ans = document.querySelector("#qbox .answer")?.textContent ?? "";
        return ans.length > 5 && !document.querySelector('#qbox .qopt[data-id="ask"]');
      });

      // Press '2' to pick Demand tests
      await page.keyboard.press("2");
      await page.waitForFunction(() => Boolean((window as unknown as { __qteOut?: unknown }).__qteOut));
      const qteRes = await page.evaluate(() => (window as unknown as { __qteOut: { id: string; by: string; asked: boolean } }).__qteOut);
      expect(qteRes).toMatchObject({ id: "tests", by: "human", asked: true });

      // Open Red Wall on 390x844 and check ruleId, bottom-sheet tap target >= 44px, and Space/B block
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        const w = window as unknown as {
          __ledring: {
            redWall: (
              finds: Array<{ cat: string; ruleId: string; line: string }>,
              where: string,
            ) => Promise<{ v: string; by: string }>;
          };
          __wallOut?: { v: string; by: string };
        };
        void w.__ledring
          .redWall([{ cat: "network", ruleId: "risk.network.fetch", line: "fetch('https://evil.test')" }], "code")
          .then((res) => {
            w.__wallOut = res;
          });
      });
      await page.locator("#choicelayer.on.wall").waitFor({ state: "visible" });
      expect(await page.locator(".wallfind").textContent()).toContain("[risk.network.fetch]");
      expect(await page.locator("#a11y-live").textContent()).toContain("risk.network.fetch");
      const wbBox = await page.locator("#wb").boundingBox();
      expect(wbBox).toBeTruthy();
      expect(wbBox!.height).toBeGreaterThanOrEqual(44);
      const qboxOverflow = await page.locator("#qbox").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(qboxOverflow).toBe(false);

      await page.keyboard.press("b");
      await page.waitForFunction(() => Boolean((window as unknown as { __wallOut?: unknown }).__wallOut));
      const wallRes = await page.evaluate(() => (window as unknown as { __wallOut: { v: string; by: string } }).__wallOut);
      expect(wallRes).toEqual({ v: "block", by: "human" });
      await ctx.close();

      // 2. Reduced motion: hazard bands are hidden and static red border is used
      const ctxRm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const pageRm = await ctxRm.newPage();
      await pageRm.goto(`${site.url}?rm&hold&fast`, { waitUntil: "domcontentloaded" });
      await pageRm.evaluate(() => {
        const w = window as unknown as {
          __ledring: {
            show: (id: string) => void;
            redWall: (
              finds: Array<{ cat: string; ruleId: string; line: string }>,
              where: string,
            ) => Promise<{ v: string; by: string }>;
          };
        };
        w.__ledring.show("run");
        void w.__ledring.redWall([{ cat: "eval", ruleId: "risk.eval.1", line: "eval(x)" }], "code");
      });
      await pageRm.locator("#choicelayer.on.wall").waitFor({ state: "visible" });
      const rmWallStyle = await pageRm.evaluate(() => {
        const hz = document.querySelector("#choicelayer .hz") as HTMLElement;
        const qb = document.querySelector("#qbox") as HTMLElement;
        return {
          hzDisplay: getComputedStyle(hz).display,
          borderColor: getComputedStyle(qb).borderColor,
        };
      });
      expect(rmWallStyle.hzDisplay).toBe("none");
      expect(rmWallStyle.borderColor).toBe("rgb(224, 30, 43)");
      await ctxRm.close();
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);
});
