export const STRAND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const POST_DEVICE_LIMIT = 8;
export const POST_IP_LIMIT = 20;
export const LIKE_DEVICE_LIMIT = 30;
export const LIST_LIMIT = 20;

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
