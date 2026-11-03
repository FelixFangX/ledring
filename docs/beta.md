# LEDRING Beta

Early public Beta of the `ledring` command. One install path. This file is the publish checklist. It does not publish anything.

## Version

| Stage | Version | npm dist-tag | Install |
|---|---|---|---|
| This Beta | `0.2.0-beta.0` | `beta` | `npm install -g ledring@beta` |
| Later Beta fixes | `0.2.0-beta.1`, `0.2.0-beta.2`, … | `beta` | same command |
| Stable | `0.2.0` | `latest` | `npm install -g ledring` |

`v0.1.0` is the git tag for the pre-npm source snapshot. It was not published to npm. Workspace libraries (`@ledring/trace`, `@ledring/flowchart`, and the rest) stay at `0.1.0` and are not published in this Beta. The `ledring` package bundles the ones the command needs.

Do not publish a prerelease as `latest`. Stable is a version with no prerelease suffix, published with `--tag latest`.

## Install

Node ≥ 20.

```sh
npm install -g ledring@beta
```

Then:

```sh
ledring flowchart ~/.claude/projects/<project>/ --out report.html
ledring instability ~/.claude/projects/<project>/
ledring mcp
```

That is the only supported install. A source checkout is for contributors and for the local Play bridge (`node packages/cli/dist/bin.js play`). The bridge is not in the npm package: it depends on a headless browser, and Play in the browser does not need it for the default demo.

## What gets published

Package name `ledring`, from `packages/cli`. `pnpm pack` writes a tarball whose manifest has:

- `name`: `ledring`
- `bin`: `ledring` → `dist/bin.js`
- `engines.node`: `>=20`
- `publishConfig.access`: `public` (applied at pack time)
- `dependencies`: `@modelcontextprotocol/sdk` and `zod` only

`dist/bin.js` inlines flowchart, instability, trust, card, redwall, and the read-only MCP server. `@ledring/play-bridge` is left external, so the install does not pull in Playwright. `ledring play` is not in the package.

## Verify before you publish

From a clean checkout, Node 20 or 22:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
node packages/cli/dist/bin.js flowchart fixtures/claude-code --title "fix login bug" --out /tmp/ledring-report.html
node packages/cli/dist/bin.js instability fixtures/claude-code
node packages/cli/dist/bin.js mcp </dev/null
```

`flowchart` prints `Wrote /tmp/ledring-report.html — 6 runs, 2 forks`. `instability` exits 0. `mcp` exits 0 when stdin closes. `pnpm test` packs the tarball, installs it in a temp directory, and runs those three commands from that install.

Confirm the name is still free (or already yours) before the first upload:

```sh
npm view ledring version
```

A 404 means the name is free. If the view prints a version you did not publish, stop.

## Publish

Requires an npm account that can publish the `ledring` name. No token is stored in this repo. From the repo root, on the commit you intend to release:

```sh
pnpm install
pnpm --filter ledring publish --tag beta --access public
```

`prepack` rebuilds `dist/` and copies `LICENSE` into the package for the tarball. `postpack` deletes that copy. The command uploads `0.2.0-beta.0` (or the version in `packages/cli/package.json`) to the `beta` dist-tag.

Dry-run, no upload:

```sh
pnpm --filter ledring publish --tag beta --access public --dry-run
```

After it succeeds, `npm install -g ledring@beta` is the install path above.

## Promote to stable

1. Set `packages/cli/package.json` `version` to `0.2.0` (no `-beta` suffix).
2. Note it in `CHANGELOG.md`.
3. `pnpm --filter ledring publish --tag latest --access public`.
4. The install command becomes `npm install -g ledring`. Leave the `beta` tag in place until you decide to move it.
