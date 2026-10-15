import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEGRADED_JUDGE_NOTICE, DEGRADED_JUDGE_NOTICE_ZH } from "@ledring/play-sandbox";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

describe("play page", () => {
  it("keeps the prototype screens, labels demo, and does not fake a ChatGPT connection", () => {
    for (const id of ["menu", "insp", "missions", "run", "end"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("DEMO · synthetic cassette, not a live model recording");
    expect(html).toContain("合成卡带，不是实时模型录制");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("ledring-siwc-mock");
    expect(html).not.toContain("connected:true");
    expect(html).not.toMatch(/Quantic|Konami|\bSony\b|Detroit|Persona/);
    expect(html).toContain("available:()=>!!TB");
    expect(html).toContain(DEGRADED_JUDGE_NOTICE);
    expect(html).toContain(DEGRADED_JUDGE_NOTICE_ZH);
    expect(html).toContain("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:");
    expect(html).toContain("window.__ledringWithHarness");
  });
});
