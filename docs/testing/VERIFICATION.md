# Implementation status and verification

| Scope | Result |
| --- | --- |
| Initial main `54bddb2e9e62e5eaee168ea283ea8eb38a92fce6` | [Run 44921584812](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44921584812), 21 November 2026. 18 native backend tests and build passed. Browser server startup timed out. |
| Browser fix `4167de732d0bb25acbc430d22f486241f1a11c68` | [Branch run 44922499954](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44922499954) and [PR run 44922540252](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44922540252), 21 November 2026. Each passed 18 native PostgreSQL 17 tests and five Chromium tests. |
| First merge `bad4119518e22f68521b9e756679ef542d94d790` | [Main run 44922725263](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44922725263), 21 November 2026. Successful after [PR #1](https://github.com/keenosmith-del/fda-delivery-assurance-lab/pull/1) merged. |
| Adoption and outcome local checks | Type checks and both production builds passed. 21 passed and four native-only skips using embedded PostgreSQL. Local Chromium failed at macOS Mach port check-in, before browser assertions. |
| Adoption and outcome commit `ecdf13a20f9fe1aa13f35fcc5b508ffce29a9e9c` | [Branch run 44923886250](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44923886250) and [PR run 44923911575](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44923911575), 21 November 2026. Both completed successfully with 25 native backend tests and seven Chromium tests. |
| Production readiness local checks | Type checks and builds passed. 28 embedded PostgreSQL tests passed and five native-only tests were skipped locally. Both local browser commands started their test servers, but macOS denied Chromium's Mach port check-in before assertions. |
| Production readiness `3a9d837de8b352d1f37e86bf647d89491640a5db` | [Hosted run 44926893880](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44926893880), 21 November 2026. All 33 native PostgreSQL tests passed, including API and worker restart persistence. Seven baseline and two private-origin Chromium cases passed. Backup and restore matched 4 schema versions, 6 tasks and 464 executions. The deployment image built and its artifacts passed runtime checks. |
| Production deployment and presentation | Pending separate public access, rate limiting and security review, and user visual approval. |

## Reproduce

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Set `TEST_DATABASE_URL` to a dedicated PostgreSQL 17 database to execute every backend test. Each fixture uses a temporary schema. The process recovery test terminates its own worker. The interruption test controls a dedicated local PostgreSQL proxy. Playwright starts the disposable API, seeds both sets of synthetic records and opens the frontend via its local Vite proxy.

## Evidence integrity

The verification workflow generates the `synthetic-review-evidence` artifact with six JSON receipts using a disposable PostgreSQL 17 schema. The exported source revision is the workflow's exact checkout. The receipt generator uses the API write paths and confirmation worker state transitions, then exports via the same read routes used by the browser. The generated ATS receipts add a separately labeled in-process HTTP test trace with the observed status and request ID for each step. Those observations are test evidence and are distinct from the database snapshot.

For a disposable checkout with dependencies installed, run `node scripts/export-review-evidence.ts test-results/review-evidence` against a fresh output directory. Set `TEST_DATABASE_URL` to use native PostgreSQL with an isolated schema, and optionally set `LAB_SOURCE_REVISION` to a verified full SHA. With no test URL the script uses an embedded database. UUIDs and server timestamps vary across runs. Recomputable fixture counts, scoring inputs, quantities and conclusions are stable.

Coverage includes both outcome comparisons, modeled versus reviewed reconciliation, missing inputs, audit links, role attribution, revision handling, protected downloads, redaction, and both synthetic ATS fault decisions. The evidence and private-browser fixtures do not contact live staging.
