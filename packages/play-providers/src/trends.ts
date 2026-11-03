import { redact } from "./redact.js";

export interface TrendItem {
  title: string;
  source: string;
  url: string;
  ts: string | null;
  provider: string;
  fetchedAt: string;
  tid?: string;
}

export interface TrendReport {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface TrendContext {
  /** Demo mode must not touch trend hosts. */
  demo?: boolean;
  /** When true, skip sources that cannot be called from a browser (reddit, X, model search). */
  browser?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => string;
  openai?: { apiKey: string; baseUrl: string; model?: string };
  /** X recent search. Off unless this is true. The bearer never goes to the page. */
  xEnabled?: boolean;
  xBearer?: string;
}

export interface TrendSource {
  id: string;
  label: string;
  /** False for sources a static page must not call. */
  browser: boolean;
  available(ctx: TrendContext): boolean;
  fetch(ctx: TrendContext): Promise<Omit<TrendItem, "fetchedAt" | "tid">[]>;
}

const HN_URL = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=12";
const REDDIT_URL = "https://www.reddit.com/r/popular/top.json?t=day&limit=12&raw_json=1";
const X_URL = "https://api.x.com/2/tweets/search/recent";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

async function readJson(ctx: TrendContext, url: string, init?: RequestInit): Promise<unknown> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const timeoutMs = ctx.timeoutMs ?? 7000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
}

export const modelWebSearch: TrendSource = {
  id: "model-web-search",
  label: "model web search",
  browser: false,
  available: (ctx) => Boolean(ctx.openai?.apiKey && /api\.openai\.com/i.test(ctx.openai.baseUrl)),
  async fetch(ctx) {
    const openai = ctx.openai;
    if (!openai) return [];
    const body = {
      model: openai.model || "gpt-5",
      tools: [{ type: "web_search" }],
      input:
        'Search the web for 6 recent public posts or news items. Reply ONLY JSON {"items":[{"title":"","source":"","url":"https://…","date":""}]}. Only items you found, each with a URL. Do not call an item trending unless the source does.',
    };
    const payload = await readJson(ctx, `${openai.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${openai.apiKey}` },
      body: JSON.stringify(body),
    });
    const record = asRecord(payload);
    const outputText = typeof record?.output_text === "string" ? record.output_text : "";
    const output = Array.isArray(record?.output) ? record.output : [];
    const joined = outputText || output.map((part) => {
      const row = asRecord(part);
      const content = Array.isArray(row?.content) ? row.content : [];
      return content.map((block) => (typeof asRecord(block)?.text === "string" ? String(asRecord(block)?.text) : "")).join("");
    }).join("");
    const start = joined.indexOf("{");
    const end = joined.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("malformed JSON");
    const parsed = JSON.parse(joined.slice(start, end + 1)) as { items?: unknown[] };
    return (parsed.items ?? []).flatMap((item) => {
      const row = asRecord(item);
      const url = httpUrl(row?.url);
      const title = typeof row?.title === "string" ? row.title.slice(0, 120) : "";
      if (!title || !url) return [];
      let source = typeof row?.source === "string" ? row.source.slice(0, 40) : "";
      if (!source) {
        try { source = new URL(url).hostname; } catch { source = "web"; }
      }
      return [{ title, source, url, ts: typeof row?.date === "string" ? row.date : null, provider: "model-web-search" }];
    }).slice(0, 5);
  },
};

export const hackerNews: TrendSource = {
  id: "hn",
  label: "Hacker News (Algolia API)",
  browser: true,
  available: () => true,
  async fetch(ctx) {
    const payload = asRecord(await readJson(ctx, HN_URL));
    if (!payload || !Array.isArray(payload.hits)) throw new Error("malformed JSON");
    const hits = payload.hits;
    return hits.flatMap((hit) => {
      const row = asRecord(hit);
      const title = typeof row?.title === "string" ? row.title : "";
      const id = row?.objectID;
      if (!title || (typeof id !== "string" && typeof id !== "number")) return [];
      return [{
        title,
        source: "Hacker News",
        url: `https://news.ycombinator.com/item?id=${id}`,
        ts: typeof row?.created_at === "string" ? row.created_at : null,
        provider: "hn",
      }];
    }).slice(0, 5);
  },
};

