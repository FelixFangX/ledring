# @ledring/play-sandbox

Offline frame for a Play artifact.

- The iframe attribute is `sandbox="allow-scripts"` only, so the document origin is opaque.
- `withHarness` injects a Content-Security-Policy meta: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`.
- The harness posts `{ __lr, t, d }` to the parent. `readHarnessMessage` accepts it only for that render's nonce.
- Static Pages mode has no Playwright browser. The page must show `DEGRADED_JUDGE_NOTICE` and judge from this harness. The bridge runs `@ledring/play-judge` instead.

`createNonce()` returns 32 hex characters. Pass that string to `withHarness`. Do not interpolate an untrusted nonce into the script.
