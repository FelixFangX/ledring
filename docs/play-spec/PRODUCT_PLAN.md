# LEDRING Play: production plan

Status: draft for Felix · 2026-10-14 · nothing pushed, no issues created.
Prototype: `playable/index.html` (v4 = v1 look + build-anything loop + motion layer + responsive + SIWC sign-in stub). Motion spec: `playable/MOTION_DESIGN.md`.

> **Decisions (Felix, 14 Oct 2026):** (1) Auth = **only** the official Sign in with ChatGPT (`@siwc/local`) path, plus BYO key. The Codex `auth.json`/direct and `codex exec` backends are dropped, and the prototype bridge that implemented them was deleted. (2) More playful, game-like UI. (3) Fully responsive: phone, tablet, desktop. (4) Motion system that respects reduced motion, animates only transform/opacity at 60fps, uses interruptible timelines and causes no layout thrash. (5) Game-UI references: see MOTION_DESIGN.md.

LEDRING Play is the playable front door of the LEDRING devtool. You name a thing, a real agent builds it as a
self-contained web artifact, and you supervise: timed choices, the Red Wall, interrogation. The ending is judged from what
was actually built, and every session exports a `ledring.trace.v1` run that the rest of LEDRING (card, flowchart,
drift, red-wall CLI) can read. It should feel like a game and work like a tool. This plan is about getting from the
prototype to that level of reliability.

---

## 0. Research summary (what the best projects do)

| Project | Streaming | Sandbox / preview | Providers / auth | Persistence | Quality gates |
|---|---|---|---|---|---|
| **bolt.diy** (StackBlitz) | Remix `/api/chat` → AI SDK `streamText` → SSE; a streaming parser turns tagged blocks into actions | **WebContainers**: in-browser Node; an ActionRunner queues file/shell actions | `LLMManager` singleton plus a `BaseProvider` class per provider (19+); local providers auto-detected | IndexedDB chats, localStorage settings | Vitest, Playwright, Docker, GH Actions |
| **open-lovable** (Firecrawl) | Next.js routes stream code; it applies file diffs | `SandboxFactory` → **E2B** or **Vercel Sandbox** behind one `SandboxProvider` interface (create/exec/fs/url/kill) | Multi-model via AI SDK | Sandbox-scoped | Light |
| **v0 / Lovable / same.dev** (closed) | Streaming code plus a live preview; agentic multi-step | Hosted sandboxes; **visual edits** (click an element → edit); version history; one-click deploy | Hosted | Projects, versions | n/a. UX lessons: versions you can scrub, a visible plan, an error → "fix it" loop, visual edit |
| **opencode** | Headless **client/server** with HTTP/OpenAPI and a generated SDK (2.0); many clients attach | Local FS with permission rules | Native **Codex/ChatGPT OAuth** (PKCE + device flow), `models.dev` catalog | Local | Plugin API, permission rules |
| **Cline** | gRPC/protobuf "ProtoBus" core; HostBridge per host | Editor host | `ProviderSettingsManager` (one creds store) plus a runtime OAuth token manager; Codex OAuth login | providers.json | Plan/Act approvals, checkpoints and rollback |
| **Vercel AI SDK / assistant-ui** | UI message stream protocol; **resumable streams** (`resume`, stream ids, an explicit stop endpoint) | n/a | Provider registry | `ThreadHistoryAdapter` | Typed tool-approval parts |
| **LibreChat / Open WebUI** | Express/FastAPI SSE; LibreChat's GenerationJobManager plus resumable streams | n/a | Per-provider SDKs; custom OpenAI-compatible endpoints | Mongo / SQLite and Postgres | Docker images, GH Actions; LibreChat relays OTel to Langfuse. Libre WebUI enforces "capability contracts" in CI |

Patterns we adopt:

1. **A provider registry with a single interface**, as bolt.diy and Cline do. Credentials live server-side only, as in Cline.
2. **A sandbox abstraction with swappable backends**, as open-lovable does. For single-file artifacts, a hardened iframe is enough; WebContainers/E2B are later backends for multi-file apps.
3. **Client/server split with a typed protocol**, as opencode does. The bridge is the server, the web game is a client, and the CLI is another client.
4. **Resumable, stoppable streams**, as in the AI SDK and assistant-ui: a reload must not lose a run, and "pull the plug" must cancel upstream work.
5. **Approval as a first-class, recorded event**, as Cline (Plan/Act) and the AI SDK (tool approvals) do. Our QTE and Red Wall map directly onto this, and into `decision` on trace steps.
6. **Capability contracts in CI**, as Libre WebUI does: a provider isn't "supported" until it has a handler, UI, docs and a behaviour test.
7. **UX from v0/Lovable**: a visible plan, version scrubber, error → fix loop, and download/deploy. LEDRING's twist is that the human's supervision is the game.

### 0.1 Codex / ChatGPT auth findings (important)

**There is now an official path: "Sign in with ChatGPT" (SIWC).** As of September 2026:

- OpenAI's cookbook and SIWC quickstart describe it, with a DevKit containing `@siwc/local` and `@siwc/react`.
- An app signs the user in through the browser with PKCE and a loopback callback on 127.0.0.1. It uses a dynamic client (`client_id=dynamic_agent_client`, `agent_name_hint`, a per-install `ext_agent_host_id`) and requests `offline_access` plus `resource.invoke` with scope **`chatgpt.tokens.use.direct`** on resource `https://api.openai.com/v1`.
- Requests then go to the **public Responses API** with that OAuth token.
- Plan usage is **explicitly available to open-source projects and personal projects that run locally**. Paid or remotely hosted apps need the waitlist.
- Users manage per-app limits in ChatGPT Settings → Usage. Apps must show "Using ChatGPT plan" and a "Manage usage" action.
- LEDRING Play is open source and runs locally, so it fits the program as described.

