# Evidence integrity

## What an export establishes

The API exports a consistent read-only PostgreSQL snapshot. It includes source table and record identifiers so the inputs, decisions and results can be traced to the same view of the database. The source revision identifies the exporting application build. It comes from `LAB_SOURCE_REVISION` or Railway's `RAILWAY_GIT_COMMIT_SHA`. An absent or invalid value is represented as `null`. New review decisions, adoption audit events and synthetic ATS fault decisions also record the source revision at write time. Earlier records keep unknown attribution.

The actor is derived from the existing authentication mechanism. `operator` and `demo` are shared hosted credential roles. `local-token` and `local-open` describe local access policies. These fields do not identify individual people. Time-study review is a fixture flag with fixture provenance for newly seeded studies. Older rows can have a reviewed flag without known review provenance. There is no individual or independent measurement sign-off.

The export routes project fields explicitly for working records. Review reasons, adoption hypotheses, actions, owner names, follow-up notes and operator identifiers remain in the workspace. Candidate input codes, payload fingerprints, credentials and queue lease tokens are excluded. Supporting task sequences and adoption signal descriptions come from the synthetic lab data. Keep the dataset synthetic.

## Workflow scoring

Both scores are rounded weighted composites on a 0–100 rubric. They have no statistical calibration. Changing the sample or the engineering assumptions changes the factors and may change the recommendation.

| Classification factor | Weight | Input |
| --- | ---: | --- |
| Ordered sequence similarity | 45% | Average across observations of matches at the same step index divided by the longer sequence length |
| Evidence frequency | 20% | Observation count divided by 10, capped at 1 |
| Most repeated sequence | 20% | Highest occurrence count of an identical ordered sequence divided by observation count |
| Endpoint corroboration | 15% | Distinct observed devices divided by 4, capped at 1 |

Each computed factor is rounded to a whole point before the final weighted sum. No observations yields zero for all four classification factors. Suitability uses determinism (15%), exception-free observations (10%), independence from judgment (15%), permission readiness (10%), integration availability (10%), low sensitivity (8%), low risk (10%), low complexity (7%), and expected value (15%). Judgment, sensitivity, risk and complexity are inverted using `100 − input`. Assigned inputs are engineering rubric values. Exception-free share comes from the observations.

The recommendation first asks for more evidence below 65 classification points. Judgment or risk of at least 80 calls for human review. Otherwise a suitability score of at least 75 qualifies for considering a supervised pilot. These are lab decision thresholds. The offer-review fixture reproduces 94 classification points and 44 suitability points.

## Candidate intake reconciliation

The selected fixture compares 2–9 November 2026 with 9–16 November 2026. Both periods contain 350 observed items. The modeled eligibility assumption is 86%, so baseline modeled opportunity is `350 × 0.86 = 301` occurrences. The observed ledger records `319 ÷ 350 = 91.14%` eligible opportunities. The assumption and ledger input answer different questions.

| Calculation | Reproducible result |
| --- | --- |
| Gross modeled savings | `237 successes × 240 baseline seconds per item = 56,880 s` |
| Net modeled savings | `56,880 − 1,805 rework − 6,160 review = 48,915 s` (815.3 minutes displayed) |
| Reviewed synthetic difference | `84,000 − 62,000 = 22,000 s` (366.7 minutes displayed) |
| Modeled net minus reviewed difference | `48,915 − 22,000 = 26,915 s` (448.6 minutes displayed) |

The estimation formula credits each successful comparison execution with a fixed manual-time assumption. It then subtracts the comparison execution ledger's review and rework costs. The reviewed fixture compares whole-period human handling, including residual human work, across matched volumes using the same method. The aggregate fixture contains too little detail to allocate the gap among remaining manual work, actual per-item handling, and other differences in scope. In particular, costs already in the time-study total must not be deducted again. Neither figure is a measured real-world saving.

Pipeline Digest lacks a reviewed comparison study and observed 40 of 46 expected opportunities in the follow-up. Its modeled net of 2,575 seconds is available. The reviewed difference and reconciliation gap remain `null`. The sum of modeled opportunities across both automations is 339.64 occurrences. It measures modeled volume under assumptions.

## Pipeline digest adoption

| Metric | Baseline | Follow-up | Change |
| --- | ---: | ---: | ---: |
| Eligible-user adoption | 2 / 4 = 50% | 3 / 4 = 75% | +25.0 percentage points |
| Execution reliability | 14 / 15 = 93.3% | 19 / 22 = 86.4% | −7.0 percentage points |
| Observation coverage | 46 / 46 = 100% | 40 / 46 = 87.0% | −13.0 percentage points |

Adoption and absolute successes increased. Failures rose from one to three, exceptions from three to six, and follow-up coverage declined. The onboarding record links a diagnosis and planned intervention to an existing fixture window. The fixture independently seeds both measurement windows, and the second begins on the recorded implementation date. There is no control group or counterfactual. Missing observations, differences in operators and eligible workload, and execution conditions are plausible alternative explanations to investigate.

## Research and verification boundaries

The [source register](../research/SOURCE_REGISTER.md) separates published Attain statements, supplied source material, lab assumptions and hypotheses. The evidence here records reproducible synthetic experiments and verified application behaviour in the test environment. It establishes no live ATS confirmation, employee telemetry, real business benefit, causality or production performance.

## Imported source evidence

The simulated FDA dataset traces each canonical event to the receipt that processed it. Endpoint history and workflow observations link to those receipts. Event occurrence, server receipt and processing timestamps identify distinct stages. Source-supplied coverage and recommendations are evidence inputs, while derived reporting, missing intervals and unresolved relationships come from the lab's read models. Imported permissions do not establish lawful authorization. The existing evidence exports continue to describe their original fixture datasets.

## Workflow planning decisions

An assessment revision freezes its canonical evidence, receipt links, readiness rule version, feasibility, suitability and risk inputs. A decision links to that precise revision. Its export also includes current evidence so changes can be identified while the saved evidence remains independently readable. Role-level operator attestation, source observations, deterministic rules and external prerequisites appear as distinct records.

## Downstream execution evidence

The execution record retains the exact approval revision and source fingerprint at authorisation. Exports show a dispatch response separately from the authoritative lookup, including the expected and observed effect fingerprints and verified effect ID. The same evidence preserves terminal and ambiguous outcomes. The export generator exercises a post-commit acknowledgment loss and a pre-commit failure followed by explicit redrive.
