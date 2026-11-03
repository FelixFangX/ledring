import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { languageDirective } from "@ledring/play-core";

const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const chunk = html.slice(html.indexOf("/* zh-feed */"), html.indexOf("/* zh-feed-end */"));
const api = new Function(
  `${chunk}\nreturn {languageDirective, feedItemKey, curatedFeedLine, parseFeedLines, applyZhFeed, latinOnlyProblem};`,
)() as {
  languageDirective: (lang: "en" | "zh") => string;
  feedItemKey: (item: { url?: string; id?: string; title?: string }) => string;
  curatedFeedLine: (title: string) => string;
  parseFeedLines: (text: string) => { id: string; zh: string }[];
  applyZhFeed: (
    items: { id: string; title: string; url?: string }[],
    cache: Record<string, string>,
    modelText: string | null,
  ) => { items: { id: string; title: string; display?: string }[]; cache: Record<string, string> };
  latinOnlyProblem: (text: string) => string | null;
};

describe("zh feed copy", () => {
  it("uses the same language directive as the play prompts", () => {
    expect(api.languageDirective("zh")).toBe(languageDirective("zh"));
    expect(api.languageDirective("en")).toBe(languageDirective("en"));
    expect(html).toContain('streamChat(SYS()');
    expect(html).toContain("pingSystem()");
  });

  it("caches a faithful line per item and keeps the original title when no translation exists", () => {
    const item = { id: "T1", title: "Local-first tools on small screens", url: "https://news.ycombinator.com/item?id=101" };
    const model = JSON.stringify({ lines: [{ id: "T1", zh: "小屏上的本地优先工具。" }] });
    const first = api.applyZhFeed([item], {}, model);
    expect(first.items[0]?.title).toBe("小屏上的本地优先工具。");
    expect(first.cache[item.url]).toBe(first.items[0]?.title);
    const cached = api.applyZhFeed([item], first.cache, null);
    expect(cached.items[0]?.title).toBe(first.items[0]?.title);
    const offline = api.applyZhFeed([item], {}, null);
    expect(offline.cache).toEqual({});
    expect(offline.items[0]?.title).toBe(item.title);
    expect(offline.items[0]?.display).toBe(`暂无中文译文。以下为原标题：${item.title}`);
    expect(api.curatedFeedLine(item.title)).toBe(offline.items[0]?.display);
    const kept = api.applyZhFeed([{ id: "T2", title: "已经是中文的题目", url: "https://example.com/zh" }], {}, null);
    expect(kept.items[0]?.title).toBe("已经是中文的题目");
    expect(api.parseFeedLines('noise {"lines":[{"id":"T3","zh":"Only English"}]} tail')).toEqual([]);
    expect(api.parseFeedLines('{"lines":[{"id":"T4","zh":"暂无中文译文。以下为原标题：Hello"}]}')).toEqual([]);
  });

  it("flags Latin-only sentences and allows brands and code identifiers", () => {
    expect(api.latinOnlyProblem("tests pass")).toBe("tests pass");
    expect(api.latinOnlyProblem("self-tests")).toBe("self-tests");
    expect(api.latinOnlyProblem("The model did not answer.")).toBe("The model did not answer.");
    expect(api.latinOnlyProblem("LEDRING")).toBeNull();
    expect(api.latinOnlyProblem("CX-417")).toBeNull();
    expect(api.latinOnlyProblem("Anthropic")).toBeNull();
    expect(api.latinOnlyProblem("Hacker News")).toBeNull();
    expect(api.latinOnlyProblem("index.html")).toBeNull();
    expect(api.latinOnlyProblem("node packages/cli/dist/bin.js play")).toBeNull();
    expect(api.latinOnlyProblem("risk.network.1")).toBeNull();
    expect(api.latinOnlyProblem("--bg · #EEF1F3")).toBeNull();
    expect(api.latinOnlyProblem("LEDRING 免费 AI")).toBeNull();
    expect(api.latinOnlyProblem("4/4 项自测通过")).toBeNull();
  });
});
