import { pct, type BranchNode, type BranchTree } from "./tree.js";
import { darkTokens, lightTokens, tokensToCss, type Tokens } from "./tokens.js";

export interface RenderOptions {
  title?: string;
  /** Run whose path is lit. Defaults to the first run. */
  highlightRunId?: string;
  /** Override the default (dark) theme tokens. */
  tokens?: Partial<Tokens>;
  /** Override the light theme tokens (used under `prefers-color-scheme: light`). */
  lightTokens?: Partial<Tokens>;
}

const COL = 200, ROW = 66, W = 164, H = 44, PAD = 28;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n = 19) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Placed { n: BranchNode; x: number; y: number }

function layout(root: BranchNode): Placed[] {
  const out: Placed[] = [];
  let leaf = 0;
  const walk = (n: BranchNode): number => {
    let y: number;
    if (n.children.length === 0) y = leaf++ * ROW;
    else {
      const ys = n.children.map(walk);
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    out.push({ n, x: n.depth * COL, y });
    return y;
  };
  walk(root);
  return out.sort((a, b) => a.n.depth - b.n.depth || a.y - b.y);
}

/** Render a branch tree to a single self-contained HTML document (no network). */
export function renderHtml(tree: BranchTree, opts: RenderOptions = {}): string {
  const placed = layout(tree.root);
  const at = new Map(placed.map((p) => [p.n.id, p]));
  const hl = tree.runs.find((r) => r.id === opts.highlightRunId) ?? tree.runs[0]!;
  if (opts.highlightRunId && hl.id !== opts.highlightRunId) throw new Error(`No run "${opts.highlightRunId}" in tree.`);
  const taken = new Set(hl.path);
  const width = Math.max(...placed.map((p) => p.x)) + W + PAD * 2;
  const height = Math.max(...placed.map((p) => p.y)) + H + PAD * 2;
  const forks = placed.filter((p) => p.n.children.length > 1).length;
  const errored = placed.reduce((a, p) => a + p.n.errors, 0);

  const base: string[] = [], lit: string[] = [], pills: string[] = [], nodes: string[] = [];
  for (const p of placed) {
    p.n.children.forEach((c) => {
      const q = at.get(c.id)!;
      const x1 = p.x + W + PAD, y1 = p.y + H / 2 + PAD, x2 = q.x + PAD, y2 = q.y + H / 2 + PAD, mx = (x1 + x2) / 2;
      const d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
      const on = taken.has(c.id) && taken.has(p.n.id);
      base.push(`<path class="e" d="${d}"/>`);
      lit.push(`<path class="e-lit${on ? " on" : ""}${c.errors > 0 ? " bad" : ""}" data-to="${c.id}" style="--i:${c.depth}" pathLength="1" d="${d}"/>`);
      if (p.n.children.length > 1 || p.n.id === "0") {
        const label = pct(c.share), w = label.length * 6.4 + 12, cx = mx, cy = (y1 + y2) / 2;
        pills.push(`<g class="pill${on ? " on" : ""}" data-to="${c.id}"><rect x="${cx - w / 2}" y="${cy - 9}" width="${w}" height="18" rx="9"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle">${label}</text></g>`);
      }
    });
    const cls = ["n", taken.has(p.n.id) ? "taken" : "locked", p.n.errors > 0 ? "error" : ""].filter(Boolean).join(" ");
    const kind = p.n.id === "0" ? "start" : p.n.children.length === 0 ? `${p.n.kind} · end` : p.n.kind;
    const meta = p.n.errors > 0 ? `${p.n.errors} err` : `${p.n.count}/${tree.runCount}`;
    nodes.push(`<g class="${cls}" data-id="${p.n.id}" tabindex="0" style="--i:${p.n.depth}" transform="translate(${p.x + PAD} ${p.y + PAD})"><title>${esc(p.n.signature)} — ${p.n.count}/${tree.runCount} runs</title><rect class="halo" x="-3" y="-3" width="${W + 6}" height="${H + 6}" rx="9"/><rect class="b" width="${W}" height="${H}" rx="6"/><circle class="dot" cx="14" cy="${H / 2}" r="3"/><text class="k" x="26" y="17">${esc(kind.toUpperCase())}</text><text class="t" x="26" y="32">${esc(clip(p.n.signature))}</text><text class="m" x="${W - 10}" y="17" text-anchor="end">${meta}</text></g>`);
  }

  const data = JSON.stringify({ runs: tree.runs, nodes: placed.map((p) => ({ id: p.n.id, signature: p.n.signature, kind: p.n.kind, count: p.n.count, share: p.n.share, errors: p.n.errors, ends: p.n.ends, outcomes: p.n.outcomes })) }).replace(/</g, "\\u003c");
  const dark = { ...darkTokens, ...opts.tokens };
  const light = { ...lightTokens, ...opts.lightTokens };
  const title = opts.title ?? "Branch replay";
  const runOptions = tree.runs.map((r) => `<option value="${esc(r.id)}"${r.id === hl.id ? " selected" : ""}>${esc(clip(r.id, 44))} · ${esc(r.outcome)}</option>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="ledring"><meta name="color-scheme" content="dark light">
<title>${esc(title)} — LEDRING</title>
<style>
:root{${tokensToCss(dark)}}
@media (prefers-color-scheme:light){:root{${tokensToCss(light)}}}
*{box-sizing:border-box;margin:0}
body{background:radial-gradient(900px 520px at 78% -8%,var(--lr-accent-tint),transparent 70%),var(--lr-bg);color:var(--lr-text);font:13px/1.55 var(--lr-font-sans);letter-spacing:-.003em;padding:32px;min-height:100vh;-webkit-font-smoothing:antialiased}
.mono,.lbl,select,.kv{font-family:var(--lr-font-mono);font-variant-numeric:tabular-nums}
.lbl{font-size:10.5px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;color:var(--lr-text-3)}
.brk{color:var(--lr-accent)}
header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.ring{width:14px;height:14px;border-radius:50%;border:2px solid var(--lr-accent);box-shadow:0 0 12px var(--lr-accent-glow)}
.brand{font:600 12px var(--lr-font-mono);letter-spacing:.24em}
.sep{color:var(--lr-text-4)}
h1{font-size:24px;font-weight:600;letter-spacing:-.025em;margin:6px 0 8px}
.instr{color:var(--lr-text-2);max-width:760px}
.kpis{display:flex;gap:24px;margin:20px 0 24px}
.kpi b{display:block;font:500 22px var(--lr-font-mono);letter-spacing:-.04em;color:var(--lr-text)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;align-items:start}
.panel{background:var(--lr-panel);border:1px solid var(--lr-line);border-radius:var(--lr-radius-md);box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 1px 2px rgba(0,0,0,.35)}
.canvas{overflow:auto;background:radial-gradient(circle at 1px 1px,var(--lr-line) 1px,transparent 0) 0 0/20px 20px,var(--lr-sunken)}
.canvas svg{display:block;max-width:100%;height:auto}
aside{padding:16px}
select{width:100%;margin-top:8px;font-size:11.5px;background:var(--lr-raised);color:var(--lr-text);border:1px solid var(--lr-line-2);border-radius:var(--lr-radius-sm);padding:7px 8px}
select:focus-visible,.n:focus-visible{outline:none;box-shadow:0 0 0 2px var(--lr-accent-glow)}
.e{fill:none;stroke:var(--lr-line-2);stroke-width:1;stroke-dasharray:2 4}
.e-lit{fill:none;stroke:var(--lr-accent);stroke-width:1.5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;opacity:0;filter:drop-shadow(0 0 4px var(--lr-accent-glow))}
.e-lit.on{opacity:1;animation:reveal .7s var(--lr-ease-reveal) forwards;animation-delay:calc(var(--i) * 110ms)}
.e-lit.bad{stroke:var(--lr-critical)}
@keyframes reveal{to{stroke-dashoffset:0}}
.pill rect{fill:var(--lr-sunken);stroke:var(--lr-line-2)}
.pill text{font:500 10px var(--lr-font-mono);fill:var(--lr-text-3)}
.pill.on rect{stroke:var(--lr-accent);fill:var(--lr-panel)}.pill.on text{fill:var(--lr-accent)}
.n{cursor:pointer;outline:none;animation:enter .45s var(--lr-ease) both;animation-delay:calc(var(--i) * 55ms)}
@keyframes enter{from{opacity:0;filter:blur(3px)}}
.n .b{fill:var(--lr-panel);stroke:var(--lr-line-2);stroke-width:1;transition:stroke .2s,fill .2s}
.n .halo{fill:none;stroke:var(--lr-accent);opacity:0;transition:opacity .2s}
.n .dot{fill:var(--lr-text-4)}
.n .k{font:500 8.5px var(--lr-font-mono);letter-spacing:.1em;fill:var(--lr-text-4)}
.n .t{font:500 11.5px var(--lr-font-mono);fill:var(--lr-text-3)}
.n .m{font:500 9px var(--lr-font-mono);fill:var(--lr-text-4)}
.n.taken .b{stroke:var(--lr-accent);fill:var(--lr-raised)}
.n.taken .dot{fill:var(--lr-accent)}.n.taken .k{fill:var(--lr-accent)}.n.taken .t{fill:var(--lr-text)}.n.taken .m{fill:var(--lr-text-2)}
.n.locked .b{stroke-dasharray:3 3;fill:transparent}
.n.error .dot{fill:var(--lr-critical)}.n.error .m{fill:var(--lr-critical)}
.n.error.taken .b{stroke:var(--lr-critical)}
.n:hover .b{stroke:var(--lr-line-3)}.n.taken:hover .b{stroke:var(--lr-accent)}
.n.sel .halo{opacity:.35}
.kv{display:grid;grid-template-columns:84px 1fr;gap:8px 12px;font-size:11.5px;margin-top:12px;word-break:break-word}
.kv b{font-weight:400;color:var(--lr-text-3)}.kv span{color:var(--lr-text)}
.empty{color:var(--lr-text-3);margin-top:12px}
.legend{display:flex;gap:16px;padding:10px 14px;border-top:1px solid var(--lr-line);font:500 10.5px var(--lr-font-mono);color:var(--lr-text-3);background:var(--lr-panel)}
.legend span{display:flex;align-items:center;gap:6px}
.legend i{width:14px;border-top:1.5px solid var(--lr-accent)}.legend .l2 i{border-top:1px dashed var(--lr-text-3)}.legend .l3 i{border-color:var(--lr-critical)}
footer{margin-top:20px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.e-lit.on{stroke-dashoffset:0}}
@media (max-width:900px){.layout{grid-template-columns:1fr}}
</style></head><body>
<header><span class="ring"></span><span class="brand">LEDRING</span><span class="sep">/</span><span class="lbl">flowchart</span></header>
<div class="lbl"><span class="brk">[</span> branch replay · ledring.branch-tree.v1 <span class="brk">]</span></div>
<h1>${esc(title)}</h1>
${tree.instruction ? `<p class="instr">“${esc(tree.instruction)}”</p>` : ""}
<div class="kpis"><div class="kpi"><span class="lbl">runs</span><b>${tree.runCount}</b></div><div class="kpi"><span class="lbl">forks</span><b>${forks}</b></div><div class="kpi"><span class="lbl">errored steps</span><b>${errored}</b></div></div>
<div class="layout">
<div class="panel" style="overflow:hidden"><div class="canvas"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Branch tree">${base.join("")}${lit.join("")}${pills.join("")}${nodes.join("")}</svg></div>
<div class="legend"><span><i></i>taken path</span><span class="l2"><i></i>locked · other runs</span><span class="l3"><i></i>errored step</span></div></div>
<aside class="panel"><div class="lbl">highlighted run</div><select id="run" aria-label="Highlighted run">${runOptions}</select>
<div class="lbl" style="margin-top:20px">node</div><div id="info"><p class="empty">Select a node to inspect it.</p></div></aside>
</div>
<footer class="lbl">generated by ledring · self-contained · works offline</footer>
<script type="application/json" id="lr-data">${data}</script>
<script>
(function(){var d=JSON.parse(document.getElementById("lr-data").textContent);
var byId={};d.nodes.forEach(function(n){byId[n.id]=n});
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function light(id){var r=d.runs.find(function(x){return x.id===id});if(!r)return;var t={};r.path.forEach(function(p){t[p]=1});
document.querySelectorAll(".n").forEach(function(g){var on=!!t[g.dataset.id];g.classList.toggle("taken",on);g.classList.toggle("locked",!on)});
document.querySelectorAll("[data-to]").forEach(function(e){var to=e.dataset.to,from=to.slice(0,to.lastIndexOf(".")),on=!!(t[to]&&t[from]);
if(e.classList.contains("e-lit")){e.classList.remove("on");void e.getBoundingClientRect();}e.classList.toggle("on",on)})}
function show(id){var n=byId[id];document.querySelectorAll(".n.sel").forEach(function(g){g.classList.remove("sel")});var g=document.querySelector('.n[data-id="'+id+'"]');g&&g.classList.add("sel");
document.getElementById("info").innerHTML='<div class="kv"><b>signature</b><span>'+esc(n.signature)+"</span><b>kind</b><span>"+esc(n.kind)+"</span><b>runs</b><span>"+n.count+" / "+d.runs.length+"</span><b>divergence</b><span>"+Math.round(n.share*100)+"% of parent</span><b>errors</b><span>"+n.errors+"</span><b>ended here</b><span>"+n.ends+"</span><b>outcomes</b><span>"+n.outcomes.success+" ok · "+n.outcomes.failure+" fail · "+n.outcomes.unknown+" ?</span></div>"}
document.getElementById("run").addEventListener("change",function(e){light(e.target.value)});
document.querySelectorAll(".n").forEach(function(g){g.addEventListener("click",function(){show(g.dataset.id)});g.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();show(g.dataset.id)}})});
})();
</script>
</body></html>
`;
}
