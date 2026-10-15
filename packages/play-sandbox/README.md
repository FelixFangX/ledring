# @ledring/play-sandbox

Offline frame for a Play artifact.

- The iframe attribute is `sandbox="allow-scripts"` only, so the document origin is opaque.
- `withHarness` injects a Content-Security-Policy meta: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`.
- The harness posts `{ __lr, t, d }` to the parent. `readHarnessMessage` accepts it only for that render's nonce.
- Static Pages mode has no Playwright browser. The page must show `DEGRADED_JUDGE_NOTICE` and judge from this harness. The bridge runs `@ledring/play-judge` instead.

`createNonce()` returns 32 hex characters. Pass that string to `withHarness`. Do not interpolate an untrusted nonce into the script.

## Backends

Single-file artifacts use the iframe. `resolveSandboxBackend()` returns `iframe` unless the caller asks for `webcontainer` and `LEDRING_WEBCONTAINER=1`.

`bootWebcontainer()` does not launch a container. `@webcontainer/api` (1.6.x) is not a dependency of this package, and default CI does not set the flag. Installing the package in a browser page is a later step. A boot needs a cross-origin-isolated document:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin` on every subresource, because `require-corp` blocks a response that omits it

Those three headers are `WEBCONTAINER_HEADERS`. The bridge preview sends them as well. COEP applies to the whole origin: a page that turns it on cannot load third-party images, fonts, or scripts unless those responses opt in. Do not enable it on the static GitHub Pages site.

## Multi-file preview

`MULTI_FILE_PRESET` is `index.html`, `app.js`, and `app.css`. The word `ready` is written by `app.js`. `POST /api/preview` on the bridge stores that plan and returns `http://127.0.0.1:<port>/api/preview/<id>/index.html`. The judge may open that URL. Its network wall continues only that preview directory. Every other host is still aborted. A preview URL that is not `http://127.0.0.1` or `http://localhost` under `/api/preview/` is ignored, so the judge cannot be pointed at another origin.

`normalizeFilePlan` accepts up to 8 flat file names. `..`, slashes, and a missing `index.html` are rejected. The iframe CSP stays the single-file policy. The preview CSP allows same-origin scripts and styles so `app.js` can load.
