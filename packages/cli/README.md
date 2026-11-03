# ledring

Branch tree and instability score for AI agent traces. Public Beta.

Agents drift off the instruction. The fork is the part you don't review.

```sh
npx ledring@beta flowchart path/to/traces --out report.html
npx ledring@beta instability path/to/traces
npx ledring@beta mcp
```

Node.js 20 or newer. Read-only over local traces. No model calls.

**In this Beta:** `flowchart`, `instability`, `inspect`, and the read-only MCP server (`list_sessions`, `get_drift`, `get_redwall`, `get_branch_summary`). Adapters: `claude-code`, `otel-genai`, `ledring-trace`, `ledring-decisions`.

**Experimental:** `trust`, `card`, `redwall`, and `play`. The local Play bridge is not in this package. The hosted demo is https://play.ledring.dev/play/.

Full docs: https://github.com/FelixFangX/ledring
