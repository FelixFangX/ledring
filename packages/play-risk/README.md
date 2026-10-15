# @ledring/play-risk

AST scan of a single-file HTML artifact. HTML is parsed with parse5. Inline scripts and event handlers are parsed with acorn, and a partial stream falls back to acorn-loose so a cut-off file does not throw.

Findings are `{ category, severity, line, col, snippet, ruleId }`.

| Category | What it catches |
|---|---|
| `network` | `fetch`, XHR, WebSocket, EventSource, `sendBeacon`, remote `import()`, remote image URLs |
| `eval` | `eval`, `Function`, string `setTimeout` / `setInterval`, `document.write` of a script |
| `storage` | `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, Cache API |
| `external` | remote script, stylesheet, `@import`, frame |
| `popup` | `window.open`, `top`/`parent` location, `postMessage` to `*`, remote form action, meta refresh |
| `suspicious` | `window['ev'+'al']`, `atob` fed into a sink, a computed `window[...]` call |

A local binding that shadows `fetch` is not a network call. Plan text uses a separate EN/zh lexicon (`scanPlan`); it is not the AST.

`scanHtml` is safe to call from the browser during streaming and from the bridge as the authoritative pass.
