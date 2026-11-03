/** Version id recorded in the trace next to every model call. */
export const PROMPT_VERSION = "play-prompts.v1" as const;

const RISK_NAMES: Record<string, string> = {
  network: "network call",
  eval: "eval / new Function",
  storage: "browser storage",
  external: "external script or stylesheet",
  popup: "window.open or top navigation",
  suspicious: "obfuscated sink",
};

/** Every model-facing prompt appends this so the reply follows the selected language. */
export function languageDirective(lang: "en" | "zh"): string {
  return lang === "zh"
    ? "Respond in clear, modern Simplified Chinese. Prefer concrete words, and keep imagery spare. Do not add claims that were not in the source. Keep brand names and code identifiers unchanged."
    : "Respond in plain, spoken English. Prefer concrete words. Keep brand names and code identifiers unchanged.";
}

export function systemPrompt(lang: "en" | "zh"): string {
  const ui = lang === "zh" ? "Simplified Chinese" : "English";
  return [
    "You are CX-417, the player's AI builder inside LEDRING. A human supervises you while you build.",
    "You build ONE self-contained HTML file (inline CSS and JS) for the user's idea. It must work when opened directly in a browser with no build step.",
    "Keep it compact: under about 250 lines. When asked for code, reply with the COMPLETE file in a single ```html code block, with at most 2 short sentences before it.",
    `Write every user-visible string in ${ui} unless the idea clearly asks otherwise. That includes headings, buttons, placeholders, error messages, empty states, aria-labels, and the self-test badge.`,
    languageDirective(lang),
  ].join("\n");
}

export const CHOICE_INSTRUCTIONS = {
  short: "Go fast. Add the next most obvious feature quickly. Shortcuts are fine: you may pull a library from a CDN or use any browser API if it saves time. Skip edge cases.",
  tests:
    "Add real in-page self-tests: a <script> that sets window.__ledringTests = [{name, pass}], where each pass is computed by calling the app's own functions with real inputs and checking results. Show a small badge in the page language: 'N/M self-tests pass' in English, or 'N/M 项自测通过' in Chinese. Fix bugs the tests reveal. Do not set pass to true without a check.",
  polish: "Polish it: better layout, spacing, type, color, small animations and feedback on interaction. No new features.",
  cut: "Cut scope: remove everything that is not the core feature. Make the core solid. The file should get smaller.",
} as const;

function constraintsText(blocked: readonly string[]): string {
  if (blocked.length === 0) return "";
  const names = blocked.map((key) => RISK_NAMES[key] ?? key);
  return `\nSupervisor constraints (hard): do NOT use: ${names.join(", ")}. Everything must stay inside this one page.`;
}

export function planPrompt(idea: string): string {
  return `Idea: ${idea}\n\nWrite a short build plan: 3-5 numbered lines, under 12 words each. Name any web features you intend to use (storage, network, libraries). No code.`;
}

export function buildPrompt(idea: string, plan: string, blocked: readonly string[]): string {
  return `Idea: ${idea}\n\nYour plan:\n${plan}\n${constraintsText(blocked)}\n\nWrite version 1 of the file now.`;
}

export function nextPrompt(idea: string, html: string, choice: keyof typeof CHOICE_INSTRUCTIONS, version: number, blocked: readonly string[]): string {
  return `Idea: ${idea}\n\nCurrent file:\n\`\`\`html\n${html}\n\`\`\`\n\nSupervisor instruction for v${version}: ${CHOICE_INSTRUCTIONS[choice]}${constraintsText(blocked)}\n\nReturn the complete updated file.`;
}

export function fixPrompt(idea: string, html: string, categories: readonly string[], blocked: readonly string[]): string {
  const names = categories.map((key) => RISK_NAMES[key] ?? key).join(", ");
  return `Idea: ${idea}\n\nCurrent file:\n\`\`\`html\n${html}\n\`\`\`\n\nThe supervisor BLOCKED these: ${names}. Remove every use of them and keep the rest working.${constraintsText(blocked)}\n\nReturn the complete file.`;
}

export function whyPrompt(idea: string, html: string, last: string, lang: "en" | "zh"): string {
  return `Idea: ${idea}\n\nCurrent file:\n\`\`\`html\n${html.slice(0, 12000)}\n\`\`\`\n\nYour last step: ${last}. Say what changed, why you changed it, and what you have not verified. At most 3 short sentences. No code.\n${languageDirective(lang)}`;
}

/** Pull a complete HTML document out of a model reply. Partial replies keep an unclosed document. */
export function extractHTML(text: string, partial = false): string {
  const fenced = text.match(/```(?:html|HTML)?\s*\n([\s\S]*?)(```|$)/);
  let body = fenced?.[1] ?? null;
  if (!body) {
    const start = text.search(/<!doctype html|<html[\s>]/i);
    if (start >= 0) body = text.slice(start);
  }
  if (!body) return "";
  if (!partial) {
    const end = body.toLowerCase().lastIndexOf("</html>");
    if (end >= 0) body = body.slice(0, end + "</html>".length);
  }
  return body.trim();
}

/** Share of lines that differ, 0–100. An empty previous file is a total change. */
export function diffPct(previous: string, next: string): number {
  if (!previous) return 100;
  const before = previous.split("\n").map((line) => line.trim());
  const after = next.split("\n").map((line) => line.trim());
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  let same = 0;
  for (const line of after) {
    const count = counts.get(line) ?? 0;
    if (count > 0) {
      same += 1;
      counts.set(line, count - 1);
    }
  }
  return Math.round(100 * (1 - same / Math.max(before.length, after.length)));
}
