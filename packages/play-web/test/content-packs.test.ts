import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CN_MEMES,
  CN_PRESETS,
  CN_VERDICTS,
  CN_WALL,
  ENDING_IDS,
  experienceFromQuery,
  resolveExperience,
  runPacing,
  wallLine,
  type Experience,
} from "../src/content-packs.js";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const doc = readFileSync(fileURLToPath(new URL("../../../docs/content-packs.md", import.meta.url)), "utf8");
const chunk = html.slice(html.indexOf("/* packs */"), html.indexOf("/* packs-end */"));
const page = new Function(`${chunk}\nreturn {resolveExperience, experienceFromQuery, runPacing, wallLine, CN_VERDICTS};`)() as {
  resolveExperience: typeof resolveExperience;
  experienceFromQuery: typeof experienceFromQuery;
  runPacing: typeof runPacing;
  wallLine: typeof wallLine;
  CN_VERDICTS: typeof CN_VERDICTS;
};

const cases: { name: string; query: { lang?: string | null; src?: string | null }; storage: { lang?: string | null; explicit?: string | null; src?: string | null }; expect: Pick<Experience, "lang" | "pack" | "src" | "onboard" | "ending"> }[] = [
  { name: "default en", query: {}, storage: {}, expect: { lang: "en", pack: "dev", src: null, onboard: "full", ending: "dev" } },
  { name: "stored zh", query: {}, storage: { lang: "zh", explicit: "1" }, expect: { lang: "zh", pack: "cn", src: null, onboard: "full", ending: "share" } },
  { name: "hn", query: { src: "hn" }, storage: {}, expect: { lang: "en", pack: "dev", src: "hn", onboard: "full", ending: "dev" } },
  { name: "x", query: { src: "x" }, storage: {}, expect: { lang: "en", pack: "dev", src: "x", onboard: "full", ending: "dev" } },
  { name: "reddit", query: { src: "reddit" }, storage: {}, expect: { lang: "en", pack: "dev", src: "reddit", onboard: "full", ending: "dev" } },
  { name: "v2ex", query: { src: "v2ex" }, storage: {}, expect: { lang: "zh", pack: "cn", src: "v2ex", onboard: "full", ending: "share" } },
  { name: "xhs skips onboard", query: { src: "xhs" }, storage: {}, expect: { lang: "zh", pack: "cn", src: "xhs", onboard: "skip", ending: "share" } },
  { name: "douyin skips onboard", query: { src: "douyin" }, storage: {}, expect: { lang: "zh", pack: "cn", src: "douyin", onboard: "skip", ending: "share" } },
  { name: "explicit en wins over douyin", query: { lang: "en", src: "douyin" }, storage: {}, expect: { lang: "en", pack: "cn", src: "douyin", onboard: "skip", ending: "share" } },
  { name: "explicit zh wins over hn", query: { lang: "zh", src: "hn" }, storage: {}, expect: { lang: "zh", pack: "dev", src: "hn", onboard: "full", ending: "dev" } },
  { name: "stored src", query: {}, storage: { src: "douyin" }, expect: { lang: "zh", pack: "cn", src: "douyin", onboard: "skip", ending: "share" } },
  { name: "toggle sticks over stored src", query: {}, storage: { lang: "en", explicit: "1", src: "xhs" }, expect: { lang: "en", pack: "cn", src: "xhs", onboard: "skip", ending: "share" } },
  { name: "legacy lang sticks", query: { src: "hn" }, storage: { lang: "zh" }, expect: { lang: "zh", pack: "dev", src: "hn", onboard: "full", ending: "dev" } },
  { name: "unknown src ignored", query: { src: "tiktok" }, storage: {}, expect: { lang: "en", pack: "dev", src: null, onboard: "full", ending: "dev" } },
];

