# AGENTS.md

Short pointers for coding agents working in this repo.

- **Standards**: spec issue first, thin vertical slices as PRs, TDD through public interfaces only, external formats behind adapters. See `CONTRIBUTING.md`.
- **Vocabulary**: use the terms in `GLOSSARY.md` (run, step, signature, branch tree, divergence, adapter).
- **Decisions**: `docs/adr/`. Read before changing the trace schema.
- **Tracker**: GitHub issues on `FelixFangX/ledring`. Reference the issue in commits (`Closes #N`).
- **Checks**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` must pass (CI runs Node 20 and 22).
- **Do not** commit real session transcripts, secrets, or third-party game names/assets. Fixtures in `fixtures/` are synthetic.
