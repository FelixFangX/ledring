# @ledring/play-providers

Trend sources for Chapter 0, plus streaming model providers (`demo`, `openai-compat`, `anthropic`, `ollama`).

`stream()` yields text deltas. `429` and `5xx` retry with `retry-after` before the first delta. Aborting the signal cancels the upstream request and is not retried. Error text is redacted. The demo provider replays a synthetic cassette and is labelled `DEMO · synthetic cassette, not a live model recording`. It does not call a model.

Sign in with ChatGPT is behind `LEDRING_SIWC=1` plus operator-supplied `LEDRING_SIWC_AUTH_BASE` and `LEDRING_SIWC_API_BASE`. With the flag off, `ready` stays false. See `docs/play-siwc.md`. The official `@siwc/local` package was not on npm when this shipped.

`fetchTrends` never invents items. A failed provider is an error on the report and contributes nothing. If every provider fails, the item list is empty and the UI asks the offline questions.

| Source | Where it runs | Notes |
|---|---|---|
| `model-web-search` | bridge, or a browser call that the provider allows | OpenAI Responses API `web_search`. Items without an `http(s)` URL are dropped. |
| `hn` | browser or bridge | Hacker News Algolia. CORS-open, no key. |
| `reddit` | bridge | `r/popular/top.json`. Browsers are blocked by Reddit's CORS, so the page does not call it. |
| `x` | bridge, off by default | Recent search with the user's own bearer token. The token stays in the bridge. Needs a paid X API tier. Set `xEnabled` to turn it on. |

Google Trends is not implemented. Proxying it is a terms-of-service grey area.

Demo mode (`{ demo: true }`) returns no items and does not call `fetch`.

Timeout is 7 seconds per provider.
