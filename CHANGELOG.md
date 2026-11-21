# Changelog

## Unreleased

- Corrected Vite startup and browser selectors. Verified the existing release with PostgreSQL 17 and Chromium.
- Added Adoption Diagnostics with persisted cohorts, first-use events, diagnostic decisions, interventions and follow-ups.
- Added Outcome Verification with modeled opportunities, net estimates, compared synthetic time studies and evidence JSON exports.
- Added calculation, persistence and browser regression coverage.

## Iterations 05–07

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
