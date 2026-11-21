# Iteration 03 · Fault recovery

| Item | Record |
| --- | --- |
| Objective | Demonstrate recoverable submission ambiguity and interrupted confirmation jobs. |
| Starting state | Transactional submissions and operation history. |
| Requirements addressed | Pre-commit interruption, lost post-commit acknowledgment, lease recovery, bounded backoff and terminal confirmation failure. |
| Architecture and design decisions | Enable deterministic request faults through server configuration. Worker claims carry a lease token, with stale claims fenced from completion. |
| Files added or modified | `backend/src/workers/`, fault handling in `backend/src/api/app.ts`, backend integration tests and the runbook. |
| Implementation details | One fault throws before commit. The other returns a 504 after commit. Worker failure schedules retry or transitions to terminal state after four attempts. |
| API or database changes | Optional fault header and job lease fields. Operation lookup reports confirmation state and attempts. |
| Tests performed | Verified rollback, post-commit replay, expired leases, stale completion rejection and four-attempt exhaustion. |
| Actual test results | All listed assertions passed with embedded PostgreSQL. |
| Problems and resolution | Used controlled SQL clock offsets for deterministic lease and backoff tests. |
| Known limitations | Actual process termination, database-network interruption, job redrive and a side-by-side comparison with an unreliable path are pending. |
| Completion status | Submission fault recovery and worker persistence logic implemented. |
| Next engineering steps | Exercise concurrent workers and actual process restarts on native PostgreSQL. |
