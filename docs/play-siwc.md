# Sign in with ChatGPT

LEDRING Play does not read a Codex credential file and does not spawn `codex`. The only ChatGPT path is the official Sign in with ChatGPT flow, plus bring-your-own-key providers.

`@siwc/local` was not installable from npm on 15 Oct 2026 (the package returned 404). Until that SDK can be imported, the bridge ships a feature-flagged client:

- `LEDRING_SIWC` must be exactly `1`. Otherwise the provider reports `ready: false` and sign-in refuses to start. The UI must not show "Using ChatGPT plan" or "Connected" in that state.
- `LEDRING_SIWC_AUTH_BASE` and `LEDRING_SIWC_API_BASE` are required. The client does not guess a production OAuth host. Relative paths under the auth base are a stand-in (see the TODO in `packages/play-providers/src/siwc.ts`) and must be replaced by the DevKit client when it is public.
- Tokens are written atomically to `siwc-token.json` in the Play home (`~/.ledring/play` by default) with mode `0600`. They are not returned by `/api/providers` and are redacted from logs.
- A usage-limit response becomes the typed error `usage_limit`. Plan sharing turned off becomes `plan_off`. Both carry the public Manage usage link: https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- Sign-out posts a revoke request to the configured auth base and deletes the local file.

Eligibility, per OpenAI's published ChatGPT-plan guidance, is local open-source apps. Revoke access from the ChatGPT security settings as well as from Play's sign-out.

Do not point the auth base at a guessed production URL. A wrong base fails the token request; it does not report success.
