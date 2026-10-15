import { AxeBuilder } from "@axe-core/playwright";
import type { BrowserContext, Page } from "playwright";
import { resolveEnding, type EndingId, type JudgeFacts } from "@ledring/play-core";
import { createNonce, withHarness } from "@ledring/play-sandbox";
import { detectFakeTests } from "./fake.js";
import type { JudgeRuntime } from "./runtime.js";
import { riskCategories } from "./static.js";

export const JUDGE_VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
] as const;

export interface JudgeInput {
  html: string;
  wantTests?: boolean;
  wantPolish?: boolean;
  leakedDespiteBlock?: boolean;
}

export interface NetworkAttempt {
  url: string;
  resourceType: string;
}

export interface JudgeScreenshot {
  name: string;
  png: Uint8Array;
}

export interface JudgeSelfTests {
  pass: number;
  total: number;
  fake: boolean;
}

export interface JudgeVerdict {
  engine: "playwright";
  ending: EndingId;
  validPage: boolean;
  blankScreen: boolean;
  interactive: boolean;
  responsiveActions: number;
  actions: number;
  errors: string[];
  runtimeErrors: number;
  fakeTests: boolean;
  selfTests: JudgeSelfTests | null;
  risksLeft: string[];
  networkAttempts: NetworkAttempt[];
  screenshots: JudgeScreenshot[];
  a11y: { violations: number; gating: false };
  facts: JudgeFacts;
}

interface Probe {
  text: number;
  painted: boolean;
}

function allowedOffline(url: string): boolean {
  return url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:");
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const body = document.body;
    const text = (body?.innerText ?? "").replace(/\s+/g, "").length;
    let painted = false;
    for (const node of document.querySelectorAll("canvas")) {
      const canvas = node as HTMLCanvasElement;
      if (canvas.width < 1 || canvas.height < 1) continue;
      const context = canvas.getContext("2d");
      if (!context) {
        painted = true;
        continue;
      }
      const width = Math.min(canvas.width, 400);
      const height = Math.min(canvas.height, 300);
      const pixels = context.getImageData(0, 0, width, height).data;
      const stride = Math.max(4, Math.floor(pixels.length / 4096));
      for (let i = 3; i < pixels.length; i += stride) {
        if ((pixels[i] ?? 0) > 0) {
          painted = true;
          break;
        }
      }
      if (painted) break;
    }
    return { text, painted };
  });
}

async function fingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    const parts: string[] = [];
    for (const node of document.querySelectorAll("canvas")) {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext("2d");
      if (!context || canvas.width < 1 || canvas.height < 1) {
        parts.push("x");
        continue;
      }
      const width = Math.min(canvas.width, 400);
      const height = Math.min(canvas.height, 300);
      const pixels = context.getImageData(0, 0, width, height).data;
      let hash = 0;
      const stride = Math.max(16, Math.floor(pixels.length / 2048));
      for (let i = 0; i < pixels.length; i += stride) hash = (hash + (pixels[i] ?? 0) + (pixels[i + 3] ?? 0)) % 1000003;
      parts.push(`${width}x${height}:${hash}`);
    }
    return `${text}|${parts.join(",")}`;
  });
}

async function act(page: Page, run: () => Promise<void>): Promise<boolean> {
  const before = await fingerprint(page);
  try {
    await run();
  } catch {
    // An action that cannot be performed still counts as attempted.
  }
  return (await fingerprint(page)) !== before;
}

async function interact(page: Page): Promise<{ actions: number; responsive: number }> {
  let actions = 0;
  let responsive = 0;
  const note = async (run: () => Promise<void>) => {
    actions += 1;
    if (await act(page, run)) responsive += 1;
  };

  const focusables = await page.locator("a, button, input, textarea, select, [tabindex]").count();
  if (focusables > 0) {
    await note(async () => {
      const steps = Math.min(focusables, 8);
      for (let i = 0; i < steps; i += 1) await page.keyboard.press("Tab");
    });
  }

  const buttons = page.locator("button, [role='button'], input[type='button'], input[type='submit']");
  const buttonCount = Math.min(await buttons.count(), 20);
  for (let i = 0; i < buttonCount; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    await note(() => button.click({ timeout: 500 }));
  }

  const fields = page.locator(
    "textarea, input:not([type='button']):not([type='submit']):not([type='hidden']):not([type='checkbox']):not([type='radio'])",
  );
  const fieldCount = Math.min(await fields.count(), 5);
  for (let i = 0; i < fieldCount; i += 1) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    await note(() => field.fill("led", { timeout: 500 }));
  }

  const canvas = page.locator("canvas");
  if ((await canvas.count()) > 0) {
    const target = canvas.first();
    await note(() => target.click({ timeout: 500, force: true }));
    await note(async () => {
      const box = await target.boundingBox();
      if (!box) return;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 28, y + 8);
      await page.mouse.up();
    });
  }

  await note(async () => {
    for (const key of ["ArrowRight", " ", "Enter"]) await page.keyboard.press(key);
  });
  return { actions, responsive };
}