describe("content packs", () => {
  it("falls back to the browser language only when nothing else decides", () => {
    for (const fn of [experienceFromQuery, page.experienceFromQuery]) {
      expect(fn({}, { browser: "zh" }).lang).toBe("zh");
      expect(fn({}, { browser: "en" }).lang).toBe("en");
      expect(fn({ src: "hn" }, { browser: "zh" }).lang).toBe("en");
      expect(fn({ lang: "en" }, { browser: "zh" }).lang).toBe("en");
      expect(fn({}, { lang: "en", explicit: "1", browser: "zh" }).lang).toBe("en");
    }
  });
  it("resolves src, language, pack, onboard length, and ending the same way on the page", () => {
    for (const row of cases) {
      const got = experienceFromQuery(row.query, row.storage);
      const inline = page.experienceFromQuery(row.query, row.storage);
      expect(got, row.name).toMatchObject(row.expect);
      expect(inline, row.name).toEqual(got);
    }
    expect(resolveExperience({ querySrc: "douyin" }).presets).toEqual(["confess", "slack", "bday", "fortune"]);
    expect(resolveExperience({ querySrc: "hn" }).presets).toEqual(["snake", "pomo", "paint", "tip"]);
    expect(page.resolveExperience({ querySrc: "xhs" }).presets).toEqual(["confess", "slack", "bday", "fortune"]);
  });

  it("keeps a China-pack phone run to one short choice", () => {
    expect(runPacing("confess", false)).toEqual({ versions: [2], wallSec: 3.6, qteSec: 8 });
    expect(runPacing("snake", false)).toEqual({ versions: [2, 3], wallSec: 4.5, qteSec: 10 });
    expect(runPacing("snake", true).versions).toEqual([2, 3]);
    expect(page.runPacing("fortune", false)).toEqual(runPacing("fortune", false));
    expect(page.runPacing("snake", true)).toEqual(runPacing("snake", true));
  });

  it("ships the China wall memes, verdicts, and presets in the page and the doc", () => {
    expect(CN_PRESETS.map((p) => p.id)).toEqual(["confess", "slack", "bday", "fortune"]);
    expect(CN_MEMES.fortune.zh).toBe("AI 删库");
    expect(wallLine("zh", "fortune", "网络请求")).toContain("AI 删库");
    expect(wallLine("zh", "fortune", "网络请求")).toContain("拦截");
    expect(wallLine("en", "snake", "network call")).toBeNull();
    expect(page.CN_VERDICTS).toEqual(CN_VERDICTS);
    for (const preset of CN_PRESETS) {
      expect(page.wallLine("zh", preset.id, "网络请求")).toBe(wallLine("zh", preset.id, "网络请求"));
      expect(page.wallLine("en", preset.id, "eval")).toBe(wallLine("en", preset.id, "eval"));
    }
    for (const preset of CN_PRESETS) {
      expect(html).toContain(preset.zh);
      expect(html).toContain(preset.en);
      expect(html).toContain(preset.name.zh);
      expect(html).toContain(preset.name.en);
      expect(doc).toContain(preset.zh);
      expect(doc).toContain(CN_MEMES[preset.id].zh);
    }
    for (const id of ENDING_IDS) {
      expect(html).toContain(CN_VERDICTS.zh[id]);
      expect(html).toContain(CN_VERDICTS.en[id]);
      expect(doc).toContain(CN_VERDICTS.zh[id]);
    }
    expect(doc).toContain(CN_WALL.zh);
    expect(html).toContain(CN_WALL.zh);
    expect(html).toContain("ledring-src");
    expect(html).toContain("ledring-lang-explicit");
    expect(html).toContain('id="e-star"');
    expect(html).toContain('id="e-cli"');
    expect(html).toContain('id="e-source"');
    expect(html).toContain('id="e-share"');
    expect(html).toContain("https://github.com/FelixFangX/ledring");
    expect(html).toContain("localStorage.setItem('confess.name'");
    expect(html).toContain("https://slack.example/api/log");
    expect(html).toContain("window.open('https://share.example/card");
    expect(html).toContain("eval(raw)");
    expect(html).not.toMatch(/Quantic|Konami|\bSony\b|Detroit|Persona/);
  });
});
