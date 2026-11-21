# Iteration 05 · CI and ATS reliability hardening

| Item | Record |
| --- | --- |
| Objective | Restore browser CI compatibility and verify ATS failure handling across the API, worker and database. |
| Starting state | Clean local and remote `main` at `3fa4cd3`. Baseline GitHub Actions passed test and build steps, then failed during Chromium installation. |
| Requirements addressed | CI runner support, native fault tests, before-and-after comparison, and fault-mode isolation. |
| Architecture decisions | Pin Ubuntu 24.04 for Playwright 1.58.2. Keep the unreliable fixture in memory. Measure the transactional result through the existing service and SQL. |
| Implementation and files | Changed `.github/workflows/ci.yml` and the ATS React feature. Added `backend/src/modules/submissions/comparison.ts`, native recovery tests and an IPC-driven lease-holder fixture. |
| Database and API | Added `POST /api/lab/submission-comparison`. The safe path uses existing business records, operations and audit tables. |
| Tests performed | Embedded integration tests, type checks, builds and Playwright discovery/start attempt. |
| Actual results | Embedded comparison produced two fixture records versus one SQL record with replay and duplicate-link events. Native-only and browser assertions await a usable runner. |
| Problems and resolutions | The locked Playwright Chromium registry includes Ubuntu 24.04 and the working-tree workflow now selects it. Local `.git/index.lock` creation failed with `Operation not permitted`. GitHub write endpoints returned 403. |
| Known limitations | Native process and network tests and the revised Actions run have no result. Public deployment still needs a rate limit, read access policy, review retention and operator identity. |
| Completion status | Implementation present in the working tree. Delivery verification pending. |
| Next steps | Push from a write-enabled checkout and verify the Ubuntu 24.04 job, all native tests and the browser suite. |
