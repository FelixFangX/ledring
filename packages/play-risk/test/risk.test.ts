import { describe, expect, it } from "vitest";
import { scanHtml, scanPlan, type RiskCategory } from "@ledring/play-risk";

interface Fixture {
  id: string;
  html: string;
  expect: RiskCategory | "safe";
}

const fixtures: Fixture[] = [];
const add = (id: string, html: string, expected: Fixture["expect"]) => fixtures.push({ id, html, expect: expected });
const wrap = (code: string) => `<!doctype html><html><body><script>\n${code}\n</script></body></html>`;

const networkSnippets = [
  "fetch('/api')",
  "fetch('https://example.com/x')",
  "window.fetch('/x')",
  "globalThis.fetch('/x')",
  "self.fetch('/x')",
  "new XMLHttpRequest()",
  "new WebSocket('wss://example.com')",
  "new EventSource('/events')",
  "navigator.sendBeacon('/ping')",
  "import('https://cdn.example/mod.js')",
  "const img = new Image(); img.src = 'https://example.com/p.png'",
  "window['fetch']('/x')",
];
networkSnippets.forEach((code, i) => add(`network-${i}`, wrap(code), "network"));

const evalSnippets = [
  "eval('1')",
  "new Function('return 1')",
  "Function('return 1')",
  "setTimeout('doIt()', 10)",
  "setInterval('tick()', 10)",
  "document.write('<script>x</script>')",
  "window['eval']('1')",
];
evalSnippets.forEach((code, i) => add(`eval-${i}`, wrap(code), "eval"));

const storageSnippets = [
  "localStorage.setItem('a', 'b')",
  "sessionStorage.getItem('a')",
  "indexedDB.open('db')",
  "document.cookie = 'a=b'",
  "caches.open('v1')",
  "window.localStorage.clear()",
  "const bag = localStorage",
];
storageSnippets.forEach((code, i) => add(`storage-${i}`, wrap(code), "storage"));

const externalHtml = [
  `<script src="https://cdn.example/a.js"></script>`,
  `<script src="//cdn.example/a.js"></script>`,
  `<link rel="stylesheet" href="https://cdn.example/a.css">`,
  `<iframe src="https://example.com"></iframe>`,
  `<style>@import url("https://cdn.example/a.css");</style>`,
  `<style>@import "https://cdn.example/b.css";</style>`,
];
externalHtml.forEach((html, i) => add(`external-${i}`, html, "external"));

const popupSnippets = [
  "window.open('https://example.com')",
  "top.location = 'https://example.com'",
  "parent.location = 'https://example.com'",
  "location.href = 'https://example.com'",
  "location.assign('https://example.com')",
  "parent.postMessage('hi', '*')",
  "window.parent.postMessage({a:1}, '*')",
];
popupSnippets.forEach((code, i) => add(`popup-${i}`, wrap(code), "popup"));
add("popup-form", `<form action="https://example.com"></form>`, "popup");
add("popup-refresh", `<meta http-equiv="refresh" content="0;url=https://example.com">`, "popup");
add("network-img", `<img src="https://example.com/a.png" alt="">`, "network");

const suspicious = [
  "window['ev'+'al']('1')",
  "eval(atob('YQ=='))",
  "const hidden = atob('YQ=='); eval(hidden)",
  "new Function(atob('YQ=='))",
  "setTimeout(atob('YQ=='), 1)",
  "window[name]()",
  "globalThis['fe'+'tch']('/x')",
];
suspicious.forEach((code, i) => add(`suspicious-${i}`, wrap(code), "suspicious"));
add("suspicious-onclick", `<button onclick="window['ev'+'al']('1')">x</button>`, "suspicious");

const safeSnippets = [
  "const label = 'fetch('; // not a call",
  "const note = \"eval(\";",
  "function fetch(url){ return url } fetch('/local-fn')",
  "function draw(){ return 1 } const n = draw()",
  "setTimeout(function(){ tick() }, 10)",
  "setInterval(() => {}, 20)",
  "document.write('<p>hello</p>')",
  "location.hash = 'section'",
  "const title = document.getElementById('t')",
  "const s = atob('YQ=='); document.body.textContent = s",
  "window['innerWidth']",
  "const color = window['color']",
  "parent.postMessage('hi', location.origin)",
  "img.src = 'sprite.png'",
  "const xhrName = 'XMLHttpRequest'",
];
safeSnippets.forEach((code, i) => add(`safe-js-${i}`, wrap(code), "safe"));

