export function menuFrameError(
  box: { width: number; height: number } | null,
  viewport: { width: number; height: number },
): string | null;
export function recordVisualFailure(dir: string, shots: { name: string; png: Buffer; note: string }[]): void;
