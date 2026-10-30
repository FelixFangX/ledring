import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { languageDirective } from "@ledring/play-core";
import { DEGRADED_JUDGE_NOTICE, DEGRADED_JUDGE_NOTICE_ZH } from "@ledring/play-sandbox";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

describe("play page", () => {
  it("keeps the prototype screens, labels demo, and does not fake a ChatGPT connection", () => {
    for (const id of ["menu", "onboard", "insp", "missions", "run", "end"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("DEMO · synthetic cassette, not a live model recording");
    expect(html).toContain("内置示例，不是实时录制");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("ledring-siwc-mock");
    expect(html).not.toContain("connected:true");
    expect(html).not.toMatch(/Quantic|Konami|\bSony\b|Detroit|Persona/);
    expect(html).toContain("available:()=>!!TB&&!usesRecorded()");
    expect(html).toContain("available:()=>!usesRecorded(),");
    expect(html).toContain("if(INSP.live)scan();else askQ();");
    expect(html).toContain(
      'function cassetteLabel(p){if(p&&p.kind==="recorded"&&p.model&&p.recordedAt)return "recorded from "+p.model+" on "+p.recordedAt;return "DEMO · synthetic cassette, not a live model recording";}',
    );
    expect(html.match(/recorded from /g)).toEqual(["recorded from "]);
    expect(html).toContain(DEGRADED_JUDGE_NOTICE);
    expect(html).toContain(DEGRADED_JUDGE_NOTICE_ZH);
    expect(html).toContain("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:");
    expect(html).toContain("window.__ledringWithHarness");
  });

  it("never uses getUserMedia, geolocation, or clipboard read/write in play-web", () => {
    expect(html).not.toMatch(/getUserMedia|geolocation|navigator\.clipboard/i);
  });

  it("synthesizes all SFX via Web Audio API with zero external audio asset references", () => {
    expect(html).not.toMatch(/\.(mp3|wav|ogg|m4a|aac|flac)\b/i);
    for (const cue of ["click", "tick", "alert", "thud", "stamp", "ring", "blip", "scan", "ping", "win", "lose", "like"]) {
      expect(html).toContain(`${cue}:()=>`);
    }
  });

  it("includes the first-run onboarding flow with LEDRING Free AI preselected, your own key, the bridge, and SIWC", () => {
    for (const id of [
      "onboard",
      "ob-cards",
      "ob-bridge-box",
      "ob-cmd",
      "ob-copy",
      "ob-key",
      "ob-priv",
      "ob-test",
      "ob-test-status",
      "ob-skip",
      "ob-continue",
      "d-onboard",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('value="node packages/cli/dist/bin.js play"');
    expect(html).toContain("ledring-onboarded");
    expect(html).toContain("LEDRING_SIWC");
    expect(html).toContain("COMING SOON");
    expect(html).toContain("敬请期待");
    expect(html).toContain("CX-417 · 你的 AI 构建助手");
    expect(html).toContain("和 CX-417 一起构建");
  });

  it("defaults to LEDRING Free AI and does not call /ai/chat until streamChat", () => {
    expect(html).toContain('mode:"ledring"');
    expect(html).toContain('return "ledring"');
    expect(html).toContain("LEDRING Free AI");
    expect(html).toContain("LEDRING 免费 AI");
    expect(html).toContain('strandsFetch("/ai/chat"');
    expect(html).toContain("T.obQuota");
    expect(html).toContain("今天的免费额度已经用完");
    expect(html).not.toContain("FREE_PRESETS");
    expect(html).not.toContain("ob-presets");
    expect(html).not.toContain("activeBridgePreset");
    const boot = html.slice(html.lastIndexOf("/* boot */"));
    expect(boot).not.toContain("streamChat");
    expect(boot).not.toContain("/ai/chat");
    expect(html).toContain(languageDirective("zh"));
    expect(html).toContain(languageDirective("en"));
    expect(html).toContain("ledring-zh-feed-v1");
    expect(html).toContain("项自测通过");
    expect(html.split("languageDirective(").length).toBeGreaterThanOrEqual(6);
  });
});
