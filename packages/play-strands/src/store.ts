import { STRAND_TTL_MS } from "./limits.js";

export interface Strand {
  id: string;
  traceHash: string;
  title: string;
  ending: string;
  brief: string;
  signatures: string[];
  lang: string;
  bucket: string;
  likes: number;
  createdAt: number;
}

export interface StrandStore {
  purge(now: number): Promise<void>;
  insert(strand: Strand): Promise<void>;
  listNear(buckets: readonly string[], now: number, limit: number): Promise<Strand[]>;
  get(id: string, now: number): Promise<Strand | null>;
  like(id: string, deviceHash: string, now: number): Promise<"ok" | "missing" | "duplicate">;
  takeQuota(actorHash: string, action: string, windowStart: number, limit: number): Promise<"ok" | "limited">;
  /** Every persisted string. Callers use it to prove raw keys and addresses are absent. */
  persisted(): Promise<string>;
}

function alive(strand: Strand, now: number): boolean {
  return strand.likes > 0 || strand.createdAt + STRAND_TTL_MS >= now;
}

export function memoryStore(): StrandStore {
  const strands: Strand[] = [];
  const likes = new Set<string>();
  const quotas = new Map<string, number>();
  return {
    async purge(now) {
      const doomed = new Set(strands.filter((strand) => !alive(strand, now)).map((strand) => strand.id));
      for (let i = strands.length - 1; i >= 0; i -= 1) {
        if (doomed.has(strands[i]?.id ?? "")) strands.splice(i, 1);
      }
      for (const key of likes) {
        const id = key.slice(0, key.indexOf(":"));
        if (doomed.has(id)) likes.delete(key);
      }
    },
    async insert(strand) {
      strands.push({ ...strand, signatures: [...strand.signatures], likes: 0 });
    },
    async listNear(buckets, now, limit) {
      return strands
        .filter((strand) => buckets.includes(strand.bucket) && alive(strand, now))
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((strand) => ({ ...strand, signatures: [...strand.signatures] }));
    },
    async get(id, now) {
      const strand = strands.find((item) => item.id === id && alive(item, now));
      return strand ? { ...strand, signatures: [...strand.signatures] } : null;
    },
    async like(id, deviceHash, now) {
      const strand = strands.find((item) => item.id === id && alive(item, now));
      if (!strand) return "missing";
      const key = `${id}:${deviceHash}`;
      if (likes.has(key)) return "duplicate";
      likes.add(key);
      strand.likes += 1;
      return "ok";
    },
    async takeQuota(actorHash, action, windowStart, limit) {
      const key = `${actorHash}:${action}:${windowStart}`;
      const count = quotas.get(key) ?? 0;
      if (count >= limit) return "limited";
      quotas.set(key, count + 1);
      return "ok";
    },
    async persisted() {
      return JSON.stringify({ strands, likes: [...likes], quotas: [...quotas.keys()] });
    },
  };
}
