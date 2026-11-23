# Iteration 17 | Workflow assessment and engineering decisions

Milestone 09 connects imported synthetic FDA findings to evidence review, structured technical feasibility, risk evaluation, and a durable engineering decision. An eligible approval creates a planning case tied to the exact reviewed revision. The source recommendation remains visible as evidence supplied by the simulated publisher. The lab has no access to private attain services or to customer environments.

## Architecture

The imported Workflow Evidence view remains the entry point. Milestone 09 uses the existing tenant and source scope, canonical source store, receipt history, incident service and hosted workspace roles. Migration 008 adds a stable assessment per scoped workflow plus immutable revisions, receipt associations, engineering decisions, delivery cases and audit entries. Foreign keys enforce scope and keep each case tied to the chosen decision and revision. Feasibility, risk and evidence snapshots use validated JSONB. Existing ingestion and incident data keep their schema and history.

Evidence is evaluated under `fda-lab.workflow-readiness/v2`. Reporting interruption and restricted capture or permission can block readiness directly from source conditions. An opened incident is optional for detection. Active incidents can add blocking or review requirements. The gate checks eligible endpoints, capture and required permissions, missing intervals, observation freshness, source declarations, record consistency and observed delivery. Evidence with an unknown timestamp, a late in-window transmission, or a source observation reported after its own window can require further review. The historical lab replay may produce long transport delays after window end. The assessment exposes receipt times and keeps that replay delay separate from source-timeline lateness. A later complete window can qualify for review while earlier gaps persist.

Each revision stores the candidate, linked observations and windows, relevant canonical event envelopes, accepted receipt identifiers, agent readiness and incident references. The evidence hash uses deterministic content and derived readiness, including operational incident identity and detection timing classifications. It excludes volatile request clocks, raw receipt timestamps, and processing duration. A source replacement with material content changes marks the revision stale. Reassessment appends a fresh evidence revision and preserves older decisions, exports and cases.

## Engineering review

1. Open an evidence review from a canonical imported candidate. Unknown or incomplete related evidence remains visible and can be deferred.
2. Record workflow understanding, integrations, execution controls, workplace and operational assumptions, alternatives and planned phases. A revised feasibility assessment requires reconsideration of risks.
3. Review risk under the proposed controls and record the review basis. Elevated unreviewed risks and high residual risks block approval. Expected value cannot offset these gates.
4. Submit a revision for decision. The operator may approve implementation planning, approve a constrained supervised pilot, reject, or defer. Approvals require current ready evidence, feasibility, integration status, acknowledgement of permission requirements, required dependencies and review of elevated risk.
5. Create a case from the approved current revision. Case creation is idempotent. The delivery case carries the engineering scope, integration and acceptance criteria, operational controls, risk, phases and prerequisites. Conditions and unverified access or external approval keep a case blocked. A later revision supersedes an earlier case in the current read view and retains its originally recorded readiness. No case executes an automation.

Suitability rules `fda-lab.workflow-suitability/v1` use qualitative engineering inputs plus permission and evidence state, and observed exception counts. An exception rate of at least one quarter of the reviewed sample prompts supervision. The output recommends further review, supervised pilot, or implementation planning. It is a deterministic review aid and does not measure empirical probability. A supervised pilot requires a human-supervised execution model, operating limits, human review and stop criteria.

## Integrity and verification

A PostgreSQL source row lock serializes canonical evidence publication, incident changes and approval mutations per scope. Each write checks the expected revision inside the transaction. SQL keys prevent duplicate assessments, decisions and delivery cases. Repeating an identical approval at the same current revision returns the saved decision. Conflicting inputs return a conflict.

All hosted writes require the authenticated operator role. An audit record identifies the role, action, time, reason and application revision. It does not identify the individual behind a shared account. Lab engineering approval does not establish client consent, access to production or external authorisation. The standard JSON package retains source-supported facts, engineering assumptions, feasibility, decision and prerequisite status. Synthetic cases are plans, even when ready for technical implementation.

See the [API contract](../architecture/API_CONTRACTS.md#workflow-assessment-and-engineering-decisions), [operations runbook](../operations/RUNBOOK.md#workflow-assessment-and-engineering-decisions) and [verification matrix](../testing/VERIFICATION.md). Generalised downstream execution, independent adoption and outcome evidence, AI-assisted investigation, engagement handover and hosted acceptance remain future work.
