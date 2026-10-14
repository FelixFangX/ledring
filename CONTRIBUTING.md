# Contributing

1. **Spec first.** Non-trivial work starts as an issue: problem, solution, user stories, implementation decisions, testing decisions, out of scope.
2. **Thin slices.** Each PR is a demoable end-to-end path (schema → logic → CLI → tests) and links its issue.
3. **TDD.** Red → green → refactor. Test behaviour through each package's public entry point (`@ledring/<pkg>`), never private helpers. Mock only at system boundaries (filesystem, network, clock).
4. **Adapters.** Every external trace format lives behind the `Adapter` interface in `@ledring/trace`. Adding a format = adding an adapter + fixtures + tests; nothing else should change.
5. **Fixtures** must be synthetic or permissively licensed, and contain no secrets or personal data.
6. Conventional commit messages (`feat(trace): …`, `fix(flowchart): …`).

Definition of done: linked issue, tests first, `lint`/`typecheck`/`test`/`build` green, README/GLOSSARY/ADR updated when behaviour or vocabulary changes.
