/** Version id recorded on every Play session. Weights are part of the contract. */
export const INSTABILITY_VERSION = "play-instability.v1" as const;

/** Signals the Play instability function reads. All counts are non-negative. */
export interface Signals {
  retries: number;
  runtimeErrors: number;
  /** Percent of lines that changed versus the previous artifact, 0–100. */
  diff: number;
  openRisks: number;
  shortcuts: number;
  apiErrors: number;
  streaming: boolean;
}

export type InstabilityLevel = "calm" | "processing" | "critical";

export function emptySignals(): Signals {
  return { retries: 0, runtimeErrors: 0, diff: 0, openRisks: 0, shortcuts: 0, apiErrors: 0, streaming: false };
}

/**
 * Play instability, 0–100.
 * `retries*12 + min(runtimeErrors,4)*9 + min(diff,100)*0.22 + openRisks*24 + shortcuts*7 + apiErrors*10 + (streaming?6:0)`.
 */
export function instability(signals: Signals): number {
  const raw =
    signals.retries * 12 +
    Math.min(signals.runtimeErrors, 4) * 9 +
    Math.min(signals.diff, 100) * 0.22 +
    signals.openRisks * 24 +
    signals.shortcuts * 7 +
    signals.apiErrors * 10 +
    (signals.streaming ? 6 : 0);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** calm < 30, processing < 60, critical otherwise. */
export function instabilityLevel(score: number): InstabilityLevel {
  if (score >= 60) return "critical";
  if (score >= 30) return "processing";
  return "calm";
}
