import { pct, type BranchNode, type BranchTree } from "./tree.js";
import { darkTokens, lightTokens, tokensToCss, type Tokens } from "./tokens.js";

export interface RenderOptions {
  title?: string;
  /** Run whose path is lit. Defaults to the first run. */
  highlightRunId?: string;
  /** Override light-theme tokens (e.g. from a tokens.json). */
  tokens?: Partial<Tokens>;
  /** Override dark-theme tokens. */
  darkTokens?: Partial<Tokens>;
}

const COL = 210, ROW = 64, NODE_W = 168, NODE_H = 34, PAD = 24;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Placed { n: BranchNode; x: number; y: number }

function layout(root: BranchNode): Placed[] {
  const out: Placed[] = [];
  let leaf = 0;
  const walk = (n: BranchNode): number => {
    const y = n.children.length === 0 ? leaf++ * ROW : (() => { const ys = n.children.map(walk); return (ys[0]! + ys[ys.length - 1]!) / 2; })();
    out.push({ n, x: n.depth * COL, y });
    return y;
  };
  walk(root);
  return out;
}

/** Render a branch tree to a single self-contained HTML document (no network). */
export function renderHtml(tree: BranchTree, opts: RenderOptions = {}): string {
  const placed = layout(tree.root);
  const at = new Map(placed.map((p) => [p.n.id, p]));
  const hl = tree.runs.find((r) => r.id === opts.highlightRunId) ?? tree.runs[0]!;
  if (opts.highlightRunId && hl.id !== opts.highlightRunId) throw new Error(`No run "${opts.highlightRunId}" in tree.`);
  const taken = new Set(hl.path);
  const width = Math.max(...placed.map((p) => p.x)) + NODE_W + PAD * 2 + 40;
  const height = Math.max(...placed.map((p) => p.y)) + NODE_H + PAD * 2;

  const edges: string[] = [];
  const nodes: string[] = [];
  for (const p of placed) {
    for (const c of p.n.children) {
      const q = at.get(c.id)!;
      const x1 = p.x + NODE_W + PAD, y1 = p.y + NODE_H / 2 + PAD, x2 = q.x + PAD, y2 = q.y + NODE_H / 2 + PAD, mx = (x1 + x2) / 2;
      const on = taken.has(c.id) && taken.has(p.n.id);
      edges.push(`<path class="e${on ? " taken" : ""}" data-to="${c.id}" d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`);
      if (p.n.children.length > 1 || p.n.id === "0") edges.push(`<text class="pct${on ? " taken" : ""}" data-to="${c.id}" x="${mx}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle">${pct(c.share)}</text>`);
    }
    const cls = ["n", taken.has(p.n.id) ? "taken" : "locked", p.n.errors > 0 ? "error" : ""].filter(Boolean).join(" ");
    const badge = p.n.errors > 0 ? `<text class="badge err" x="${NODE_W - 8}" y="${NODE_H / 2 + 4}" text-anchor="end">${p.n.errors}✗</text>` : p.n.ends > 0 && p.n.children.length > 0 ? `<text class="badge" x="${NODE_W - 8}" y="${NODE_H / 2 + 4}" text-anchor="end">■${p.n.ends}</text>` : "";
    nodes.push(`<g class="${cls}" data-id="${p.n.id}" tabindex="0" transform="translate(${p.x + PAD} ${p.y + PAD})"><title>${esc(p.n.signature)} — ${p.n.count}/${tree.runCount} runs</title><rect width="${NODE_W}" height="${NODE_H}" rx="2"/><text x="10" y="${NODE_H / 2 + 4}">${esc(clip(p.n.signature))}</text>${badge}</g>`);
  }

  const data = JSON.stringify({ runs: tree.runs, nodes: placed.map((p) => ({ id: p.n.id, signature: p.n.signature, count: p.n.count, share: p.n.share, errors: p.n.errors, ends: p.n.ends, outcomes: p.n.outcomes })) }).replace(/</g, "\\u003c");
  const light = { ...lightTokens, ...opts.tokens };
  const dark = { ...darkTokens, ...opts.darkTokens };
  const title = opts.title ?? "Branch replay";
  const runOptions = tree.runs.map((r) => `<option value="${esc(r.id)}"${r.id === hl.id ? " selected" : ""}>${esc(clip(r.id, 48))} · ${esc(r.outcome)}</option>`).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="ledring">
<title>${esc(title)} — LEDRING</title>
<style>
:root{${tokensToCss(light)}}
@media (prefers-color-scheme:dark){:root{${tokensToCss(dark)}}}
*{box-sizing:border-box;margin:0}
body{background:var(--lr-bg);color:var(--lr-text);font:14px/1.5 var(--lr-font-sans);padding:24px}
header{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:18px;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
.lbl{font:500 11px var(--lr-font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--lr-text-muted)}
.mono{font-family:var(--lr-font-mono)}
.layout{display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start}
.panel{background:var(--lr-panel);border:1px solid var(--lr-line);border-radius:var(--lr-radius);padding:16px}
.canvas{overflow:auto}
select{font:12px var(--lr-font-mono);background:var(--lr-panel);color:var(--lr-text);border:1px solid var(--lr-line);border-radius:var(--lr-radius);padding:4px 6px;max-width:100%}
.e{fill:none;stroke:var(--lr-locked);stroke-width:1.5;stroke-dasharray:5 4}
.e.taken{stroke:var(--lr-accent);stroke-width:2.5;stroke-dasharray:none}
.pct{font:600 11px var(--lr-font-mono);fill:var(--lr-text-muted)}
.pct.taken{fill:var(--lr-accent)}
.n{cursor:pointer;outline:none}
.n rect{fill:var(--lr-panel);stroke:var(--lr-line);stroke-width:1.2}
.n text{font:500 12px var(--lr-font-mono);fill:var(--lr-text-muted)}
.n.taken rect{stroke:var(--lr-accent);stroke-width:2;filter:drop-shadow(0 0 6px var(--lr-accent-glow))}
.n.taken text{fill:var(--lr-text)}
.n.locked rect{stroke-dasharray:4 3;fill:transparent}
.n.error rect{stroke:var(--lr-error)}
.n:focus rect,.n.sel rect{stroke-width:3}
.badge{font-size:10px!important}.badge.err{fill:var(--lr-error)!important}
.kv{display:grid;grid-template-columns:90px 1fr;gap:4px 10px;font:12px var(--lr-font-mono);margin-top:10px;word-break:break-word}
.kv b{font-weight:400;color:var(--lr-text-muted)}
.legend{display:flex;gap:16px;margin-top:12px;font:11px var(--lr-font-mono);color:var(--lr-text-muted)}
.sw{display:inline-block;width:14px;height:8px;margin-right:6px;border:1.5px solid var(--lr-accent)}
.sw.l{border-style:dashed;border-color:var(--lr-locked)}.sw.x{border-color:var(--lr-error)}
footer{margin-top:16px}
</style></head><body>
<header><h1>${esc(title)}</h1><span class="lbl">${tree.runCount} runs · ledring.branch-tree.v1</span></header>
${tree.instruction ? `<p class="mono" style="margin-bottom:16px;color:var(--lr-text-muted)">“${esc(tree.instruction)}”</p>` : ""}
<div class="layout">
<div class="panel canvas"><svg width="${width}" height="${height}" style="max-width:100%;height:auto" viewBox="0 0 ${width} ${height}" role="img" aria-label="Branch tree">${edges.join("")}${nodes.join("")}</svg>
<div class="legend"><span><i class="sw"></i>taken path</span><span><i class="sw l"></i>locked · other runs</span><span><i class="sw x"></i>errored step</span><span>■n runs ended here</span></div></div>
<aside class="panel"><div class="lbl">Highlighted run</div><select id="run" aria-label="Highlighted run">${runOptions}</select>
<div class="lbl" style="margin-top:18px">Node</div><div id="info" class="kv"><b>hint</b><span>Select a node.</span></div></aside>
</div>
<footer class="lbl">Generated by ledring · self-contained, no network</footer>
<script type="application/json" id="lr-data">${data}</script>
<script>
(function(){var d=JSON.parse(document.getElementById("lr-data").textContent);
var byId={};d.nodes.forEach(function(n){byId[n.id]=n});
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function light(id){var r=d.runs.find(function(x){return x.id===id});if(!r)return;var t={};r.path.forEach(function(p){t[p]=1});
document.querySelectorAll(".n").forEach(function(g){var on=!!t[g.dataset.id];g.classList.toggle("taken",on);g.classList.toggle("locked",!on)});
document.querySelectorAll("[data-to]").forEach(function(e){var to=e.dataset.to,from=to.slice(0,to.lastIndexOf("."));e.classList.toggle("taken",!!(t[to]&&t[from]))})}
function show(id){var n=byId[id];document.querySelectorAll(".n.sel").forEach(function(g){g.classList.remove("sel")});var g=document.querySelector('.n[data-id="'+id+'"]');g&&g.classList.add("sel");
document.getElementById("info").innerHTML="<b>signature</b><span>"+esc(n.signature)+"</span><b>runs</b><span>"+n.count+" / "+d.runs.length+"</span><b>divergence</b><span>"+Math.round(n.share*100)+"% of parent</span><b>errors</b><span>"+n.errors+"</span><b>ended here</b><span>"+n.ends+"</span><b>outcomes</b><span>"+n.outcomes.success+" ok · "+n.outcomes.failure+" fail · "+n.outcomes.unknown+" ?</span>"}
document.getElementById("run").addEventListener("change",function(e){light(e.target.value)});
document.querySelectorAll(".n").forEach(function(g){g.addEventListener("click",function(){show(g.dataset.id)});g.addEventListener("keydown",function(e){if(e.key==="Enter")show(g.dataset.id)})});
})();
</script>
</body></html>
`;
}
