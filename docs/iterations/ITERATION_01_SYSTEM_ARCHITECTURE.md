# Iteration 01 · System architecture

| Item | Record |
| --- | --- |
| Objective | Establish the TypeScript workspace, shared contracts and PostgreSQL development path. |
| Starting state | Initial repository charter and evidence baseline. |
| Requirements addressed | Explicit frontend and backend, shared validation, migrations, configuration and CI. |
| Architecture and design decisions | npm workspaces, React/Vite, Fastify/Zod and PostgreSQL. Native SQL is versioned and integrity-checked. |
| Files added or modified | Workspace and package files, `shared/contracts/`, `backend/src/config/`, `backend/src/db/`, `infrastructure/docker/compose.yaml`, CI and architecture docs. |
| Implementation details | The migration runner serialises migrations, checks content hashes and commits migration history with the schema changes. The dev UI uses a same-origin proxy. |
| API or database changes | Liveness and database readiness endpoints. Migration ledger plus the initial submissions schema. |
| Tests performed | Reproducible npm installation from available cache, type checking, build, Compose config validation and migration execution in integration setup. |
| Actual test results | Typechecks, builds and Compose config passed. Embedded PostgreSQL applied the migration and reported readiness. |
| Problems and resolution | Registry DNS and Docker were unavailable. Used cached packages and an embedded PostgreSQL test harness while keeping native PostgreSQL for runtime and CI. |
| Known limitations | Docker startup and CI execution remain unverified. |
| Completion status | Workspace and migration path implemented. |
| Next engineering steps | Verify submission and worker invariants against native PostgreSQL. |
