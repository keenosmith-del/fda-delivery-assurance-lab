# FDA Delivery Assurance Lab

**An independent forward-deployed engineering assessment of workflow discovery, operational reliability, and measurable automation outcomes.**

The lab shows how a synthetic FDA finding moves from ingestion and operational evidence to a human engineering decision, an implementation plan, and verifiable outcomes. The independent demonstration draws on public attain materials and uses synthetic records throughout.

## Engineering workstreams

1. **FDA Integration** imports versioned synthetic endpoint, workflow and measurement records with canonical provenance.
2. **Agent Operational Assurance** evaluates reporting and permissions and verifies incident recovery from new source evidence.
3. **Workflow Evidence and Engineering Decisions** links observations to technical feasibility, risk reviews, human decisions and scoped delivery cases.
4. **Downstream Integration and Delivery Reliability** runs approved delivery cases through a synthetic HTTP simulator, verifies downstream effects independently, and retains the ATS recovery example.
5. **Adoption Diagnostics** records evidence-backed hypotheses, changes and follow-up decisions.
6. **Outcome Verification** distinguishes observed work, modeled opportunity and reviewed synthetic evidence.

## Current implementation

The gateway, independent publisher, incident verification, and workflow assessment and planning services persist to PostgreSQL. Approved delivery plans include prerequisites and can authorise local synthetic execution. The downstream worker records dispatch and verifies the effect through the simulator. The ATS example retains its separate confirmation flow. The adoption and outcome workspaces analyze their own synthetic measurement fixtures.

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

## Workflow assessment and engineering decisions

Import the normal synthetic fixture and publish `assurance-complete-window`. Open `workflow-003` in imported **Workflow Evidence**, record feasibility and risk, and submit the current revision for a human decision. An eligible approval can create a durable delivery case. [Workflow assessment runbook](docs/operations/RUNBOOK.md#workflow-assessment-and-engineering-decisions)

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


See [Evidence integrity](docs/architecture/EVIDENCE_INTEGRITY.md) for the scoring rubric, calculation inputs, and interpretation of synthetic outcome and adoption comparisons. The verification workflow attaches the generated JSON evidence packages to each successful release run.

### Agent operational assurance

The imported Agent Health view evaluates readiness, identifies source evidence gaps and lets operators record and verify incident interventions. Workflow Evidence shows the affected endpoint cohort and uses coverage and incident state for its engineering review gate. See the [operational assurance walkthrough](docs/operations/RUNBOOK.md#agent-operational-assurance).

FDA-linked Adoption Assurance is available from a delivery case or the Adoption Diagnostics workspace. It joins synthetic usage observations to the originating engineering approval and treats verified delivery, source-reported activity and adoption as separate measures.
