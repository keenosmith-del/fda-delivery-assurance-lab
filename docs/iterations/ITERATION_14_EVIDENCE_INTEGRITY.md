# Iteration 14 · Evidence integrity and traceability

## Objective and starting state

Address the independent review of the synthetic walkthrough, starting from `2bdde0d60399b80852a9651c30cc75af0afe2418`. Earlier evidence included a downloadable outcome comparison, on-screen ATS and adoption traces, and deterministic workflow scoring. The complete intake example, scoring inputs, and linked audit evidence needed a reproducible export.

## Implementation

- Added ATS, adoption and workflow evidence downloads alongside the existing outcome download. Each receipt has a versioned envelope. Calculation outputs identify their rubric or method. Multi-query exports use a read-only repeatable-read snapshot.
- Migration `005_evidence_provenance.sql` adds role and source revision to workflow reviews and adoption audit rows, records synthetic fixture review provenance, and adds a table for synthetic ATS fault decisions. Migrations 001–004 remain unchanged.
- A lost acknowledgment decision is written with the committed operation. A pre-commit interruption rolls back the operation before its separate diagnostic receipt is written. The export relates these records by operation UUID. It omits candidate input codes and shows server fault decisions, not a client network trace.
- The workflow detail exposes suitability inputs, factor values and weights, observation IDs and the heuristic version. The scoring math and thresholds are unchanged.
- Outcome verification surfaces the modeled net, the reviewed synthetic difference, and the gap with separate units, assumptions and scope. Incomplete studies continue to produce a null reviewed comparison.
- Adoption exports relate diagnoses, interventions, and follow-ups, report the seeded before/after trade-offs, and disclose the lack of causal evidence. Shared credential roles provide role attribution. Free-text notes and names are excluded from review exports.
- Changed backend API and modules, shared contracts, seed metadata, workspace copy and download links, and the verification workflow. All workspaces retain the existing design and interactions.

## Verification and evidence

The verification workflow runs native PostgreSQL tests and the normal and private Chromium suites, builds the release image, and checks disposable backup and restore. It generates both outcome examples, two ATS recovery receipts, the workflow receipt and the adoption receipt from an isolated synthetic database. See [verification](../testing/VERIFICATION.md) for the generation command and acceptance scope.

The development checkout passed type checks, the build, and 34 embedded database tests. Five native-only cases required the CI PostgreSQL 17 service. Local Chromium launch failed at the macOS Mach port restriction in both browser suites, before any browser assertions ran. GitHub's Linux runner is the browser acceptance environment for this iteration.

## Limits and next gate

The evidence supports synthetic test-environment claims. The time study does not provide human reviewer identity or per-item timings. An environment that does not supply an exact build revision exports a null revision. Railway provisioning remains deferred pending existing-project capacity. Live acceptance still requires private PostgreSQL 17, combined web/API, an independent worker, and hosted smoke, browser and restart checks.
