# Iteration 11 · Integration and regression verification

| Item | Record |
| --- | --- |
| Objective | Verify the existing and new workflows through the same production builds, native PostgreSQL and browser gate. |
| Starting state | Browser fixes green on main. New measurement screens and the shared migration in review. |
| Requirements addressed | Maintain the 18 prior backend and five prior browser cases. Add unit, persistence and two full browser workflow cases. |
| Design decisions | Seed measurement and intelligence fixtures in the Playwright API process. Keep tests on disposable schemas. Enable the backend TypeScript syntax check for Node strip mode. |
| Database | Playwright uses versioned migrations and isolated fixtures. Native recovery tests remain active in CI. |
| API | Tests exercise real validation, workflow transitions, outcome calculations and JSON attachment. |
| Frontend | Browser suites exercise all five existing cases plus an intervention and an outcome export. |
| Files modified | `backend/tests/measurement.test.ts`, `tests/e2e/measurement.spec.ts`, `tests/support/browser-server.ts`, `backend/tsconfig.json`, and the verification matrix. |
| Tests executed | Type checks, backend suite, production builds and local browser run. The matrix records hosted runs. |
| Actual results | Local type checks, both builds and 21 embedded tests passed. Four native-only tests were skipped locally. The local session reached the Playwright servers, then macOS denied Chromium's Mach port check-in. |
| Problems and resolutions | Fixed a Node startup error that TypeScript's transforming build had accepted. Backend type checking now rejects TypeScript constructs that require transformation. Native and full browser verification run on Ubuntu CI. |
| Known limitations | Public deployment and final presentation capture require separate review. |
| Next steps | Review the loopback synthetic app, confirm operational security boundaries and obtain visual approval. |
