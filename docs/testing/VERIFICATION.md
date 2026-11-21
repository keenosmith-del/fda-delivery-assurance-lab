# Implementation status and verification

| Capability | Baseline and local verification |
| --- | --- |
| Type checking and builds | Both frontend and backend type checks and builds pass. |
| Integration and calculation tests | 14 pass using embedded PostgreSQL. These include submission idempotency, rollback, lost acknowledgment, bounded retries, evidence scoring, seeded coverage, protected review writes and comparison record counts. |
| Native PostgreSQL | Baseline run `44889196879` passed its native test step. The expanded suite has four native-only tests skipped locally, covering separate-connection duplicates and conflicts, worker termination and restart, and database interruption. |
| Browser suites | Five tests discovered. Local API listener failed with `EPERM`, so no browser assertions executed locally. |
| Hosted CI | [Baseline run](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44889196879) failed at Chromium installation on Ubuntu 26.04. The locked Playwright 1.58.2 installer includes Ubuntu 24.04, which is pinned in the working tree. A new hosted run awaits a pushed commit. |
| Local database and preview | Compose configuration parses. Docker's daemon is unavailable here and this session cannot bind API or Vite sockets. |
| Visual approval | Pending a working preview. Presentation captures await approval. |

## Reproduce

```sh
npm run typecheck
npm test
npm run build
docker compose -f infrastructure/docker/compose.yaml config --quiet
npx playwright install chromium
npm run test:e2e
```

Set `TEST_DATABASE_URL` to a dedicated PostgreSQL instance to run the native-only tests. Each fixture uses a temporary schema. The process test terminates only its own child worker. The network test briefly closes connections on a local proxy dedicated to its client pool.
