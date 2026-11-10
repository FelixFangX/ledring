import { pct, type BranchNode, type BranchTree } from "./tree.js";
import { darkTokens, paperTokens, tokensToCss, type Tokens } from "./tokens.js";
import { CJK_SANS, STRINGS, type Lang } from "./i18n.js";

export interface ReviewFinding {
  status: "observed" | "derived" | "unknown";
  code: string;
  text: string;
  /** The record this note read. A check that read tool output cites the result event. */
  provenance?: { file?: string; line?: number; eventId?: string };
}
export interface ReviewStep {
  stepId: string;
  nodeId?: string;
  signature: string;
  kind: string;
  isError?: boolean;
  decision?: { verdict: "allow" | "deny"; by: string; reason?: string };
  nonExecution?: "interrupted";
  startedAt?: string;
  parentId?: string;
  provenance?: { file?: string; line?: number; eventId?: string; resultLine?: number; resultEventId?: string };
  inputPreview?: string;
  outputPreview?: string;
  inputCut?: boolean;
  outputCut?: boolean;
  findings: ReviewFinding[];
}
export interface ReviewRun {
  id: string;
  truncated?: boolean;
  instructionStatus: "observed" | "unknown";
  omitted: number;
  /** Claude Code sidechain messages left out of this run. */
  omittedSidechains?: number;
  findings: ReviewFinding[];
  steps: ReviewStep[];
}

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
  /** Per-run step evidence. Omitted reports keep the tree and say the step record is absent. */
  review?: ReviewRun[];
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
  const lang: Lang = opts.lang === "zh" ? "zh" : "en";
  const L = STRINGS[lang];
  const label = (key: string) => (L as Record<string, string>)[key] ?? key;
  const placed = layout(tree.root);
  const at = new Map(placed.map((p) => [p.n.id, p]));
  const hl = tree.runs.find((r) => r.id === opts.highlightRunId) ?? tree.runs[0]!;
  if (opts.highlightRunId && hl.id !== opts.highlightRunId) throw new Error(`No run "${opts.highlightRunId}" in tree.`);
  const taken = new Set(hl.path);
  const width = Math.max(...placed.map((p) => p.x)) + W + PAD * 2;
  const height = Math.max(...placed.map((p) => p.y)) + H + PAD * 2;
  const forks = placed.filter((p) => p.n.children.length > 1).length;
  const errored = placed.reduce((a, p) => a + p.n.errors, 0);

  const review = opts.review ?? [];
  const hlReview = review.find((run) => run.id === hl.id);
  const plateText = (n: BranchNode, on: boolean, isError: boolean | undefined) => {
    const name = n.id === "0" ? L.start : n.signature;
    let text = `${name} — ${n.count}/${tree.runCount} ${L.runs}`;
    if (n.errors > 0) text += ` — ${n.errors} ${L.withError}`;
    if (on && isError === true) text += ` — ${L.thisErrored}`;
    else if (on && isError === false) text += ` — ${L.thisClean}`;
    return text;
  };

  const base: string[] = [], lit: string[] = [], pills: string[] = [], nodes: string[] = [];
  for (const p of placed) {
    const step = hlReview?.steps.find((item) => item.nodeId === p.n.id);
    const onPlate = taken.has(p.n.id);
    const runError = onPlate && step?.isError === true;
    p.n.children.forEach((c) => {
      const q = at.get(c.id)!;
      const x1 = p.x + W + PAD, y1 = p.y + H / 2 + PAD, x2 = q.x + PAD, y2 = q.y + H / 2 + PAD, mx = (x1 + x2) / 2;
      const d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
      const on = taken.has(c.id) && taken.has(p.n.id);
      const child = hlReview?.steps.find((item) => item.nodeId === c.id);
      base.push(`<path class="e" d="${d}"/>`);
      lit.push(`<path class="e-lit${on ? " on" : ""}${on && child?.isError === true ? " bad" : ""}" data-to="${c.id}" style="--i:${c.depth}" pathLength="1" d="${d}"/>`);
      if (p.n.children.length > 1 || p.n.id === "0") {
        const share = pct(c.share), w = share.length * 6.6 + 8, cx = mx, cy = (y1 + y2) / 2;
        pills.push(`<g class="pill${on ? " on" : ""}" data-to="${c.id}"><rect x="${cx - w / 2}" y="${cy - 8}" width="${w}" height="16"/><text x="${cx}" y="${cy + 3.5}" text-anchor="middle">${share}</text></g>`);
      }
    });
    const cls = ["n", onPlate ? "taken" : "locked", p.n.errors > 0 ? "error" : "", runError ? "run-error" : ""].filter(Boolean).join(" ");
    const kind = p.n.id === "0" ? L.start : p.n.children.length === 0 ? `${label(p.n.kind)} · ${L.end}` : label(p.n.kind);
    const meta = `${p.n.count}/${tree.runCount}`;
    const no = String(placed.indexOf(p) + 1).padStart(2, "0");
    const tab = no.length * 6.2 + kind.length * 5.6 + 16;
    const plate = plateText(p.n, onPlate, step?.isError);
    nodes.push(`<g class="${cls}" data-id="${p.n.id}" tabindex="0" role="button" aria-label="${esc(plate)}" transform="translate(${p.x + PAD} ${p.y + PAD})"><title data-user-content>${esc(plate)}</title><rect class="b" width="${W}" height="${H}"/><rect class="tab" width="${tab}" height="15"/><text class="no" x="5" y="11">${no}</text><text class="k" x="${no.length * 6.2 + 10}" y="11">${esc(kind.toUpperCase())}</text><text data-user-content class="t" x="10" y="35">${esc(clip(p.n.id === "0" ? L.start : p.n.signature))}</text><text class="m" x="${W - 8}" y="11" text-anchor="end">${meta}</text></g>`);
  }

  const data = JSON.stringify({ labels: STRINGS[lang], runs: tree.runs, evidence: review, nodes: placed.map((p) => ({ id: p.n.id, signature: p.n.signature, kind: p.n.kind, count: p.n.count, share: p.n.share, errors: p.n.errors, ends: p.n.ends, outcomes: p.n.outcomes })) }).replace(/</g, "\\u003c");
  const paper = { ...paperTokens, ...opts.lightTokens, ...opts.tokens };
  const dark = { ...darkTokens, ...opts.darkTokens };
  const title = opts.title ?? L.title;
  const runOptions = tree.runs.map((r) => `<option data-user-content value="${esc(r.id)}"${r.id === hl.id ? " selected" : ""}>${esc(clip(r.id, 44))} · ${esc(label(r.outcome))}</option>`).join("");

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
.n.run-error.taken .tab{fill:var(--lr-critical)}
.n:hover .b{stroke:var(--lr-line-3)}
.n.sel .b{stroke:var(--lr-calm);stroke-width:2}
.kv{display:grid;grid-template-columns:132px minmax(0,1fr);gap:8px 12px;font-size:12px;margin-top:14px;word-break:break-word}
.kv b{font-weight:400;color:var(--lr-text-2)}.kv span{color:var(--lr-text)}
.empty{color:var(--lr-text-2);margin-top:14px;padding:18px 0;border-top:1px dashed var(--lr-text-4);border-bottom:1px dashed var(--lr-text-4);font-size:13px}
.legend{display:flex;gap:18px;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:6px}
.legend i{width:20px;border-top:2px solid var(--lr-accent)}.legend .l2 i{border-top:1px dashed var(--lr-text-4)}.legend .l3 i{border-color:var(--lr-critical)}
.timeline{list-style:none;margin:18px 0 0;padding:0;max-height:320px;overflow:auto;border-top:1px solid var(--lr-line-3)}
.timeline button{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:baseline;width:100%;text-align:left;background:transparent;color:inherit;border:0;border-bottom:1px solid var(--lr-line);font:inherit;padding:8px 2px;cursor:pointer;min-height:36px}
.timeline button span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.timeline button[aria-current="true"]{background:var(--lr-sunken)}
.timeline button:focus-visible,summary:focus-visible{outline:2px solid var(--lr-calm);outline-offset:2px}
.limit{margin-top:10px;max-width:68ch;color:var(--lr-text-2)}
.scope{margin-top:18px;padding:0 0 2px 12px}
.scope.all{border-left:2px solid var(--lr-text-4)}
.scope.one{border-left:2px solid var(--lr-calm)}
.scope h2{font:500 11px var(--lr-font-mono);color:var(--lr-text);margin:0 0 8px}
a.src{color:inherit}
a.src:focus-visible,.event:focus{outline:2px solid var(--lr-calm);outline-offset:2px}
.event{margin-top:12px}
.note{padding:10px 0;color:var(--lr-text-2);font-size:13px}
.findings{list-style:none;padding:0;margin:8px 0 0}
.findings li{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px;margin:10px 0;font-size:13px}
details{margin-top:18px}
summary{cursor:pointer;font-size:12px}
pre.raw{white-space:pre-wrap;word-break:break-word;font:12px/1.45 var(--lr-font-mono);background:var(--lr-sunken);padding:10px;margin-top:8px;max-height:180px;overflow:auto}
footer{margin-top:32px;padding-top:10px;border-top:1px solid var(--lr-line-2);display:flex;justify-content:space-between}
${lang === "zh" ? `body{font-family:var(--lr-font-sans),${CJK_SANS};line-height:1.75;text-spacing-trim:normal;text-autospace:normal}h1.disp{font-stretch:100%;text-transform:none;letter-spacing:.02em;line-height:1.15;font-family:${CJK_SANS};font-weight:600}.cap{letter-spacing:0}.empty{line-height:1.8}` : ""}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.e-lit.on{stroke-dashoffset:0}}
@media (max-width:900px){body{padding:16px}.layout{grid-template-columns:1fr}.head{grid-template-columns:1fr}h1{font-size:32px}.idx{font-size:40px}.kpi b{font-size:28px}.timeline button{min-height:44px}}
</style></head><body>
<header><span class="mark"><span class="ring"></span>ledring</span><span class="cap">${L.section}</span></header>
<div class="head"><div class="disp idx">01</div><div><h1 class="disp">${esc(title)}</h1>
${tree.instruction ? `<p data-user-content class="instr">“${esc(tree.instruction)}”</p>` : ""}</div>
<div class="kpis"><div class="kpi"><span class="cap">${L.runs}</span><b class="disp">${tree.runCount}</b></div><div class="kpi"><span class="cap">${L.forks}</span><b class="disp">${forks}</b></div><div class="kpi"><span class="cap">${L.errored}</span><b class="disp"${errored ? ' style="color:var(--lr-critical)"' : ""}>${errored}</b></div></div></div>
<div class="layout">
<div><div class="canvas"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${L.branchTree}">${base.join("")}${lit.join("")}${pills.join("")}${nodes.join("")}</svg></div>
<div class="fig cap"><span>${L.figure.replace("{n}", String(tree.runCount)).replace(" 1 runs", " 1 run")}</span><span class="legend"><span><i></i>${L.taken}</span><span class="l2"><i></i>${L.others}</span>${review.length ? `<span class="l3"><i></i>${L.erroredStep}</span>` : ""}</span></div>
<p class="limit cap" id="tree-limit">${esc(L.treeLimit)}</p>
<ol class="timeline" id="timeline" aria-label="${esc(L.timeline)}"></ol></div>
<aside><div class="cap rule">${L.highlighted}</div><select id="run" aria-label="${L.highlighted}">${runOptions}</select>
<div class="cap rule">${L.selected}</div><div id="info"><p class="empty">${L.empty}</p></div></aside>
</div>
<footer class="cap"><span>${L.generated}</span><span>${L.offline}</span></footer>
<script type="application/json" id="lr-data">${data}</script>
<script>
(function(){var d=JSON.parse(document.getElementById("lr-data").textContent);
var byId={};d.nodes.forEach(function(n){byId[n.id]=n});
var runSel=document.getElementById("run");
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function evidence(){return (d.evidence||[]).find(function(e){return e.id===runSel.value})}
function stepAt(ev,id){return ev&&ev.steps.find(function(s){return s.nodeId===id})}
function plateLabel(n,on,step){if(!n)return "";var name=n.id==="0"?d.labels.start:n.signature;var text=name+" — "+n.count+"/"+d.runs.length+" "+d.labels.runs;if(n.errors)text+=" — "+n.errors+" "+d.labels.withError;if(on&&step&&step.isError===true)text+=" — "+d.labels.thisErrored;else if(on&&step&&step.isError===false)text+=" — "+d.labels.thisClean;return text}
function light(id){var r=d.runs.find(function(x){return x.id===id});if(!r)return;var ev=evidence(),t={};r.path.forEach(function(p){t[p]=1});
document.querySelectorAll(".n").forEach(function(g){var on=!!t[g.dataset.id],n=byId[g.dataset.id],step=stepAt(ev,g.dataset.id),label=plateLabel(n,on,on?step:null);g.classList.toggle("taken",on);g.classList.toggle("locked",!on);g.classList.toggle("run-error",!!(on&&step&&step.isError===true));g.setAttribute("aria-label",label);var title=g.querySelector("title");if(title)title.textContent=label});
document.querySelectorAll("[data-to]").forEach(function(e){var to=e.dataset.to,from=to.slice(0,to.lastIndexOf(".")),on=!!(t[to]&&t[from]),step=stepAt(ev,to);
if(e.classList.contains("e-lit")){e.classList.remove("on");void e.getBoundingClientRect();e.classList.toggle("bad",!!(on&&step&&step.isError===true))}e.classList.toggle("on",on)})}
function row(label,text,user){return "<b>"+esc(label)+"</b><span"+(user?" data-user-content":"")+">"+esc(text)+"</span>"}
function rowHtml(label,html){return "<b>"+esc(label)+"</b><span>"+html+"</span>"}
function loc(file,line){if(!file&&line==null)return "";return (file||"")+(line!=null?":"+line:"")}
function domId(step,part){return "ev-"+String(step.stepId).replace(/[^A-Za-z0-9_-]/g,"_")+"-"+part}
function sourceLink(step,part,file,line,eventId){var where=loc(file,line)||eventId||"";var name=d.labels.openEvent+" "+where+(eventId&&where!==eventId?" "+eventId:"");return '<a class="src" data-source href="#'+domId(step,part)+'" aria-label="'+esc(name)+'">'+esc(where)+"</a>"}
function partFor(step,finding){var p=finding&&finding.provenance;if(!p||!step.provenance)return "call";if(p.line!=null&&step.provenance.resultLine===p.line)return "result";if(p.eventId&&step.provenance.resultEventId&&p.eventId===step.provenance.resultEventId)return "result";return "call"}
function eventBlock(step,part,heading,file,line,eventId,body,cut,missing){var where=loc(file,line);var head=esc(heading)+(where?" · "+esc(where):"")+(eventId?" · "+esc(eventId):"");var bodyHtml=body==null?'<p class="note">'+esc(missing)+"</p>":(cut?'<p class="cap">'+esc(d.labels.shownInPart)+"</p>":"")+'<pre class="raw" data-user-content>'+esc(body)+"</pre>";return '<div class="event" id="'+domId(step,part)+'" tabindex="-1"><p class="cap">'+head+"</p>"+bodyHtml+"</div>"}
function drawTimeline(){var ol=document.getElementById("timeline"),ev=evidence(),L=d.labels;
if(!ev){ol.innerHTML='<li class="note">'+esc(L.noEvidence)+"</li>";return}
var html="";
if(ev.truncated)html+='<li class="note">'+esc(L.truncated)+"</li>";
if(ev.omitted)html+='<li class="note">'+esc(String(L.omitted).replace("{n}",String(ev.omitted)))+"</li>";
if(ev.omittedSidechains)html+='<li class="note">'+esc(String(L.sidechains).replace("{n}",String(ev.omittedSidechains)))+"</li>";
ev.steps.forEach(function(s,i){html+='<li><button type="button" data-node="'+esc(s.nodeId||"")+'" data-step="'+esc(s.stepId)+'"><span class="cap">'+String(i+1).padStart(2,"0")+'</span><span data-user-content>'+esc(s.signature)+'</span><span class="cap">'+(s.startedAt?esc(s.startedAt):esc(L.timeUnknown))+"</span></button></li>"});
ol.innerHTML=html||'<li class="note">'+esc(L.noEvidence)+"</li>"}
function show(nodeId,stepId){var L=d.labels,n=nodeId?byId[nodeId]:null,ev=evidence();
var step=ev&&ev.steps.find(function(s){return stepId?s.stepId===stepId:!!(nodeId&&s.nodeId===nodeId)});
document.querySelectorAll(".n.sel").forEach(function(g){g.classList.remove("sel")});
if(nodeId)document.querySelectorAll(".n").forEach(function(g){if(g.dataset.id===nodeId)g.classList.add("sel")});
document.querySelectorAll("#timeline button").forEach(function(b){if(step&&b.dataset.step===step.stepId){b.setAttribute("aria-current","true");b.scrollIntoView({block:"nearest"})}else b.removeAttribute("aria-current")});
var html="";
if(n)html+='<section class="scope all" aria-labelledby="h-all"><h2 id="h-all">'+esc(L.allRuns)+'</h2><div class="kv">'+row(L.kSignature,n.signature,true)+row(L.kKind,L[n.kind]||n.kind)+row(L.kRuns,n.count+" / "+d.runs.length)+row(L.kDivergence,Math.round(n.share*100)+L.ofPrevious)+row(L.kErrors,String(n.errors))+row(L.kEnded,String(n.ends))+row(L.kOutcomes,n.outcomes.success+" "+L.ok+" · "+n.outcomes.failure+" "+L.fail+" · "+n.outcomes.unknown+" "+L.unknown)+"</div></section>";
if(!ev)html+='<p class="empty">'+esc(L.noEvidence)+"</p>";
else if(!step)html+='<p class="empty">'+esc(n?L.notOnRun:L.empty)+"</p>";
else{html+='<section class="scope one" aria-labelledby="h-one"><h2 id="h-one">'+esc(L.thisRun)+"</h2>";
if(ev.instructionStatus==="unknown")html+='<p class="note">'+esc(L.instructionUnknown)+"</p>";
if(ev.omittedSidechains)html+='<p class="note">'+esc(String(L.sidechains).replace("{n}",String(ev.omittedSidechains)))+"</p>";
html+='<p class="note">'+esc(L.timeOrder)+"</p>";
var decision=step.nonExecution==="interrupted"?L.interrupted:(step.decision?step.decision.verdict+" · "+step.decision.by+(step.decision.reason?" · "+step.decision.reason:""):L.noneRecorded);
var err=step.isError===true?L.yes:step.isError===false?L.no:L.unknown;
var p=step.provenance||{},src="";
if(p.file||p.line!=null||p.eventId)src=sourceLink(step,"call",p.file,p.line,p.eventId);
if(p.resultLine!=null||p.resultEventId)src+=(src?" · ":"")+sourceLink(step,"result",p.file,p.resultLine,p.resultEventId);
html+='<div class="cap">'+esc(L.observed)+'</div><div class="kv">'+row(L.error,err)+row(L.decision,decision,true)+row(L.time,step.startedAt||L.timeUnknown,true)+rowHtml(L.source,src||esc(L.noneRecorded))+row(L.parent,step.parentId||L.noneRecorded,true)+"</div>";
var items=(step.findings||[]).map(function(f){var link="";if(f.provenance&&(f.provenance.file||f.provenance.line!=null||f.provenance.eventId)){var part=partFor(step,f);link=" "+sourceLink(step,part,f.provenance.file||p.file,f.provenance.line,f.provenance.eventId)}return '<li><span class="cap">'+esc(L[f.status]||f.status)+'</span><span><span data-user-content>'+esc(f.text)+"</span>"+link+"</span></li>"}).join("");
html+=items?'<ul class="findings">'+items+"</ul>":'<p class="empty">'+esc(L.noDerived)+"</p>";
var hasResult=p.resultLine!=null||!!p.resultEventId;
var blocks=eventBlock(step,"call",L.call,p.file,p.line,p.eventId,step.inputPreview,step.inputCut,L.inputMissing);
if(hasResult)blocks+=eventBlock(step,"result",L.result,p.file,p.resultLine,p.resultEventId,step.outputPreview,step.outputCut,L.outputMissing);
else{var out=step.outputPreview==null?'<p class="note"><span class="cap">'+esc(L.output)+"</span> "+esc(L.outputMissing)+"</p>":(step.outputCut?'<p class="cap">'+esc(L.shownInPart)+"</p>":"")+'<pre class="raw" data-user-content>'+esc(step.outputPreview)+"</pre>";var end="</div>";blocks=blocks.slice(0,-end.length)+out+end}
html+="<details><summary>"+esc(L.sourceEvent)+"</summary>"+blocks+"</details></section>"}
document.getElementById("info").innerHTML=html||'<p class="empty">'+esc(L.empty)+"</p>"}
runSel.addEventListener("change",function(){light(runSel.value);drawTimeline();document.querySelectorAll(".n.sel").forEach(function(g){g.classList.remove("sel")});document.getElementById("info").innerHTML='<p class="empty">'+esc(d.labels.empty)+"</p>"});
document.querySelectorAll(".n").forEach(function(g){g.addEventListener("click",function(){show(g.dataset.id)});g.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();show(g.dataset.id)}})});
document.getElementById("timeline").addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button");if(!b)return;show(b.dataset.node,b.dataset.step)});
document.getElementById("timeline").addEventListener("keydown",function(e){if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;var buttons=Array.prototype.slice.call(document.querySelectorAll("#timeline button"));if(!buttons.length)return;var i=buttons.indexOf(document.activeElement);var n=e.key==="ArrowDown"?(i<0?0:Math.min(buttons.length-1,i+1)):(i<=0?0:i-1);e.preventDefault();buttons[n].focus();show(buttons[n].dataset.node,buttons[n].dataset.step)});
document.getElementById("info").addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[data-source]");if(!a)return;e.preventDefault();var el=document.getElementById((a.getAttribute("href")||"").slice(1));if(!el)return;var details=el.closest("details");if(details)details.open=true;el.scrollIntoView({block:"nearest"});el.focus()});
drawTimeline();
})();
</script>
</body></html>
`;
}
