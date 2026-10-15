# @ledring/play-providers

Trend sources for Chapter 0, and (in a following slice) the streaming model providers.

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
