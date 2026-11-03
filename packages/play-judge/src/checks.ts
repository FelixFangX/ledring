import type { Page } from "playwright";

export const CHECK_ACTIONS = ["click", "type", "key", "wait"] as const;
export type CheckAction = (typeof CHECK_ACTIONS)[number];

export const CHECK_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter", "Tab"] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export interface DeclarativeCheck {
  action: CheckAction;
  target?: ParsedTarget;
  text?: string;
  key?: CheckKey;
  ms?: number;
  expect?: { textChanges?: ParsedTarget };
}

/** A target the grammar already accepted. Executors must not turn the raw string into a selector. */
export type ParsedTarget =
  | { kind: "button" }
  | { kind: "button-text"; name: string }
  | { kind: "input" }
  | { kind: "canvas" }
  | { kind: "id"; id: string }
  | { kind: "class"; className: string };

export interface CheckResult {
  index: number;
  source: "model-proposed";
  status: "passed" | "failed" | "rejected";
  reason?: string;
  action?: CheckAction;
}

interface PreparedCheck {
  index: number;
  check: DeclarativeCheck;
}

const ALLOWED_KEYS = new Set<string>(["action", "target", "text", "key", "ms", "expect"]);
const EXPECT_KEYS = new Set<string>(["textChanges"]);
const KEYS = new Set<string>(CHECK_KEYS);
const HOSTILE = /javascript\s*:|xpath|\s>>\s?|https?:|url\s*\(|\bnavigate\b|\bgoto\b/i;
const TARGET =
  /^(?:button(?::has-text\("((?:[^"\\]|\\.){0,80})"\))?|input|canvas|#([A-Za-z][\w-]{0,40})|\.([A-Za-z][\w-]{0,40}))$/;

function unescapeQuoted(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

export function parseTarget(target: string): ParsedTarget | undefined {
  if (HOSTILE.test(target)) return undefined;
  const match = TARGET.exec(target);
  if (!match) return undefined;
  if (target.startsWith("button:has-text(")) return { kind: "button-text", name: unescapeQuoted(match[1] ?? "") };
  if (target === "button") return { kind: "button" };
  if (target === "input") return { kind: "input" };
  if (target === "canvas") return { kind: "canvas" };
  if (match[2]) return { kind: "id", id: match[2] };
  if (match[3]) return { kind: "class", className: match[3] };
  return undefined;
}

function reject(index: number, reason: string, action?: CheckAction): CheckResult {
  return action ? { index, source: "model-proposed", status: "rejected", reason, action } : { index, source: "model-proposed", status: "rejected", reason };
}

function parseOne(item: unknown, index: number): { ok: true; check: DeclarativeCheck } | { ok: false; result: CheckResult } {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, result: reject(index, "check must be an object") };
  const row = item as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, result: reject(index, `unknown field ${key}`) };
  }
  if (typeof row.action !== "string" || !CHECK_ACTIONS.includes(row.action as CheckAction)) {
    return { ok: false, result: reject(index, "action must be click, type, key, or wait") };
  }
  const action = row.action as CheckAction;
  const strings = [row.target, row.text, row.key].filter((value) => typeof value === "string") as string[];
  if (strings.some((value) => HOSTILE.test(value))) return { ok: false, result: reject(index, "selector is not allowed", action) };

  const check: DeclarativeCheck = { action };
  if (action === "wait") {
    if (row.target !== undefined || row.text !== undefined || row.key !== undefined || row.expect !== undefined) {
      return { ok: false, result: reject(index, "wait only accepts ms", action) };
    }
    if (row.ms !== undefined && (typeof row.ms !== "number" || !Number.isInteger(row.ms) || row.ms < 0 || row.ms > 500)) {
      return { ok: false, result: reject(index, "ms must be an integer from 0 to 500", action) };
    }
    check.ms = typeof row.ms === "number" ? row.ms : 0;
    return { ok: true, check };
  }

  if (typeof row.target !== "string") return { ok: false, result: reject(index, "target is required", action) };
  const target = parseTarget(row.target);
  if (!target) return { ok: false, result: reject(index, "target is outside the grammar", action) };
  check.target = target;

  if (row.expect !== undefined) {
    if (!row.expect || typeof row.expect !== "object" || Array.isArray(row.expect)) {
      return { ok: false, result: reject(index, "expect must be an object", action) };
    }
    const expectRow = row.expect as Record<string, unknown>;
    for (const key of Object.keys(expectRow)) {
      if (!EXPECT_KEYS.has(key)) return { ok: false, result: reject(index, `unknown expect field ${key}`, action) };
    }
    if (expectRow.textChanges !== undefined) {
      if (typeof expectRow.textChanges !== "string" || HOSTILE.test(expectRow.textChanges)) {
        return { ok: false, result: reject(index, "textChanges is outside the grammar", action) };
      }
      const textTarget = parseTarget(expectRow.textChanges);
      if (!textTarget) return { ok: false, result: reject(index, "textChanges is outside the grammar", action) };
      check.expect = { textChanges: textTarget };
    }
  }

  if (action === "click") {
    if (row.text !== undefined || row.key !== undefined || row.ms !== undefined) {
      return { ok: false, result: reject(index, "click only accepts target and expect", action) };
    }
    return { ok: true, check };
  }
  if (action === "type") {
    if (typeof row.text !== "string" || row.text.length < 1 || row.text.length > 80) {
      return { ok: false, result: reject(index, "text must be 1 to 80 characters", action) };
    }
    if (row.key !== undefined || row.ms !== undefined) return { ok: false, result: reject(index, "type only accepts target, text, and expect", action) };
    check.text = row.text;
    return { ok: true, check };
  }
  if (typeof row.key !== "string" || !KEYS.has(row.key)) return { ok: false, result: reject(index, "key is not in the allowlist", action) };
  if (row.text !== undefined || row.ms !== undefined) return { ok: false, result: reject(index, "key only accepts target, key, and expect", action) };
  check.key = row.key as CheckKey;
  return { ok: true, check };
}