**Codex CLI login reuse (`~/.codex/auth.json` → `chatgpt.com/backend-api/codex/responses`) and `codex exec` shell-out: dropped.**
Earlier research found the first undocumented and ToS-grey (a reused first-party client id, 403s after version bumps, openai/codex#36886 still open). The shell-out added a second auth surface. LEDRING ships neither. The v3 prototype bridge and its mocks were removed.

**Decision for production:**

| Option | Status |
|---|---|
| **SIWC via `@siwc/local` in the bridge** ("ChatGPT plan") | **The only ChatGPT path.** Default provider when the bridge runs |
| BYO key: OpenAI-compatible / Anthropic / Ollama | Kept |
| Demo (recorded cassettes) | Kept; works with no bridge or key |
| ~~Codex auth.json direct~~ / ~~codex exec~~ | Dropped |

**Prototype status:** the drawer has a ChatGPT plan card with a **mock** SIWC flow. It goes Continue with ChatGPT → "opening chatgpt.com" → a consent sheet → Connected, showing **"Using ChatGPT plan"** and **"Manage usage ↗"**. It is labelled `MOCK · SDK not installed here`. While mocked, runs replay the recorded demo builds. `@siwc/local` could not be installed or verified in this environment, so its exact API is in slice S3 and needs checking against the DevKit.

---

## 1. Product shape

**Who it's for:**
- LEDRING users who want to *feel* agent supervision before reading traces.
- Devs who want a fun, honest "build me X" toy that produces real artifacts.
- The project's demo and marketing surface.

**Non-goals for v1:**
- Hosted multi-tenant service (SIWC rules make local-first the right call anyway).
- Multi-file framework apps. That's phase 3, via a WebContainers backend.
- Accounts or cloud sync.

**Core loop:** **Chapter 0: find your idea** (live: trends → trend questions; offline: 3 questions → fragments → 3 directions → brief) → plan → v1 → [QTE | Red Wall | interrogate]×N → judge → ending, plus a playable artifact, a trace and a replay.

**What separates the product from a toy:**
1. A run never silently loses work: resumable streams, autosaved sessions, and replay from the trace.
2. The judge actually interacts with the artifact (Playwright), not just load-time errors.
3. Risk detection is AST-based with precise locations, and a BLOCK provably removes the risk (re-scan plus a sandbox network log).
4. Every provider passes the same contract test suite in CI.
5. Accessibility and reduced motion are first-class, and the timed QTEs have an accessible mode.
6. Deterministic e2e: a recorded-provider "cassette" mode makes full runs reproducible in CI.

---

## 2. Monorepo architecture (inside `FelixFangX/ledring`)

```
packages/
  trace/            (exists) ledring.trace.v1 schema, adapters, riskOf, signatureOf
  play-core/        NEW  pure TS game engine: state machine, signals → instability, trust, endings, prompt builders
  play-providers/   NEW  provider adapters behind one interface (server-side only)
  play-sandbox/     NEW  artifact runner backends: iframe (browser), headless (Playwright), later webcontainer/e2b
  play-risk/        NEW  AST risk detector (acorn + parse5), shared by web (fast pass) and bridge (authoritative)
  play-judge/       NEW  judge: static facts + Playwright interaction smoke tests → verdict + evidence
  play-web/         NEW  Vite + Preact (or Lit) UI, v1 design system, i18n, a11y
  cli/              (exists) adds `ledring play` → starts play-bridge and opens play-web
  play-bridge/      NEW  local HTTP server: serves play-web, /api/* typed protocol, holds credentials, runs judge
```

**Runtime topology (local-first):**

```
browser (play-web)  ──HTTP/SSE same-origin──▶  play-bridge @127.0.0.1:<port>
   │  no secrets                                   ├─ play-providers (SIWC "ChatGPT plan" / openai-compat / anthropic / ollama / demo)
   │                                               ├─ play-risk (authoritative scan)
   └─ <iframe sandbox> artifact preview            ├─ play-judge → Playwright Chromium (headless)
                                                   └─ sessions/ (JSONL event log + trace export)
```

A **static mode** (play-web on GitHub Pages, no bridge) keeps working with Demo plus BYO-key providers in the browser.
In that mode the judge degrades to the in-iframe harness, and the UI says so.

### 2.1 play-core (engine)
- An **explicit state machine** (xstate-style but dependency-free). States: `idle → planning → planWall? → building(v) → codeWall? → fixing → qte(v) → interrogating → judging → ended | aborted`.
- Every transition emits a typed `PlayEvent`. The UI is a pure projection of `state + events`, which makes replay trivial: replay = re-projecting the events.
- **Signals → instability** stays a pure function, `f(retries, apiErrors, runtimeErrors, diff%, openRisks, shortcuts, streaming)`. It is unit-tested with table cases, and its weights are versioned.
- **Prompt builders** are pure functions of `(idea, plan, html, choice, blocked constraints, lang)`. They are snapshot-tested, and each prompt gets a version id recorded in the trace.
- **Endings** are declared as data, `{id, predicate(judgeVerdict, choices), copy keys}`. Each one is tested with a judge fixture that reaches it.

### 2.2 play-providers
The interface:

```ts
interface Provider {
  id: "demo" | "chatgpt-plan" | "openai-compat" | "anthropic" | "ollama";
  status(): Promise<{ ready: boolean; account?: string; plan?: string; models: ModelInfo[]; warning?: string }>;
  stream(req: { system: string; user: string; model?: string; maxTokens?: number; signal: AbortSignal }): AsyncIterable<Delta>;
}
```

- Lives in the bridge (Node). The browser only ever sees `/api/providers` status, never credentials.
- **chatgpt-plan (SIWC):**
  - `@siwc/local` handles sign-in, profiles, refresh and `listModels`.
  - Storage goes in the OS keychain where available (macOS Keychain via `security`, libsecret), otherwise a 0600 file under `~/.ledring/`.
  - UI requirements: "Using ChatGPT plan", a "Manage usage" link, and the usage-limit error as the primary action.
  - Sign-out revokes and deletes local tokens. Usage-limit and "plan usage off" states map to typed errors that the UI renders with a primary **Manage usage** action.
  - The page never sees the token. `/api/providers` returns `{ready, account:{name,emailMasked}, plan, sharing}` only.
- Every provider has **retry with backoff** on 429/5xx (respecting `retry-after`) and **cancellation** wired to "pull the plug".
- They also carry a **token/cost meter**, plus a **cassette recorder** (records `req hash → deltas`) for deterministic tests and the new Demo mode. Demo becomes real recorded model output rather than hand-authored variants, labelled with the model and the date.

### 2.3 play-sandbox (artifact runner)

| Backend | Where | Use |
|---|---|---|
| `iframe` | browser | live preview while streaming |
| `headless` | bridge, Playwright Chromium | judge runs, screenshots, network log |
| `webcontainer` (phase 3) | browser | multi-file/npm apps |
| `e2b`/`vercel` (later, optional) | remote | hosted/CI heavy runs |

**iframe hardening** (the prototype already does most of this):
- `sandbox="allow-scripts"` only (opaque origin, no same-origin).
- An injected CSP meta, `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`, which blocks network, eval and external resources even if the user "lets it through".
- A harness that posts errors, CSP violations and test results via `postMessage`, with a per-render nonce.
- A **separate preview origin** when served by the bridge (`http://127.0.0.1:<port+1>`), so even a sandbox escape can't reach `/api`.
- Partial-stream renders are throttled, and their errors are ignored.

**headless:** a fresh browser context per run, with `route('**', abort)` except `about:`, `data:` and `blob:`. That gives a hard offline mode and a log of attempted requests as evidence. It also sets a CPU and time budget and a viewport matrix (mobile and desktop).

### 2.4 play-risk (AST, not regex)
- Parse with **parse5** (HTML) → collect inline scripts, `<script src>`, `<link href>`, `<iframe>`, `<form action>`, `<meta http-equiv=refresh>`, and inline handlers (`onclick=`). Then parse JS with **acorn** (+ acorn-loose for partial streams) and walk it with a scope-aware visitor:
  - **network:** `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `import()` with a URL, `new Image().src = http…`, and `<img src=http…>`
  - **eval:** `eval`, `new Function`, `Function(…)`, string `setTimeout`/`setInterval`, `document.write` of script tags
  - **storage:** `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie`, Cache API
  - **external:** remote script, link or `@import` (CSS parsed with a tiny tokenizer)
  - **navigation/popup:** `window.open`, `top.location`, `parent.postMessage` to `*` with data, `location.href = http…`
  - **obfuscation tells:** `window['ev'+'al']`, `atob(...)` fed into a sink, computed member access on `window` reaching a sink. These are flagged as `suspicious`.
- Each finding is `{category, severity, node range → line/col, snippet, ruleId}`. Those ids feed the Red Wall copy and trace `decision.reason`.
- **Plan-text risk** uses a small classifier: keyword lexicon EN/zh, plus an optional LLM self-report ("list the web APIs you will use" as JSON) that is cross-checked against the AST after build.
- A **BLOCK contract**: after a fix, re-scan. If the category is still present, count a retry and fix again (max 2). If it's still present after that, mark "leaked despite block" and give a stronger ending penalty. The headless network log must show zero attempts for the blocked categories.
- Tests use a fixture corpus of more than 150 snippets, safe and risky, including obfuscated ones, with precision/recall tracked in CI. It reuses `trace/risk.ts` conventions.

### 2.5 play-judge (real interaction)
1. **Static facts:** whether it parses, the size, the AST risk report, `__ledringTests` present, and the fake-test heuristic. Fake tests are detected via AST: test `pass` expressions that are literals, or that never call a function defined in the artifact.
2. **Load:** Playwright opens the artifact offline at 2 viewports. It records console errors, page errors, blocked requests and first paint, and checks for a blank screen (visible text or painted canvas pixels > threshold).
3. **Generic interaction smoke**, which runs no matter what:
   - tab through focusables
   - click every visible button (max 20)
   - type into inputs
   - send arrow, space and enter keys to the canvas or body
   - for canvas apps: drag across the canvas
   - after each action: check for new errors, a DOM or canvas diff (did something respond?), and a frozen main thread (rAF heartbeat)
4. **Idea-specific checks:** the model is asked once, at judge time, to emit 3–5 **Playwright-free declarative checks** as JSON, e.g. `{action:"click", target:"button:has-text('+1')", expect:{textChanges:"#count"}}`. The judge executes them, and the trace records that they were model-proposed.
5. **Self-tests:** results from `window.__ledringTests`, cross-checked against the fake-test AST rule.
6. **Verdict:** `{validPage, errors[], blankScreen, interactive:boolean, responsiveActions/total, selfTests{pass,total,fake}, risksLeft[], networkAttempts[], a11y{axeViolations}}`. Endings map from the verdict and choices declaratively. Screenshots at each judge stage become trace attachments.
7. **a11y probe:** axe-core on the artifact. It doesn't gate the ending, but it shows up in the recap.

### 2.6 Trace emission (`ledring.trace.v1`)
- The bridge appends `PlayEvent`s to `~/.ledring/play/sessions/<id>.jsonl` (crash-safe). Export maps them to `RunSchema`:
  - `kind:"human"` steps for QTE and Red Wall choices, with `decision{verdict, by:"human"|"unknown"(timeout), reason}`
  - `kind:"llm"` steps for model calls (prompt version, model, tokens, latency, isError)
  - `kind:"tool"` steps for write_file (diff stats plus content hash) and judge
  - `kind:"plan"` steps for the plan
- Extension data lives under `"x-ledring-play"`: ending, signals, blocked/allowed, judge verdict, and prompt versions.
- **Validated with `RunSchema.parse` before download, and in CI.** The prototype already validates.
- Since the schema is the same, `ledring card`, `ledring flow` and `ledring redwall` work on Play sessions unchanged, and play sessions show up in the main LEDRING viewer.
- Replay loads the JSONL, so it works across reloads and can be shared as a file.

### 2.7 Bridge protocol and security
- Endpoints (typed with zod, with a generated client):
  - `GET /api/status`
  - `GET /api/providers`
  - `POST /api/sessions`
  - `POST /api/sessions/:id/steps` (stream: SSE with event ids)
  - `GET /api/sessions/:id/stream?from=<eventId>` (resume)
  - `POST /api/sessions/:id/stop`
  - `POST /api/judge`
  - `GET /api/sessions/:id/trace`
- Security:
  - bind 127.0.0.1 only
  - Host-header allowlist (DNS-rebinding guard)
  - Origin check
  - a per-launch session token injected into the served page
  - no CORS except a secretless `/api/status` probe
  - CSP on play-web
  - preview served from a separate origin
  - logs redact `authorization`, `*token*` and `*key*`
  - `ledring play --print-config` never prints secrets
- The browser-side BYO keys (static mode) stay in localStorage, with a "forget key" control and a warning. In bridge mode, keys move to the bridge store and the browser never holds them.

---

## 3. Quality: tests, CI, e2e, release

| Layer | Tooling | What |
|---|---|---|
| Unit | Vitest | play-core reducers, instability fn, endings table, prompt snapshots, risk rules, fake-test detector, i18n key parity |
| Contract | Vitest + mock upstreams | every provider: happy stream, 401→refresh→retry, 429 backoff, 5xx, malformed SSE, abort, timeout, no secrets in errors/logs |
| Security | Vitest + supertest | bad Host 421, foreign Origin 403, missing token 403, token never in responses, auth.json 0600 + atomic write |
| Judge | Playwright | fixture artifacts → expected verdicts (blank, throws on click, fake tests, canvas game responds, network attempt logged) |
| E2E | Playwright | full runs per ending using **cassette provider**; EN + zh; reduced-motion; keyboard-only run |
| Visual | Playwright screenshots | menu, idea, run mid-stream, QTE, wall, ending at 1280×800, 1440×900, 390×844; diff threshold 0.1% |
| a11y | axe-core in e2e | zero serious/critical violations on all scenes |
| Perf | Lighthouse CI | play-web LCP < 1.5s local, bundle < 120 KB gz |
| Live smoke (manual/nightly, secrets-gated) | real providers | one short run per provider; not required for PRs |

**CI:** GitHub Actions matrix (Node 20/22; ubuntu and macos for the bridge and keychain), pnpm, turbo cache. It runs
`lint → typecheck → unit → contract → build → e2e (cassette) → visual → trace-validate`.
Capability-contract script: a provider or ending only counts as "shipped" once its UI, handler, docs and test all exist.

**Release:** changesets → npm `ledring` (CLI includes `play`), plus play-web deployed to GitHub Pages as static/demo mode.
SBOM plus `npm provenance`. Bridge checks for an outdated `@siwc/local` and warns.

**Telemetry:** none by default. An opt-in, local-only metrics file (ending distribution, latency) can feed the
"other players" percentages honestly later. No prompt content ever leaves the machine except to the chosen provider.

---

## 4. UX and design system (preserve v1)

**Principles:** light, ink-on-paper, mono captions, chunky black display type, a single accent per state. **Banned:** dark
glassmorphism, cyan glow, grain, gradients-as-decoration, Quantic Dream/Sony assets.

**Tokens** (from v1 `p1-head.html`), exported as `@ledring/play-web/tokens.css` and TS:
- Colour:
  - `--bg #EEF1F3`, `--bg2 #E4E8EB`, `--panel #FFF`
  - ink `#0E1114 / #5A6168 / #949BA1`
  - lines `#D4DADE / #BAC2C8`
  - states: calm `#1E63E9`, proc `#E8A50A`, crit `#E01E2B`, ok `#1C9D54`
- Type:
  - Archivo 400–900 for display and UI; IBM Plex Mono for captions and code; Noto Sans SC for zh. Self-host the fonts, with no Google Fonts call in bridge mode.
  - Scale: huge `clamp(48px,8vw,96px)/.92 -0.03em`; h2 52; card title 18–20/800; body 15; cap 11 mono +0.08em uppercase (zh: no uppercase, +0.02em, line-height 1.7).
- Shape: radius 3 (buttons), 6 (cards), 8 (panels), 12 (QTE box); borders 1.5px; hover lift −1px with a `0 4px 0 -1px ink` shadow.
- Grid backdrop: 34px lines at 35% opacity, radial mask.
- **Motion:** the full spec is in `MOTION_DESIGN.md`. Summary:
  - Tokens: `ease.out (.2,.8,.2,1)`, `ease.snap (.3,1.4,.4,1)`, `ease.in (.6,0,.8,.2)`; durations 120/220/420/700ms.
  - One `Motion` layer (in production: `motion` (MIT) `animate()` on WAAPI; GSAP is allowed by its free standard license but not needed).
  - Rules: transform/opacity only; each element has one live animation that a new one cancels (interruptible); measure, then write (FLIP); a global reduced-motion switch.
  - Moments: ink-slab scene wipe with a caption, split-text titles, staggered card deal, card tilt, decision/step banners, QTE slam + stagger + pick stamp + urgency pulse, Red Wall hit-stop + hazard bands + shatter, count-up numbers, ending stamp + flow-path draw + confetti chips (good endings) or shake (bad endings).
- **Playfulness budget:** at most one "big" effect per player action and none while the user reads (no ambient motion besides the LED ring).

**Components:** HUD (brand LED, chapter line, mode chip, lang pill), Ring, Meter (+signal line), Log line, Code pane with
tabs (plan.md / index.html / tests), Preview with test slip, QTE box (single-line options, coloured tag, key cap),
Red Wall box, Toast, Mission card (also used as the idea card), Model drawer, Ending (tag, title, flow SVG, recap metrics,
judge line, artifact frame with a version scrubber, downloads).

**Layout budgets (fully responsive):**
- Desktop ≥1180×760: a fixed stage of 1180×760; the ending fits at 1280×800 with no scroll (an e2e assertion; v4 measures scrollHeight = clientHeight = 760).
- Small desktop / landscape tablet (<1180 or <760 high): the stage fills the viewport (`100dvh`).
- Tablet / ≤900px: scenes scroll vertically. Run = agent+meter row, short log, then code | preview side by side. QTE/Red Wall = bottom sheet. Drawer = `min(380px,100%)`.
- Phone ≤600px: single column; the preview sits *above* the code (46dvh / 30dvh); full-width buttons; the footer hint is hidden; safe-area insets apply.
- Targets: 390×844, 820×1180, 1280×800 screenshots in CI for every scene, EN+zh, with no horizontal overflow (an e2e assertion).

**Accessibility and reduced motion:**
- `prefers-reduced-motion` (or `?rm`): no shake, flash, hit-stop, particles, tilt, wipe or ring spin; every animation becomes a ≤160ms opacity fade; count-ups jump to the value. State is still shown via text, colour and icons.
- **QTE accessible mode** (setting, auto-on with a screen reader): timers pause, there's a visible "time pressure off" note, and the default pick is still recorded as `by:"unknown"` only when the timer is enabled.
- Every option is keyboard-reachable (1–5, I, B, Esc for the drawer). Focus is trapped in the QTE and drawer, with a visible focus ring (2px ink plus 2px offset).
- Live regions announce log lines and the Red Wall. Colour is never the only signal (icons plus words). Contrast is ≥ 4.5:1, so the ink3 grey is not used for essential text.

**i18n:**
- ICU message format (`@formatjs/intl`), EN default and zh-CN, keys parity-checked in CI.
- No idioms in HUD copy. Prompts tell the model which UI language to use.
- Layout tested with zh at 1.25× text length.

**Product UX additions (from v0/Lovable, with a LEDRING spin):**
- Version scrubber during the run, not only at the end.
- "Fix this" on a judge failure, which becomes a new QTE branch.
- Click-to-point in the preview, so the user can tell the agent "this button" (a visual-edit lite, phase 2).
- One-click "open artifact in new tab", plus a downloadable zip (html + trace + judge screenshots).
- A session library on the menu: past runs, endings and replays.

---

## 5. Phasing

- **Phase 1, "real and reliable":** monorepo packages; bridge with BYO providers + Demo; AST risk; headless judge; trace export; v1 design system + motion layer; responsive; e2e with cassettes; a11y.
- **Phase 2, "ChatGPT plan":** SIWC provider (the only ChatGPT path), session library, resumable streams, fix-this loop, recorded Demo.
- **Phase 3, "bigger builds":** WebContainers backend for multi-file apps, plus visual point-and-tell.

---

## 6. Thin-slice issue specs

Each slice is a vertical, demoable, independently mergeable change. The format is loosely mattpocock-style: **What to
build** (the end-to-end behaviour), **Acceptance criteria** (testable checks), **Blocked by**, and **Model**.

- **Grok 4.7** = architecture, backend, logic, bridge, judge, risk, providers, CI.
- **Gemini 4** = frontend UI, visual polish, motion, a11y affordances, i18n copy fit.

### S1. play-core state machine with a cassette provider · Grok 4.7
**What to build:** extract the engine from the prototype into `packages/play-core`: a typed state machine, `PlayEvent`s, a pure instability fn, prompt builders, and endings-as-data. A `cassette` provider replays recorded deltas. A headless runner script plays a full session from a cassette and prints the ending.
**Acceptance criteria:**
- [ ] `pnpm -F play-core test` covers every state transition and all 7 endings via fixtures
- [ ] The instability fn is table-tested; prompt builders are snapshot-tested, with version ids
- [ ] `node scripts/play-headless.mjs --cassette fixtures/snake-polished.json` prints `POLISHED` deterministically
**Blocked by:** none

### S2. play-bridge skeleton with BYO providers · Grok 4.7
**What to build:** a new `packages/play-bridge` (TS, zod-typed `/api/*`, SSE with event ids) wired to `ledring play` in the CLI. Providers: openai-compat, anthropic, ollama, demo. Keys go in the bridge store, never in the browser. (The v3 Codex prototype bridge was deleted; do not port it.)
**Acceptance criteria:**
- [ ] `npx ledring play` serves on 127.0.0.1 and opens the browser; `--port`/`--no-open` work
- [ ] Security tests: bad Host → 421, foreign Origin → 403, missing token → 403, no secret in any response or log (grep test)
- [ ] Contract tests against mock upstreams: stream, abort, 429 backoff, 5xx, malformed SSE
**Blocked by:** S1

### S3. "ChatGPT plan" provider via Sign in with ChatGPT · Grok 4.7
**What to build:** integrate `@siwc/local` in the bridge as the **only** ChatGPT path: sign-in (PKCE, loopback, dynamic client, `chatgpt.tokens.use.direct`), profiles, model list, refresh, sign-out/revoke, and streaming Responses. Credentials go in the keychain or a 0600 file. Expose `/api/providers` status `{ready, account, plan, sharing}` to the UI. First step: verify the real `@siwc/local` API against the DevKit docs. The prototype only mocks the UI.
**Acceptance criteria:**
- [ ] Contract tests against a mock auth server and a mock Responses API: sign-in callback, token exchange, refresh, usage-limit error mapping, sharing=false state, sign-out
- [ ] The browser never receives tokens (network capture assertion in e2e)
- [ ] A "Manage usage" URL is exposed; a usage-limit error becomes a typed error the UI can make primary
- [ ] No code path reads `~/.codex/auth.json` or spawns `codex` (lint/grep check in CI)
- [ ] Docs: eligibility (local and open-source only) and how to revoke
**Blocked by:** S2

### S4. SIWC sign-in UI (from the v4 stub) · Gemini 4
**What to build:** turn the prototype drawer card into the real one, driven by S3 status. States: signed out ("Continue with ChatGPT"), waiting for browser, consent declined, connected with **"Using ChatGPT plan"** pill and **"Manage usage ↗"** link, plan usage off, usage limit hit (primary Manage usage), signed out/expired. Show the account name and masked email; Disconnect.
**Acceptance criteria:**
- [ ] Every state has a screenshot at 390/820/1280 in EN+zh
- [ ] The labels "Using ChatGPT plan" and "Manage usage" appear verbatim (per the SIWC guidelines)
- [ ] The connect transition uses the motion layer (stamp on "Connected"), reduced-motion safe
**Blocked by:** S3, S21

### S5. AST risk detector · Grok 4.7
**What to build:** `packages/play-risk` with parse5 + acorn (+ acorn-loose) covering the rule set in §2.4, with locations, rule ids and severity. Ship it in both the bridge (authoritative) and the browser (fast pass during streaming).
**Acceptance criteria:**
- [ ] A corpus of 150 or more fixtures; recall on risky ≥ 0.97 and precision ≥ 0.95, reported in CI
- [ ] Obfuscation cases (`window['ev'+'al']`, `atob`→sink) are flagged `suspicious`
- [ ] Incremental scan of a partial stream does not throw
- [ ] The BLOCK contract (re-scan, retry ≤ 2, "leaked despite block") is implemented in play-core
**Blocked by:** S1

### S6. Headless judge v1 · Grok 4.7
**What to build:** `packages/play-judge`: static facts, offline Playwright load at 2 viewports, generic interaction smoke, blank-screen detection, network-attempt log, self-test cross-check with AST fake-test detection, and screenshots. It returns a typed verdict, and endings map from it.
**Acceptance criteria:**
- [ ] Fixtures: blank page → BROKEN; throws on click → BUGGY; fake tests → FAKE; responsive canvas game → interactive=true; fetch attempt is logged even though it was blocked
- [ ] Runs in under 8s per artifact on CI; the browser is reused across runs
**Blocked by:** S1, S5

### S7. Model-proposed declarative checks · Grok 4.7
**What to build:** at judge time, ask the model for 3–5 JSON checks (schema-validated, with a constrained action vocabulary), execute them, and record "model-proposed" in the trace.
**Acceptance criteria:**
- [ ] An invalid or hostile JSON check is rejected safely (no arbitrary selectors beyond the allowed grammar, no navigation)
- [ ] Check results appear in the verdict and in the ending recap
**Blocked by:** S6

### S8. Trace export and session store · Grok 4.7
**What to build:** append-only JSONL session log in the bridge, mapped to `ledring.trace.v1` with `x-ledring-play`, validated via `RunSchema`. `ledring card/flow` work on play sessions.
**Acceptance criteria:**
- [ ] Every e2e cassette run produces a trace that passes `RunSchema.parse`
- [ ] Killing the bridge mid-run leaves a recoverable session; reload resumes from the last event id
- [ ] `ledring card session.json` renders
**Blocked by:** S1, S2

### S9. Resumable stream and real "pull the plug" · Grok 4.7
**What to build:** SSE event ids, a resume endpoint, and a stop endpoint that aborts the upstream request or child process and persists the partial output.
**Acceptance criteria:**
- [ ] An e2e test reloads mid-build; the stream continues and the code pane is restored
- [ ] Pull the plug aborts the upstream request within 1s and persists partial output (mock upstream)
**Blocked by:** S8

### S10. CI pipeline and capability contracts · Grok 4.7
**What to build:** a GH Actions matrix, turbo cache, the stage order in §3, the capability-contract script, visual-diff artifact upload, and changesets release with provenance.
**Acceptance criteria:**
- [ ] A PR that adds a provider without its contract test fails CI with a clear message
- [ ] Visual diffs are uploaded on failure
- [ ] A release dry-run produces npm tarballs plus a Pages build
**Blocked by:** S2

### S11. play-web scaffold and design tokens (v1 look) · Gemini 4
**What to build:** a Vite + Preact app in `packages/play-web` with `tokens.css`/`tokens.ts` from §4, self-hosted fonts, and HUD, Ring, Meter, Log, Toast and Button components matching v1 pixel-for-pixel. A Storybook-lite gallery page shows them.
**Acceptance criteria:**
- [ ] Screenshot diffs against the v1 references (`playable/shots/*`) for HUD, ring states and buttons are within threshold
- [ ] No external font or network requests in bridge mode
- [ ] Banned-styles lint: no `backdrop-filter` on dark, no cyan glow, no grain
**Blocked by:** none (it can run in parallel with S1)

### S12. Menu and the "type it yourself" idea screen (secondary to S22) · Gemini 4
**What to build:** the v1 menu with the host line that remembers the last run, and the "What should it build?" screen. The idea card is a full-width mission card with an inline input; the 4 preset cards carry a demo/live tag. A mode chip opens the drawer.
**Acceptance criteria:**
- [ ] Enter submits; empty input shakes the card gently (reduced motion: outline only)
- [ ] EN/zh copy fits without wrapping at 1280×800 and 390×844
- [ ] Keyboard-only path: Tab → type → Enter starts a run
**Blocked by:** S11

### S13. Model drawer · Gemini 4
**What to build:** a right drawer listing providers with live status from `/api/providers`: a ChatGPT plan card (see S4), BYO keys, Ollama and Demo. Focus is trapped, Esc closes it, and test-connection feedback is shown.
**Acceptance criteria:**
- [ ] Matches the SIWC UI guidelines (connection card states, usage-limit messaging)
- [ ] Never renders a secret; key inputs are write-only once saved (show "•••• saved")
- [ ] axe: zero serious violations
**Blocked by:** S11; data from S2/S3

### S14. Run screen: v1 layout with streaming polish · Gemini 4
**What to build:** the agent card, meter with signal line, log, a code pane with plan/index/tests tabs and a streaming cursor, preview with a test slip, and the trust bar. Smooth auto-scroll that pauses when the user scrolls up, a per-version diff highlight, and an in-run version scrubber.
**Acceptance criteria:**
- [ ] 60fps while streaming 20 KB (Performance panel trace in CI using a cassette)
- [ ] The LED ring and meter respond to signals within 1 frame of the event
- [ ] Reduced motion: no ring spin, no pops
**Blocked by:** S11, S1

### S15. QTE, Red Wall and interrogate: feel and accessibility · Gemini 4
**What to build:** the v1 QTE box (single-line options, coloured tags, key caps, timer bar, slow-mo), the Red Wall (shake, flash, pulsing BLOCK, one-line finding with the rule id), and the interrogate answer inline. Add an accessible mode that pauses timers, live-region announcements and a focus trap.
**Acceptance criteria:**
- [ ] Keyboard: 1–5, I, B/Space/Enter all work; a timer timeout is announced
- [ ] Reduced motion swaps shake/flash for a static red border
- [ ] Juice per MOTION_DESIGN §3: QTE slam + option stagger + pick stamp + urgency pulse <3s + AUTO stamp on timeout; Red Wall hit-stop 90ms + hazard bands + shatter on BLOCK / MISSED stamp
- [ ] Bottom-sheet layout ≤900px with safe-area padding
**Blocked by:** S14, S21

### S16. Ending screen that fits 1280×800 · Gemini 4
**What to build:** the tag, title, flow SVG of the actual path (with untaken options greyed), 4 recap metrics, the judge evidence line (expandable to the full verdict with screenshots), the artifact frame with version scrubber and play button, downloads (html, trace, zip), and replay/new/menu.
**Acceptance criteria:**
- [ ] An e2e assertion that `#end` has no scroll at 1280×800 for every ending
- [ ] The flow SVG handles 2–8 decision columns without overlap
- [ ] zh and EN verified
**Blocked by:** S14, S6

### S17. Session library and replay · Gemini 4 (UI) + Grok 4.7 (API)
**What to build:** a menu section listing past sessions (idea, ending, date), with open → replay from events and export.
**Acceptance criteria:**
- [ ] 100 sessions list in under 100ms
- [ ] Replay is deterministic (identical frames for a cassette run)
**Blocked by:** S8, S16

### S18. Recorded Demo mode · Grok 4.7
**What to build:** record real model runs (one per preset × branch set) into cassettes with model and date labels, replacing the hand-authored demo variants. A static Pages build plays them with no bridge.
**Acceptance criteria:**
- [ ] Every Demo artifact passes the judge, consistent with its labelled ending
- [ ] The UI shows "recorded from <model> on <date>"
**Blocked by:** S1, S6

### S19. Responsive layout and i18n hardening · Gemini 4
**What to build:** the breakpoints from §4 (desktop stage / ≤900 stacked scroll with code|preview / ≤600 preview-over-code, bottom-sheet QTE, full-width actions), ICU messages, a CI key-parity check, and a zh typography pass.
**Acceptance criteria:**
- [ ] Visual snapshots at 390×844, 820×1180 and 1280×800 for all scenes, EN+zh
- [ ] An e2e check for no horizontal overflow on any scene; tap targets ≥ 44px on phone
- [ ] Zero missing or unused keys
**Blocked by:** S12–S16

### S20. WebContainers backend (phase 3 spike) · Grok 4.7
**What to build:** run a multi-file Vite artifact in a WebContainer behind the `play-sandbox` interface, with the judge pointed at its preview URL.
**Acceptance criteria:**
- [ ] One preset builds as a multi-file app and the judge runs against it
- [ ] Documented COOP/COEP requirements and limits
**Blocked by:** S6

### S21. Motion system (`play-web/motion`) · Gemini 4 (+ Grok 4.7 for the perf CI gate)
**What to build:** port `p6b-motion.js` to a typed module on `motion`'s `animate()`: tokens, `run/stagger/split/pop/stamp/shake/hitstop/count/burst/fly/wipe`, the one-animation-per-element cancel rule, a global reduced-motion store (OS + in-app toggle), and a `FAST` test mode. Then wire the moments in MOTION_DESIGN §3 into each screen.
**Acceptance criteria:**
- [ ] Lint rule: animations may only target `transform`, `opacity` (and `stroke-dashoffset` on the flow SVG); CSS `transition` on layout props fails CI
- [ ] Perf: a cassette run on CI Chrome records no long frames >50ms during wipe/QTE/ending, and no forced reflow inside animation callbacks (Performance trace check)
- [ ] Interruptibility: clicking through a wipe or picking during the QTE stagger never leaves elements stuck (e2e spam-click test)
- [ ] `prefers-reduced-motion` e2e run: no transform animations started (instrumented `Element.animate`)
**Blocked by:** S11

### S22. Chapter 0: inspiration discovery · Grok 4.7 (engine, generator, LLM synthesis, trace) + Gemini 4 (screen, motion)
**Why:** Felix's v4 feedback was that preset cards and a blank idea box *hand* ideas to the player. The opening must draw out the player's **own** material.
**What to build:**
- An interrogation in which CX-417 questions the player. There are 5 beats: today's annoyance, something you love or play, who it's for, the vibe (tool/game × cozy/chaotic), and an optional rule. Each beat offers 3–4 Detroit-style choices plus free text; "Stuck? get a nudge" suggests an answer.
- Answers become **memory fragments** F1–F5, pinned on an evidence board.
- **Synthesis** produces 3 distinct directions, each listing its source fragments:
  - Live (SIWC ChatGPT plan / BYO key): a JSON-schema'd model call that must use ≥2 fragments per direction. On invalid output it falls back to the generator, and the trace records the error.
  - Demo / no key: a deterministic **combinatorial generator**: mechanic templates (8 now: chase, rush, doodle, tally, timer, split, grid, nudge) × the player's nouns and quoted phrases × vibe twist × rule. It is seeded by a hash of the answers plus a reroll counter. Group-only mechanics are skipped for solo players. The set is two picks of the chosen kind plus one wildcard of the other kind.
- Player verbs: **pick**, **fuse two**, **reroll a fragment** (it flips and the directions regenerate), **reroll directions**, and **rewrite** the brief in place. The result is a one-line brief that feeds `playRun`.
- Presets are demoted to small "watch a sample build" icons. An "I already have an idea →" link leads to the free-text box.
- Trace: each event becomes a step `inspiration:{answer|nudge|directions|directions_error|fuse|pick|reroll_fragment|reroll_directions|rewrite|brief}`. `x-ledring-play.inspiration` holds `{fragments, directions, picked, brief, edited, demoArchetype}`. The ending shows "From your fragment F1 “…” → <title>, the thing you built."
**Acceptance criteria:**
- [ ] The generator is a pure function in play-core, table-tested: ≥20 answer sets give ≥3 distinct directions each, every direction cites ≥2 fragment ids, and identical inputs give identical outputs
- [ ] Brief diversity: across 50 random answer sets, ≥80% of first-direction briefs are unique (CI metric)
- [ ] The live synthesis contract test against a mock model covers valid JSON, prose-wrapped JSON, invalid JSON → fallback, and fragment ids not in the set being dropped
- [ ] The trace from an e2e run validates against `RunSchema` and contains the inspiration steps in order
- [ ] Keyboard path: 1–4 / S per question, Enter for free text; the board's reroll buttons have labels; phone layout puts the board below the questions with fragments in two columns
- [ ] EN+zh copy, with screenshots at 1280×800 and 390×844
**Blocked by:** S1, S3 (live synthesis), S21 (motion)
**Known gap to close:** the demo cannot build an arbitrary brief. It re-titles the closest recorded engine (snake/pomodoro/pixel/splitter) and says so in a toast. Real builds need a model. S18's recorded demo should add cassettes per mechanic.

### S23. Chapter 0 v2: two inspiration sources (live trends vs offline questions) · Grok 4.7 (providers, prompts, trace) + Gemini 4 (cards, motion)
**Why:** Felix (v5 review) wants the inspiration source to depend on whether an LLM is connected.
**Live (SIWC ChatGPT plan or BYO key):**
- A `TrendSource` interface: `{id, label, available(ctx), fetch(): TrendItem[]}`, where `TrendItem = {title, source, url, ts, provider, fetchedAt}`. The prototype ships these, in order:
  1. `model-web-search`: OpenAI Responses API with `tools:[{type:"web_search"}]`, asking for JSON items that must carry URLs. Only for OpenAI-hosted keys today; via the bridge for SIWC once S3 lands.
  2. `hn`: the Hacker News Algolia API (CORS-open, no key). Verified live from the box.
  3. `reddit`: `r/popular/top.json`, best effort. Reddit's CORS and rate limits make it fail from the browser in tests (it is recorded as `ok:false` in the trace). Move it to the bridge in production.
  4. **X API (documented, not built):** a bridge-only provider using the user's own X developer bearer token (keychain), calling recent search (`GET /2/tweets/search/recent`) and trends by WOEID where the tier allows. Token never in the page; respect X's developer terms and rate limits. Needs a paid tier; off by default.
  - Not done: Google Trends RSS (no CORS; it would need a proxy, and proxying it is a ToS grey area, so it is skipped).
- Results are fetched in parallel, interleaved, capped at 8, and deduplicated. Each card shows its source and relative time. **Never fabricated:** if every provider fails, the UI says "No live feed reachable" and switches to the offline questions. Demo mode never shows trend cards.
- The model picks 3 trends and writes one provocative question each (JSON with trend ids; invalid ids are dropped, <3 questions → a simple fallback question per trend). The chosen trends become fragments T1–T3 and the answers F1–F3. Directions must combine ≥1 trend with ≥1 answer.
**Offline (demo / no key):** exactly 3 questions, each rooted in a theme:
- running on autopilot (programming vs free will)
- which decision you'd hand to a machine (trust between human and machine)
- who should notice when it works (being seen; choosing for whom)

Each has 3 choices, free text and a nudge. Answers become F1–F3. Generator v2 uses whole-sentence templates per decision family (stop / pay / make + 2 wildcards), audience × tone, and the player's phrase quoted (「…」 or “…”) instead of spliced into nouns.
**Trace:** `inspiration:trends` (fetchedAt, per-provider ok/count/error, items with url+ts), `inspiration:questions` / `questions_error`, answers, directions, pick/fuse/reroll/rewrite, brief. `x-ledring-play.inspiration.source = live-trends | offline-questions`, plus `trends[]` with `used` flags.
**Acceptance criteria:**
- [ ] Provider contract tests against mocks: ok, HTTP error, timeout (7s), malformed JSON, items without URLs (dropped for model search)
- [ ] An e2e test with all providers failing shows the offline questions, with no trend card rendered
- [ ] A test that demo mode makes zero network requests to trend hosts
- [ ] Offline generator: 3 questions × all choice combos (27) plus 20 free-text sets → 3 directions each, no template placeholders left, zh briefs with no bare spliced noun phrases (lint: every player phrase appears inside 「」)
- [ ] Screenshots, live and offline, at 1280×800 and 390×844, EN+zh
**Blocked by:** S22, S3 (SIWC web search via bridge)

---

```

## 7. What Felix can run today (prototype)

```bash
open detroit/playable/index.html          # or serve the folder: npx serve detroit/playable
# Model ▸ ChatGPT plan ▸ Continue with ChatGPT → mock consent → "Using ChatGPT plan" + "Manage usage ↗"
# Demo and ChatGPT plan (mock) play the recorded builds; a BYO key (OpenAI-compatible / Anthropic / Ollama) builds anything
# ?rm forces reduced motion · ?fast skips animation (tests) · try phone width in devtools
```

---
## v7 update: "wow layer" (S24–S27)
Design rationale: KOJIMA_WOW.md. Code: p9c-wow.js + p2d-css.html.

### S24 Strands (real async backend). Owner: Grok 4.7 (backend), Gemini 4 (UI)
- **Today:** fully simulated ghosts (12, labelled) plus your own strands in localStorage (`SAVE.strands`).
- **Real design:**
  - `POST /strands` with `{trace_hash, title, ending, brief, signatures[], lang}`. No code and no PII. Opt-in per run, and the share step is shown before sending.
  - `GET /strands?near=<brief embedding bucket>` returns 20 nodes.
  - `POST /strands/:id/like` takes likes only, rate-limited per device key. No comments and no downvotes (the Kojima rule).
  - Storage: Postgres + pgvector. Moderation runs on title/brief through the existing risk scanner and a model check.
  - Abuse: per-IP and device quotas; strands expire after 30 days unless liked.
- **Acceptance:** the "simulated" label disappears only for server-backed nodes. Offline falls back to simulated with the label.

### S25 Fourth-wall system. Owner: Gemini 4
- **Built:** time, device, battery (no prompt), past runs, tab switches, tab-away duration, idle.
- **Next:**
  - Resize/rotate "port swap" Red Wall.
  - Colonel-style corruption on COMPROMISED.
  - Never use the camera, mic, location or clipboard.

### S26 Scan + alert. Owner: Grok 4.7
- **Built:** the sweep and the DOM-range line pin.
- **Next:**
  - Pin all findings, not just the first.
  - Keep the pin through the wall.
  - On phone, sweep only the code area (it currently also passes over the preview block).

### S27 Sound. Owner: Gemini 4
- **Built:** a synthesized SFX set (click, tick, alert, thud, stamp, ring, blip, scan, ping, win, lose, like). Off by default.
- **Next:** a mix bus with a master volume and duck under codec.
