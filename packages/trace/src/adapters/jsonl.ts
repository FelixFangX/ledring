export interface JsonlRecord {
  /** 1-based line in the source text. */
  line: number;
  value: unknown;
}

export interface JsonlRead {
  records: JsonlRecord[];
  /** A non-empty trailing line was not valid JSON, and nothing followed it. */
  truncated: boolean;
}

/** Parse JSON lines. A truncated final line is dropped and reported, not treated as a finished record. */
export function readJsonLines(text: string): JsonlRead {
  const records: JsonlRecord[] = [];
  const lines = text.split(/\r?\n/);
  let truncated = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      records.push({ line: i + 1, value: JSON.parse(t) });
    } catch (e) {
      if (i < lines.length - 1 && lines.slice(i + 1).some((l) => l.trim())) throw e;
      truncated = true;
    }
  });
  return { records, truncated };
}

/** Parse JSON lines, skipping blanks and a truncated final line. */
export function jsonLines(text: string): unknown[] {
  return readJsonLines(text).records.map((record) => record.value);
}

export function firstJson(text: string): unknown {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    const nl = t.indexOf("\n");
    try {
      return JSON.parse(nl === -1 ? t : t.slice(0, nl));
    } catch {
      return undefined;
    }
  }
}
