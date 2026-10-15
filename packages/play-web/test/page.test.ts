import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEGRADED_JUDGE_NOTICE, DEGRADED_JUDGE_NOTICE_ZH } from "@ledring/play-sandbox";
import { FREE_PRESETS } from "@ledring/play-web";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

describe("play page", () => {
  it("keeps the prototype screens, labels demo, and does not fake a ChatGPT connection", () => {
    for (const id of ["menu", "onboard", "insp", "missions", "run", "end"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("DEMO · synthetic cassette, not a live model recording");
    expect(html).toContain("合成卡带，不是实时模型录制");
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

  it("includes the first-run onboarding flow with all 5 providers, local bridge command, SIWC gate, and literary zh copy", () => {
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
    expect(html).toContain('value="npx ledring play"');
    expect(html).toContain("ledring-onboarded");
    expect(html).toContain("LEDRING_SIWC");
    expect(html).toContain("COMING SOON");
    expect(html).toContain("敬请期待");
    expect(html).toContain("临阵校准 · 心智接引");
    expect(html).toContain("为 CX-417 择定心智之源。");
  });

  it("embeds the free-preset catalog, the no-card badge, and bridge routing for hosts that block browsers", () => {
    for (const id of ["ob-presets", "ob-preset-row", "ob-free-badge", "ob-limits", "ob-keylink", "ob-route", "ob-account"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("FREE · NO CARD");
    expect(html).toContain("免费 · 无需绑卡");
    expect(html).toContain("领取密钥");
    expect(html).toContain("activeBridgePreset");
    expect(html).toContain("obNeedBridge");
    for (const preset of FREE_PRESETS) {
      expect(html).toContain(preset.baseUrl);
      expect(html).toContain(preset.model);
      expect(html).toContain(preset.keyUrl);
      expect(html).toContain(`browser:${preset.browser}`);
    }
    expect(html).toContain("此端拒绝浏览器直连");
    expect(html).toContain("gemini-3.8-flash 不另收费");
    expect(html).toContain("每分钟 30 次、每日 1000 次");
  });
});