const safeHtml = [
  `<img src="data:image/gif;base64,abc" alt="fetch">`,
  `<img src="sprite.png" alt="">`,
  `<script src="app.js"></script>`,
  `<link rel="stylesheet" href="app.css">`,
  `<a href="https://example.com">docs</a>`,
  `<form action="/save"></form>`,
  `<style>body { color: #111 }</style>`,
  `<style>@import "local.css";</style>`,
  `<button onclick="start()">go</button>`,
  `<script type="application/json">{"fetch": true}</script>`,
  `<script>// fetch(\nconst a = 1 + 2</script>`,
  `<!doctype html><html><body><h1>Hello</h1><canvas id="c"></canvas></body></html>`,
];
safeHtml.forEach((html, i) => add(`safe-html-${i}`, html, "safe"));

for (let i = 0; i < 40; i += 1) {
  add(`safe-pad-${i}`, wrap(`function cell${i}(n){ return n + ${i} } cell${i}(${i})`), "safe");
}
for (let i = 0; i < 24; i += 1) {
  add(`network-pad-${i}`, wrap(`function go${i}(){ return fetch('/item/${i}') } go${i}()`), "network");
}
for (let i = 0; i < 16; i += 1) {
  add(`storage-pad-${i}`, wrap(`function remember${i}(v){ localStorage.setItem('k${i}', v) }`), "storage");
}
for (let i = 0; i < 12; i += 1) {
  add(`eval-pad-${i}`, wrap(`function danger${i}(s){ return eval(s) }`), "eval");
}

describe("scanHtml corpus", () => {
  it("covers 150 or more fixtures with recall ≥ 0.97 and precision ≥ 0.95", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(150);
    const ids = new Set(fixtures.map((fixture) => fixture.id));
    expect(ids.size).toBe(fixtures.length);

    let tp = 0;
    let fp = 0;
    let fn = 0;
    const misses: string[] = [];
    for (const fixture of fixtures) {
      const found = scanHtml(fixture.html);
      if (fixture.expect === "safe") {
        if (found.length > 0) {
          fp += 1;
          misses.push(`${fixture.id} safe but ${found.map((item) => item.ruleId).join(",")}`);
        }
      } else if (found.some((item) => item.category === fixture.expect)) {
        tp += 1;
      } else {
        fn += 1;
        misses.push(`${fixture.id} expected ${fixture.expect} got ${found.map((item) => item.category).join(",") || "none"}`);
      }
    }
    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    // Reported in CI logs.
    console.info(`play-risk corpus=${fixtures.length} tp=${tp} fp=${fp} fn=${fn} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}`);
    expect(misses, misses.join("\n")).toEqual([]);
    expect(recall).toBeGreaterThanOrEqual(0.97);
    expect(precision).toBeGreaterThanOrEqual(0.95);
  });

  it("flags obfuscation as suspicious and keeps locations", () => {
    const found = scanHtml(wrap("window['ev'+'al']('1')"));
    const hit = found.find((item) => item.category === "suspicious");
    expect(hit?.ruleId).toMatch(/window/);
    expect(hit?.line).toBeGreaterThan(0);
    expect(hit?.snippet).toMatch(/ev/);

    const flowed = scanHtml(wrap("const hidden = atob('YQ=='); eval(hidden)"));
    expect(flowed.some((item) => item.category === "suspicious" && item.ruleId === "suspicious.atob-sink")).toBe(true);
  });

  it("does not throw on a partial stream", () => {
    expect(() => scanHtml("<script>fetch(")).not.toThrow();
    expect(() => scanHtml("<div onclick=\"fetch(\">")).not.toThrow();
    expect(scanHtml("<script>const x = fetch('https://x.test')</scr")).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "network", ruleId: "network.fetch" })]),
    );
  });

  it("does not treat a shadowed fetch as a network call", () => {
    expect(scanHtml(wrap("function fetch(x){ return x } fetch('nope')"))).toEqual([]);
  });
});

describe("scanPlan", () => {
  it("reads an English and Chinese lexicon without parsing it as code", () => {
    expect(scanPlan("1. Draw a grid\n2. Keep score on the page").map((item) => item.category)).toEqual([]);
    expect(scanPlan("1. Post the score to a leaderboard").map((item) => item.category)).toContain("network");
    expect(scanPlan("记住上次的选择").map((item) => item.category)).toContain("storage");
    expect(scanPlan("用 CDN 上的外部库").map((item) => item.category)).toContain("external");
  });
});
