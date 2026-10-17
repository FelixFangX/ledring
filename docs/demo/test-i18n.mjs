// node test-i18n.mjs — every i18n key exists in both languages, is non-empty, and every English source string still exists in the build.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("./src/0-i18n.js", import.meta.url), "utf8").split("const LANG=")[0];
const ctx = {}; vm.runInNewContext(src + ";this.I18N=I18N;this.ROWS=I18N_ROWS", ctx);
const { I18N, ROWS } = ctx; const html = ["1-head.html","2-css.html","3-css.html","4-body.html","data.js","6-js.js","7-js.js"].map((f) => readFileSync(new URL("./src/" + f, import.meta.url), "utf8")).join(" ").replace(/\s+/g, " ");
let fail = 0; const bad = (m) => { fail++; console.error("✗ " + m); };
const en = Object.keys(I18N.en), zh = Object.keys(I18N.zh);
if (new Set(ROWS.map((r) => r[0])).size !== ROWS.length) bad("duplicate keys");
for (const k of en) if (!zh.includes(k)) bad("missing zh: " + k);
for (const k of zh) if (!en.includes(k)) bad("missing en: " + k);
for (const k of en) if (/[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/.test(I18N.en[k])) bad("CJK in en: " + k);
for (const k of en) { if (!I18N.en[k]?.trim()) bad("empty en: " + k); if (!I18N.zh[k]?.trim()) bad("empty zh: " + k); }
const esc = (s) => s.replace(/\s+/g, " ");
for (const k of en) { const s = esc(I18N.en[k]); if (!html.includes(s) && !html.includes(s.replace(/'/g, "\\'")) && !html.includes(JSON.stringify(s).slice(1, -1))) bad("unreferenced key (no element or JS source string): " + k); }
for (const k of zh) if (/[\u4e00-\u9fff][!?,;:]/.test(I18N.zh[k])) bad("half-width punctuation after Hanzi: " + k);
// Exercise the real applier after code annotations have changed innerHTML.
const body = readFileSync(new URL("./src/4-body.html", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./src/0-i18n.js", import.meta.url), "utf8");
for (const lang of ["zh", "en"]) {
  const context = {
    URLSearchParams, location: { search: "?lang=" + lang },
    navigator: { language: "en" }, document: { documentElement: {} },
    localStorage: { setItem() {}, getItem() {} },
  };
  vm.runInNewContext(runtime + ";this.apply=tDom", context);
  for (const key of en.filter(k => I18N.en[k].includes("<"))) {
    if (!body.includes(`data-i18n-html="${key}"`)) bad("unwired HTML key: " + key);
    const element = {
      nodeType: 1, innerHTML: I18N[lang === "zh" ? "en" : "zh"][key].replace(/<code>/g, '<code translate="no">'),
      getAttribute: name => name === "data-i18n-html" ? key : null,
      querySelectorAll: () => [],
    };
    context.apply(element);
    if (element.innerHTML !== I18N[lang][key]) bad("HTML application failed: " + lang + ": " + key);
    const text = element.innerHTML.replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, "").replace(/<[^>]*>/g, "");
    if (lang === "zh" && /[a-z]/i.test(text) && !/[\u3400-\u9fff]/.test(text)) bad("English-only zh HTML: " + key);
  }
}
console.log(fail ? `${fail} i18n failures` : `ok — ${en.length} keys in en and zh`); process.exit(fail ? 1 : 0);
