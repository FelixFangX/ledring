# @ledring/play-strands

Cloudflare Worker + D1 for LEDRING Play strands. **This repo does not deploy it.** There is no API token, account id, or real database id in the tree.

D1 has no pgvector. A strand is stored under a **lexical hash bucket** of its brief: lowercase tokens, sorted and de-duplicated, then FNV-1a modulo 256. `GET /strands?near=<bucket>` returns that bucket and the two neighbours (wrapping at `00` and `ff`), at most 20 rows. Same words in a different order share a bucket. This is not a semantic embedding.

Rows expire 30 days after `created_at` unless `likes > 0`. Likes only: a device can like a strand once, and there is no downvote. Quotas: 8 posts per device per day, 20 posts per IP per day, 30 like attempts per device per hour. The stored actor is a SHA-256 prefix, never the raw device key or IP.

`POST /strands` accepts only `traceHash`, `title`, `ending`, `brief`, `signatures`, `lang`, `optIn`, and `deviceKey`. `optIn` must be `true`. Any other field (including code, html, or email) is rejected and nothing is written. Title and brief that the Play risk lexicon flags are rejected with `422`.

## What Felix creates in the Cloudflare dashboard

1. A Cloudflare account that can create Workers and D1.
2. No secrets. The worker does not read API keys.
3. A D1 database named `ledring-play-strands`. Copy its `database_id` into `wrangler.toml` in place of `00000000-0000-0000-0000-000000000000`.

## Deploy (do this locally; CI never runs it)

From the repo root, with Node 20+ and pnpm:

```sh
pnpm install
pnpm --filter @ledring/play-risk build
pnpm --filter @ledring/play-strands build
cd packages/play-strands
npx wrangler login
npx wrangler d1 create ledring-play-strands
```

Put the printed `database_id` in `wrangler.toml`, then:

```sh
npx wrangler d1 execute ledring-play-strands --remote --file=schema.sql
npx wrangler deploy
```

`schema.sql` is the whole schema. Do not add an embedding column. The placeholder database id will refuse to deploy, which is intentional until the create step above has been run.

The worker is deployed as `strands` at https://api.ledring.dev, and Play uses it by default: strands are server-backed out of the box. The `?strandsUrl=` query parameter, `window.__LEDRING_STRANDS_URL__`, and the saved localStorage value still override it. Play falls back to labelled simulated strands only when the server is unreachable or returns no strands. `api.ledring.dev` is the only external host Play's offline tests allow. The workers.dev URL is turned off (`workers_dev = false` in `wrangler.toml`).

## Free AI (`POST /ai/chat`)

Play's default provider, LEDRING Free AI, calls this route. The worker uses the Workers AI binding. There is no API key in the repo, in the request, or in D1. Prompts are not stored. The actor stored for the counter is a SHA-256 prefix, never the raw address.

`wrangler.toml` contains:

```toml
[ai]
binding = "AI"
```

Model: `@cf/openai/gpt-oss-120b`. Checked on 2026-10-15 against the Workers AI catalog: it is Cloudflare-hosted, it is not on the paid-only list (that list was Kimi K2.6, Kimi K2.7 Code, and GLM 5.2), and the published price is 31,818 neurons per million input tokens and 68,182 neurons per million output tokens. Workers Free includes 10,000 neurons per day. This route therefore caps each reply at 2,048 tokens, each address at 12 requests per day, and the whole worker at 40 requests per day. Past either cap it returns `429` and does not call the model:

- per address: `error.code` `rate_limited`
- shared daily quota, or a Workers AI failure: `error.code` `quota_exhausted`

The body is an OpenAI chat request (`messages`, optional `max_tokens`, optional `temperature`). The response is OpenAI-compatible SSE (`choices[0].delta.content`, then `data: [DONE]`). The client model id is ignored; the worker always runs `@cf/openai/gpt-oss-120b`. Bodies over 48,000 bytes, or message text over 24,000 characters, return `413`.

CORS allows `https://felixfangx.github.io`, plus `http://localhost` and `http://127.0.0.1` on any port (https on those hosts too). Any other `Origin` gets `403` and no `Access-Control-Allow-Origin`. Strand routes stay `*`.

## Deploy Free AI (on your machine, after merge)

CI does not deploy. The D1 database id in `wrangler.toml` is already filled in. From the repo root, with Node 20+:

```sh
pnpm install
pnpm --filter @ledring/play-risk build
pnpm --filter @ledring/play-strands build
cd packages/play-strands
npx wrangler login
npx wrangler deploy
```

The `[ai]` binding needs no secret. Workers AI has to be available on the account. Keep the worker name `strands`; https://api.ledring.dev serves both `/strands` and `/ai/chat`. Re-run `npx wrangler d1 execute ledring-play-strands --remote --file=schema.sql` only when the database is new; the quota counter reuses `strand_quotas`.
