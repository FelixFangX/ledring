/** Kept in step with @ledring/play-core ENDING_IDS. The worker does not import that package. */
export const ENDING_IDS = ["POLISHED", "SHIPPED", "BUGGY", "FAKE", "COMPROMISED", "BROKEN", "ABANDONED"] as const;
export type EndingId = (typeof ENDING_IDS)[number];
