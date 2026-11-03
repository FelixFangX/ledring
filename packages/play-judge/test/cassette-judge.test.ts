import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { loadCassette, playCassette } from "@ledring/play-core";
import { JudgeRuntime, judgeArtifact } from "@ledring/play-judge";

function browserInstalled(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const installed = browserInstalled();
const root = fileURLToPath(new URL("../../../", import.meta.url));
const files = readdirSync(join(root, "fixtures/play")).filter((name) => name.endsWith(".json")).sort();

function labelledEnding(file: string): string {
  const stem = file.replace(/\.json$/, "");
  return stem.slice(stem.lastIndexOf("-") + 1).toUpperCase();
}

describe.skipIf(!installed && !process.env.CI)("shipped cassette endings", () => {
  const runtime = new JudgeRuntime();

  afterAll(async () => {
    await runtime.close();
  });

  it.each(files)("%s matches its filename under playCassette and the Playwright judge", async (file) => {
    const expected = labelledEnding(file);
    const cassette = loadCassette(readFileSync(join(root, "fixtures/play", file), "utf8"));
    const state = playCassette(cassette);
    expect(state.ending).toBe(expected);
    if (expected === "ABANDONED") return;
    if (!installed) throw new Error("chromium is not installed");
    const verdict = await judgeArtifact(
      { html: state.html, wantTests: state.wantTests, wantPolish: state.wantPolish },
      { runtime },
    );
    expect(verdict.ending).toBe(expected);
  }, 30_000);
});
