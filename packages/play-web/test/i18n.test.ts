import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
// Read the page's actual dictionaries without running providers or the game.
function dictionaries() {
  let code = html.slice(html.indexOf("const DICT="), html.indexOf("/* ================= ENGINE"));
  for (const match of html.matchAll(/Object\.assign\(DICT\.(?:en|zh),/g)) {
    let depth = 1, quote = "", escaped = false, i = match.index! + match[0].length;
    for (; i < html.length; i++) {
      const c = html[i]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(") depth++;
      if (c === ")" && --depth === 0) break;
    }
    code += "\n" + html.slice(match.index, i + 2);
  }
  return new Function(code + ";return DICT;")() as Record<"en" | "zh", Record<string, unknown>>;
}
describe("strict bilingual Play chrome", () => {
  it("has matching keys and no CJK in any English dictionary value", () => {
    const dict = dictionaries();
    expect(Object.keys(dict.zh).sort()).toEqual(Object.keys(dict.en).sort());
    // The toggle label (key "lang") is the one allowed exception: it reads "中文" and carries lang="zh-CN".
    expect(dict.en.lang).toBe("中文");
    expect(JSON.stringify({ ...dict.en, lang: "" })).not.toMatch(/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/);
  });
  it("exposes a keyboard language toggle and exempts the command from translation", () => {
    expect(html).toContain('id="lang" role="button" tabindex="0" lang="zh-CN" aria-label="Switch to Chinese"');
    expect(html).toContain('input translate="no" id="ob-cmd"');
    expect(html).toContain('e.key==="Enter"||e.key===" "');
  });
});

describe("static site language bootstrap", () => {
  for (const file of ["index.html", "404.html"]) {
    it(`${file} resolves and persists language before rendering`, () => {
      const source = readFileSync(new URL(`../../../docs/${file}`, import.meta.url), "utf8");
      const bootstrap = source.match(/<script>([\s\S]*?)<\/script>/)![1]!;
      const run = (search: string, language: string, stored: Record<string, string>) => {
        const document = { documentElement: { lang: "en", style: { visibility: "" } } };
        new Function("document", "location", "navigator", "localStorage", bootstrap)(
          document, { search }, { language }, {
            getItem: (key: string) => stored[key],
            setItem: (key: string, value: string) => { stored[key] = value; },
          },
        );
        return document.documentElement;
      };
      expect(run("", "zh-CN", {}).lang).toBe("zh-CN");
      expect(run("", "en-US", {}).lang).toBe("en");
      expect(run("", "zh-CN", { "ledring-lang": "en", "ledring-lang-explicit": "1" }).lang).toBe("en");
      const stored = { "ledring-lang": "en", "ledring-lang-explicit": "1" };
      expect(run("?lang=zh", "en-US", stored)).toEqual({ lang: "zh-CN", style: { visibility: "hidden" } });
      expect(stored["ledring-lang"]).toBe("zh");
    });
  }
});

it("marks the onboarding source URL and bridge command as code in both languages", () => {
  const expression = html.match(/<small>\$\{(esc\(sub\)\.replace[^\n]+?)\}<\/small>/)![1]!;
  const render = new Function("sub", "esc", "return " + expression);
  const dict = dictionaries();
  for (const lang of ["en", "zh"] as const) {
    const result = render(dict[lang].obPBridgeSub, (s: string) => s);
    expect(result).toContain('<code translate="no">https://github.com/FelixFangX/ledring#quickstart</code>');
    expect(result).toContain('<code translate="no">node packages/cli/dist/bin.js play</code>');
    expect(result.replace(/<[^>]*>/g, "")).toBe(dict[lang].obPBridgeSub);
  }
});
