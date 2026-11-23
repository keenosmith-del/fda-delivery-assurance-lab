# Iteration 16 | Agent lifecycle and operational assurance

Milestone 08 applies an operational assurance workflow to the simulated FDA integration published in Milestone 07. Existing source authentication, contracts, canonical records and receipts remain the source of operational observations. The workspace adds a replayable incident trail and an independent evidence gate for imported workflow candidates. No connection to attain or to employee endpoints is required.

## Assessment

The `fda-lab.agent-assurance/v1` rules evaluate a selected observation window at its end, or at an explicit time within the window. Assessment reads scoped canonical records and their accepted receipts. The presentation feed retains its 500-record limit. Assessment uses the full set of relevant record types within the connected tenant and source.

| Factor | Evidence or lab rule |
| --- | --- |
| Lifecycle | Registration or enrolment is read from source registration. Reported activity without registration remains distinct. An endpoint advances to active only once the readiness factors are met. Retirement requires source evidence. |
| Connectivity | The current status must be online with a heartbeat no more than 90 minutes old at assessment time. Source interruption and recovery diagnostics are reported alongside the status evidence. |
| Capture and consent | Available capture and reported granted screen permission are required for evidence completeness. Unknown permission is retained. Reported permission and a source consent reference do not establish legal consent. |
| Version | Stable synthetic 1.x releases satisfy the lab policy. Version history includes the receipt and timestamp for previous and latest reported versions. The underlying update process may be unknown. |
| Coverage | Each eligible elapsed hour, including a final partial hour, requires a canonical observation. The interval begins at the later of window start and enrolment. Status-reported observation freshness is tracked separately from measured interval coverage. Complete assessment requires a finished window, reporting, available capture and required permission. |
| Delivery | Compare source and observation timestamps with the server-recorded receipt. A clock-ahead comparison is unknown. Source occurrence after window end and server receipt after window end are independent facts. Delivery over 300 seconds or an explicitly reported queue of at least 25 events qualifies for investigation. An omitted queue count is unknown. |

The assessments expose the source's declared cohort and completeness alongside actual reporting, observed endpoints, required permission, independent coverage and disagreements. Historical fixtures can have large receipt delays because they are deliberately replayed. Freshness is always measured relative to the selected source window, independent of current wall-clock time.

Workflow Evidence uses linked windows and unresolved cases. A reporting or capture case blocks readiness for its window. Missing evidence and non-blocking unresolved cases request additional evidence. An unknown or unregistered cohort can leave the gate unknown. A later complete period can support a new assessment, while the original window retains its recorded gaps. This gate provides evidence for an engineering review independent of existing suitability scoring and automation approval.

## Cases and recovery

An operator opens a case from a deterministic condition. The database enforces one unresolved incident per tenant, source, endpoint, window and category. Concurrent opens return the same incident. Its initial condition and evidence are immutable. After verified recovery, a later condition with source time beyond the verification watermark may open a new incident. A replay or a diagnostic note cannot reopen a closed case.

`open → investigating → intervention_planned → awaiting_verification → resolved`

Diagnoses distinguish a source-backed fact from a hypothesis and an unresolved question. Interventions record the synthetic action, owner role, reason, target and rule-based verification criteria. Implementing records server time and a note. Verification retains each distinct outcome and receipt set. Every transition stores the actor role, timestamp and application revision. A role is a shared access designation.

Recovery requires both source chronology newer than the detected condition and server receipt time after recorded implementation. Rules depend on the condition. Reporting requires a new fresh heartbeat, while permission recovery also requires available capture and a new observation after the reported permission change. This can restore future readiness while earlier missed intervals remain in the original case. Missing coverage requires a complete subsequent window. Version recovery requires a new policy-compliant report. Delay recovery requires a new low queue and observation received within policy. Insufficient, partial and contradictory evidence keep the incident awaiting verification. There is no manual resolution override.

Migration 007 adds incident state, append-only audit decisions and scoped receipt associations. It uses foreign keys to existing source registrations and ingestion receipts. Case changes and audit records commit together. Row locks prevent duplicate implementation and verified resolution actions. Viewer reads and JSON exports follow the existing workspace access policy. Hosted operators alone can mutate cases; publisher and demo credentials confer no case write access. As with the rest of the lab, local loopback mode can require the configured local operator token.

## Demonstration and verification

Use the [operations runbook](../operations/RUNBOOK.md#agent-operational-assurance) for the operator steps and publisher scenarios. The [API contract](../architecture/API_CONTRACTS.md#agent-operational-assurance) specifies inputs, scopes and exports. The [verification matrix](../testing/VERIFICATION.md) records the checks and environment.

The milestone uses versioned synthetic rules and manual operator case creation. It does not drive real endpoint changes, establish root cause, or approve workflow delivery. Future work can extend this evidence gate into a durable engineering approval and release lifecycle.
