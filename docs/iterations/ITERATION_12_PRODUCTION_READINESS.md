# Iteration 12 · Production readiness and private staging

| Item | Record |
| --- | --- |
| Objective | Prepare a reproducible and private hosted release without changing the accepted interface. |
| Starting state | Verified main at `98854a290613f33403ce42a388bb105671bfb2c5`, with 25 native backend and seven Chromium cases. |
| Design | Same-origin compiled frontend with authenticated Fastify routes, an independent worker and private PostgreSQL. |
| Database and API | Added worker status migration 004, checksum readiness, hosted access policy and protected operational counts. |
| Frontend | Compiled assets are served under the same hosted access policy. |
| Deployment | Non-root application image, separate service commands, staged migration, explicit seeding and repeatable smoke checks. |
| Regression coverage | Added hosted configuration and access tests, native restart verification, compiled frontend browser cases and a disposable PostgreSQL backup and restore. |
| Local execution | 28 tests passed with embedded PostgreSQL. Five native-only cases are exercised in CI. |
| Provider state | Authenticated Railway workspace rejected dedicated project creation because the free-plan resource provision limit was exceeded. No existing projects were modified. |
| Remaining | Provision isolated staging capacity, execute hosted checks, and verify provider recovery. See [staging verification](../testing/STAGING_VERIFICATION.md). |
