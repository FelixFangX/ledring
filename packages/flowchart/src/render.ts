import { pct, type BranchNode, type BranchTree } from "./tree.js";
import { darkTokens, paperTokens, tokensToCss, type Tokens } from "./tokens.js";
import { CJK_SANS, STRINGS, type Lang } from "./i18n.js";

export interface RenderOptions {
  title?: string;
  /** Run whose path is lit. Defaults to the first run. */
  highlightRunId?: string;
  /** Override the default (paper) theme tokens. */
  tokens?: Partial<Tokens>;
  /** Override the ink theme tokens (used under `prefers-color-scheme: dark`). */
  darkTokens?: Partial<Tokens>;
  /** Language of the UI chrome. Defaults to English. */
  lang?: Lang;
  /** @deprecated Paper is now the default theme; these merge into it, under `tokens`. */
  lightTokens?: Partial<Tokens>;
}

const COL = 210, ROW = 68, W = 168, H = 46, PAD = 32;

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
        const label = pct(c.share), w = label.length * 6.6 + 8, cx = mx, cy = (y1 + y2) / 2;
        pills.push(`<g class="pill${on ? " on" : ""}" data-to="${c.id}"><rect x="${cx - w / 2}" y="${cy - 8}" width="${w}" height="16"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle">${label}</text></g>`);
      }
    });
    const cls = ["n", taken.has(p.n.id) ? "taken" : "locked", p.n.errors > 0 ? "error" : ""].filter(Boolean).join(" ");
    const kind = p.n.id === "0" ? "start" : p.n.children.length === 0 ? `${p.n.kind} · end` : p.n.kind;
    const meta = p.n.errors > 0 ? `${p.n.errors} err` : `${p.n.count}/${tree.runCount}`;
    const no = String(placed.indexOf(p) + 1).padStart(2, "0");
    const tab = no.length * 6.2 + kind.length * 5.6 + 16;
    nodes.push(`<g class="${cls}" data-id="${p.n.id}" tabindex="0" transform="translate(${p.x + PAD} ${p.y + PAD})"><title>${esc(p.n.signature)} — ${p.n.count}/${tree.runCount} runs</title><rect class="b" width="${W}" height="${H}"/><rect class="tab" width="${tab}" height="15"/><text class="no" x="5" y="11">${no}</text><text class="k" x="${no.length * 6.2 + 10}" y="11">${esc(kind.toUpperCase())}</text><text class="t" x="10" y="35">${esc(clip(p.n.signature))}</text><text class="m" x="${W - 8}" y="11" text-anchor="end">${meta}</text></g>`);
  }

  const data = JSON.stringify({ labels: STRINGS[opts.lang === "zh" ? "zh" : "en"], runs: tree.runs, nodes: placed.map((p) => ({ id: p.n.id, signature: p.n.signature, kind: p.n.kind, count: p.n.count, share: p.n.share, errors: p.n.errors, ends: p.n.ends, outcomes: p.n.outcomes })) }).replace(/</g, "\\u003c");
  const paper = { ...paperTokens, ...opts.lightTokens, ...opts.tokens };
  const dark = { ...darkTokens, ...opts.darkTokens };
  const lang: Lang = opts.lang === "zh" ? "zh" : "en";
  const L = STRINGS[lang];
  const title = opts.title ?? L.title;
  const runOptions = tree.runs.map((r) => `<option value="${esc(r.id)}"${r.id === hl.id ? " selected" : ""}>${esc(clip(r.id, 44))} · ${esc(r.outcome)}</option>`).join("");

  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="ledring"><meta name="color-scheme" content="light dark">
