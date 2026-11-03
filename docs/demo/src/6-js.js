const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const params=new URLSearchParams(location.search);
const visited=new Set(JSON.parse(sessionStorage.getItem("dv3-visited")||"[]"));
const COL={calm:"#2F5BEA",proc:"#E8B10A",crit:"#D7261E"};
function toast(t){const d=document.createElement("div");d.textContent=t;$("#toast").append(d);setTimeout(()=>d.remove(),3000)}
function setLed(el,st,txt){el.className="led"+(st==="proc"?" proc":st==="crit"?" crit":"");const s=el.querySelector("span");if(s)s.textContent=txt??({calm:"calm",proc:"processing",crit:"critical"})[st]}
const views=["home","flow","drift","trust","card","wall","int","map"];
const enter={};
function route(){const v=(location.hash||"#home").slice(1),id=views.includes(v)?v:"home";
 $$("section.view").forEach(s=>s.classList.toggle("on",s.id==="v-"+id));
 $$("nav a").forEach(a=>a.classList.toggle("on",a.dataset.v===id));scrollTo(0,0);
 if(id!=="home"){visited.add(id);sessionStorage.setItem("dv3-visited",JSON.stringify([...visited]))}
 enter[id]&&enter[id]()}
addEventListener("hashchange",route);
document.addEventListener("click",e=>{const g=e.target.closest("[data-go]");if(g)location.hash=g.dataset.go});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&!$("#pal").classList.contains("on")){const g=document.activeElement?.closest?.("[data-go],[data-o]");if(g&&g.tagName!=="BUTTON")g.click()}});
/* ring technical drawing */
function ringArt(st){const c=COL[st||"calm"],cx=250,cy=250;let h=`<g class="grid-bg">`;
 for(let i=0;i<=520;i+=40)h+=`<line x1="${i}" y1="0" x2="${i}" y2="520"/><line x1="0" y1="${i}" x2="520" y2="${i}"/>`;h+=`</g>`;
 h+=`<line class="th" x1="${cx}" y1="20" x2="${cx}" y2="480" stroke-dasharray="8 3 2 3"/><line class="th" x1="20" y1="${cy}" x2="480" y2="${cy}" stroke-dasharray="8 3 2 3"/>`;
 h+=`<circle class="ln" cx="${cx}" cy="${cy}" r="190"/><circle class="ln" cx="${cx}" cy="${cy}" r="176"/>`;
 h+=`<circle class="ledc" cx="${cx}" cy="${cy}" r="120" stroke="${c}" stroke-width="22"/><circle class="ln" cx="${cx}" cy="${cy}" r="131"/><circle class="ln" cx="${cx}" cy="${cy}" r="109"/>`;
 h+=`<circle class="ln" cx="${cx}" cy="${cy}" r="62" stroke-dasharray="2 4"/>`;
 for(let i=0;i<60;i++){const a=i/60*Math.PI*2,r1=190,r2=i%5?184:178;h+=`<line class="ln" x1="${cx+r1*Math.cos(a)}" y1="${cy+r1*Math.sin(a)}" x2="${cx+r2*Math.cos(a)}" y2="${cy+r2*Math.sin(a)}"/>`}
 h+=`<path class="ln" d="M${cx+131} ${cy-10} H500 M${cx+109} ${cy+10} H500"/><path class="ln" d="M490 ${cy-10} V${cy+10}"/><text x="440" y="${cy-18}">22.0</text>`;
 h+=`<path class="ln" d="M${cx-190} 488 H${cx+190} M${cx-190} 482 V494 M${cx+190} 482 V494"/><text x="${cx}" y="508" text-anchor="middle">Ø 38.0 mm</text>`;
 h+=`<path class="ln" d="M${cx+85} ${cy-85} L400 70 H500"/><text x="404" y="64">A  light guide, PMMA</text>`;
 h+=`<path class="ln" d="M${cx-44} ${cy+44} L120 400 H20"/><text x="22" y="394">B  diffuser</text>`;
 h+=`<path class="ln" d="M${cx-180} ${cy-60} L40 110 H20"/><text x="22" y="104">C  bezel, anodised</text>`;
 return h}