async function readTests(page: Page): Promise<{ name: string; pass: boolean }[] | null> {
  return page.evaluate(() => {
    const value = (window as unknown as { __ledringTests?: unknown }).__ledringTests;
    if (!Array.isArray(value) || value.length === 0) return null;
    return value.slice(0, 40).map((item) => {
      const row = item && typeof item === "object" ? (item as { name?: unknown; pass?: unknown }) : {};
      return { name: String(row.name ?? ""), pass: Boolean(row.pass) };
    });
  });
}

async function axeViolations(page: Page): Promise<number> {
  try {
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations.length;
  } catch {
    return 0;
  }
}

async function load(page: Page, html: string, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.setContent(withHarness(html, createNonce()), { waitUntil: "domcontentloaded", timeout: 2500 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(0))));
}

/** JSON body for `/api/judge`. Screenshot bytes stay in the process; the response keeps lengths. */
export function judgeBody(verdict: JudgeVerdict): Omit<JudgeVerdict, "screenshots" | "facts"> & {
  screenshots: { name: string; bytes: number }[];
} {
  return {
    engine: verdict.engine,
    ending: verdict.ending,
    validPage: verdict.validPage,
    blankScreen: verdict.blankScreen,
    interactive: verdict.interactive,
    responsiveActions: verdict.responsiveActions,
    actions: verdict.actions,
    errors: verdict.errors,
    runtimeErrors: verdict.runtimeErrors,
    fakeTests: verdict.fakeTests,
    selfTests: verdict.selfTests,
    risksLeft: verdict.risksLeft,
    networkAttempts: verdict.networkAttempts,
    screenshots: verdict.screenshots.map((shot) => ({ name: shot.name, bytes: shot.png.byteLength })),
    a11y: verdict.a11y,
  };
}

/**
 * Load one artifact offline in a fresh context, at desktop and mobile.
 * The browser on `runtime` is reused. Network requests other than about, data, and blob are aborted and logged.
 */
export async function judgeArtifact(input: JudgeInput, opts: { runtime: JudgeRuntime }): Promise<JudgeVerdict> {
  const browser = await opts.runtime.browser();
  const context = await browser.newContext({
    bypassCSP: true,
    serviceWorkers: "block",
    viewport: { width: JUDGE_VIEWPORTS[0].width, height: JUDGE_VIEWPORTS[0].height },
  });
  context.setDefaultTimeout(2500);
  try {
    return await judgeInContext(context, input);
  } finally {
    await context.close();
  }
}

async function judgeInContext(context: BrowserContext, input: JudgeInput): Promise<JudgeVerdict> {
  const networkAttempts: NetworkAttempt[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (allowedOffline(url)) {
      await route.continue();
      return;
    }
    if (networkAttempts.length < 40) networkAttempts.push({ url, resourceType: route.request().resourceType() });
    await route.abort("blockedbyclient");
  });

  const errors: string[] = [];
  const seen = new Set<string>();
  const pushError = (message: string) => {
    const text = message.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!text || seen.has(text) || errors.length >= 20) return;
    seen.add(text);
    errors.push(text);
  };

  const screenshots: JudgeScreenshot[] = [];
  let seenContent = false;
  let tests: { name: string; pass: boolean }[] | null = null;
  let actions = 0;
  let responsiveActions = 0;
  let axePage: Page | undefined;

  for (const viewport of JUDGE_VIEWPORTS) {
    const page = await context.newPage();
    axePage = page;
    page.on("pageerror", (error) => pushError(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pushError(message.text());
    });
    await load(page, input.html, viewport);
    const reading = await probe(page);
    if (reading.text > 0 || reading.painted) seenContent = true;
    screenshots.push({ name: viewport.name, png: await page.screenshot({ type: "png" }) });
    if (viewport.name === "desktop") {
      tests = await readTests(page);
      const smoke = await interact(page);
      actions = smoke.actions;
      responsiveActions = smoke.responsive;
      const after = await probe(page);
      if (after.text > 0 || after.painted) seenContent = true;
    }
  }

  const fakeTests = detectFakeTests(input.html);
  const risksLeft = riskCategories(input.html);
  const selfTests = tests ? { pass: tests.filter((item) => item.pass).length, total: tests.length, fake: fakeTests } : null;
  const blankScreen = !seenContent;
  const facts: JudgeFacts = {
    validPage: !blankScreen,
    risksLeft,
    fakeTests,
    selfTests: selfTests ? { pass: selfTests.pass, total: selfTests.total } : null,
    runtimeErrors: errors.length,
    wantTests: input.wantTests ?? false,
    wantPolish: input.wantPolish ?? false,
    leakedDespiteBlock: input.leakedDespiteBlock,
  };
  const violations = axePage ? await axeViolations(axePage) : 0;
  return {
    engine: "playwright",
    ending: resolveEnding(facts),
    validPage: facts.validPage,
    blankScreen,
    interactive: responsiveActions > 0,
    responsiveActions,
    actions,
    errors,
    runtimeErrors: errors.length,
    fakeTests,
    selfTests,
    risksLeft,
    networkAttempts,
    screenshots,
    a11y: { violations, gating: false },
    facts,
  };
}
