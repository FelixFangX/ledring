# P0: play-dual + play-key

Problem: the catalogue privileges reports, while onboarding gives key-based providers primary space despite Free AI being the default.

Solution: equal bilingual report and play cards; sample reports below. Onboarding presents LEDRING Free AI and demo first, with other providers under a secondary disclosure. Credential fields appear only for a selected key-based provider. Preserve the existing keyless daily quota request and error handling.

User stories: visitors can choose reports or play with equal prominence; new players can build without supplying credentials; players can deliberately configure their own provider.

Validation: page and language tests, keyless request/quota behavior, lint, typecheck, test, build; generate the Pages play bundle from the edited source.

Out of scope: P1 play-empty, trace schema, backend quota policy, unrelated Strands changes.

Issue linkage: GitHub API unavailable in this environment; issue creation/linkage pending. Git metadata is mounted read-only, preventing branch creation and commit.