<title>${esc(title)} — LEDRING</title>
<style>
:root{${tokensToCss(paper)}}
@media (prefers-color-scheme:dark){:root{${tokensToCss(dark)}}}
*{box-sizing:border-box;margin:0}
body{background:var(--lr-bg);color:var(--lr-text);font:14px/1.5 var(--lr-font-sans);padding:28px 40px 40px;min-height:100vh;-webkit-font-smoothing:antialiased}
.mono,.cap,select,.kv{font-family:var(--lr-font-mono);font-variant-numeric:tabular-nums}
.cap{font-size:11px;color:var(--lr-text-2)}
.cap b{color:var(--lr-text);font-weight:500}
.disp{font-family:var(--lr-font-display);font-stretch:68%;font-weight:600;text-transform:uppercase;letter-spacing:.005em;line-height:.9}
header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:1px solid var(--lr-line-3)}
.mark{font:700 20px/1 var(--lr-font-display);font-stretch:110%;letter-spacing:-.03em}
.ring{display:inline-block;width:11px;height:11px;border-radius:50%;border:3px solid var(--lr-calm);margin-right:8px;vertical-align:-1px}
.head{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:24px;align-items:end;padding:28px 0 22px;border-bottom:1px solid var(--lr-line-3)}
.idx{font-size:64px}
h1{font-size:52px}
.instr{color:var(--lr-text-2);max-width:720px;margin-top:10px}
.kpis{display:flex;border-left:1px solid var(--lr-line-2)}
.kpi{padding:0 18px;border-right:1px solid var(--lr-line-2)}
.kpi b{display:block;font-size:40px;margin-top:4px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;align-items:start;margin-top:28px}
.canvas{overflow:auto;background:var(--lr-panel);border:1px solid var(--lr-line-3);background-image:linear-gradient(var(--lr-line) 1px,transparent 1px),linear-gradient(90deg,var(--lr-line) 1px,transparent 1px);background-size:24px 24px}
.canvas svg{display:block;max-width:100%;height:auto}
.fig{display:flex;justify-content:space-between;gap:16px;margin-top:8px;flex-wrap:wrap}
aside .rule{border-bottom:1px solid var(--lr-line-3);padding-bottom:8px}
select{width:100%;margin:10px 0 24px;font-size:12px;background:var(--lr-panel);color:var(--lr-text);border:1px solid var(--lr-line-3);border-radius:0;padding:7px 8px}
select:focus-visible,.n:focus-visible{outline:2px solid var(--lr-calm);outline-offset:2px}
.e{fill:none;stroke:var(--lr-text-4);stroke-width:1;stroke-dasharray:3 3}
.e-lit{fill:none;stroke:var(--lr-accent);stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1;opacity:0}
.e-lit.on{opacity:1;animation:draw .5s var(--lr-ease-reveal) forwards;animation-delay:calc(var(--i) * 140ms)}
.e-lit.bad{stroke:var(--lr-critical)}
@keyframes draw{to{stroke-dashoffset:0}}
.pill rect{fill:var(--lr-panel)}
.pill text{font:500 10.5px var(--lr-font-mono);fill:var(--lr-text-4)}
.pill.on text{fill:var(--lr-text)}
.n{cursor:pointer}
.n .b{fill:var(--lr-panel);stroke:var(--lr-text-4);stroke-width:1}
.n .tab{fill:var(--lr-sunken)}
.n .no,.n .k,.n .m{font:500 9px var(--lr-font-mono);fill:var(--lr-text-3)}
.n .t{font:400 12px var(--lr-font-mono);fill:var(--lr-text-2)}
.n.taken .b{stroke:var(--lr-line-3);stroke-width:1.5}
.n.taken .tab{fill:var(--lr-line-3)}.n.taken .no,.n.taken .k{fill:var(--lr-bg)}.n.taken .t{fill:var(--lr-text)}.n.taken .m{fill:var(--lr-text-2)}
.n.locked .b{stroke-dasharray:2 3}
.n.error .m{fill:var(--lr-critical)}
.n.error.taken .tab{fill:var(--lr-critical)}
.n:hover .b{stroke:var(--lr-line-3)}
.n.sel .b{stroke:var(--lr-calm);stroke-width:2}
.kv{display:grid;grid-template-columns:84px 1fr;gap:8px 12px;font-size:12px;margin-top:14px;word-break:break-word}
.kv b{font-weight:400;color:var(--lr-text-2)}.kv span{color:var(--lr-text)}
.empty{color:var(--lr-text-2);margin-top:14px;padding:18px 0;border-top:1px dashed var(--lr-text-4);border-bottom:1px dashed var(--lr-text-4);font-size:13px}
.legend{display:flex;gap:18px}
.legend span{display:flex;align-items:center;gap:6px}
.legend i{width:20px;border-top:2px solid var(--lr-accent)}.legend .l2 i{border-top:1px dashed var(--lr-text-4)}.legend .l3 i{border-color:var(--lr-critical)}
footer{margin-top:32px;padding-top:10px;border-top:1px solid var(--lr-line-2);display:flex;justify-content:space-between}
${lang === "zh" ? `body{font-family:var(--lr-font-sans),${CJK_SANS};line-height:1.75}h1.disp{font-stretch:100%;text-transform:none;letter-spacing:.02em;line-height:1.15;font-family:${CJK_SANS};font-weight:600}.cap{letter-spacing:0}.empty{line-height:1.8}` : ""}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.e-lit.on{stroke-dashoffset:0}}
@media (max-width:900px){.layout{grid-template-columns:1fr}.head{grid-template-columns:1fr}}
</style></head><body>
<header><span class="mark"><span class="ring"></span>ledring</span><span class="cap">${L.section}</span></header>
<div class="head"><div class="disp idx">01</div><div><h1 class="disp">${esc(title)}</h1>
${tree.instruction ? `<p class="instr">“${esc(tree.instruction)}”</p>` : ""}</div>
<div class="kpis"><div class="kpi"><span class="cap">${L.runs}</span><b class="disp">${tree.runCount}</b></div><div class="kpi"><span class="cap">${L.forks}</span><b class="disp">${forks}</b></div><div class="kpi"><span class="cap">${L.errored}</span><b class="disp"${errored ? ' style="color:var(--lr-critical)"' : ""}>${errored}</b></div></div></div>
<div class="layout">
<div><div class="canvas"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Branch tree">${base.join("")}${lit.join("")}${pills.join("")}${nodes.join("")}</svg></div>
<div class="fig cap"><span>${L.figure.replace("{n}", String(tree.runCount)).replace(" 1 runs", " 1 run")}</span><span class="legend"><span><i></i>${L.taken}</span><span class="l2"><i></i>${L.others}</span><span class="l3"><i></i>${L.erroredStep}</span></span></div></div>
<aside><div class="cap rule">${L.highlighted}</div><select id="run" aria-label="${L.highlighted}">${runOptions}</select>
<div class="cap rule">${L.selected}</div><div id="info"><p class="empty">${L.empty}</p></div></aside>
</div>
<footer class="cap"><span>${L.generated}</span><span>${L.offline}</span></footer>
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
var L=d.labels;document.getElementById("info").innerHTML='<div class="kv"><b>'+L.kSignature+'</b><span>'+esc(n.signature)+'</span><b>'+L.kKind+'</b><span>'+esc(n.kind)+'</span><b>'+L.kRuns+'</b><span>'+n.count+' / '+d.runs.length+'</span><b>'+L.kDivergence+'</b><span>'+Math.round(n.share*100)+L.ofParent+'</span><b>'+L.kErrors+'</b><span>'+n.errors+'</span><b>'+L.kEnded+'</b><span>'+n.ends+'</span><b>'+L.kOutcomes+'</b><span>'+n.outcomes.success+' '+L.ok+' · '+n.outcomes.failure+' '+L.fail+' · '+n.outcomes.unknown+' ?</span></div>'}
document.getElementById("run").addEventListener("change",function(e){light(e.target.value)});
document.querySelectorAll(".n").forEach(function(g){g.addEventListener("click",function(){show(g.dataset.id)});g.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();show(g.dataset.id)}})});
})();
</script>
</body></html>
`;
}
