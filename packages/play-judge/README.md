# @ledring/play-judge

Judges one self-contained HTML artifact.

`assessStatic` reads the file: blank page, AST fake tests, and `@ledring/play-risk` categories. Endings go through `resolveEnding`.

`judgeArtifact` reuses a `JudgeRuntime` Chromium. Each artifact gets a new context. `route('**')` aborts every request except `about:`, `data:`, and `blob:`, and those attempts are logged. It loads desktop (1280×800) and mobile (390×844), takes a screenshot at each, and runs a short interaction smoke (tab, buttons, inputs, canvas click and drag, arrow, space, enter). A blank screen is no visible text and no painted canvas. axe-core runs last and does not change the ending (`a11y.gating` is false).

Static Pages mode does not call this package. It uses the in-iframe harness and must show `DEGRADED_JUDGE_NOTICE` from `@ledring/play-sandbox`. The local bridge `POST /api/judge` calls `judgeArtifact`.

Install the browser before the Playwright tests:

```sh
pnpm --filter @ledring/play-judge exec playwright install --with-deps chromium
```

CI does that. Locally, if the browser binary is missing and `CI` is unset, the browser tests skip. They fail in CI when the binary is missing.
