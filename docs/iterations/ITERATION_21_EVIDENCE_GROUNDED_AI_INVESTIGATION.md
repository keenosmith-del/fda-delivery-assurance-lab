# Iteration 21 · Evidence-grounded AI investigation

Evidence Investigation follows a synthetic approved delivery case across original FDA imports, agent health, engineering approval, downstream execution and reconciliation, adoption and interventions, and outcome assurance. The same records and calculation versions power both investigation and the original workspaces.

## Scope and evidence

Select a case, investigation category, and optional outcome period pair, method and intervention. A read-only PostgreSQL repeatable-read snapshot collects the relevant records using explicit case, assessment, operation, window and period relationships. Migration 012 adds case-linked requests, immutable evidence packets, bounded inference attempts and append-only review revisions. A request UUID replays idempotently for the same input. Conflicting use of that UUID is rejected.

Each citation records a scoped source identity, period or timestamp, version, classification, typed facts and an application link. The fingerprint covers the selected registry and its material dependencies. A new observation, reconciliation, intervention event or related review can make the earlier snapshot stale. Historical evidence and reviews remain inspectable under their original fingerprints. An operator must initiate a fresh investigation for current evidence.

The registry has a 160-entry ceiling. Contradictions and missing evidence are ordered first. A truncated packet, an adverse record count beyond the response budget, or an input above the configured conservative byte ceiling yields an insufficient-evidence state before any provider call. JSON exports keep the historical packet, evidence classes, provider metadata, validation, selected findings and operator audit distinct.

## Inference and controls

The OpenAI adapter calls the [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) over HTTPS with [strict structured output](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). It sends a fixed instruction set and a compact projection of the bounded synthetic facts and operator question. There are no model tools, remote user-selected endpoints or automatic retries. The adapter handles unsuccessful HTTP responses, timeouts, partial content, refusals and malformed response bodies. Model and configuration version, prompt version, outcome and token usage are recorded without prompts, credentials or raw provider errors.

The model selects and orders cited facts, classifications, hypothesis categories and recommendation categories. The contract has no arbitrary prose fields. For every claim the server checks the allowed case, tenant and source, exact citation and fact key, and exact typed value. Known missing records and contradictions must be represented. This prevents invented numbers, customer impact assertions and arbitrary generated URLs in the analysis. It does not establish that a model selected the most relevant facts or the best recommendation. The UI exposes each citation and renders data using React text.

Operator questions are bounded and screened for credential patterns, URLs and markup. Retrieved free-form notes, approval rationales and measurement comments stay inside their original application evidence. Programmatic output checks and an absent tool interface protect the database independently of the prompt. All operational mutations remain on their existing human-authorised endpoints.

Investigations can be saved with deterministic evidence alone. Operators can consider a recommendation, reject findings, request evidence, close the investigation, or supersede it. Considering a recommendation requires a validated result and a current evidence fingerprint. Reviews preserve the actor role, reason, evidence fingerprint, output version, application revision and time. A per-role request quota and scoped two-request concurrency limit bound inference load. Expired or interrupted attempts resolve to a failed state.

## Reproduce the journey

1. Follow [Iteration 20](ITERATION_20_END_TO_END_OUTCOME_ASSURANCE.md#reproduce-the-connected-demonstration) through workflow approval, lost acknowledgment, authoritative reconciliation, adoption follow-up and the operator-reviewed 140-second synthetic comparison.
2. From **Outcome Verification**, follow **Evidence Investigation**. The link carries the selected case and study periods. Preview the evidence, enter a question, and choose **Save evidence only** or explicitly **Request AI analysis**. With inference disabled, the deterministic packet remains available.
3. For downstream failure choose **Downstream failure**. For a committed effect with a lost acknowledgment choose **Retry reconciliation** and inspect the failed acknowledgment, authoritative lookup and one verified effect. For incomplete reporting select **Agent health** and inspect the missing intervals. Select **Adoption usage** to inspect 1/4 and 3/4 participant adoption and the distinction between reported and verified success. Select **Intervention follow up** to inspect the human diagnosis, implementation and follow-up.
4. For a negative or incomplete time study select **Outcome verification** and supply baseline `period-001` with comparison `period-003` or `period-005`. The fixture records an observed −100-second difference and missing rework respectively. Open a citation to see its evidence version and application source.
5. Inspect the validation result. Record a reason and choose **Reject findings** to append a human decision without executing any operational recommendation. Download the investigation JSON and refresh to verify persistence. Add the conflicting late observation described in Iteration 20, then reopen the older investigation to inspect its stale warning.
6. Run the offline checks below to reproduce invalid citations, incorrect numbers, attempted prompt injection, model timeout, missing configuration, and permission denial. The test provider is isolated from the application runtime.

```bash
npx vitest run backend/tests/investigation-evaluation.test.ts backend/tests/adoption-assurance.test.ts
npm run test:e2e -- tests/e2e/fda-ingestion.spec.ts
node scripts/export-review-evidence.ts /tmp/fda-investigation-evidence
```

The evidence runner exports the connected investigation, acknowledgment recovery, pre-commit redrive, negative outcome, inadequate coverage, rejected citation and stale snapshot as separate JSON files. Its generated selections are explicitly attributed to offline fixtures. The deployment image and PostgreSQL backup round trip verify that the new code and migration ship correctly and that a saved packet and review can be reconstructed after restore.

## Deployment handover

Inference is disabled by default. For local use set a dedicated `LAB_WRITE_TOKEN`, `LAB_AI_ENABLED=true`, `LAB_AI_PROVIDER=openai`, a compatible `LAB_AI_MODEL` and `LAB_AI_API_KEY` in the server environment. The optional `LAB_AI_MAX_INPUT_TOKENS`, `LAB_AI_MAX_OUTPUT_TOKENS` and `LAB_AI_REQUEST_TIMEOUT_MS` set bounded limits. Use `LAB_AI_HOSTED_APPROVED=true` on hosted deployments only after approval of the synthetic data egress and provider policy.

Hosted acceptance still requires provisioned PostgreSQL and separate simulator storage, appropriate API and worker services, private routing, TLS, configured workspace and service credentials, validated restore and migration procedures, a configured provider smoke test if inference is enabled, and role-based browser smoke checks. Provider-side processing and retention follow the deployment’s approved provider settings. Offline evaluation verifies orchestration and grounding guards. Live inference quality and latency require separate acceptance.
