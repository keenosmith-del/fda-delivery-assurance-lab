# Iteration 10 · Outcome Verification

| Item | Record |
| --- | --- |
| Objective | Inspect modeled opportunity and measured activity alongside the evidence needed to verify an outcome. |
| Starting state | PostgreSQL workflow and endpoint evidence, then shared period and execution measurement tables. |
| Requirements addressed | Volume, eligibility, attempt and success counts, exception/review cost, adoption adjustment, completeness, verified timing and export. |
| Design decisions | Compute estimated benefit separately from end-to-end timing. Require complete observation, matching workloads and methods, and two reviewed timing records before returning the verified synthetic difference. |
| Database | Migration `003_adoption_and_outcomes.sql` persists period assumptions, execution costs and independently recorded timing inputs. |
| API | Added opportunity model, pairwise outcome and JSON evidence export endpoints. |
| Frontend | Added comparison period controls, observed metric table, estimate breakdown, completeness reasons, provenance and evidence download. |
| Files modified | `backend/src/modules/outcomes/`, `backend/src/api/measurement.ts`, `database/seeds/measurement.ts`, `frontend/src/features/outcomes/`, shared measurement contracts. |
| Tests executed | Unit checks for calculations and invalid data, integration tests for provenance and export, and browser verification attempt. |
| Actual results | Local tests reproduced 339.64 modeled occurrences, checked a 22,000-second matched synthetic timing difference and withheld verification on incomplete evidence. Browser and hosted results are tracked in the verification matrix. |
| Problems and resolutions | The pipeline fixture deliberately lacks a comparison time study. It still reports its measurements, costs and estimates and spells out the evidence gaps. |
| Known limitations | Synthetic prospective model and retrospective fixture comparison. The difference is specific to the reviewed timing records. |
| Next steps | Establish measurement ownership and validation rules before importing operational data. |
