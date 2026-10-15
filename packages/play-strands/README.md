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

Simulated strand ghosts in the Play UI stay labelled simulated until a Gemini slice reads this worker. This package does not remove that label.
