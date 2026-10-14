import { paperTokens, type Tokens } from "@ledring/flowchart";
import { PERMISSIONS_EXTENSION, type AgentCard } from "./card.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && out.join(" ").length < text.length) out[lines - 1] = out[lines - 1]!.replace(/.{0,1}$/, "…");
  return out;
}

/** Render a self-contained, offline-safe SVG spec plate (system font fallbacks, no external fonts or images). */
export function renderCardSvg(card: AgentCard, opts: { tokens?: Partial<Tokens> } = {}): string {
  const t = { ...paperTokens, ...opts.tokens };
  const ext = card.capabilities.extensions.find((e) => e.uri === PERMISSIONS_EXTENSION)?.params;
  const W = 640;
  const P = 24;
  const parts: string[] = [];
  const mono = `font-family="${esc(t.fontMono)}"`;
  const sans = `font-family="${esc(t.fontSans)}"`;
  const disp = `font-family="${esc(t.fontDisplay)}"`;
  const rule = (yy: number, strong = false) => parts.push(`<line x1="0" x2="${W}" y1="${yy}" y2="${yy}" stroke="${strong ? t.line3 : t.line2}"/>`);

  // Top bar: maker, document type, status ring.
  parts.push(`<text x="${P}" y="25" ${mono} font-size="11" fill="${t.text}"><tspan font-weight="600">ledring</tspan><tspan fill="${t.text2}"> · agent spec plate · A2A ${esc(card.version)}</tspan></text>`);
  parts.push(`<circle cx="${W - P - 6}" cy="21" r="5.5" fill="none" stroke="${t.calm}" stroke-width="3"/>`);
  rule(40, true);
  let y = 40;
  parts.push(`<text x="${P}" y="${(y += 52)}" ${disp} font-size="44" font-weight="700" letter-spacing="-1" fill="${t.text}">${esc(card.name)}</text>`);
  y += 6;
  for (const line of wrap(card.description, 78, 3)) parts.push(`<text x="${P}" y="${(y += 19)}" ${sans} font-size="13" fill="${t.text2}">${esc(line)}</text>`);

  const section = (label: string) => {
    y += 22;
    rule(y, true);
    parts.push(`<text x="${P}" y="${(y += 20)}" ${mono} font-size="10.5" fill="${t.text2}">${label.toLowerCase().replace(/ · model (.+)$/, (_, m: string) => ` · model ${m.toUpperCase()}`)}</text>`);
  };
  const row = (k: string, v: string, kc = t.text2, vfont = mono) => {
    y += 24;
    parts.push(`<text x="${P}" y="${y}" ${mono} font-size="11" fill="${kc}">${esc(k)}</text>`);
    parts.push(`<text x="${P + 110}" y="${y}" ${vfont} font-size="12" fill="${t.text}">${esc(v)}</text>`);
    parts.push(`<line x1="${P}" x2="${W - P}" y1="${y + 9}" y2="${y + 9}" stroke="${t.line}"/>`);
  };
  const chips = (items: string[]) => {
    let x = P;
    y += 12;
    for (const item of items) {
      const w = item.length * 7 + 14;
      if (x + w > W - P) { x = P; y += 30; }
      parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w}" height="22" fill="${t.panel}" stroke="${t.line3}"/>`);
      parts.push(`<text x="${x + 7}" y="${y + 15}" ${mono} font-size="11.5" fill="${t.text}">${esc(item)}</text>`);
      x += w + 6;
    }
    y += 22;
  };

  if (card.skills.length) {
    section(`SKILLS · ${card.skills.length}`);
    for (const s of card.skills) {
      parts.push(`<text x="${P}" y="${(y += 24)}" ${mono} font-size="11.5" font-weight="600" fill="${t.text}">${esc(s.name)}</text>`);
      parts.push(`<text x="${P}" y="${(y += 17)}" ${sans} font-size="12" fill="${t.text2}">${esc(wrap(s.description, 84, 1)[0] ?? "")}</text>`);
      parts.push(`<line x1="${P}" x2="${W - P}" y1="${y + 9}" y2="${y + 9}" stroke="${t.line}"/>`);
    }
  }
  if (ext) {
    section(`TOOLS · ${ext.tools.length || "all"}${ext.model ? ` · MODEL ${esc(ext.model.toUpperCase())}` : ""}`);
    chips(ext.tools.length ? ext.tools : ["inherits all tools"]);
    const { allow, ask, deny } = ext.permissions;
    if (allow.length + ask.length + deny.length) {
      section(`PERMISSIONS · ${allow.length} ALLOW · ${ask.length} ASK · ${deny.length} DENY`);
      for (const [rules, color, k] of [[allow, t.calm, "allow"], [ask, t.processing, "ask"], [deny, t.critical, "deny"]] as const)
        for (const r of rules) row(k, r, color);
    }
    if (ext.mcpServers.length) {
      section(`MCP SERVERS · ${ext.mcpServers.length}`);
      chips(ext.mcpServers.map((s) => `${s.name} · ${s.transport}`));
    }
  }
  y += 22;
  rule(y, true);
  parts.push(`<text x="${P}" y="${y + 20}" ${mono} font-size="10" fill="${t.text2}">static derivation · unsigned</text>`);
  parts.push(`<text x="${W - P}" y="${y + 20}" text-anchor="end" ${mono} font-size="10" fill="${t.text2}">ledring card</text>`);
  y += 32;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" role="img" aria-label="${esc(card.name)} agent spec card">
<rect x=".5" y=".5" width="${W - 1}" height="${y - 1}" fill="${t.panel}" stroke="${t.line3}"/>
${parts.join("\n")}
</svg>
`;
}
