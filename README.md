# FDA Delivery Assurance Lab

**An independent forward-deployed engineering assessment of workflow discovery, operational reliability, and measurable automation outcomes.**

This project explores how an observed operational bottleneck can move through engineering investigation, implementation, verification, and measurable business impact. It is informed by the publicly documented attain FDA workflow, a supplied product walkthrough, and a published HIREXE internal workflow study.

The goal is **not to recreate or replace Attain**. It is to develop and demonstrate complementary engineering capabilities, using an independently implemented system and synthetic test data.

## Engineering workstreams

1. **ATS reliability and recovery** — Design a transaction-safe submission flow with idempotency, durable operation state, retry recovery, asynchronous confirmation, auditability, and reproducible failure injection.
2. **Workflow evidence and scoring** — Inspect detected tasks, supporting evidence, heuristic classification and automation suitability scores, and gaps in endpoint reporting coverage.
3. **Adoption diagnostics** — Investigate low-adoption automations, record hypotheses about possible barriers, document corrective actions, and track follow-up measurements.
4. **Outcome verification** — Distinguish observed activity, modeled savings, and verified improvements; calculate adoption-adjusted results while accounting for failures and rework.

## Current implementation

The workspace includes the ATS reliability runner and lost-acknowledgment comparison, Workflow Evidence with persisted review history, Agent Health with independently tracked reporting, permissions and evidence freshness, and two measurement workspaces. Adoption Diagnostics stores evidence-backed findings, owned interventions, implementation dates and follow-up decisions. Outcome Verification separates observed work, modeled opportunity, estimated savings and reviewed synthetic time studies. PostgreSQL stores the synthetic fixtures, submission operations, audit events, and review history. A separate worker confirms ATS operations.

Use Node.js 24 and Docker Compose. From the project root:

```sh
npm ci
cp -n .env.example .env
docker compose -f infrastructure/docker/compose.yaml up -d --wait
npm run db:migrate
npm run db:seed
```

In separate terminals, run `npm run dev`, `npm run dev:worker` and `npm run dev:frontend`. Vite prints the browser URL.

## Simulated FDA integration

An independent publisher sends versioned, minimized synthetic records over HTTP. After configuring the source token in the [runbook](docs/operations/RUNBOOK.md#simulated-fda-import), run `npm run fda:publish`. Open **FDA Integration** to inspect persisted source receipts and to trace endpoint and workflow data into **Agent Health** and **Workflow Evidence**. The gateway and publisher implement a hypothetical, lab-owned contract.

## Demonstration scenarios

- **Ambiguous submission:** Compare an isolated unsafe retry with PostgreSQL-backed idempotent replay and business-key deduplication.
- **Workflow review:** Filter synthetic task candidates, inspect supporting evidence and save independent classification and automation suitability decisions.
- **Incomplete observation:** Inspect why a reporting workstation can still have stale observations and limited permissions.
- **Adoption intervention:** Investigate the pipeline digest, document an onboarding hypothesis, and record an owned intervention with a follow-up.
- **Outcome evidence:** Compare complete and incomplete measurement windows and export their calculation inputs, assumptions and results.

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

See the [verification matrix](docs/testing/VERIFICATION.md) for the local checks, PostgreSQL 17 and Chromium CI runs, and deployment requirements.

---

*Independent engineering case study. Not an official Attain or HIREXE product, partnership, endorsement, or production integration.*

## Private deployment

The root Dockerfile packages API, frontend and worker. See the [deployment runbook](docs/operations/DEPLOYMENT_RUNBOOK.md), [access policy](docs/operations/SECURITY_AND_ACCESS.md) and [staging verification](docs/testing/STAGING_VERIFICATION.md) for launch procedure, test coverage and provider status.


See [Evidence integrity](docs/architecture/EVIDENCE_INTEGRITY.md) for the scoring rubric, calculation inputs, and interpretation of synthetic outcome and adoption comparisons. The verification workflow attaches the six generated JSON receipts to each successful release run.

### Agent operational assurance

The imported Agent Health view evaluates readiness, identifies source evidence gaps and lets operators record and verify incident interventions. Workflow Evidence shows the affected endpoint cohort and uses coverage and incident state for its engineering review gate. See the [operational assurance walkthrough](docs/operations/RUNBOOK.md#agent-operational-assurance).
