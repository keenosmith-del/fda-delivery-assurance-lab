# Iteration 19 · Delivery adoption and intervention assurance

A verified synthetic delivery case can now be followed through usage measurement, diagnosis, intervention and a later measurement period. The legacy Adoption Diagnostics fixtures still serve their original independent demonstration.

## Evidence and calculations

The assessment references the tenant, source, workflow, engineering assessment revision, decision and approved delivery case. The downstream operation supplies its independently verified effect and timestamp. Usage observations have their own synthetic source event identities, declared measurement windows, pseudonymous cohort and opportunity records. The publisher uses the scoped FDA lab source credential with the dedicated adoption-observation contract. It can run against an isolated local API.

User adoption counts distinct eligible participants who attempted a qualifying opportunity against the explicitly established eligible cohort. Opportunity usage counts attempted opportunities against observed eligible opportunities. Execution reliability counts independently verified successes against qualifying attempts. Coverage counts distinct observed measurement units against the declared expected units. Zero or unknown denominators are unavailable. Incomplete or contradictory evidence is visible alongside any observed counts.

A downstream effect can be explicitly assigned to one logical opportunity across its delivery case. Source-reported results with no authoritative match retain their reported classification. Transport retries and duplicate attempts do not change the number of attempted opportunities. Duplicate and conflicting source-event submissions produce durable receipts. Event occurrence determines window membership, and receipt times show when the publisher delivered the evidence.

The versioned thresholds describe lab diagnostic signals. Recorded explanations are operator hypotheses. An operator may save a diagnosis, plan an intervention, record implementation, register follow-up, review and close. Reviews preserve the measurements and limitations used at the time. Identical request IDs replay safely, while competing transitions are serialised. Comparisons show count differences, percentage-point changes and cohort or coverage limitations. Observed changes cannot establish intervention causality.

## Reproduce the delivery-linked journey

1. Import the synthetic FDA workflow and complete its engineering review. Open its delivery case and start the synthetic downstream operation. Wait for the authoritative verification result.
2. Follow **Open FDA-linked Adoption Diagnostics** before publishing usage. The page displays unknown adoption.
3. Retrieve the case ID, workflow ID, operation ID and ISO verification time from the case or downstream export. With the local publisher configured, run `npm run adoption:publish -- CASE_ID WORKFLOW_ID OPERATION_ID VERIFIED_AT baseline`. Replay the same command to see duplicate receipts. The baseline has one distinct adopter among four eligible participants.
4. Record a diagnosis for `period-001`, plan a follow-up for `period-002`, and record implementation on the third UTC calendar day after verification.
5. Publish the same case with fixture variant `improvement`. Refresh the page and record the follow-up. The observed adoption rate moves from 25% to 75% in the synthetic cohort. Check the one verified baseline success and separately classified follow-up activity.
6. Use the `unchanged`, `incomplete` and `changed-cohort` variants for periods 003, 004 and 005 respectively. Plan a separate matching follow-up for each variant. The comparisons report zero change, insufficient coverage and changed cohort respectively.
7. Download the adoption evidence. Review the observations, receipts, logical evidence, metrics, scope, revision, operator audit and interpretation limits.

The browser suite covers one end-to-end case. Backend tests cover the populated upgrade, source authentication, scope, duplicate delivery and requests, logical execution deduplication, unknown or incomplete conditions and comparisons. The evidence runner exports the linked adoption package, and the PostgreSQL backup workflow checks that the assessment, usage and independent operation reference survive restore.

All activity is synthetic. The product does not collect employee activity or connect to customer environments. Outcome attribution and business-value verification are outside this iteration.