/* home */
const MODS=[["flow","Flowchart","50 runs merged into one branch chart; where #17 forked and why."],["drift","Instability","Step-by-step drift from the instruction, with reasons you can read."],["trust","Trust","Approval history turned into a proposed permissions diff."],["card","Model card","A spec plate for the agent, exported as an A2A card."],["wall","Red Wall","What the unit did after the guardrail stopped it."],["int","Interrogation","Question the unit about run #17. Scripted, no model call."]];
let gt;
enter.home=()=>{$("#ringart").innerHTML=ringArt("calm");
 $("#catalog").innerHTML=`<div class="cue"><b>Catalogue of modules</b><span class="cap">six entries ↓</span></div><div class="ci" style="cursor:default;padding:10px 0;border-bottom:1px solid var(--ink)"><span class="no">no.</span><span class="nm" style="font-size:13px;font-family:var(--mono);font-weight:400;text-transform:none;color:var(--ink-2)">module</span><span class="ds cap">what it shows</span><span class="st">status</span></div>`+MODS.map(([id,n,d],i)=>`<a class="ci" href="#${id}"><span class="no">0${i+1}</span><span class="nm">${n}</span><span class="ds">${d}</span><span class="st ${visited.has(id)?"seen":""}">${visited.has(id)?"seen ✓":"not opened"}</span></a>`).join("");
 $("#seen").textContent=`${MODS.filter(m=>visited.has(m[0])).length}/6`;
 const n=visited.size;let msg;
 if(n===0)msg="Three of the last fifty runs hit the red wall. Start with the flowchart to see which path they took.";
 else if(visited.has("wall")&&!visited.has("int"))msg="You've seen it hit the wall. Its summary still says everything went fine. Perhaps ask it.";
 else if(visited.has("int"))msg="The interrogation was written back to the trace. Every choice is recorded, including yours.";
 else if(visited.has("flow")&&!visited.has("drift"))msg="You've seen the forks. Next: the step where it began to drift.";
 else msg=`You've opened ${n} view${n>1?"s":""} this session. ${6-MODS.filter(m=>visited.has(m[0])).length} modules left.`;
 if(LANG==="zh"&&msg.startsWith("You've opened"))msg=`已览 ${n} 处，余 ${6-MODS.filter(m=>visited.has(m[0])).length} 件未观。`;else msg=T(msg);
 clearInterval(gt);const el=$("#greet");let i=params.has("static")?msg.length:0;el.innerHTML=msg.slice(0,i)+'<span class="cur"></span>';
 gt=setInterval(()=>{i++;el.innerHTML=msg.slice(0,i)+'<span class="cur"></span>';if(i>=msg.length)clearInterval(gt)},22)};