export const reddit: TrendSource = {
  id: "reddit",
  label: "Reddit r/popular (.json)",
  browser: false,
  available: () => true,
  async fetch(ctx) {
    const payload = asRecord(await readJson(ctx, REDDIT_URL, { headers: { accept: "application/json" } }));
    const data = asRecord(payload?.data);
    const children = Array.isArray(data?.children) ? data.children : [];
    return children.flatMap((child) => {
      const row = asRecord(asRecord(child)?.data);
      if (!row || row.over_18 === true || typeof row.title !== "string" || typeof row.permalink !== "string") return [];
      const created = typeof row.created_utc === "number" ? new Date(row.created_utc * 1000).toISOString() : null;
      return [{
        title: row.title,
        source: `Reddit r/${typeof row.subreddit === "string" ? row.subreddit : "popular"}`,
        url: `https://www.reddit.com${row.permalink}`,
        ts: created,
        provider: "reddit",
      }];
    }).slice(0, 5);
  },
};

/** Documented, off by default. Bridge-only. Never send the bearer to the page. */
export const xRecent: TrendSource = {
  id: "x",
  label: "X recent search",
  browser: false,
  available: (ctx) => ctx.xEnabled === true && Boolean(ctx.xBearer),
  async fetch(ctx) {
    if (!ctx.xBearer) return [];
    const url = `${X_URL}?query=${encodeURIComponent("lang:en -is:retweet")}&max_results=10&tweet.fields=created_at`;
    const payload = asRecord(await readJson(ctx, url, { headers: { authorization: `Bearer ${ctx.xBearer}` } }));
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.flatMap((tweet) => {
      const row = asRecord(tweet);
      const id = typeof row?.id === "string" ? row.id : "";
      const text = typeof row?.text === "string" ? row.text.replace(/\s+/g, " ").slice(0, 120) : "";
      if (!id || !text) return [];
      return [{
        title: text,
        source: "X",
        url: `https://x.com/i/web/status/${id}`,
        ts: typeof row?.created_at === "string" ? row.created_at : null,
        provider: "x",
      }];
    }).slice(0, 5);
  },
};

export const TREND_SOURCES: readonly TrendSource[] = [modelWebSearch, hackerNews, reddit, xRecent];

function dedupe(items: TrendItem[]): TrendItem[] {
  const seen = new Set<string>();
  const out: TrendItem[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

/** Fetch every available source. Failures stay on the report. Nothing is invented. */
export async function fetchTrends(ctx: TrendContext, sources: readonly TrendSource[] = TREND_SOURCES): Promise<{
  items: TrendItem[];
  report: TrendReport[];
  fetchedAt: string;
}> {
  const fetchedAt = ctx.now?.() ?? new Date().toISOString();
  if (ctx.demo) return { items: [], report: [], fetchedAt };
  const selected = sources.filter((source) => source.available(ctx) && (!ctx.browser || source.browser));
  const settled = await Promise.allSettled(selected.map((source) => source.fetch(ctx)));
  const report: TrendReport[] = selected.map((source, index) => {
    const result = settled[index];
    if (result?.status === "fulfilled") return { id: source.id, label: source.label, ok: true, count: result.value.length };
    const message = result?.status === "rejected" ? redact(result.reason instanceof Error ? result.reason.message : String(result.reason)) : "failed";
    return { id: source.id, label: source.label, ok: false, count: 0, error: message };
  });
  const lists = settled.map((result) => (result.status === "fulfilled" ? result.value : []));
  const interleaved: TrendItem[] = [];
  for (let row = 0; row < 5 && interleaved.length < 8; row += 1) {
    for (const list of lists) {
      const item = list[row];
      if (item && interleaved.length < 8) interleaved.push({ ...item, fetchedAt });
    }
  }
  const items = dedupe(interleaved).slice(0, 8).map((item, index) => ({ ...item, tid: `T${index + 1}` }));
  return { items, report, fetchedAt };
}
