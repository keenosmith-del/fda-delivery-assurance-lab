# Changelog

## Unreleased

- Pinned the CI runner to Ubuntu 24.04 for the locked Playwright version.
- Added native PostgreSQL tests for conflicting concurrent requests, process termination and worker recovery, and database reconnection.
- Added the controlled ATS comparison and its SQL-backed record counts.
- Added Workflow Evidence and Agent Health with reproducible fixtures, scoring factors, observation history and persisted operator reviews.
- Extended workspace navigation and browser specifications for the working modules.

## Iteration 01

- Established the frontend, backend and shared TypeScript workspaces, PostgreSQL migration tooling, Compose configuration and CI.
- Implemented synthetic ATS submission, stable operation lookup, duplicate detection, transactional audit events and durable asynchronous confirmation.
- Added controlled failure before commit and lost acknowledgment after commit, with retry and lease recovery coverage.
- Added the first operator workspace and seven submission scenarios.
- Documented the implementation, source evidence, local operations and verification results.
