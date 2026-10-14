/** Parse JSON lines, skipping blanks and a truncated final line. */
export function jsonLines(text: string): unknown[] {
  const out: unknown[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      if (i < lines.length - 1 && lines.slice(i + 1).some((l) => l.trim())) throw e;
    }
  });
  return out;
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
