# ledring

Same task, several agent runs, and no picture of where they split or which steps left the instruction.

```sh
npm install -g ledring@beta
```

Node ≥ 20. The `beta` dist-tag, not `latest`.

The package includes `flowchart`, `instability`, `trust`, `card`, `redwall`, and read-only `mcp`. It does not include the local Play bridge or Playwright.

```sh
ledring flowchart ~/.claude/projects/<project>/ --out report.html
ledring instability ~/.claude/projects/<project>/
ledring mcp
```

`flowchart` writes one self-contained HTML branch tree. `instability` prints a 0–100 drift score. `mcp` is a read-only stdio server for an agent that wants to inspect its own traces.

This is the early public Beta (`0.2.0-beta.0`). The browser demo is [Play](https://play.ledring.dev/play/) and needs no install. `ledring play` stays in the [source checkout](https://github.com/FelixFangX/ledring/blob/main/docs/beta.md).

Full manual: https://github.com/FelixFangX/ledring
