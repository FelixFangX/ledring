import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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
