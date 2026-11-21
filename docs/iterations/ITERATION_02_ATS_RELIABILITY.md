# Iteration 02 · ATS reliability

| Item | Record |
| --- | --- |
| Objective | Persist synthetic submissions safely when a client submits or retries. |
| Starting state | Workspace, migration and shared validation contracts established. |
| Requirements addressed | Stable operation identity, normalised payload fingerprinting, database uniqueness, transactional audit, operation lookup and asynchronous confirmation. |
| Architecture and design decisions | One transaction creates the business record, operation, event and queue item. A per-operation advisory lock and business unique constraint guard the two identities. |
| Files added or modified | `backend/src/modules/submissions/service.ts`, `backend/src/api/app.ts`, `database/migrations/001_submissions.sql`, `backend/tests/submissions.test.ts` and API docs. |
| Implementation details | A matching replay resolves to the existing operation. A changed payload returns 409 and appends a conflict event. A new UUID for an existing candidate/requisition pair creates a linked operation. |
| API or database changes | Added submit and operation lookup routes. Added submission, operation, event and confirmation queue tables. |
| Tests performed | Submission, token validation, replay, payload conflict, duplicate detection and SQL record-count assertions. |
| Actual test results | Passed against embedded PostgreSQL. The native multi-connection concurrency test was skipped locally. |
| Problems and resolution | The embedded engine serialises its database access. The native PostgreSQL CI job is configured to exercise independent connections. |
| Known limitations | Hosted request budgets, retention and native concurrency verification are pending. |
| Completion status | Core persistence and API implemented. |
| Next engineering steps | Verify interrupted and ambiguous submissions and implement operator recovery. |
