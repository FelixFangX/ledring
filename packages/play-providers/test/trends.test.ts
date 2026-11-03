import { describe, expect, it, vi } from "vitest";
import { fetchTrends, hackerNews, modelWebSearch, reddit, xRecent, type TrendContext } from "@ledring/play-providers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("trend sources", () => {
  it("interleaves live items, drops URLless model hits, and caps at 8", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("algolia")) {
        return jsonResponse({
          hits: [
            { title: "HN one", objectID: "1", created_at: "2026-10-15T00:00:00.000Z" },
            { title: "HN two", objectID: "2", created_at: "2026-10-15T00:00:00.000Z" },
          ],
        });
      }
      if (String(url).includes("reddit")) {
        return jsonResponse({
          data: { children: [{ data: { title: "Reddit one", permalink: "/r/test/1", subreddit: "test", created_utc: 1_700_000_000, over_18: false } }, { data: { title: "skip", over_18: true, permalink: "/r/x" } }] },
        });
      }
      if (String(url).includes("/responses")) {
        return jsonResponse({
          output_text: 'Here is JSON {"items":[{"title":"Found","source":"Example","url":"https://example.com/a","date":"2026-10-15"},{"title":"No url","source":"x","url":"not-a-url"}]}',
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const ctx: TrendContext = {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => "2026-10-15T03:00:00.000Z",
      openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1", model: "gpt-5" },
    };
    const result = await fetchTrends(ctx);
    expect(result.items.map((item) => item.provider)).toEqual(["model-web-search", "hn", "reddit", "hn"]);
    expect(result.items[0]?.url).toBe("https://example.com/a");
    expect(result.items.every((item) => item.fetchedAt === "2026-10-15T03:00:00.000Z")).toBe(true);
    expect(result.report.find((row) => row.id === "x")?.ok).toBeUndefined();
    expect(result.items.length).toBeLessThanOrEqual(8);
  });

  it("records HTTP errors, malformed JSON, and timeouts without inventing titles", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("algolia")) return jsonResponse({ hits: "nope" });
      if (href.includes("reddit")) return jsonResponse({ error: "nope" }, 429);
      if (href.includes("/responses")) return jsonResponse({ output_text: "not json at all" });
      return jsonResponse({}, 500);
    });
    const result = await fetchTrends({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
    });
    expect(result.items).toEqual([]);
    expect(result.report.filter((row) => row.id !== "x").every((row) => row.ok === false)).toBe(true);
    expect(result.report.some((row) => row.error?.includes("HTTP 429"))).toBe(true);
    expect(result.report.some((row) => row.error === "malformed JSON")).toBe(true);
  });

  it("times out a hung provider at 7s", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const pending = fetchTrends({ fetchImpl: fetchImpl as unknown as typeof fetch, browser: true, timeoutMs: 7000 });
    await vi.advanceTimersByTimeAsync(7000);
    const result = await pending;
    expect(result.items).toEqual([]);
    expect(result.report).toEqual([expect.objectContaining({ id: "hn", ok: false, error: "timeout" })]);
    vi.useRealTimers();
  });

  it("makes zero requests in demo mode", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchTrends({ demo: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.items).toEqual([]);
    expect(result.report).toEqual([]);
  });

  it("keeps X off unless a bridge bearer is enabled, and redacts the bearer", async () => {
    expect(xRecent.available({})).toBe(false);
    expect(xRecent.available({ xBearer: "secret-token" })).toBe(false);
    let authorization = "";
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse({ data: [{ id: "99", text: "hello   trend", created_at: "2026-10-15T00:00:00.000Z" }] });
    };
    const result = await fetchTrends(
      { fetchImpl: fetchImpl as unknown as typeof fetch, xEnabled: true, xBearer: "secret-token" },
      [xRecent],
    );
    expect(result.items[0]?.url).toBe("https://x.com/i/web/status/99");
    expect(authorization).toBe("Bearer secret-token");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("does not call reddit or model search from the browser", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(String(url));
      return jsonResponse({ hits: [{ title: "Only HN", objectID: "9" }] });
    };
    const result = await fetchTrends({
      browser: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      openai: { apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" },
    });
    expect(result.items.map((item) => item.provider)).toEqual(["hn"]);
    expect(urls.every((url) => url.includes("algolia"))).toBe(true);
    expect(hackerNews.browser).toBe(true);
    expect(reddit.browser).toBe(false);
    expect(modelWebSearch.browser).toBe(false);
  });
});
