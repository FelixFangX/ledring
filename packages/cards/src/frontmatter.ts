/** Minimal YAML frontmatter reader: `key: value` scalars and `- item` lists. */
export function parseFrontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const cur = data[listKey];
      data[listKey] = [...(Array.isArray(cur) ? cur : []), unquote(item[1]!)];
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = kv[2] === "" ? kv[1] : undefined;
    data[kv[1]!] = kv[2] === "" ? [] : unquote(kv[2]!);
  }
  return { data, body: m[2]! };
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
