/** Lexical hash bucket. This is not an embedding and not pgvector. */
export function briefBucket(brief: string): string {
  const tokens = brief
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => token.length > 1);
  const text = [...new Set(tokens)].sort().join(" ");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 256).toString(16).padStart(2, "0");
}

/** The bucket plus its two neighbours, wrapping at 00 and ff. */
export function nearBuckets(bucket: string): string[] | null {
  if (!/^[0-9a-f]{2}$/i.test(bucket)) return null;
  const center = Number.parseInt(bucket, 16);
  return [center - 1, center, center + 1].map((value) => ((value + 256) % 256).toString(16).padStart(2, "0"));
}