/** Split model JSON into checks that may run and checks that must not. */
export function reviewChecks(input: unknown): { accepted: PreparedCheck[]; rejected: CheckResult[] } {
  if (input === undefined) return { accepted: [], rejected: [] };
  if (!Array.isArray(input)) return { accepted: [], rejected: [reject(0, "checks must be an array")] };
  if (input.length > 5) return { accepted: [], rejected: [reject(0, "at most 5 checks")] };
  const accepted: PreparedCheck[] = [];
  const rejected: CheckResult[] = [];
  input.forEach((item, index) => {
    const parsed = parseOne(item, index);
    if (!parsed.ok) rejected.push(parsed.result);
    else accepted.push({ index, check: parsed.check });
  });
  return { accepted, rejected };
}

function locator(page: Page, target: ParsedTarget) {
  switch (target.kind) {
    case "button":
      return page.locator("button");
    case "button-text":
      return page.locator("button", { hasText: target.name });
    case "input":
      return page.locator("input");
    case "canvas":
      return page.locator("canvas");
    case "id":
      return page.locator(`[id="${target.id}"]`);
    case "class":
      return page.locator(`[class~="${target.className}"]`);
  }
}

async function textOf(page: Page, target: ParsedTarget): Promise<string> {
  return locator(page, target).first().innerText({ timeout: 500 });
}

/** Run checks that already passed the grammar. Rejected checks never reach this function. */
export async function runChecks(page: Page, accepted: readonly PreparedCheck[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const item of accepted) {
    const { check, index } = item;
    const base = { index, source: "model-proposed" as const, action: check.action };
    try {
      const watched = check.expect?.textChanges;
      const before = watched ? await textOf(page, watched) : "";
      if (check.action === "wait") {
        await page.waitForTimeout(check.ms ?? 0);
      } else if (check.target) {
        const target = locator(page, check.target).first();
        if (check.action === "click") await target.click({ timeout: 500 });
        else if (check.action === "type") await target.fill(check.text ?? "", { timeout: 500 });
        else {
          await target.click({ timeout: 500 });
          await page.keyboard.press(check.key === " " ? "Space" : (check.key ?? "Enter"));
        }
      }
      if (watched) {
        const after = await textOf(page, watched);
        if (after === before) {
          results.push({ ...base, status: "failed", reason: "text did not change" });
          continue;
        }
      }
      results.push({ ...base, status: "passed" });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 160) : "check failed";
      results.push({ ...base, status: "failed", reason });
    }
  }
  return results;
}
