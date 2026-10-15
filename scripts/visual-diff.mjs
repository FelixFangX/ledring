// Writes play-visual-diff/ when a scaffold frame check fails. CI uploads that directory.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {{ width: number, height: number } | null} box
 * @param {{ width: number, height: number }} viewport
 */
export function menuFrameError(box, viewport) {
  if (!box) return `${viewport.width}x${viewport.height} menu has no box`;
  if (viewport.width >= 1000) {
    if (box.width < 600 || box.height < 400) return `desktop menu ${Math.round(box.width)}x${Math.round(box.height)}`;
    return null;
  }
  if (box.width < 300 || box.width > viewport.width + 1 || box.height < 400) {
    return `narrow menu ${Math.round(box.width)}x${Math.round(box.height)} at ${viewport.width}px`;
  }
  return null;
}

/** @param {string} dir @param {{ name: string, png: Buffer, note: string }[]} shots */
export function recordVisualFailure(dir, shots) {
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const shot of shots) {
    writeFileSync(join(dir, `${shot.name}.png`), shot.png);
    lines.push(`${shot.name}: ${shot.note}`);
  }
  writeFileSync(join(dir, "diff.txt"), `${lines.join("\n")}\n`);
}
