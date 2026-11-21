# Iteration 06 · Workflow Evidence

| Item | Record |
| --- | --- |
| Objective | Let operators inspect task evidence, calculate separate scores and persist reasoned decisions. |
| Starting state | ATS runner and synthetic research observations. |
| Requirements addressed | Deterministic fixtures, supporting observations, separate scoring, recommendation reasoning and review history. |
| Architecture decisions | Derive classification from persisted sequences. Assess suitability from persisted operational assumptions and observed exception rate. Keep human decisions separate. |
| Implementation and files | Added workflow service and scoring, shared intelligence contracts, migration 002, fixture generator, Discover view and browser and API assertions. |
| Database and API | Added candidates, observations and reviews. Added task list, task details and review endpoints. |
| Tests performed | Reseed, deterministic scores, evidence, token validation, invalid reasons, two-decision persistence and history order. |
| Actual results | All corresponding embedded tests passed. Browser test discovered but blocked at listener startup. |
| Problems and resolutions | The walkthrough aggregates are attributed vendor observations. The lab provides six curated task candidates with replayable records and transparent reference weights. |
| Known limitations | Scores are reference heuristics. Review reason access and retention must be defined before use with real operators or data. |
| Completion status | Interactive UI and PostgreSQL-backed service implemented. Browser verification pending. |
| Next steps | Verify the browser workflow and extend the evidence model for adoption diagnostics. |
