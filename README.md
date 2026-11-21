# FDA Delivery Assurance Lab

**An independent forward-deployed engineering assessment of workflow discovery, operational reliability, and measurable automation outcomes.**

This project explores how an observed operational bottleneck can move through engineering investigation, implementation, verification, and measurable business impact. It is informed by the publicly documented Attain FDA workflow, a supplied product walkthrough, and a published HIREXE internal workflow study.

The goal is **not to recreate or replace Attain**. It is to develop and demonstrate complementary engineering capabilities, using an independently implemented system and synthetic test data.

## Engineering workstreams

1. **ATS reliability and recovery** — Design a transaction-safe submission flow with idempotency, durable operation state, retry recovery, asynchronous confirmation, auditability, and reproducible failure injection.
2. **Workflow evidence and confidence** — Inspect detected tasks, supporting evidence, classification confidence, automation suitability, and gaps in endpoint reporting coverage.
3. **Adoption diagnostics** — Investigate low-adoption automations, classify likely causes, document corrective actions, and track follow-up measurements.
4. **Outcome verification** — Distinguish observed activity, modeled savings, and verified improvements; calculate adoption-adjusted results while accounting for failures and rework.

## Current implementation

The first ATS reliability slice includes a React scenario runner, Fastify API, PostgreSQL migration and separate confirmation worker. The runner demonstrates seven submission flows and shows the authoritative operation record, retries and audit events. After a timeout or tab reload, an operator can recover the same logical submission with its original operation ID.

Use Node.js 24 and Docker Compose. From the project root:

```sh
npm ci
cp -n .env.example .env
docker compose -f infrastructure/docker/compose.yaml up -d --wait
npm run db:migrate
```

In separate terminals, run `npm run dev`, `npm run dev:worker` and `npm run dev:frontend`. Vite prints the browser URL.

## Demonstration scenarios

- **Ambiguous submission:** Simulate a successful database write followed by a lost browser acknowledgment; retry the same operation without creating a duplicate business record.
- **Incomplete observation:** Explore how a workflow report should represent missing endpoint telemetry and uncertainty in task classification.
- **Low adoption:** Diagnose an automation that is live but underused, record an intervention, and compare follow-up adoption.
- **Measured impact:** Reconcile baseline activity, attempted automations, successful executions, exceptions, and estimated net benefit.

## Evidence and boundaries

The original FDA walkthrough illustrates task-discovery, endpoint-coverage, adoption, and results screens. A separate HIREXE case study reports historical save-retry and post-submission-wait events. These references provide **problem context**, not access to or proof of defects in HIREXE's current production systems.

All application records, candidate data, activity events, failures, and benchmark workloads in this repository will be **synthetic or locally generated** unless explicitly documented otherwise. No real candidate information, installer binaries, access credentials, private telemetry, or proprietary walkthrough recordings belong in this public repository.

## Documentation

- [System overview and directory guide](docs/architecture/SYSTEM_OVERVIEW.md)
- [API contracts](docs/architecture/API_CONTRACTS.md)
- [Research source register](docs/research/SOURCE_REGISTER.md)
- [Iteration records](docs/iterations/)
- [Local setup and operational recovery](docs/operations/RUNBOOK.md)
- [Status and verification matrix](docs/testing/VERIFICATION.md)
- [Changelog](CHANGELOG.md)

## Status

The ATS slice builds and the embedded database integration tests pass. Native PostgreSQL concurrency, browser verification and hosted deployment are pending. Workflow Evidence, Adoption Diagnostics, Outcome Verification and Agent Health remain on the implementation roadmap.

---

*Independent engineering case study. Not an official Attain or HIREXE product, partnership, endorsement, or production integration.*