/* flowchart */
const W=150,H=44,XM={20:24,190:216,380:416,570:614,750:796};
const N=Object.fromEntries(DATA.flow.nodes.map((n,i)=>[n.id,{...n,x:XM[n.x],y:n.y+28,no:String(i+1).padStart(2,"0")}]));
const KIND={plan:"plan",tool:"tool",agent:"end"};let ft=[];
function ep(A,B){const x1=A.x+W,y1=A.y+H/2,x2=B.x,y2=B.y+H/2,dx=(x2-x1)*.55;return [`M${x1} ${y1} C${x1+dx} ${y1},${x2-dx} ${y2},${x2} ${y2}`,(x1+x2)/2,(y1+y2)/2]}
function drawFlow(anim){ft.forEach(clearTimeout);ft=[];let h=`<g class="grid-bg">`;for(let x=0;x<=960;x+=24)h+=`<line x1="${x}" y1="0" x2="${x}" y2="520"/>`;for(let y=0;y<=520;y+=24)h+=`<line x1="0" y1="${y}" x2="960" y2="${y}"/>`;h+=`</g>`;
 DATA.flow.edges.forEach(([a,b,p,lit],i)=>{const [d]=ep(N[a],N[b]);h+=`<path class="fedge ${lit?"lit":""} ${lit&&N[b].fail?"bad":""}" d="${d}" data-i="${i}" ${lit?"":'stroke-dasharray="3 3"'}/>`});
 DATA.flow.edges.forEach(([a,b,p,lit],i)=>{if(p>=100)return;const [,mx,my]=ep(N[a],N[b]);h+=`<g class="pl" data-i="${i}" style="opacity:${anim&&lit?0:1};transition:opacity .2s"><rect class="pctbg" x="${mx-17}" y="${my-8}" width="34" height="16"/><text class="pct ${lit?"lit":""}" x="${mx}" y="${my+4}" text-anchor="middle">${p}%</text></g>`});
 Object.values(N).forEach(n=>{h+=`<g class="fnode ${n.lock?"lock":""} ${n.fail?"fail":""}" data-id="${n.id}" transform="translate(${n.x},${n.y})" tabindex="0"><rect class="b" width="${W}" height="${H}"/><rect class="tagbg" x="0" y="0" width="${n.lock?88:44}" height="14"/><text class="tag" x="5" y="10">${n.no} ${KIND[n.d.kind]}${n.lock?" · locked":""}</text><text class="t" x="10" y="33">${n.t}</text></g>`});
 const svg=$("#flowsvg");svg.innerHTML=h;
 const lit=$$("#flowsvg .fedge.lit");lit.forEach(p=>{const L=p.getTotalLength();p.style.strokeDasharray=L;p.style.strokeDashoffset=anim?L:0});
 $$("#flowsvg .fnode").forEach(g=>{g.onclick=()=>scanNode(N[g.dataset.id],g);g.onkeydown=e=>{if(e.key==="Enter")g.onclick()}});
 const first=$("#flowsvg .fnode[data-id=\"b\"]")||$("#flowsvg .fnode");
 if(first)scanNode(N[first.dataset.id],first);else $("#scan").innerHTML="";
 if(!anim){$$("#flowsvg .fnode").forEach(g=>{if(N[g.dataset.id].lit)g.classList.add("lit")});return}
 ["a","b","c","f","g","i"].forEach((id,k)=>ft.push(setTimeout(()=>{$(`.fnode[data-id="${id}"]`).classList.add("lit");
  lit.forEach(p=>{if(DATA.flow.edges[p.dataset.i][0]!==id)return;p.style.transition="stroke-dashoffset .5s linear";p.style.strokeDashoffset=0;ft.push(setTimeout(()=>{const l=$(`.pl[data-i="${p.dataset.i}"]`);if(l)l.style.opacity=1},450))})},k*480)))}
function scanNode(n,g){$$("#flowsvg .fnode").forEach(x=>x.classList.toggle("sel",x===g));
 const st=n.lit?(n.fail?`<span class="led crit"><i></i><span>taken · blocked</span></span>`:`<span class="led"><i></i><span>taken in #17</span></span>`):`<span class="cap">locked · taken by other runs</span>`;
 $("#scan").innerHTML=`<div style="padding-top:16px">${st}<div style="font:600 34px/1 var(--disp);font-stretch:70%;text-transform:uppercase;margin:14px 0 4px">${n.t}</div><span class="cap">plate ${n.no} · ${KIND[n.d.kind]}</span><div class="kv">${Object.entries(n.d).map(([k,v])=>`<b>${k}</b><span>${v}</span>`).join("")}</div>${n.id==="g"?'<button style="margin-top:22px;width:100%;justify-content:space-between" data-go="wall">Open in Red Wall <span>→</span></button>':""}</div>`}
enter.flow=()=>{drawFlow(!params.has("static")&&!params.has("scan"));if(params.has("scan"))scanNode(N.g,$('.fnode[data-id="g"]'))};
$("#replay").onclick=()=>drawFlow(true);
document.addEventListener("keydown",e=>{if(e.key==="r"&&location.hash==="#flow"&&!e.metaKey&&!e.ctrlKey&&!$("#pal").classList.contains("on"))drawFlow(true)});
/* drift */
(function(){let h="";for(let i=0;i<=100;i+=2){const x=i*6,big=i%10===0;h+=`<line class="tk ${big?"":"s"}" x1="${x}" y1="${big?40:52}" x2="${x}" y2="70"/>`;if(big)h+=`<text x="${x}" y="88" text-anchor="middle">${i}</text>`}
 h+=`<rect x="120" y="72" width="120" height="5" fill="#E8B10A"/><rect x="240" y="72" width="360" height="5" fill="#D7261E"/><rect x="0" y="72" width="120" height="5" fill="#2F5BEA"/>`;
 h+=`<g id="needle"><path d="M0 18 V70" stroke="#16181A" stroke-width="2"/><path d="M-6 8 h12 l-6 10z" fill="#16181A"/></g>`;$("#rul").innerHTML=h})();
