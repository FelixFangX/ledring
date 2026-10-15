# @ledring/play-bridge

Local HTTP bridge for LEDRING Play. It binds **127.0.0.1** only.

The page talks to `/api/*`. Provider API keys stay in this process (`~/.ledring/play/providers.json`, mode `0600`). Responses and logs are redacted.

| Route | Auth | Behaviour |
|---|---|---|
| `GET /api/status` | none | Secretless liveness probe. The only route that sends `Access-Control-Allow-Origin: *`. |
| `GET /api/providers` | token | Ready flags and model ids. No keys. |
| `POST /api/sessions` | token | Create a session. |
| `GET /api/sessions` | token | List the session index (idea, ending, date). Does not read each session log. |
| `POST /api/sessions/:id/library` | token | Save play events, update the index, and return the projected ending. |
| `GET /api/sessions/:id/replay` | token | Load that session's play log and re-project it. Event ids stay as stored. |
| `POST /api/sessions/:id/steps` | token | SSE deltas (`id`, `event`, `data`). An OpenAI-compatible step may also carry a one-request `baseUrl` and `apiKey` for an allowlisted free host. That key is not written to disk and is redacted from logs and errors. |
| `GET /api/sessions/:id/stream?from=` | token | Replay and follow from an event id. |
| `POST /api/sessions/:id/stop` | token | Abort the upstream request. |
| `POST /api/judge` | token | Headless judge. Body `{ html, wantTests?, wantPolish?, leakedDespiteBlock?, checks? }`. `checks` is model-proposed JSON. Hostile checks are rejected and do not run. `400` when the body is invalid, `503` when Chromium cannot launch. |
| `POST /api/preview` | token | Register a flat multi-file plan. Returns a loopback preview URL. The backend in that response is `iframe`. |
| `GET /api/preview/:id/:file` | preview id | Serve one file from that plan. The id is the capability. No bridge token, so the judge can load `app.js`. |
| `GET /api/sessions/:id/trace` | token | `ledring.trace.v1` for the session. `x-ledring-play` is attached after schema validation. |

A bad `Host` is **421**. A foreign `Origin` is **403**. A missing token is **403**, except `GET /api/preview/:id/:file`, where the unguessable preview id is the capability. `GET /` sets an HttpOnly `ledring_token` cookie for the local page and does not print the token in the HTML.

`ledring play --print-config` prints this summary and never prints secrets. ChatGPT plan sign-in is a later slice and is not reported as connected.
