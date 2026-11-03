import { STRAND_TTL_MS } from "./limits.js";
import type { Strand, StrandStore } from "./store.js";

export interface D1Run {
  meta: { changes: number };
}

export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<D1Run>;
  first<T>(): Promise<T | null>;
}

export interface D1Database {
  prepare(sql: string): D1Prepared;
}

interface StrandRow {
  id: string;
  trace_hash: string;
  title: string;
  ending: string;
  brief: string;
  signatures: string;
  lang: string;
  bucket: string;
  likes: number;
  created_at: number;
}

const SELECT = `SELECT id, trace_hash, title, ending, brief, signatures, lang, bucket, likes, created_at
FROM strands
WHERE bucket IN (?, ?, ?) AND (likes > 0 OR created_at >= ?)
ORDER BY created_at DESC
LIMIT ?`;

const INSERT = `INSERT INTO strands (id, trace_hash, title, ending, brief, signatures, lang, bucket, likes, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`;

function rowToStrand(row: StrandRow): Strand {
  const signatures = JSON.parse(row.signatures) as unknown;
  return {
    id: row.id,
    traceHash: row.trace_hash,
    title: row.title,
    ending: row.ending,
    brief: row.brief,
    signatures: Array.isArray(signatures) ? signatures.filter((item): item is string => typeof item === "string") : [],
    lang: row.lang,
    bucket: row.bucket,
    likes: row.likes,
    createdAt: row.created_at,
  };
}

export function createD1Store(db: D1Database): StrandStore {
  return {
    async purge(now) {
      const cutoff = now - STRAND_TTL_MS;
      await db.prepare(`DELETE FROM strand_likes WHERE strand_id IN (SELECT id FROM strands WHERE likes = 0 AND created_at < ?)`).bind(cutoff).run();
      await db.prepare(`DELETE FROM strands WHERE likes = 0 AND created_at < ?`).bind(cutoff).run();
    },
    async insert(strand) {
      await db
        .prepare(INSERT)
        .bind(strand.id, strand.traceHash, strand.title, strand.ending, strand.brief, JSON.stringify(strand.signatures), strand.lang, strand.bucket, strand.createdAt)
        .run();
    },
    async listNear(buckets, now, limit) {
      const [a, b, c] = buckets;
      const rows = await db.prepare(SELECT).bind(a, b, c, now - STRAND_TTL_MS, limit).all<StrandRow>();
      return rows.results.map(rowToStrand);
    },
    async get(id, now) {
      const row = await db
        .prepare(
          `SELECT id, trace_hash, title, ending, brief, signatures, lang, bucket, likes, created_at
           FROM strands WHERE id = ? AND (likes > 0 OR created_at >= ?)`,
        )
        .bind(id, now - STRAND_TTL_MS)
        .first<StrandRow>();
      return row ? rowToStrand(row) : null;
    },
    async like(id, deviceHash, now) {
      const row = await db
        .prepare(`SELECT id FROM strands WHERE id = ? AND (likes > 0 OR created_at >= ?)`)
        .bind(id, now - STRAND_TTL_MS)
        .first<{ id: string }>();
      if (!row) return "missing";
      const inserted = await db
        .prepare(`INSERT OR IGNORE INTO strand_likes (strand_id, device_hash, created_at) VALUES (?, ?, ?)`)
        .bind(id, deviceHash, now)
        .run();
      if (inserted.meta.changes === 0) return "duplicate";
      await db.prepare(`UPDATE strands SET likes = likes + 1 WHERE id = ?`).bind(id).run();
      return "ok";
    },
    async takeQuota(actorHash, action, windowStart, limit) {
      const result = await db
        .prepare(
          `INSERT INTO strand_quotas (actor_hash, action, window_start, count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(actor_hash, action, window_start) DO UPDATE SET count = count + 1
           WHERE count < ?`,
        )
        .bind(actorHash, action, windowStart, limit)
        .run();
      return result.meta.changes > 0 ? "ok" : "limited";
    },
    async persisted() {
      const strands = await db.prepare(`SELECT id, trace_hash, title, ending, brief, signatures, lang, bucket, likes, created_at FROM strands`).all();
      const likes = await db.prepare(`SELECT strand_id, device_hash, created_at FROM strand_likes`).all();
      const quotas = await db.prepare(`SELECT actor_hash, action, window_start, count FROM strand_quotas`).all();
      return JSON.stringify({ strands: strands.results, likes: likes.results, quotas: quotas.results });
    },
  };
}