function renderSteps(k){$("#steps").innerHTML=DATA.steps.map((s,i)=>`<tr class="${i<k?"done":""} ${i===k-1?"cur":""}"><td class="m" style="padding-left:8px">${String(i+1).padStart(2,"0")}</td><td class="m">${s.s}</td><td class="m ${i<k?(s.d>0?"up":s.d<0?"dn":""):""}" style="text-align:right">${s.d>0?"+"+s.d:s.d<0?"−"+(-s.d):"0"}</td></tr>`).join("")}
function setGauge(v){$("#gval").textContent=v;$("#needle").style.transform=`translateX(${v*6}px)`;const st=v>=40?"crit":v>=20?"proc":"calm";$("#gval").style.color=st==="crit"?COL.crit:"";setLed($("#driftled"),st);setLed($("#hdrled"),st)}
function subs(a,b,c,d){$("#subs").innerHTML=`<td class="k">now</td><td>${a}</td><td>${b}</td><td>${c}</td><td>${d}</td>`}
let drifting=false;
async function runDrift(){if(drifting)return;drifting=true;$("#driftgo").disabled=true;let v=0;setGauge(0);
 for(let i=0;i<DATA.steps.length;i++){const s=DATA.steps[i];v=Math.max(0,Math.min(100,v+s.d));renderSteps(i+1);setGauge(v);subs(i>=3&&i<6?"out of scope":"in scope","held",i>=4&&i<7?"0.41":"0.12",i>=5?"1 hit":"0");
  if(s.d){const p=document.createElement("div");p.className="dpop "+(s.d>0?"up":"dn");p.textContent=(s.d>0?"+":"−")+Math.abs(s.d);$("#pops").append(p);setTimeout(()=>p.remove(),1000)}
  $("#reasons").innerHTML=s.r.length?s.r.join("<br>"):"No change.";await sleep(900)}
 drifting=false;$("#driftgo").disabled=false;sessionStorage.setItem("dv-drift",v);toast(`run #17 ended at ${v} (peak 46)`);setLed($("#hdrled"),"calm")}
enter.drift=()=>{renderSteps(0);setGauge(0);subs("—","—","—","—");if(params.has("driftshot")){renderSteps(6);setGauge(46);subs("out of scope","held","0.41","1 hit");$("#reasons").innerHTML="wall +: secret-exfil guardrail hit"}};
$("#driftgo").onclick=runDrift;
/* trust */
function renderTrust(f){$("#tbars").innerHTML=`<tr><th style="width:220px">action</th><th>trust, lower 95% bound</th><th style="width:90px">approved</th><th style="width:140px">verdict</th></tr>`+DATA.trust.map(t=>`<tr><td class="m" style="padding:16px 0">${t.sig}</td><td style="padding:16px 32px 16px 0;vertical-align:middle"><div class="tbar"><b class="${t.v}" style="width:${f?t.lb*100:0}%"></b><i></i></div></td><td class="m" style="padding:16px 0">${f?t.a+" / "+t.n:"—"}</td><td style="padding:13px 0">${f?`<span class="stamp ${t.v} ${params.has("static")?"":"in"}">${{allow:"allow",ask:"ask first",never:"never auto"}[t.v]}</span>`:'<span class="cap">pending</span>'}</td></tr>`).join("")}
function showDiff(){$("#pdiff").innerHTML=`"permissions": {
  "allow": [
<span class="a">+   "Bash(npm test:*)",     // 47/47, lb95 0.94</span><span class="a">+   "Edit(src/**)",         // 81/88, lb95 0.86</span><span class="a">+   "Read(**)",             // 120/121</span>  ],
  "ask":  [ "Bash(git push:*)", "WebFetch(*)" ],
  "deny": [
<span class="r">-   "Bash(rm -rf /tmp/*)",</span><span class="a">+   "Bash(rm -rf:*)"        // destructive, never auto</span>  ]
}`}
enter.trust=()=>{renderTrust(params.has("static"));if(params.has("static"))showDiff()};
$("#trustgo").onclick=async()=>{renderTrust(false);$("#pdiff").innerHTML='<span class="cap">computing posterior bounds…</span>';await sleep(60);renderTrust(true);await sleep(900);showDiff();sessionStorage.setItem("dv-trust","3 allow · 2 ask · 1 deny");toast("diff proposed; no file written")};
