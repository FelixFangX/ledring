# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `0.2.x-beta` (`ledring@beta`) | Yes |
| `main` branch | Yes |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately via [GitHub Security Advisories](https://github.com/FelixFangX/ledring/security/advisories/new). Include a clear description of the issue, reproduction steps, and potential impact.

You can expect an acknowledgement within **72 hours**, followed by coordinated triage and disclosure once a fix is ready.

## Security & Privacy Model

- **CLI & MCP (`ledring`)**: Local-first and offline by default. `ledring mcp` is strictly read-only and does not return raw step inputs or outputs. No telemetry is collected.
- **Browser Play (`play.ledring.dev`)**:
  - Generated preview pages run inside a sandboxed `<iframe>` (`sandbox="allow-scripts"`) with an offline Content Security Policy (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`).
  - Bring-your-own API keys remain in the browser's `localStorage` and are sent only to the provider endpoint you configure.
  - The local Play bridge (`node packages/cli/dist/bin.js play`) binds only to `127.0.0.1`.
