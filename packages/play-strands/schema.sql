-- Lexical buckets only. D1 has no pgvector; do not add a vector column.
CREATE TABLE IF NOT EXISTS strands (
  id TEXT PRIMARY KEY,
  trace_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  ending TEXT NOT NULL,
  brief TEXT NOT NULL,
  signatures TEXT NOT NULL,
  lang TEXT NOT NULL,
  bucket TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS strands_bucket ON strands (bucket, created_at);

CREATE TABLE IF NOT EXISTS strand_likes (
  strand_id TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (strand_id, device_hash)
);

CREATE TABLE IF NOT EXISTS strand_quotas (
  actor_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (actor_hash, action, window_start)
);
