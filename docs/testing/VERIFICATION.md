# Implementation status and verification

| Capability | Implementation | Verification |
| --- | --- | --- |
| API and worker | Fastify routes, migration, durable confirmation | Typecheck and production build passed. Eight Fastify-injection integration tests passed against embedded PostgreSQL via PGlite. |
| Idempotency and atomic write | Same-key replay, changed-payload conflict, distinct-key duplicate link | Passed embedded tests and verified record counts with SQL. Native multi-connection concurrency test is defined and pending. |
| Request fault recovery | Synthetic rollback before commit and 504 after commit | Passed integration tests. Browser specs await an environment that permits local server sockets. |
| Worker recovery | Lease expiry, stale worker fence, bounded backoff and terminal status | Passed the persistence tests with controlled lease expiry and four failed attempts. |
| React runner | Seven selectable scenarios, authoritative database trace, stable recovery across reload | Typecheck and production build passed. Playwright startup returned `listen EPERM` for `127.0.0.1:3300`, so browser assertions did not run. |
| Local database | PostgreSQL 17 Compose service | Compose configuration parsed. Docker daemon was unavailable. |
| CI | Native PostgreSQL 17, integration suite, build and Playwright | Workflow added. No hosted run observed. |
| Subsequent modules | Discovery, adoption, outcomes and agent health | Pending implementation. |
| Deployment and visual approval | Hosted demo and final capture | Pending. |

## Reproduce

```sh
npm run typecheck
npm test
npm run build
docker compose -f infrastructure/docker/compose.yaml config --quiet
```

To include native concurrency, run the integration test with `TEST_DATABASE_URL` targeting a dedicated PostgreSQL instance. The fixture creates and removes a schema for each test server. Install Chromium with `npx playwright install chromium` and run `npm run test:e2e` on a host that allows local listener sockets. By default, the test suite uses embedded PostgreSQL and reports native concurrency as skipped.
