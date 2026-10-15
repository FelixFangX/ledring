import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LogEvent {
  id: number;
  event: string;
  data: unknown;
}

function sessionPath(dir: string, id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error("bad session id");
  return join(dir, `${id}.jsonl`);
}

/** Read a session log. A torn last line from a crash is skipped. */
export function readSessionLog(dir: string, id: string): LogEvent[] {
  let text = "";
  try {
    text = readFileSync(sessionPath(dir, id), "utf8");
  } catch {
    return [];
  }
  const events: LogEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as LogEvent;
      if (typeof parsed.id === "number" && typeof parsed.event === "string") events.push(parsed);
    } catch {
      // Incomplete line. Earlier events stay.
    }
  }
  return events;
}

export function appendSessionLog(dir: string, id: string, event: LogEvent): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(sessionPath(dir, id), `${JSON.stringify(event)}\n`);
}

export function listSessionIds(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => name.slice(0, -".jsonl".length))
      .filter((id) => /^[\w-]+$/.test(id));
  } catch {
    return [];
  }
}

export interface SessionSummary {
  id: string;
  idea: string;
  ending: string | null;
  date: string;
}

export interface PlayLogEntry {
  id: number;
  event: unknown;
}

function sessionIdOk(id: string): boolean {
  return /^[\w-]+$/.test(id);
}

function indexPath(dir: string): string {
  return join(dir, "index.json");
}

function playPath(dir: string, id: string): string {
  if (!sessionIdOk(id)) throw new Error("bad session id");
  return join(dir, "play", `${id}.jsonl`);
}

function isSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as SessionSummary;
  return sessionIdOk(row.id) && typeof row.idea === "string" && (row.ending === null || typeof row.ending === "string") && typeof row.date === "string";
}

function byRecent(a: SessionSummary, b: SessionSummary): number {
  if (a.date === b.date) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.date < b.date ? 1 : -1;
}

/** Read the session index. This does not open per-session logs. */
export function readSessionIndex(dir: string): SessionSummary[] {
  try {
    const raw = JSON.parse(readFileSync(indexPath(dir), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isSummary).sort(byRecent);
  } catch {
    return [];
  }
}

export function writeSessionIndex(dir: string, rows: readonly SessionSummary[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(indexPath(dir), `${JSON.stringify(rows)}\n`);
}

export function upsertSessionSummary(dir: string, row: SessionSummary): SessionSummary[] {
  if (!isSummary(row)) throw new Error("bad session summary");
  const next = readSessionIndex(dir).filter((item) => item.id !== row.id);
  next.push(row);
  next.sort(byRecent);
  writeSessionIndex(dir, next);
  return next;
}

export function writePlayLog(dir: string, id: string, entries: readonly PlayLogEntry[]): void {
  const path = playPath(dir, id);
  mkdirSync(join(dir, "play"), { recursive: true });
  const body = entries.map((entry) => JSON.stringify({ id: entry.id, event: entry.event })).join("\n");
  writeFileSync(path, body.length > 0 ? `${body}\n` : "");
}

/** Read one play log. A torn last line from a crash is skipped. */
export function readPlayLog(dir: string, id: string): PlayLogEntry[] {
  let text = "";
  try {
    text = readFileSync(playPath(dir, id), "utf8");
  } catch {
    return [];
  }
  const entries: PlayLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as PlayLogEntry;
      if (typeof parsed.id === "number" && parsed.event && typeof parsed.event === "object") entries.push(parsed);
    } catch {
      // Incomplete line. Earlier events stay.
    }
  }
  return entries;
}
