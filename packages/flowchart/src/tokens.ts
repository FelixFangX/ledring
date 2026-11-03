/**
 * Design tokens for the HTML viewer. The viewer reads *only* these CSS
 * variables (`--lr-*`), so a redesign is a tokens swap (`--tokens tokens.json`).
 * The default theme is "Catalogue no. 417": warm paper, ink, printed 1px rules,
 * and the status-ring colours as the only colour. An ink-on-black variant
 * applies under `prefers-color-scheme: dark`.
 */
export interface Tokens {
  bg: string; sunken: string; panel: string; raised: string;
  line: string; line2: string; line3: string;
  text: string; text2: string; text3: string; text4: string;
  accent: string; accentTint: string; accentGlow: string;
  calm: string; processing: string; critical: string; ok: string;
  fontSans: string; fontMono: string; fontDisplay: string;
  radiusSm: string; radiusMd: string;
  ease: string; easeReveal: string;
}

/** Default theme: paper and ink. System fonts only, so reports stay offline-safe. */
export const paperTokens: Tokens = {
  bg: "#F3F2EE", sunken: "#ECEAE4", panel: "#FBFAF7", raised: "#FFFFFF",
  line: "#E3E1DA", line2: "#CFCDC6", line3: "#16181A",
  text: "#16181A", text2: "#6B6E70", text3: "#8C8E8A", text4: "#A3A49F",
  accent: "#16181A", accentTint: "rgba(22,24,26,.06)", accentGlow: "rgba(47,91,234,.45)",
  calm: "#2F5BEA", processing: "#E8B10A", critical: "#D7261E", ok: "#2F7A3E",
  fontSans: "'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontMono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  fontDisplay: "Archivo, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  radiusSm: "0", radiusMd: "0",
  ease: "cubic-bezier(.2,1,.3,1)", easeReveal: "linear",
};

/** Ink variant for dark colour schemes: the same catalogue, printed in reverse. */
export const darkTokens: Tokens = {
  ...paperTokens,
  bg: "#111213", sunken: "#0B0C0D", panel: "#18191B", raised: "#1E2022",
  line: "#26282B", line2: "#3A3D40", line3: "#E9E7E1",
  text: "#E9E7E1", text2: "#A3A49F", text3: "#7C7E7B", text4: "#55585A",
  accent: "#E9E7E1", accentTint: "rgba(233,231,225,.06)", accentGlow: "rgba(90,130,255,.5)",
  calm: "#5A82FF", processing: "#F0BE2A", critical: "#F0473E", ok: "#5BB06C",
};

/** @deprecated The paper theme is now the default; kept as an alias. */
export const lightTokens: Tokens = paperTokens;

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
  const map: [keyof Tokens, ...string[]][] = [
    ["bg", "color.bg.base"], ["sunken", "color.bg.sunken"], ["panel", "color.bg.panel"], ["raised", "color.bg.raised"],
    ["line", "color.line.1"], ["line2", "color.line.2"], ["line3", "color.line.3"],
    ["text", "color.text.1"], ["text2", "color.text.2"], ["text3", "color.text.3"], ["text4", "color.text.4"],
    ["accent", "color.accent.ink", "color.accent.cyan"], ["accentTint", "color.accent.ink-tint", "color.accent.cyan-tint"], ["accentGlow", "color.accent.ink-glow", "color.accent.cyan-glow"],
    ["calm", "color.ledring.calm"], ["processing", "color.ledring.processing"], ["critical", "color.ledring.critical"], ["ok", "color.semantic.ok"],
    ["fontSans", "font.sans"], ["fontMono", "font.mono"], ["fontDisplay", "font.display"], ["radiusSm", "radius.sm"], ["radiusMd", "radius.md"],
    ["ease", "motion.out"], ["easeReveal", "motion.path-reveal"],
  ];
  const out: Partial<Tokens> = {};
  for (const [k, ...paths] of map) {
    const v = paths.map((p) => get(file, p)).find((x) => x !== undefined);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
