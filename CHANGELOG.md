# Changelog

## 0.2.0-beta.0

Public Beta.

- The npm package is `ledring` (`npx ledring@beta`, `npm install -g ledring@beta`). The tarball bundles the workspace libraries and has no `workspace:` dependencies.
- Beta commands are `flowchart`, `instability`, `inspect`, and read-only `mcp`.
- Adapters in this tag: `claude-code`, `otel-genai`, `ledring-trace`, `ledring-decisions`.
- `trust`, `card`, `redwall`, the local Play bridge, and the GitHub Action are experimental. The bridge is not in the npm package. Hosted Play stays at https://play.ledring.dev/play/.
- `@ledring/*` libraries publish at the same version for programmatic use.

Publish steps for maintainers: [docs/beta.md](docs/beta.md).
