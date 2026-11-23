# Research source register

| Source | Observation and relevance | Evidence boundary |
| --- | --- | --- |
| [Attain FDA sample report](https://attainhq.ai/docs/fda), published report, sections 3–4 | 528 retried saves and 428 post-submit waits in one ATS workflow over 14 days. The published write-path proposal includes validation, idempotency and asynchronous confirmation. | Historical observations of user workflow friction. The report gives no independent transaction-level diagnosis or current production baseline. |
| [Attain product workflow](https://attainhq.ai/how-it-works), public description | Describes installation, observation, diagnosis and implementation. | Vendor description of the product workflow. |
| Supplied implementation brief, §§5–7 | Reports walkthrough figures of 245 discovered tasks, 187 potentially automatable tasks, 7 of 9 computers reporting, 80% and 50% example adoption, and a model of 339.64 weekly occurrences. | These figures are attributed to the supplied brief. The underlying recording was unavailable for direct inspection in this iteration. Endpoint reporting is a device ratio. |
| Supplied static inspector report, Attain Telemetry Agent v0.5.15 | Reports a macOS Universal background bundle and declared permissions. This informs separate enrolment, permission and heartbeat states in the future Agent Health module. | Reviewed the report. Runtime behaviour, Gatekeeper status and private implementation are unverified. Reported DMG SHA-256 `f4c637beb8e513b4560fe37bb4ded3dde269cd95d25fe1ec2f88e1992baee5e1`. |

The ATS application uses generated candidate codes and an independent schema. Request failures and test outcomes are local synthetic experiments. The lab records no workplace telemetry.


The independent engineering review of the lab walkthrough identified the need for exportable evidence and clearer claims. It evaluated the synthetic application and reviewed source at `0a7f294d62bdfcbf4e2f818ca160b4a4da2a9632`. It supplies no new vendor telemetry or production measurements. See [evidence integrity](../architecture/EVIDENCE_INTEGRITY.md) for the reproducible lab results and explicit inference limits.

The `fda-lab.ingestion/v1` schema and simulated publisher are lab-owned hypotheses. All endpoint, observation and workflow references are synthetic. The source register establishes engineering context for the modeled categories and provides no evidence of a compatible attain API or event stream.

### Workflow assessment boundary

Imported FDA-shaped observations and recommendations are synthetic inputs to the engineering review. The lab's feasibility, readiness, approval and planning models are independent engineering constructs. They do not document a private attain approval workflow or imply access to any external client environment.
