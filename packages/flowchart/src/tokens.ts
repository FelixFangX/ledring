/**
 * Design tokens for the HTML viewer. The viewer reads *only* these CSS
 * variables (`--lr-*`), so a redesign is a tokens swap (`--tokens tokens.json`).
 * Dark is the default theme; light applies under `prefers-color-scheme: light`.
 */
export interface Tokens {
  bg: string; sunken: string; panel: string; raised: string;
  line: string; line2: string; line3: string;
  text: string; text2: string; text3: string; text4: string;
  accent: string; accentTint: string; accentGlow: string;
  calm: string; processing: string; critical: string; ok: string;
  fontSans: string; fontMono: string;
  radiusSm: string; radiusMd: string;
  ease: string; easeReveal: string;
}

export const darkTokens: Tokens = {
  bg: "#06080B", sunken: "#0A0D11", panel: "#0D1116", raised: "#121820",
  line: "rgba(255,255,255,.07)", line2: "rgba(255,255,255,.12)", line3: "rgba(255,255,255,.20)",
  text: "#E9EEF3", text2: "#9AA6B2", text3: "#5C6773", text4: "#38414B",
  accent: "#5FE3F5", accentTint: "rgba(95,227,245,.12)", accentGlow: "rgba(95,227,245,.35)",
  calm: "#4C9DFF", processing: "#F5C451", critical: "#FF5A5F", ok: "#4ADE9B",
  fontSans: "Geist, Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontMono: "'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  radiusSm: "6px", radiusMd: "10px",
  ease: "cubic-bezier(.16,1,.3,1)", easeReveal: "cubic-bezier(.65,0,.35,1)",
};

export const lightTokens: Tokens = {
  ...darkTokens,
  bg: "#F6F8FA", sunken: "#EEF1F4", panel: "#FFFFFF", raised: "#FFFFFF",
  line: "rgba(10,20,30,.08)", line2: "rgba(10,20,30,.14)", line3: "rgba(10,20,30,.24)",
  text: "#0B1117", text2: "#4A5663", text3: "#7A8692", text4: "#A9B2BB",
  accent: "#0FA3BA", accentTint: "rgba(15,163,186,.10)", accentGlow: "rgba(15,163,186,.28)",
  calm: "#2F7FE0", processing: "#C98F0A", critical: "#E0393E", ok: "#1F9D63",
};

const kebab = (k: string) => k.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);
const cssValue = (v: string) => String(v).replace(/[;{}<>]/g, "");

export function tokensToCss(t: Tokens): string {
  return Object.entries(t).map(([k, v]) => `--lr-${kebab(k)}:${cssValue(v)}`).join(";");
}

type Json = Record<string, unknown>;
const get = (o: unknown, path: string): string | undefined => {
  const v = path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Json)[k] : undefined), o);
  return typeof v === "string" ? v : undefined;
};

/**
 * Map a structured design-tokens file (`{ color: { bg: { base } }, font: { sans } … }`,
 * as produced by the LEDRING design system) onto viewer tokens. Unknown keys are ignored.
 */
export function fromDesignTokens(file: unknown): Partial<Tokens> {
  const map: [keyof Tokens, string][] = [
    ["bg", "color.bg.base"], ["sunken", "color.bg.sunken"], ["panel", "color.bg.panel"], ["raised", "color.bg.raised"],
    ["line", "color.line.1"], ["line2", "color.line.2"], ["line3", "color.line.3"],
    ["text", "color.text.1"], ["text2", "color.text.2"], ["text3", "color.text.3"], ["text4", "color.text.4"],
    ["accent", "color.accent.cyan"], ["accentTint", "color.accent.cyan-tint"], ["accentGlow", "color.accent.cyan-glow"],
    ["calm", "color.ledring.calm"], ["processing", "color.ledring.processing"], ["critical", "color.ledring.critical"], ["ok", "color.semantic.ok"],
    ["fontSans", "font.sans"], ["fontMono", "font.mono"], ["radiusSm", "radius.sm"], ["radiusMd", "radius.md"],
    ["ease", "motion.out"], ["easeReveal", "motion.path-reveal"],
  ];
  const out: Partial<Tokens> = {};
  for (const [k, p] of map) {
    const v = get(file, p);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
