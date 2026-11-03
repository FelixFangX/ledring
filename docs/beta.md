# Publish the public Beta

The npm package is `ledring` at `0.2.0-beta.0`, dist-tag `beta`. CI packs it and smoke-tests `ledring --help`, `flowchart`, `instability`, and `mcp`. This file is the remaining owner step. There is no `NPM_TOKEN` in the agent environment.

The workspace package `@ledring/cli` is private. `scripts/stage-beta.mjs` bundles it, inlines `@ledring/*` (and `zod` and the MCP SDK), and leaves `@ledring/play-bridge` out. The published tarball has no `workspace:` specifiers and no runtime dependencies. `ledring play` in that tarball points at https://play.ledring.dev/play/.

## Checklist

From a clean checkout of the release commit, logged in to npm as an owner who can create the unscoped name `ledring` and publish `@ledring/*`:

```sh
pnpm install
pnpm build
pnpm stage-beta
cd build/npm/ledring && npm publish --tag beta
pnpm -r publish --access public --tag beta --no-git-checks
```

1. `pnpm stage-beta` writes `build/npm/ledring` and `build/npm/ledring-0.2.0-beta.0.tgz`, then runs the smoke test. Publish only if that command exits 0.
2. `npm publish --tag beta` is required. Without `--tag beta`, npm records the release as `latest`.
3. `pnpm -r publish` publishes the public `@ledring/*` libraries at the same version, with `workspace:*` rewritten to `0.2.0-beta.0`. It skips private packages, including `@ledring/cli`, `@ledring/play-web`, and `@ledring/play-strands`.

Confirm:

```sh
npm view ledring@beta version
npx ledring@beta --help
```

## Release notes

Public Beta `0.2.0-beta.0`.

- Install: `npx ledring@beta` or `npm install -g ledring@beta`.
- Beta commands: `flowchart`, `instability`, `inspect`, `mcp`.
- Adapters: `claude-code`, `otel-genai`, `ledring-trace`, `ledring-decisions`.
- Experimental, and not in the install promise: `trust`, `card`, `redwall`, local `play`, the GitHub Action.
- Hosted demo: https://play.ledring.dev/play/
