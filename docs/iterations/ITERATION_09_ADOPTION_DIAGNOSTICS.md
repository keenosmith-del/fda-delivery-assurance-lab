# Iteration 09 · Adoption Diagnostics

| Item | Record |
| --- | --- |
| Objective | Give operators a traceable path from adoption evidence to an owned intervention and later measurement. |
| Starting state | Main `bad4119518e22f68521b9e756679ef542d94d790` with verified ATS, Workflow Evidence and Agent Health. |
| Requirements addressed | Eligible population, first-use and opportunity usage, execution exceptions, evidence-backed diagnosis, intervention and follow-up. |
| Design decisions | Distinct denominators and persisted first-use events. Store a snapshot of the supporting fact and keep the hypothesis separate. Intervention transitions and audit share a transaction. |
| Database | Migration `003_adoption_and_outcomes.sql` adds automation definitions, periods, cohort members, opportunities, first-use and execution events, observed signals, findings, intervention logs and audit. |
| API | Read automation periods and diagnostic details. Add four authorised mutation routes for diagnosis, plan, implementation and subsequent measurement. |
| Frontend | Added automation and period selection, evidence, trends, decision forms and an audit view. |
| Files modified | `backend/src/modules/adoption/`, `backend/src/api/measurement.ts`, `shared/contracts/measurement.ts`, `database/seeds/measurement.ts`, `frontend/src/features/adoption/`. |
| Tests executed | Rate boundary unit test, seeded adoption, invalid requests, protected writes, workflow persistence, and browser verification attempt. |
| Actual results | Local API tests confirmed the 80% and 50% baselines, implementation ordering, single audit event on rerun and duplicate follow-up rejection. Local browser and hosted evidence are tracked in the verification matrix. |
| Problems and resolutions | The operator can record a past implementation date separately from its audit timestamp. Only measurement windows that begin on or after implementation qualify for follow-up. Kept validation compatible with Node's native TypeScript strip mode. |
| Known limitations | Seeded data and role labels. Compared windows provide descriptive change and require controls to establish causality. |
| Next steps | Incorporate real measurement ingestion only after an access and data governance design is approved. |
