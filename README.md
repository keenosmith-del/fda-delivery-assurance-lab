# FDA Delivery Assurance Lab

**An independent forward-deployed engineering assessment of workflow discovery, operational reliability, and measurable automation outcomes.**

This project explores how an observed operational bottleneck can move through engineering investigation, implementation, verification, and measurable business impact. It is informed by the publicly documented Attain FDA workflow, a supplied product walkthrough, and a published HIREXE internal workflow study.

The goal is **not to recreate or replace Attain**. It is to develop and demonstrate complementary engineering capabilities, using an independently implemented system and synthetic test data.

## Engineering workstreams

1. **ATS reliability and recovery** — Design a transaction-safe submission flow with idempotency, durable operation state, retry recovery, asynchronous confirmation, auditability, and reproducible failure injection.
2. **Workflow evidence and confidence** — Inspect detected tasks, supporting evidence, classification confidence, automation suitability, and gaps in endpoint reporting coverage.
3. **Adoption diagnostics** — Investigate low-adoption automations, classify likely causes, document corrective actions, and track follow-up measurements.
4. **Outcome verification** — Distinguish observed activity, modeled savings, and verified improvements; calculate adoption-adjusted results while accounting for failures and rework.

## Planned implementation

- **Frontend:** React and TypeScript
- **Backend:** Node.js and TypeScript
- **Persistence:** PostgreSQL
- **Background execution:** Recoverable jobs and durable processing
- **Quality:** Automated API/integration tests, browser tests, controlled fault injection, CI, and observability
- **Delivery:** Hosted interactive demonstration, engineering report, architecture diagrams, operational runbook, and narrated walkthrough

The implementation and deployment details will be documented as they are completed. This README describes **project scope**, not finished functionality.

## Demonstration scenarios

- **Ambiguous submission:** Simulate a successful database write followed by a lost browser acknowledgment; retry the same operation without creating a duplicate business record.
- **Incomplete observation:** Explore how a workflow report should represent missing endpoint telemetry and uncertainty in task classification.
- **Low adoption:** Diagnose an automation that is live but underused, record an intervention, and compare follow-up adoption.
- **Measured impact:** Reconcile baseline activity, attempted automations, successful executions, exceptions, and estimated net benefit.

## Evidence and boundaries

The original FDA walkthrough illustrates task-discovery, endpoint-coverage, adoption, and results screens. A separate HIREXE case study reports historical save-retry and post-submission-wait events. These references provide **problem context**, not access to or proof of defects in HIREXE's current production systems.

All application records, candidate data, activity events, failures, and benchmark workloads in this repository will be **synthetic or locally generated** unless explicitly documented otherwise. No real candidate information, installer binaries, access credentials, private telemetry, or proprietary walkthrough recordings belong in this public repository.

## Project documentation (planned)

- `docs/assessment/` — Product analysis, evidence register, findings, and prioritisation
- `docs/architecture/` — System design, decision records, models, and API contracts
- `docs/testing/` — Acceptance criteria, failure scenarios, and reproducible results
- `docs/operations/RUNBOOK.md` — Setup, deployment, monitoring, troubleshooting, and recovery
- `docs/handoff/` — Executive brief, presentation, and demonstration narrative

## Status

**Initialisation / engineering discovery.** Source code, installation steps, public demo URL, and verified test results will be added as the implementation progresses.

---

*Independent engineering case study. Not an official Attain or HIREXE product, partnership, endorsement, or production integration.*
