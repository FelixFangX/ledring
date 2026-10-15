# @ledring/play-web

The Play screen, ported from the approved single-file prototype. Vite builds it with `base: ./` into `docs/play`, which GitHub Pages serves at `/play/`.

Demo mode is a synthetic cassette and says so. It does not call a model or a trend host. A bring-your-own key (OpenAI-compatible, Anthropic, or Ollama) streams from the browser; if the provider rejects the call, the page shows that error. OpenAI's API often blocks browser calls. The local bridge (`npx ledring play`) is the path that avoids that.

The custom OpenAI-compatible card also offers one-click free presets: Gemini, Groq, OpenRouter's free router, Cloudflare Workers AI, and NVIDIA NIM. Keys stay in `localStorage`. Gemini, Groq, and OpenRouter answer browser calls. Cloudflare and NVIDIA do not, so those two are sent only to the local bridge, and only after the user runs a test or a live step. The page does not call a preset host on its own.

Sign in with ChatGPT does not report Connected from this static page. Risk scans use `@ledring/play-risk` when the module has loaded, and the earlier pattern scan if it has not. Reddit is not called unless a trend bridge base is set. There is no Google Fonts request.

Visual polish, self-hosted fonts, and the motion pass stay on the Gemini issues.
