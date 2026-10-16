# @ledring/play-web

The Play screen, ported from the approved single-file prototype. Vite builds it with `base: ./` into `docs/play`, which GitHub Pages serves at `/play/`.

The default provider is LEDRING Free AI (中文：LEDRING 免费 AI). It needs no key. A connection test or a live build calls `POST /ai/chat` on the strands worker (`https://strands.ledring.workers.dev` unless `?strandsUrl=`, `window.__LEDRING_STRANDS_URL__`, or localStorage overrides it). The page does not call that route before the user acts. When the shared daily quota is gone, the page shows that and keeps bring-your-own-key and the local bridge available.

Demo mode uses built-in examples and says so. It does not call a model or a trend host. A bring-your-own key (OpenAI-compatible, Anthropic, or Ollama) streams from the browser; if the provider rejects the call, the page shows that error. OpenAI's API often blocks browser calls. The local bridge (`npx ledring play`) is the path that avoids that.

Sign in with ChatGPT does not report Connected from this static page. Risk scans use `@ledring/play-risk` when the module has loaded, and the earlier pattern scan if it has not. Reddit is not called unless a trend bridge base is set. There is no Google Fonts request.

Visual polish, self-hosted fonts, and the motion pass stay on the Gemini issues.
