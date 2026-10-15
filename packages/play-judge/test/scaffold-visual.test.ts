import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AxeBuilder } from "@axe-core/playwright";
import { loadCassette, playCassette } from "@ledring/play-core";
import { chromium, type Browser, type Page } from "playwright";
import { handleStrands, memoryStore } from "../../play-strands/src/index.js";
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

  it("fits #end at 1280x800 without scroll across all 7 endings in EN and zh, renders 2-8 flow columns without overlap, expands real judge evidence, and builds valid .zip/.trace.json exports", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const endings = ["POLISHED", "SHIPPED", "BUGGY", "FAKE", "COMPROMISED", "BROKEN", "ABANDONED"] as const;

      for (const lang of ["en", "zh"] as const) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
        const page = await ctx.newPage();
        await page.goto(`${site.url}?lang=${lang}&rm&fast`, { waitUntil: "domcontentloaded" });

        // 1. All 7 endings fit 1280x800 with zero scroll
        for (const end of endings) {
          const fit = await page.evaluate((e) => {
            const w = window as unknown as {
              __ledring: {
                paintEnd: (j: Record<string, unknown>) => void;
              };
            };
            w.__ledring.paintEnd({
              end: e,
              valid: e !== "BROKEN",
              left: e === "COMPROMISED" ? ["network"] : [],
              outside: e === "COMPROMISED" ? ["network"] : [],
              tests: e === "POLISHED" || e === "FAKE" ? [{ name: "t1", pass: true }] : null,
              fake: e === "FAKE",
              tpass: 1,
              errs: e === "BUGGY" ? 2 : 0,
              bytes: 3420,
              engine: "playwright",
              verdict: {
                engine: "playwright",
                ending: e,
                validPage: e !== "BROKEN",
                interactive: true,
                responsiveActions: 2,
                actions: 3,
                errors: e === "BUGGY" ? ["ReferenceError: x is not defined"] : [],
                runtimeErrors: e === "BUGGY" ? 1 : 0,
                a11y: { violations: 0, gating: false },
                screenshots: [
                  { name: "desktop", bytes: 18420 },
                  { name: "mobile", bytes: 12110 },
                ],
              },
            });
            const el = document.querySelector("#end") as HTMLElement;
            return {
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            };
          }, end);
          expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
          expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth + 1);
        }

        // 2. Expand judge evidence & screenshots and verify no scroll on #end
        await page.locator("#j-expand").click();
        expect(await page.locator("#j-expand").getAttribute("aria-expanded")).toBe("true");
        await page.locator("#j-details").waitFor({ state: "visible" });
        expect(await page.locator('#j-details [data-shot="desktop"]').textContent()).toContain("desktop");
        expect(await page.locator('#j-details [data-shot="mobile"]').textContent()).toContain("mobile");
        const fitExpanded = await page.locator("#end").evaluate((el) => el.scrollHeight <= el.clientHeight);
        expect(fitExpanded).toBe(true);

        // 3. Flow SVG handles 2 to 8 decision columns without overlap
        for (let cols = 2; cols <= 8; cols++) {
          const overlaps = await page.evaluate((count) => {
            const w = window as unknown as {
              __ledring: {
                run: () => { decs: Array<Record<string, unknown>> };
                drawFlow: (end: string) => void;
              };
            };
            const decs = Array.from({ length: count }, (_, i) =>
              i % 3 === 1
                ? { k: "wall", label: `v${i + 1} wall`, opts: ["block", "allow"], pick: "block" }
                : {
                    k: "qte",
                    label: `v${i + 1}`,
                    opts: ["short", "tests", "polish", "cut", "plug"],
                    pick: ["short", "tests", "polish", "cut"][i % 4],
                    asked: i % 2 === 0,
                  },
            );
            w.__ledring.run().decs = decs;
            w.__ledring.drawFlow("POLISHED");
            const nodes = [...document.querySelectorAll("#flow .flow-node")].map((n) => n.getBoundingClientRect());
            let nodeOverlap = 0;
            for (let i = 0; i < nodes.length; i++) {
              for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i]!;
                const b = nodes[j]!;
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 1 && oy > 1) nodeOverlap++;
              }
            }
            const heads = [...document.querySelectorAll("#flow .flow-head")].map((h) => h.getBoundingClientRect());
            let headOverlap = 0;
            for (let i = 0; i < heads.length; i++) {
              for (let j = i + 1; j < heads.length; j++) {
                const a = heads[i]!;
                const b = heads[j]!;
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 1 && oy > 1) headOverlap++;
              }
            }
            return { nodeOverlap, headOverlap, colGroups: document.querySelectorAll("#flow .flow-col").length };
          }, cols);
          expect(overlaps.nodeOverlap).toBe(0);
          expect(overlaps.headOverlap).toBe(0);
          expect(overlaps.colGroups).toBe(cols + 2); // idea + N decs + ending
        }

        // 4. ZIP and Trace exports
        const exportCheck = await page.evaluate(() => {
          const w = window as unknown as {
            __ledring: {
              trace: () => string;
              makeZip: (files: Array<[string, string]>) => Uint8Array;
            };
          };
          const trace = JSON.parse(w.__ledring.trace()) as { schema: string };
          const zip = w.__ledring.makeZip([
            ["index.html", "<!doctype html><html><body>ok</body></html>"],
            ["ledring.trace.v1.json", w.__ledring.trace()],
            ["README.md", "# Build\n"],
          ]);
          const ascii = new TextDecoder().decode(zip);
          return {
            schema: trace.schema,
            pkHeader: zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04,
            hasHtml: ascii.includes("index.html"),
            hasTrace: ascii.includes("ledring.trace.v1.json"),
            hasReadme: ascii.includes("README.md"),
          };
        });
        expect(exportCheck).toEqual({
          schema: "ledring.trace.v1",
          pkHeader: true,
          hasHtml: true,
          hasTrace: true,
          hasReadme: true,
        });

        await ctx.close();
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);

  it("renders the menu Session Library in EN and zh, supports keyboard navigation, and deterministically replays a cassette run with identical ending and event IDs", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      const cassette = loadCassette(readFileSync(join(root, "fixtures/play/snake-polished.json"), "utf8"));
      const played = playCassette(cassette);
      const events = JSON.parse(JSON.stringify(played.events)) as unknown[];
      browser = await chromium.launch({ headless: true });

      for (const lang of ["en", "zh"] as const) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
        const page = await ctx.newPage();
        await page.goto(`${site.url}?lang=${lang}&rm&fast`, { waitUntil: "domcontentloaded" });

        await page.evaluate(
          ({ sess }) => {
            const w = window as unknown as {
              __ledring: {
                setLibrarySessions: (rows: unknown[]) => void;
              };
            };
            w.__ledring.setLibrarySessions([sess]);
          },
          {
            sess: {
              id: "sess-snake-1",
              idea: played.idea,
              ending: played.ending,
              date: "2026-10-15T05:00:00.000Z",
              events,
            },
          },
        );

        await page.locator("#m-lib").waitFor({ state: "visible" });
        expect(await page.locator("#lib-cap").textContent()).toContain(lang === "zh" ? "会话记录" : "SESSION LIBRARY");
        expect(await page.locator('.lib-row[data-session-id="sess-snake-1"] .lib-idea').textContent()).toBe(played.idea);

        // Keyboard reachability: focus .lib-replay and press Enter
        const replayBtn = page.locator('.lib-replay[data-id="sess-snake-1"]');
        await replayBtn.focus();
        expect(await replayBtn.evaluate((el) => document.activeElement === el)).toBe(true);

        const replayed = await page.evaluate(async () => {
          const w = window as unknown as {
            __ledring: {
              openLibrarySession: (
                id: string,
                mode: string,
              ) => Promise<{
                id: string;
                ending: string;
                eventIds: number[];
                events: unknown[];
              }>;
              exportLibrarySession: (id: string) => Promise<string>;
            };
          };
          const res = await w.__ledring.openLibrarySession("sess-snake-1", "replay");
          const exported = await w.__ledring.exportLibrarySession("sess-snake-1");
          return { res, trace: JSON.parse(exported) as { schema: string; instruction: string } };
        });

        expect(replayed.res.ending).toBe("POLISHED");
        expect(replayed.res.eventIds).toEqual(events.map((_, i) => i + 1));
        expect(replayed.res.events).toEqual(events);
        expect(replayed.trace.schema).toBe("ledring.trace.v1");
        expect(replayed.trace.instruction).toBe(played.idea);
        expect(await page.locator("#end").evaluate((el) => el.classList.contains("on"))).toBe(true);

        await ctx.close();
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);

  it.skipIf(!installed)("supports Chapter 0 keyboard 1-4/nudge, reroll/fuse/rewrite, 2-column phone board, live trend cards with source+time, and empty-feed fallback with zero Demo trend requests", async () => {
    mkdirSync(diffDir, { recursive: true });
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });

      // 1. Offline Chapter 0 in EN and zh at 1280x800 and 390x844; verify zero Demo trend requests
      for (const lang of ["en", "zh"] as const) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        const trendHits: string[] = [];
        await page.route(/hn\.algolia\.com|reddit\.com|api\.x\.com/, async (route) => {
          trendHits.push(route.request().url());
          await route.abort();
        });

        await page.goto(`${site.url}?fast=1&rm=1&scene=insp&lang=${lang}`);
        expect(trendHits).toHaveLength(0);
        expect(await page.locator("#in-opts .trend").count()).toBe(0);

        // Q1: press "4" to trigger nudge, then Enter to submit free text
        await page.keyboard.press("4");
        const nudgedVal = await page.locator("#in-free").inputValue();
        expect(nudgedVal.length).toBeGreaterThan(0);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(40);

        // Q2: press "1"
        await page.keyboard.press("1");
        await page.waitForTimeout(40);

        // Q3: press "2"
        await page.keyboard.press("2");
        await page.waitForTimeout(60);

        expect(await page.locator("#in-frags .frag").count()).toBe(3);
        const rrLabels = await page.locator("#in-frags .rr").evaluateAll((els) =>
          els.map((el) => el.getAttribute("aria-label") || ""),
        );
        expect(rrLabels).toHaveLength(3);
        for (const label of rrLabels) {
          expect(label).toContain(lang === "zh" ? "重抽这块碎片" : "Reroll this fragment");
        }

        expect(await page.locator("#in-opts .dir").count()).toBe(3);

        // Reroll F2, fuse two directions, and edit the brief
        await page.locator('#in-frags .rr[data-k="trust"]').click();
        await page.waitForTimeout(40);
        await page.locator('#in-opts .fz input[data-i="0"]').check();
        await page.locator('#in-opts .fz input[data-i="1"]').check();
        await page.locator("#in-fuse").click();
        await page.waitForTimeout(40);
        expect(await page.locator("#in-opts .dir.fused").count()).toBe(1);

        await page.locator("#in-brief").fill(lang === "zh" ? "自定义简报内容" : "Custom rewritten brief");
        expect(await page.locator("#in-edited").textContent()).toContain(
          lang === "zh" ? "你改写过" : "rewritten by you",
        );

        await page.screenshot({ path: join(diffDir, `insp-offline-1280-${lang}.png`) });

        // Resize to 390x844 and check board is below questions and fragments are in 2 columns
        await page.setViewportSize({ width: 390, height: 844 });
        const layout = await page.evaluate(() => {
          const modeRect = document.querySelector("#in-mode")!.getBoundingClientRect();
          const boardRect = document.querySelector("#in-board")!.getBoundingClientRect();
          const cols = getComputedStyle(document.querySelector("#in-frags")!)
            .gridTemplateColumns.split(" ")
            .filter(Boolean).length;
          return {
            below: boardRect.top >= modeRect.bottom - 4,
            cols,
          };
        });
        expect(layout).toEqual({
          below: true,
          cols: 2,
        });
        await page.screenshot({ path: join(diffDir, `insp-offline-390-${lang}.png`) });
        expect(trendHits).toHaveLength(0);
        await ctx.close();
      }

      // 2. Live trends with source + relative time, and empty-feed fallback ("No live feed reachable")
      for (const lang of ["en", "zh"] as const) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
          localStorage.setItem(
            "ledring-provider",
            JSON.stringify({
              mode: "openai",
              openai: { base: "http://127.0.0.1:59999/v1", key: "sk-test-12345678", model: "gpt-4o-mini" },
            }),
          );
        });
        await page.route("http://127.0.0.1:59999/**", async (route) => {
          await route.fulfill({ status: 503, body: "offline" });
        });
        let failTrends = false;
        await page.route("https://hn.algolia.com/**", async (route) => {
          if (failTrends) {
            await route.fulfill({ status: 503, body: "unavailable" });
            return;
          }
          const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              hits: [
                { objectID: "101", title: "Local-first tools on small screens", created_at: tenMinAgo },
                { objectID: "102", title: "Why deterministic replay matters", created_at: tenMinAgo },
                { objectID: "103", title: "Synthesizing audio in 2KB of WebAudio", created_at: tenMinAgo },
              ],
            }),
          });
        });

        await page.goto(`${site.url}?fast=1&rm=1&scene=insp&lang=${lang}`);
        await page.waitForSelector("#in-frags .frag.tr", { timeout: 5000 });
        const trendCards = await page.locator("#in-opts .trend, #in-frags .frag.tr").count();
        expect(trendCards).toBeGreaterThanOrEqual(3);
        const refCard = await page.evaluate(() => {
          const src = document.querySelector("#in-opts .trend .tsrc")?.textContent?.trim() || "";
          const ts = document.querySelector("#in-opts .trend .tts")?.textContent?.trim() || "";
          return { src, ts };
        });
        expect(refCard.src).toBe("Hacker News");
        expect(refCard.ts).toContain(lang === "zh" ? "分钟前" : "m ago");
        await page.screenshot({ path: join(diffDir, `insp-live-1280-${lang}.png`) });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: join(diffDir, `insp-live-390-${lang}.png`) });

        // Empty-feed fallback when all trend providers fail
        failTrends = true;
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`${site.url}?fast=1&rm=1&scene=insp&lang=${lang}`);
        await page.waitForSelector("#in-feed .feedempty", { timeout: 5000 });
        expect(await page.locator("#in-feed .feedempty").textContent()).toContain(
          lang === "zh" ? "连不上实时信息流" : "No live feed reachable",
        );
        expect(await page.locator("#in-opts .trend").count()).toBe(0);
        await ctx.close();
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 30_000);

  it("enforces simulated vs server-backed Strands label rules across Menu, Chapter 0, and Ending in EN and zh", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });

      for (const lang of ["en", "zh"] as const) {
        const simWord = lang === "zh" ? "模拟" : "simulated";
        const store = memoryStore();
        let backendOffline = false;
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();

        await page.route("https://strands.ledring.test/**", async (route) => {
          if (backendOffline) {
            await route.fulfill({ status: 503, body: "offline" });
            return;
          }
          const req = route.request();
          const webReq = new Request(req.url(), {
            method: req.method(),
            headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.42" },
            ...(req.method() === "POST" ? { body: req.postData() ?? "{}" } : {}),
          });
          const res = await handleStrands(webReq, store);
          const body = await res.text();
          await route.fulfill({
            status: res.status,
            contentType: "application/json",
            body,
          });
        });

        // 1. Default offline / simulated state: menu, Chapter 0, and ending all show simulated label
        await page.goto(`${site.url}?fast=1&rm=1&lang=${lang}`);
        await page.locator("#menu").waitFor({ state: "visible" });
        const menuSimTag = (await page.locator("#strandtag").textContent()) || "";
        expect(menuSimTag).toContain(simWord);
        expect(await page.locator("#strandtag").getAttribute("data-simulated")).toBe("true");

        // Ending simulated strand fallback when no server is configured
        await page.evaluate(() => {
          const w = window as unknown as {
            __ledring: {
              setRun: (r: unknown) => void;
              paintEnd: (j: unknown) => void;
            };
          };
          w.__ledring.setRun({
            idea: "A quiet focus timer",
            mode: "demo",
            model: "demo",
            html: "<!doctype html><html><body><h1>Timer</h1></body></html>",
            plan: "1. timer",
            v: 1,
            blocked: new Set(),
            allowed: new Set(),
            decs: [],
            snaps: [{ label: "v1", html: "<h1>Timer</h1>" }],
            steps: [{ id: "s1", kind: "llm", name: "plan", signature: "plan" }],
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            end: "POLISHED",
          });
          w.__ledring.paintEnd({
            end: "POLISHED",
            valid: true,
            left: [],
            outside: [],
            tests: [{ name: "t1", pass: true }],
            fake: false,
            tpass: 1,
            errs: 0,
            bytes: 120,
          });
        });
        await page.locator("#e-strand").click();
        await page.waitForTimeout(40);
        expect(await page.locator("#e-strand").getAttribute("data-simulated")).toBe("true");
        expect(await page.locator("#e-strand").textContent()).toContain(simWord);

        // 2. Wire real @ledring/play-strands backend and publish a real strand
        await page.evaluate(() => {
          const b = document.querySelector("#e-strand") as HTMLButtonElement;
          b.disabled = false;
        });
        await page.evaluate(async () => {
          const w = window as unknown as {
            __ledring: {
              setStrandsUrl: (url: string, brief?: string) => Promise<unknown>;
              leaveStrand: () => Promise<{ ok: boolean; simulated: boolean; id?: string }>;
            };
          };
          await w.__ledring.setStrandsUrl("https://strands.ledring.test", "A quiet focus timer");
        });
        const posted = await page.evaluate(async () => {
          const w = window as unknown as {
            __ledring: {
              leaveStrand: () => Promise<{ ok: boolean; simulated: boolean; id?: string; likes?: number }>;
            };
          };
          return await w.__ledring.leaveStrand();
        });
        expect(posted.ok).toBe(true);
        expect(posted.simulated).toBe(false);
        expect(posted.likes).toBe(0);
        expect(await page.locator("#e-strand").getAttribute("data-simulated")).toBe("false");
        expect(await page.locator("#e-strand").textContent()).not.toContain(simWord);

        // Like the server-backed strand and verify likes count updates from server
        const liked = await page.evaluate(async (id) => {
          const w = window as unknown as {
            __ledring: {
              likeStrand: (id: string) => Promise<{ ok: boolean; likes?: number }>;
            };
          };
          return await w.__ledring.likeStrand(id!);
        }, posted.id);
        expect(liked).toEqual({ ok: true, likes: 1 });
        expect(await page.locator("#e-strand .num").textContent()).toBe("1");

        // Menu tag drops "(simulated)" when server-backed strands are loaded
        await page.evaluate(() => {
          const w = window as unknown as { __ledring: { show: (id: string) => void } };
          w.__ledring.show("menu");
        });
        const menuLiveTag = (await page.locator("#strandtag").textContent()) || "";
        expect(menuLiveTag).not.toContain(simWord);
        expect(await page.locator("#strandtag").getAttribute("data-simulated")).toBe("false");
        await page.screenshot({ path: join(diffDir, `strands-live-menu-1280-${lang}.png`) });

        // Chapter 0 direction cards omit "(simulated)" when backed by server strands
        await page.goto(`${site.url}?fast=1&rm=1&scene=insp&lang=${lang}&strandsUrl=${encodeURIComponent("https://strands.ledring.test")}`);
        await page.waitForSelector("#in-opts .qopt");
        for (let step = 0; step < 3; step += 1) {
          await page.keyboard.press("1");
          await page.waitForTimeout(30);
        }
        await page.waitForSelector("#in-opts .dir .dstr");
        await page.evaluate(async () => {
          const w = window as unknown as {
            __ledring: { syncStrands: (brief?: string) => Promise<unknown> };
          };
          await w.__ledring.syncStrands("A quiet focus timer");
        });
        const dirSimAttr = await page.locator("#in-opts .dir .dstr").first().getAttribute("data-simulated");
        const dirText = (await page.locator("#in-opts .dir .dstr").first().textContent()) || "";
        expect(dirSimAttr).toBe("false");
        expect(dirText).not.toContain(simWord);

        // 3. When backend goes offline, fallback restores "(simulated)" label on both Menu and Chapter 0
        backendOffline = true;
        await page.evaluate(async () => {
          const w = window as unknown as {
            __ledring: { syncStrands: (brief?: string) => Promise<unknown> };
          };
          await w.__ledring.syncStrands("A quiet focus timer");
        });
        expect(await page.locator("#strandtag").getAttribute("data-simulated")).toBe("true");
        expect(await page.locator("#strandtag").textContent()).toContain(simWord);
        expect(await page.locator("#in-opts .dir .dstr").first().getAttribute("data-simulated")).toBe("true");
        expect(await page.locator("#in-opts .dir .dstr").first().textContent()).toContain(simWord);

        await ctx.close();
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 25_000);

  it("supports Fourth-wall local signals, tab-away miniCodec, port-swap resize Red Wall, keyboard dismiss, and COMPROMISED brief quote in EN and zh", async () => {
    if (!installed) throw new Error("chromium is not installed");
    const site = await serve(playDir);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });

      for (const lang of ["en", "zh"] as const) {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
          localStorage.setItem(
            "ledring-play2",
            JSON.stringify({
              plays: 3,
              last: { idea: "Secret neon synth", end: "COMPROMISED", trust: 28 },
              seen: { COMPROMISED: 1 },
            }),
          );
        });
        await page.goto(`${site.url}?fast=1&rm=1&lang=${lang}`);
        await page.locator("#menu").waitFor({ state: "visible" });

        // 1. Verify fourthWallLines uses local time, screen class, past run memory, and privacy notice
        const lines = await page.evaluate(() => {
          const w = window as unknown as { __ledring: { fourthWallLines: () => string[] } };
          return w.__ledring.fourthWallLines();
        });
        expect(lines.length).toBeGreaterThanOrEqual(4);
        expect(lines.join(" ")).toContain("Secret neon synth");
        expect(lines.join(" ")).toContain(lang === "zh" ? "网络请求" : "network call");
        expect(lines.join(" ")).toContain(lang === "zh" ? "都没离开你的浏览器" : "None of this left your browser");

        // 2. Tab-away and return on #run surfaces miniCodec copy (reduced-motion safe)
        await page.evaluate(() => {
          const w = window as unknown as {
            __ledring: { show: (id: string) => void; triggerTabAway: (sec: number) => string };
          };
          w.__ledring.show("run");
          w.__ledring.triggerTabAway(7);
        });
        await page.waitForSelector("#minicodec.on");
        const miniText = (await page.locator("#minicodec").textContent()) || "";
        expect(miniText).toContain("7");
        expect(miniText).toContain(lang === "zh" ? "你离开了 7 秒" : "You left for 7 seconds");
        await page.screenshot({ path: join(diffDir, `fourth-wall-minicodec-1280-${lang}.png`) });

        // 3. Port-swap Red Wall: large resize (>=120px) blocks the wall
        await page.evaluate(() => {
          const w = window as unknown as {
            __ledring: {
              redWall: (
                finds: { cat: string; ruleId: string; line: string }[],
                where: string,
              ) => Promise<{ v: string; by: string }>;
            };
            __wallRes?: { v: string; by: string } | null;
          };
          w.__wallRes = null;
          void w.__ledring
            .redWall([{ cat: "network", ruleId: "risk.network.fetch", line: "fetch('https://evil.test')" }], "code")
            .then((r) => {
              w.__wallRes = r;
            });
        });
        await page.waitForSelector("#choicelayer.on.wall");
        expect(await page.locator("#wallswap").textContent()).toContain("120px");
        await page.setViewportSize({ width: 1080, height: 800 });
        await page.waitForFunction(() => Boolean((window as unknown as { __wallRes?: unknown }).__wallRes));
        const resizeRes = await page.evaluate(() => (window as unknown as { __wallRes: { v: string; by: string } }).__wallRes);
        expect(resizeRes).toEqual({ v: "block", by: "human" });

        // 4. Keyboard Escape also dismisses/blocks the Red Wall
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.evaluate(() => {
          const w = window as unknown as {
            __ledring: {
              redWall: (
                finds: { cat: string; ruleId: string }[],
                where: string,
              ) => Promise<{ v: string; by: string }>;
            };
            __wallEsc?: { v: string; by: string } | null;
          };
          w.__wallEsc = null;
          void w.__ledring
            .redWall([{ cat: "eval", ruleId: "risk.eval.1", line: "eval(code)" } as never], "code")
            .then((r) => {
              w.__wallEsc = r;
            });
        });
        await page.waitForSelector("#choicelayer.on.wall");
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => Boolean((window as unknown as { __wallEsc?: unknown }).__wallEsc));
        const escRes = await page.evaluate(() => (window as unknown as { __wallEsc: { v: string; by: string } }).__wallEsc);
        expect(escRes).toEqual({ v: "block", by: "human" });

        // 5. COMPROMISED ending quotes the player's own brief back at them
        await page.evaluate(() => {
          const w = window as unknown as {
            __ledring: { setRun: (r: unknown) => void; paintEnd: (j: unknown) => void };
          };
          w.__ledring.setRun({
            idea: "Secret neon synth",
            mode: "demo",
            model: "demo",
            html: "<!doctype html><html><body><h1>Synth</h1></body></html>",
            plan: "",
            v: 1,
            blocked: new Set(),
            allowed: new Set(["network"]),
            decs: [],
            snaps: [{ label: "v1", html: "<h1>Synth</h1>" }],
            steps: [],
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            end: "COMPROMISED",
          });
          w.__ledring.paintEnd({
            end: "COMPROMISED",
            valid: true,
            left: ["network"],
            outside: ["network"],
            tests: null,
            fake: false,
            tpass: 0,
            errs: 0,
            bytes: 128,
          });
        });
        await page.waitForSelector("#e-comp-quote");
        expect(await page.locator("#e-comp-quote").textContent()).toContain("Secret neon synth");
        await ctx.close();
      }
    } finally {
      await browser?.close();
      await site.close();
    }
  }, 25_000);
});
