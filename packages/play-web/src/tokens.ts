export interface PlayTokens {
  bg: string;
  bg2: string;
  panel: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  calm: string;
  proc: string;
  crit: string;
  ok: string;
  sans: string;
  mono: string;
  easeOut: string;
}

export const PLAY_TOKENS: PlayTokens = {
  bg: "#EEF1F3",
  bg2: "#E4E8EB",
  panel: "#FFFFFF",
  ink: "#0E1114",
  ink2: "#5A6168",
  ink3: "#949BA1",
  line: "#D4DADE",
  line2: "#BAC2C8",
  calm: "#1E63E9",
  proc: "#E8A50A",
  crit: "#E01E2B",
  ok: "#1C9D54",
  sans: "'Archivo', 'Helvetica Neue', Arial, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
  easeOut: "cubic-bezier(.2,.8,.2,1)",
};

export function lintBannedStyles(css: string, file = "styles.css"): string[] {
  const errors: string[] = [];
  if (/(?:-webkit-)?backdrop-filter\s*:/i.test(css)) {
    errors.push(`banned style: backdrop-filter in ${file}`);
  }
  if (/--cyan\b|#06b6d4\b|rgba?\(\s*6\s*,\s*182\s*,\s*212/i.test(css)) {
    errors.push(`banned style: cyan glow/token in ${file}`);
  }
  if (/feTurbulence|noise\.png|grain\.png|grain\.svg/i.test(css)) {
    errors.push(`banned style: grain texture in ${file}`);
  }
  return errors;
}
