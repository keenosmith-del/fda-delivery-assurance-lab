# Iteration 20 · End-to-end outcome assurance

An approved synthetic delivery case now connects the workflow evidence, verified downstream effect, adoption observations, intervention and human outcome review. Outcome Verification still includes the original standalone fixtures.

## Evidence and calculations

Migration 011 adds a delivery-scoped assessment, source measurements, receipt history and immutable review snapshots. The assessment refers to the exact tenant, source, workflow assessment revision, engineering decision and delivery case. Its read model resolves the authoritative downstream operation and linked adoption assessment. An operator can inspect the original approval, concern, intervention and follow-up through the export and workspace links.

The synthetic publisher sends `fda-lab.outcome-measurement/v1` events to the dedicated time-study endpoint. Declarations identify the period, measurement method, cohort, coverage and as-of timestamp. Effort records identify the logical opportunity, optional synthetic participant, workload class, category, duration and unit. Every event carries its source revision, provenance and occurrence timestamp. The service records its receipt separately. Exact replays produce duplicate receipts. A changed payload under the same ID produces a conflict receipt and leaves the original observation intact.

The calculation rule `fda-lab.outcome-assurance/v1` sums human handling in integer milliseconds and reports seconds. It includes manual handling, remaining manual work, review, exceptions, rework, recovery and instrumentation. Automated processing is tracked separately. Each required category must have an observation, with zero duration recorded explicitly where appropriate. Missing, out-of-window and conflicting inputs prevent a reviewed comparison. Identical logical category observations contribute only once.

A matched comparison requires the same item identifiers and workload classes. Normalisation uses seconds per item and requires identical workload-class proportions. Both methods require ordered study windows, compatible methods, adequate coverage, and a comparison study explicitly linked by identifier and exact interval to qualifying adoption evidence after implementation. The selected intervention, when included, must connect its baseline diagnosis and implemented follow-up to the selected periods. Cohort changes are visible alongside the result.

Adoption metrics retain their eligible participant and opportunity denominators. Verified effects come from authoritative simulator verification explicitly linked to a logical opportunity. The dispatch count and source-reported results are shown separately from verified effects. A source-reported success may be part of the observed workload even when its downstream effect is unverified.

Modeled gross opportunity multiplies volume, eligibility, suitability and assumed implementation coverage by baseline manual seconds. Net modeled opportunity deducts review, exception and rework assumptions. Weekly amounts require a frequency. Missing overhead leaves modeled net opportunity unknown. Modeled opportunity, observed differences, reviewed differences and verified execution counts remain distinct.

## Review and provenance

A review stores the selected calculation method, application and calculation versions, actor role, timestamp, justification, limitations and complete calculation snapshot. The API recomputes the requested selection. With a matching comparison, the observed result is baseline human effort minus comparison human effort. A negative result means the comparison required more human effort.

Review submissions include the latest revision and the fingerprint of the selected evidence. Changes in selected periods, linked intervention evidence or implementation invalidate that review. Receipts for identical replays do not change measurement inputs. Earlier snapshots and decisions remain available, and new review decisions append a revision. Insufficient evidence supports a deferral, rejection or insufficient-evidence decision. Comparisons and intervention findings describe synthetic observations, with causality unresolved.

## Reproduce the connected demonstration

1. Follow [Iteration 19](ITERATION_19_DELIVERY_ADOPTION_ASSURANCE.md#reproduce-the-delivery-linked-journey) through synthetic FDA ingestion, engineering approval, downstream verification and the adoption intervention follow-up. Select the lost-acknowledgment execution to inspect the authoritative lookup and single effect. Use the verified case ID, workflow ID and operation verification timestamp for the commands below.
2. Open **FDA-linked Outcome Assurance** from the delivery case. Observe **No time study recorded**. Run the model variant to populate a modeled-only outcome. The complete model reports 360 gross and 255 net seconds per period. The second model leaves weekly and net figures unknown.
3. Run the baseline and comparison variants. Select baseline `period-001`, comparison `period-002`, **Matched items** and the recorded intervention. The study reports 480 baseline human seconds and 340 comparison human seconds. The follow-up may show three source-reported successes and zero independently mapped effects, while the case retains the verified downstream operation and the baseline has one mapped effect.
4. Inspect **Formulas and limitations**. Record a **Reviewed synthetic comparison** with a written rationale and limitation. The reviewed synthetic handling difference is 140 seconds. Download the outcome JSON and trace its approval, operation, source receipts, adoption data, intervention and review snapshot.
5. Repeat an identical publisher command to see duplicate receipts without a change in effort. Submit an existing event with a changed payload to exercise conflict rejection. Submit a newly identified contradictory observation for one selected item/category to exercise a stale review. The export retains the earlier 140-second snapshot and shows the current comparison as insufficient.
6. Use the automated scenarios below for the remaining variants. Each comparison explicitly links a matching adoption period. The changed-method and unequal workload cases block a direct comparison. Equal-proportion workloads with different volumes can use per-item normalisation. The increased-overhead and unchanged scenarios preserve the observed adoption increase alongside a negative or zero handling difference.

```bash
npm run outcome:publish -- CASE_ID WORKFLOW_ID VERIFIED_AT model
npm run outcome:publish -- CASE_ID WORKFLOW_ID VERIFIED_AT baseline
npm run outcome:publish -- CASE_ID WORKFLOW_ID VERIFIED_AT comparison
```

| Evidence scenario | Reproduction |
| --- | --- |
| Verified implementation with no time study | Generate the evidence packages and open `delivery-outcome-without-time-study.json`. |
| Modeled opportunity and incomplete assumptions | Open `delivery-outcome-modeled-opportunity.json`. |
| Connected journey and operator review | Open `delivery-outcome-assurance.json` and its paired lost-acknowledgment and adoption exports. |
| Increased overhead | Open `delivery-outcome-increased-overhead.json`. The observed handling difference is −100 seconds. |
| Improved adoption with unchanged handling | Open `delivery-outcome-unchanged-effort.json`. The observed handling difference is zero. |
| Incomplete study | Open `delivery-outcome-incomplete-coverage.json`. One expected comparison item has no rework record. |
| Contradictory late evidence and replay | Open `delivery-outcome-stale-review.json` and inspect its receipts and prior review. |
| Unverified usage, duplicates, incompatibility, stale review | Run `npx vitest run backend/tests/adoption-assurance.test.ts` and inspect the scenario assertions. |
| Full browser review and stale warning | Run `npm run test:e2e -- tests/e2e/fda-ingestion.spec.ts`. |

Generate the packages against a disposable test database with `node scripts/export-review-evidence.ts /tmp/fda-outcome-evidence`. The directory must not contain exports with the same names. The local publisher instructions are in the [runbook](../operations/RUNBOOK.md#synthetic-outcome-time-study).

## Persistence boundaries

The application PostgreSQL backup includes the scoped assessment, observations, receipts, linked adoption records, verified operation reference and review snapshots. The restore test reads the same persisted outcome and recomputes the comparison and fingerprint. The simulator manages its effect store independently. A main application backup only captures its independently verified reference and application evidence.

The exercises use synthetic fixtures and an isolated simulator. They establish observed handling differences in the lab. Live business savings and causal intervention attribution require separate evidence.
