export const STRAND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const POST_DEVICE_LIMIT = 8;
export const POST_IP_LIMIT = 20;
export const LIKE_DEVICE_LIMIT = 30;
export const LIST_LIMIT = 20;

/** Workers Free model checked on 2026-10-15. Not on the paid-only list. */
export const AI_MODEL = "@cf/openai/gpt-oss-120b";
/** 68,182 neurons per million output tokens. 2,048 keeps one reply near 140 neurons. */
export const AI_MAX_TOKENS = 2048;
export const AI_MAX_BODY_BYTES = 48_000;
export const AI_MAX_MESSAGES = 8;
export const AI_MAX_MESSAGE_CHARS = 16_000;
export const AI_MAX_TOTAL_CHARS = 24_000;
/** Per hashed address, per UTC day. */
export const AI_IP_DAY_LIMIT = 12;
/**
 * Shared daily cap. Forty max-size replies stay under the 10,000 neuron
 * Workers Free allocation (about 32k input neurons + 68k output neurons per million tokens).
 */
export const AI_GLOBAL_DAY_LIMIT = 40;

export const AI_FIELDS = ["model", "messages", "stream", "max_tokens", "temperature"] as const;

export const STRAND_FIELDS = [
  "traceHash",
  "title",
  "ending",
  "brief",
  "signatures",
  "lang",
  "optIn",
  "deviceKey",
] as const;

export const LIKE_FIELDS = ["deviceKey"] as const;
