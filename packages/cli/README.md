# ledring

Same task, several agent runs, and no picture of where they split or which steps left the instruction.

```sh
npm install -g ledring@beta
```

Node ≥ 20.

```sh
ledring flowchart ~/.claude/projects/<project>/ --out report.html
ledring instability ~/.claude/projects/<project>/
ledring mcp
```

`flowchart` writes one self-contained HTML branch tree. `instability` prints a 0–100 drift score. `mcp` is a read-only stdio server for an agent that wants to inspect its own traces.

This is the early public Beta (`0.2.0-beta.0` on the npm `beta` dist-tag). The browser demo is [Play](https://play.ledring.dev/play/). The local Play bridge (`ledring play`) stays in the [source checkout](https://github.com/FelixFangX/ledring/blob/main/docs/beta.md).

Full manual: https://github.com/FelixFangX/ledring
