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
| `POST /api/judge` | token | Headless judge. Body `{ html, wantTests?, wantPolish?, leakedDespiteBlock?, checks? }`. `checks` is model-proposed JSON. Hostile checks are rejected and do not run. `400` when the body is invalid, `503` when Chromium cannot launch. |
| `GET /api/sessions/:id/trace` | token | `ledring.trace.v1` for the session. `x-ledring-play` is attached after schema validation. |

A bad `Host` is **421**. A foreign `Origin` is **403**. A missing token is **403**. `GET /` sets an HttpOnly `ledring_token` cookie for the local page and does not print the token in the HTML.

`ledring play --print-config` prints this summary and never prints secrets. ChatGPT plan sign-in is a later slice and is not reported as connected.
