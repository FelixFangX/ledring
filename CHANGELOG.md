# Changelog

## Unreleased

- A step can carry provenance: the file, 1-based line, and source event id the adapter actually had. A cut final JSONL line sets `truncated` on the run.
- Instability notes are observed, derived, or unknown. A check counts as passed only when its output says so. A denied risky command is not scored as if it ran. No instruction means the score is not drift from an instruction.
- Red Wall `stopped` now points at the later step that moved on. A trace that ends on the block is `unknown`, and an interrupt is not a deny. `--fail-on` still ignores unknown.
- The branch-tree report lists the highlighted run's steps and keeps the plate, the list, and the source note on one selection.

## 0.2.0-beta.0

Early public Beta. One install path: `npm install -g ledring@beta` (Node ≥ 20), after the package is published. See [docs/beta.md](docs/beta.md).

- The npm package is named `ledring`. It bundles flowchart, instability, trust, card, redwall, and the read-only MCP server. Runtime dependencies are `@modelcontextprotocol/sdk` and `zod`.
- `ledring flowchart`, `ledring instability`, and `ledring mcp` run from that install.
- The local Play bridge is not in the npm package. The browser demo is [Play](https://play.ledring.dev/play/). From a checkout, `node packages/cli/dist/bin.js play` still serves the bridge.
- Workspace libraries stay at 0.1.0 and are not published on their own. `v0.1.0` remains the git tag for the pre-npm source snapshot.
