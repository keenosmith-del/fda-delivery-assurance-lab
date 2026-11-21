# Iteration 08 · Browser and CI verification

| Item | Record |
| --- | --- |
| Objective | Verify the existing ATS, Workflow Evidence and Agent Health workflows against native PostgreSQL and Chromium. |
| Starting state | Local and remote main at `54bddb2e9e62e5eaee168ea283ea8eb38a92fce6`. The original checkout had a user edit in `playwright.config.ts`. |
| Requirements addressed | Correct Vite argument forwarding, select the Scenario combobox in both ATS tests, and inspect the permission event with its timestamp rendered. |
| Design decisions | Use accessible role and exact name for the Scenario control. Scope the permission check to the selected workstation's activity history. Keep the synthetic data unchanged. |
| Database and API | No schema or contract changes. The health API regression independently checks the permission-limited row for device 7. |
| Frontend | No application changes. |
| Files modified | `playwright.config.ts`, `tests/e2e/reliability.spec.ts`, and `tests/e2e/intelligence.spec.ts`. |
| Tests executed | Local type checks, backend suite, builds and Playwright startup. Ubuntu 24.04 CI ran the PostgreSQL 17 backend suite and five full Chromium tests on push and PR. |
| Actual results | Local 14 passed and four native-only skips. Hosted 18 backend tests and five browser tests passed twice on 21 November 2026, in [branch CI](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44922499954) and [PR CI](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44922540252). |
| Problems and resolutions | Baseline run `44921584812` passed native PostgreSQL and installations, then timed out waiting for the Vite server. The local session reached both servers but macOS denied Chromium's Mach port check-in, so Ubuntu served as the browser gate. Used an authorised writable checkout to preserve the original worktree and commit the reviewed patch. |
| Release | [PR #1](https://github.com/keenosmith-del/fda-delivery-assurance-lab/pull/1) merged `4167de732d0bb25acbc430d22f486241f1a11c68` into main at `bad4119518e22f68521b9e756679ef542d94d790`. |
| Known limitations | Native PostgreSQL and Chromium are verified on CI. This local macOS session cannot launch Chromium. |
| Next steps | Use the verified main baseline for Adoption Diagnostics and Outcome Verification. |
