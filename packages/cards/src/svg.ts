import { darkTokens, type Tokens } from "@ledring/flowchart";
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

/** Render a self-contained, offline-safe SVG spec card (no external fonts or images). */
export function renderCardSvg(card: AgentCard, opts: { tokens?: Partial<Tokens> } = {}): string {
  const t = { ...darkTokens, ...opts.tokens };
  const ext = card.capabilities.extensions.find((e) => e.uri === PERMISSIONS_EXTENSION)?.params;
  const W = 640;
  const P = 28;
  let y = P;
  const parts: string[] = [];
  const mono = `font-family="${esc(t.fontMono)}"`;
  const sans = `font-family="${esc(t.fontSans)}"`;

  parts.push(`<text x="${P}" y="${(y += 12)}" ${mono} font-size="11" letter-spacing="1.5" fill="${t.text3}">AGENT SPEC · A2A ${esc(card.version)}</text>`);
  parts.push(`<circle cx="${W - P - 4}" cy="${y - 4}" r="4" fill="${t.accent}"/>`);
  parts.push(`<text x="${P}" y="${(y += 34)}" ${sans} font-size="24" font-weight="600" fill="${t.text}">${esc(card.name)}</text>`);
  y += 8;
  for (const line of wrap(card.description, 78, 3)) parts.push(`<text x="${P}" y="${(y += 20)}" ${sans} font-size="13" fill="${t.text2}">${esc(line)}</text>`);

  const section = (label: string) => {
    y += 26;
    parts.push(`<line x1="${P}" x2="${W - P}" y1="${y}" y2="${y}" stroke="${t.line2}"/>`);
    parts.push(`<text x="${P}" y="${(y += 22)}" ${mono} font-size="10" letter-spacing="1.5" fill="${t.text3}">${label}</text>`);
  };
  const chips = (items: string[], color: string) => {
    let x = P;
    y += 12;
    for (const item of items) {
      const w = item.length * 7 + 16;
      if (x + w > W - P) { x = P; y += 30; }
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="22" rx="5" fill="none" stroke="${color}" stroke-opacity=".5"/>`);
      parts.push(`<text x="${x + 8}" y="${y + 15}" ${mono} font-size="11.5" fill="${color}">${esc(item)}</text>`);
      x += w + 8;
    }
    y += 22;
  };

  if (card.skills.length) {
    section(`SKILLS · ${card.skills.length}`);
    for (const s of card.skills) {
      parts.push(`<text x="${P}" y="${(y += 22)}" ${sans} font-size="13" font-weight="600" fill="${t.text}">${esc(s.name)}</text>`);
      parts.push(`<text x="${P + 200}" y="${y}" ${sans} font-size="12" fill="${t.text2}">${esc(wrap(s.description, 52, 1)[0] ?? "")}</text>`);
    }
  }
  if (ext) {
    section(`TOOLS · ${ext.tools.length || "all"}${ext.model ? ` · MODEL ${esc(ext.model.toUpperCase())}` : ""}`);
    chips(ext.tools.length ? ext.tools : ["inherits all tools"], t.accent);
    const { allow, ask, deny } = ext.permissions;
    if (allow.length + ask.length + deny.length) {
      section(`PERMISSIONS · ${allow.length} ALLOW · ${ask.length} ASK · ${deny.length} DENY`);
      for (const [rules, color, k] of [[allow, t.ok, "allow"], [ask, t.processing, "ask"], [deny, t.critical, "deny"]] as const)
        for (const r of rules) {
          parts.push(`<text x="${P}" y="${(y += 20)}" ${mono} font-size="11" fill="${color}">${k}</text>`);
          parts.push(`<text x="${P + 52}" y="${y}" ${mono} font-size="12" fill="${t.text}">${esc(r)}</text>`);
        }
    }
    if (ext.mcpServers.length) {
      section(`MCP SERVERS · ${ext.mcpServers.length}`);
      chips(ext.mcpServers.map((s) => `${s.name} · ${s.transport}`), t.text2);
    }
  }
  y += P;
  parts.push(`<text x="${W - P}" y="${y - 10}" text-anchor="end" ${mono} font-size="10" fill="${t.text4}">ledring card</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" role="img" aria-label="${esc(card.name)} agent spec card">
<rect x=".5" y=".5" width="${W - 1}" height="${y - 1}" rx="12" fill="${t.panel}" stroke="${t.line2}"/>
<rect x="0" y="0" width="3" height="${y}" rx="1.5" fill="${t.accent}"/>
${parts.join("\n")}
</svg>
`;
}
