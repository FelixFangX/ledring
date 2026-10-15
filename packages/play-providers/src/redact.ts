/** Strip bearer tokens and sk- keys from a string that might be logged. */
export function redact(value: string): string {
  return value.replace(/bearer\s+\S+/gi, "bearer [redacted]").replace(/sk-[a-zA-Z0-9_-]+/g, "sk-[redacted]").slice(0, 160);
}

/** Redact known secrets first, then the generic token patterns. */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return redact(out);
}
