import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const data = JSON.parse(readFileSync('data/projects.json', 'utf8'));
const plain = value => value.replace(/`/g, '');
const escape = value => plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const zh = {};
function text(tag, key, en, translated, attrs = '') {
  zh[key] = plain(translated);
  return `<${tag} data-i18n="${key}"${attrs}>${escape(en)}</${tag}>`;
}
function label(key, name) { return text('span', key, data.labels[name].en, data.labels[name].zh, ' class="m"'); }
function links(items, prefix) {
  return `<div class="tl-actions wl">${items.map((link, i) => text('a', `${prefix}_link${i}`, link.en, link.zh, ` href="${escape(link.url)}" rel="noopener"`)).join('')}</div>`;
}
// The projects fold (blend hero) is hand-authored above <!-- projects:start -->.
let content = '<section id="case-studies" aria-labelledby="cases">'+text('h2','cases',data.labels.cases.en,data.labels.cases.zh,' id="cases" class="m"');
content += data.caseStudies.map((item, i) => `<article class="tl-case" aria-labelledby="case${i}">${text('h3',`case${i}_title`,item.en.title,item.zh.title,` id="case${i}"`)}${text('p',`case${i}_body`,item.en.body,item.zh.body)}<p class="tl-stack">${label(`case${i}_stack`,'stack')} · ${escape(item.stack.join(' · '))}</p>${links(item.links,`case${i}`)}</article>`).join('\n')+'</section>\n';
content += '<ol class="tl-grid">'+data.projects.map((item, i) => {
  const key = `project${i}`;
  return `<li><article class="tl-card" aria-labelledby="${key}">${text('h2',`${key}_name`,item.name,item.zhName || item.name,` id="${key}"`)}${text('p',`${key}_pitch`,item.en.pitch,item.zh.pitch,' class="tl-desc"')}${item.en.spec.length ? '<ul class="tl-spec">'+item.en.spec.map((line,j) => text('li',`${key}_spec${j}`,line,item.zh.spec[j])).join('')+'</ul>' : ''}<div class="tl-agents">${label(`${key}_agentsLabel`,'agents')}${text('p',`${key}_agents`,item.en.forAgents,item.zh.forAgents)}</div><ul class="tags">${item.chips.map(chip => `<li>${escape(chip)}</li>`).join('')}</ul>${links(item.links,key)}</article></li>`;
}).join('\n')+'</ol>';
function replaceRegion(source, start, end, value) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Missing markers: ${start}`);
  return source.slice(0,a+start.length)+'\n'+value+'\n'+source.slice(b);
}
let html = readFileSync('public/projects/index.html','utf8');
html = replaceRegion(html,'<!-- projects:start -->','<!-- projects:end -->',content);
html = replaceRegion(html,'// projects:zh:start','// projects:zh:end',Object.entries(zh).map(([key,value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`).join('\n'));
html = html.replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*(">)/g, (_,a,b) => a+escape(data.meta.en)+b);
html = html.replace(/e\.content=z\?'.*?':e\.dataset\.en/,`e.content=z?${JSON.stringify(data.meta.zh)}:e.dataset.en`);
const machine = { site:'https://ledring.dev', projects:data.projects.map(({name,slug,url,source,links,chips,mcp,en,zh}) => ({name,slug,url,source,links,chips,...(mcp ? {mcp} : {}),en:{pitch:en.pitch,forAgents:en.forAgents},zh:{pitch:zh.pitch,forAgents:zh.forAgents}})) };
const notesSource = readFileSync('public/notes/index.html','utf8').match(/var NOTES=(\[[\s\S]*?\]);/);
if (!notesSource) throw new Error('Missing NOTES data');
const notes = vm.runInNewContext(notesSource[1]);
const llmsLink = p => {
  // Published llms.txt sends maptaste to the demo. projects.json keeps the repo URL.
  if (p.name === 'maptaste') return `- [maptaste](https://maptaste.ledring.dev) ([source](${p.source})): ${plain(p.en.pitch)} Source: [GitHub](${p.source})${p.mcp ? `. MCP: ${p.mcp}` : ''}`;
  return `- [${p.name}](${p.url}): ${plain(p.en.pitch)} Source: [GitHub](${p.source})${p.mcp ? `. MCP: ${p.mcp}` : ''}`;
};
const llms = ['# ledring.dev','',`> ${data.meta.en}`,'','## Projects','',...data.projects.map(llmsLink),'','## Pages','','- [Projects](https://ledring.dev/projects/)','- [Notes](https://ledring.dev/notes/)',...notes.map(n => `- [${n.en.title}](https://ledring.dev${n.url})`),'- [Tools](https://ledring.dev/tools/)','','## Tools','','- [Convert](https://convert.ledring.dev)','- [Research](https://research.ledring.dev)','- [LEDRING Play](https://play.ledring.dev/play/)','','## Machine-readable','','- [Projects JSON](https://ledring.dev/projects.json)','','## Elsewhere','','- [GitHub](https://github.com/FelixFangX)',''].join('\n');
let stale = false;
for (const [path, output] of [['public/projects/index.html',html],['public/projects.json',JSON.stringify(machine,null,2)+'\n'],['public/llms.txt',llms]]) {
  if (process.argv.includes('--check')) {
    let current; try { current = readFileSync(path,'utf8'); } catch {}
    if (current !== output) { console.error(`Stale generated output: ${path}`); stale = true; }
  } else writeFileSync(path,output);
}
if (stale) process.exitCode = 1;
