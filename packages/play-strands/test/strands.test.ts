import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENDING_IDS as CORE_ENDINGS } from "@ledring/play-core";
import {
  ENDING_IDS,
  LIKE_DEVICE_LIMIT,
  LIST_LIMIT,
  POST_DEVICE_LIMIT,
  POST_IP_LIMIT,
  STRAND_TTL_MS,
  briefBucket,
  createD1Store,
  handleStrands,
  memoryStore,
  nearBuckets,
  type D1Database,
  type D1Prepared,
  type StrandStore,
} from "@ledring/play-strands";

const DEVICE = "device-key-1";
const IP = "203.0.113.10";

function postBody(extra: Record<string, unknown> = {}, device = DEVICE): Record<string, unknown> {
  return {
    traceHash: "ab".repeat(16),
    title: "A quiet timer",
    ending: "SHIPPED",
    brief: "timer stop",
    signatures: ["loop:trust"],
    lang: "en",
    optIn: true,
    deviceKey: device,
    ...extra,
  };
}

function request(method: string, path: string, body?: unknown, ip = IP): Request {
  return new Request(`https://strands.ledring.test${path}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function post(store: StrandStore, now: number, extra: Record<string, unknown> = {}, device = DEVICE, ip = IP) {
  const response = await handleStrands(request("POST", "/strands", postBody(extra, device), ip), store, now);
  return { status: response.status, body: (await response.json()) as { id?: string; bucket?: string; error?: string; categories?: string[] } };
}

describe("lexical buckets", () => {
  it("hashes the same words to one bucket and lists neighbours", () => {
    expect(briefBucket("timer stop")).toBe(briefBucket("stop   timer"));
    expect(nearBuckets("00")).toEqual(["ff", "00", "01"]);
    expect(nearBuckets("nope")).toBeNull();
  });
});

describe("strands worker", () => {
  it("posts, lists the near bucket, and likes once", async () => {
    const store = memoryStore();
    const created = await post(store, 1_000);
    expect(created.status).toBe(201);
    expect(created.body.bucket).toBe(briefBucket("timer stop"));
    const listed = await handleStrands(request("GET", `/strands?near=${created.body.bucket}`), store, 1_000);
    const page = (await listed.json()) as { strands: { id: string; title: string; likes: number }[] };
    expect(page.strands.map((strand) => strand.id)).toEqual([created.body.id]);
    const liked = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), store, 1_000);
    expect(await liked.json()).toEqual({ likes: 1 });
    const again = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), store, 1_000);
    expect(await again.json()).toEqual({ likes: 1 });
  });

  it("drops an unliked strand after 30 days and keeps a liked one", async () => {
    const store = memoryStore();
    const kept = await post(store, 0, { brief: "timer stop", title: "Kept" }, "device-kept");
    const dropped = await post(store, 0, { brief: "timer stop", title: "Dropped" }, "device-drop");
    await handleStrands(request("POST", `/strands/${kept.body.id}/like`, { deviceKey: "device-kept" }), store, 0);
    const later = STRAND_TTL_MS + 1;
    const listed = await handleStrands(request("GET", `/strands?near=${kept.body.bucket}`), store, later);
    const page = (await listed.json()) as { strands: { id: string }[] };
    expect(page.strands.map((strand) => strand.id)).toEqual([kept.body.id]);
    expect(page.strands.map((strand) => strand.id)).not.toContain(dropped.body.id);
    const missed = await handleStrands(request("POST", `/strands/${dropped.body.id}/like`, { deviceKey: "device-drop" }), store, later);
    expect(missed.status).toBe(404);
  });

  it("rate-limits posts per device and per address, and likes per device", async () => {
    const store = memoryStore();
    for (let i = 0; i < POST_DEVICE_LIMIT; i += 1) {
      const created = await post(store, 5, { traceHash: `${i.toString(16).padStart(16, "0")}` });
      expect(created.status).toBe(201);
    }
    expect((await post(store, 5, { traceHash: "ff".repeat(16) })).status).toBe(429);

    const addresses = memoryStore();
    for (let i = 0; i < POST_IP_LIMIT; i += 1) {
      const created = await post(addresses, 5, { traceHash: `${i.toString(16).padStart(16, "a")}` }, `device-${i.toString(16).padStart(8, "0")}`);
      expect(created.status).toBe(201);
    }
    expect((await post(addresses, 5, { traceHash: "bb".repeat(16) }, "device-overflow")).status).toBe(429);

    const likes = memoryStore();
    const created = await post(likes, 9);
    for (let i = 0; i < LIKE_DEVICE_LIMIT; i += 1) {
      const response = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), likes, 9);
      expect(response.status).toBe(200);
    }
    const blocked = await handleStrands(request("POST", `/strands/${created.body.id}/like`, { deviceKey: DEVICE }), likes, 9);
    expect(blocked.status).toBe(429);
  });

  it("rejects a missing opt-in, a lexicon hit, and any code or PII field", async () => {
    const store = memoryStore();
    expect((await post(store, 1, { optIn: false })).status).toBe(403);
    const flagged = await post(store, 1, { brief: "fetch the leaderboard" });
    expect(flagged.status).toBe(422);
    expect(flagged.body.categories).toContain("network");
    expect((await post(store, 1, { code: "<script>alert(1)</script>" })).status).toBe(400);
    expect((await post(store, 1, { email: "person@example.com" })).status).toBe(400);
    expect((await post(store, 1, { title: "Write person@example.com" })).status).toBe(400);
    const listed = await handleStrands(request("GET", `/strands?near=${briefBucket("timer stop")}`), store, 1);
    expect(await listed.json()).toEqual({ strands: [] });
    expect(await store.persisted()).not.toContain(DEVICE);
    expect(await store.persisted()).not.toContain(IP);
    expect(await store.persisted()).not.toContain("person@example.com");
    expect(await store.persisted()).not.toContain("<script>");
  });

  it("returns at most 20 strands", async () => {
    const store = memoryStore();
    const bucket = briefBucket("timer stop");
    for (let i = 0; i < LIST_LIMIT + 3; i += 1) {
      await store.insert({
        id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
        traceHash: "ab".repeat(16),
        title: `Timer ${i}`,
        ending: "SHIPPED",
        brief: "timer stop",
        signatures: [],
        lang: "en",
        bucket,
        likes: 0,
        createdAt: i,
      });
    }
    const listed = await handleStrands(request("GET", `/strands?near=${bucket}`), store, 100);
    const page = (await listed.json()) as { strands: unknown[] };
    expect(page.strands).toHaveLength(LIST_LIMIT);
  });

  it("matches Play endings and documents deploy without a secret or pgvector", () => {
    expect([...ENDING_IDS]).toEqual([...CORE_ENDINGS]);
    const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
    const schema = readFileSync(fileURLToPath(new URL("../schema.sql", import.meta.url)), "utf8");
    expect(readme).toContain("npx wrangler d1 create ledring-play-strands");
    expect(readme).toContain("npx wrangler d1 execute ledring-play-strands --remote --file=schema.sql");
    expect(readme).toContain("npx wrangler deploy");
    expect(readme).toContain("does not deploy");
    expect(readme).toContain("no pgvector");
    expect(schema.toLowerCase()).not.toMatch(/\b(email|password|ip|html|code|embedding)\b/);
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS strands");
  });
});

describe("D1 adapter", () => {
  it("writes the public columns and no address", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const statement = (sql: string): D1Prepared => {
      const values: unknown[] = [];
      const prepared: D1Prepared = {
        bind(...next: unknown[]) {
          values.push(...next);
          return prepared;
        },
        async all<T>() {
          calls.push({ sql, values: [...values] });
          return { results: [] as T[] };
        },
        async run() {
          calls.push({ sql, values: [...values] });
          return { meta: { changes: 1 } };
        },
        async first<T>() {
          calls.push({ sql, values: [...values] });
          return null as T | null;
        },
      };
      return prepared;
    };
    const db: D1Database = { prepare: statement };
    const store = createD1Store(db);
    await store.insert({
      id: "00000000-0000-4000-8000-000000000001",
      traceHash: "ab".repeat(16),
      title: "A quiet timer",
      ending: "SHIPPED",
      brief: "timer stop",
      signatures: ["loop:trust"],
      lang: "en",
      bucket: "0a",
      likes: 0,
      createdAt: 10,
    });
    const inserted = calls.find((call) => call.sql.startsWith("INSERT INTO strands"));
    expect(inserted?.sql).toContain("trace_hash");
    expect(inserted?.sql.toLowerCase()).not.toMatch(/\b(email|ip|html|code)\b/);
    expect(JSON.stringify(inserted?.values)).not.toContain(DEVICE);
    expect(JSON.stringify(inserted?.values)).not.toContain(IP);
    await store.listNear(["09", "0a", "0b"], 10, 20);
    expect(calls.some((call) => call.sql.includes("bucket IN (?, ?, ?)"))).toBe(true);
  });
});
