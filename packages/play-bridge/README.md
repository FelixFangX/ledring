# @ledring/play-bridge

Local HTTP bridge for LEDRING Play. It binds **127.0.0.1** only.

The page talks to `/api/*`. Provider API keys stay in this process (`~/.ledring/play/providers.json`, mode `0600`). Responses and logs are redacted.

| Route | Auth | Behaviour |
|---|---|---|
| `GET /api/status` | none | Secretless liveness probe. The only route that sends `Access-Control-Allow-Origin: *`. |
| `GET /api/providers` | token | Ready flags and model ids. No keys. |
| `POST /api/sessions` | token | Create a session. |
| `POST /api/sessions/:id/steps` | token | SSE deltas (`id`, `event`, `data`). |
| `GET /api/sessions/:id/stream?from=` | token | Replay and follow from an event id. |
| `POST /api/sessions/:id/stop` | token | Abort the upstream request. |
| `POST /api/judge` | token | `501` until the judge package is running. |
| `GET /api/sessions/:id/trace` | token | `501` until session export lands. |

A bad `Host` is **421**. A foreign `Origin` is **403**. A missing token is **403**. `GET /` sets an HttpOnly `ledring_token` cookie for the local page and does not print the token in the HTML.

`ledring play --print-config` prints this summary and never prints secrets. ChatGPT plan sign-in is a later slice and is not reported as connected.
