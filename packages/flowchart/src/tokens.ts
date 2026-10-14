/**
 * Design tokens for the HTML viewer. The viewer reads *only* these CSS
 * variables, so a redesign is a tokens swap (`--tokens tokens.json`).
 */
export interface Tokens {
  bg: string; panel: string; line: string; text: string; textMuted: string;
  accent: string; accentGlow: string; locked: string; error: string; ok: string;
  fontSans: string; fontMono: string; radius: string;
}

export const lightTokens: Tokens = {
  bg: "#F4F7FA", panel: "#FFFFFF", line: "#D5DEE7", text: "#0E1620", textMuted: "#5B6B7C",
  accent: "#1FB6D6", accentGlow: "rgba(31,182,214,0.25)", locked: "#B8C3CE", error: "#E5383B", ok: "#2E8CFF",
  fontSans: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  radius: "2px",
};

export const darkTokens: Tokens = {
  ...lightTokens,
  bg: "#0B0F14", panel: "#121821", line: "#1F2A36", text: "#E8EEF4", textMuted: "#8A9AAB",
  accent: "#3CD3F0", accentGlow: "rgba(60,211,240,0.35)", locked: "#3A4654", error: "#FF4D50", ok: "#4DA3FF",
};

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const cssValue = (v: string) => v.replace(/[;{}<>]/g, "");

export function tokensToCss(t: Tokens): string {
  return Object.entries(t).map(([k, v]) => `--lr-${kebab(k)}:${cssValue(v)}`).join(";");
}
