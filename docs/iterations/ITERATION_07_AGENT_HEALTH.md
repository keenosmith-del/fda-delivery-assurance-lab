# Iteration 07 · Agent Health

| Item | Record |
| --- | --- |
| Objective | Show independent enrolment, heartbeat, permissions and observation freshness over a fixed window. |
| Starting state | No endpoint-health model or persisted device history. |
| Requirements addressed | Reproducible seven-of-nine sample, missing intervals and device history, calculated freshness and permission state. |
| Architecture decisions | Measure status at the window end. Use a 90-minute heartbeat and observation threshold. Group adjacent hourly observation gaps. |
| Implementation and files | Added backend health service, health endpoints, shared contract, fixtures, Agent Health screen and API/calculation/browser tests. Uses migration 002. |
| Database and API | Stores enrolments and heartbeat, permission and observation events. Adds coverage summary and detail reads. |
| Tests performed | Coverage count, reporting with limited permissions, stale and unobserved states, gap aggregation and missing device response. |
| Actual results | Embedded endpoint and calculation tests passed. Browser test discovered but blocked at listener startup. |
| Problems and resolutions | Fixed-window measurement prevents fixture states from drifting with wall-clock time. |
| Known limitations | The lab exposes a synthetic sample. Changes in fleet state and organisation-wide capture are outside its evidence. |
| Completion status | Service and interactive workspace view implemented. Live visual approval pending. |
| Next steps | Complete browser verification and use the health context in adoption and outcome work. |
