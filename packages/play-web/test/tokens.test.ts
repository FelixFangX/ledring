import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAY_TOKENS, lintBannedStyles } from "../src/tokens.js";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const tokensCss = readFileSync(fileURLToPath(new URL("../src/tokens.css", import.meta.url)), "utf8");

describe("design tokens and banned-styles lint", () => {
  it("defines the v1 colour and font tokens in tokens.ts and tokens.css", () => {
    expect(PLAY_TOKENS.bg).toBe("#EEF1F3");
    expect(PLAY_TOKENS.bg2).toBe("#E4E8EB");
    expect(PLAY_TOKENS.panel).toBe("#FFFFFF");
    expect(PLAY_TOKENS.ink).toBe("#0E1114");
    expect(PLAY_TOKENS.ink2).toBe("#5A6168");
    expect(PLAY_TOKENS.ink3).toBe("#949BA1");
    expect(PLAY_TOKENS.line).toBe("#D4DADE");
    expect(PLAY_TOKENS.line2).toBe("#BAC2C8");
    expect(PLAY_TOKENS.calm).toBe("#1E63E9");
    expect(PLAY_TOKENS.proc).toBe("#E8A50A");
    expect(PLAY_TOKENS.crit).toBe("#E01E2B");
    expect(PLAY_TOKENS.ok).toBe("#1C9D54");

    for (const font of ["Archivo", "IBM Plex Mono", "Noto Sans SC"]) {
      expect(tokensCss).toContain(`font-family: "${font}"`);
    }
    expect(tokensCss).not.toContain("fonts.googleapis.com");
    expect(tokensCss).not.toContain("fonts.gstatic.com");
  });

  it("rejects backdrop-filter, cyan glow, and grain, and passes on the shipped stylesheets", () => {
    expect(lintBannedStyles(".hud{backdrop-filter:blur(6px)}", "bad.css")).toEqual([
      "banned style: backdrop-filter in bad.css",
    ]);
    expect(lintBannedStyles(":root{--cyan:#06B6D4}", "bad.css")).toEqual([
      "banned style: cyan glow/token in bad.css",
    ]);
    expect(lintBannedStyles(".bg{background:url(grain.png)}", "bad.css")).toEqual([
      "banned style: grain texture in bad.css",
    ]);

    expect(lintBannedStyles(html, "packages/play-web/index.html")).toEqual([]);
    expect(lintBannedStyles(tokensCss, "packages/play-web/src/tokens.css")).toEqual([]);
  });
});
