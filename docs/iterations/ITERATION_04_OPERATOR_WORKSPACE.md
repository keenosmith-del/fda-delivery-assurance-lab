# Iteration 04 · Operator workspace

| Item | Record |
| --- | --- |
| Objective | Make the first ATS scenarios operable from a React workspace. |
| Starting state | ATS API, controlled failures and asynchronous worker. |
| Requirements addressed | Responsive local UI, accessible controls, scenario execution, request trace, recovery, database result and audit history. |
| Architecture and design decisions | Use shared Zod contracts and a same-origin proxy. Persist the active synthetic operation in tab session storage. Keep the write token in memory. |
| Files added or modified | `frontend/src/`, `frontend/index.html`, `frontend/vite.config.ts`, Playwright config and two browser specs. |
| Implementation details | Seven selectable scenarios, bounded status checks and explicit lookup/recovery of the previous operation after a timeout or reload. |
| API or database changes | The UI uses the existing API; the data model is unchanged. |
| Tests performed | Workspace typechecks and Vite build. Attempted Playwright startup. |
| Actual test results | Typecheck and build passed. Playwright assertions did not run because local listener startup returned EPERM. |
| Problems and resolution | Routed browser specifications through a PostgreSQL-backed test server configured in CI and documented how to reproduce them locally on a permitted host. |
| Known limitations | Browser verification, visual approval and deployment remain pending. |
| Completion status | ATS UI source and production bundle built. |
| Next engineering steps | Verify interactive scenarios in a browser, then implement Workflow Evidence and Confidence. |
