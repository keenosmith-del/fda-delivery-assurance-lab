# Research source register

| Source | Observation and relevance | Evidence boundary |
| --- | --- | --- |
| [Attain FDA sample report](https://attainhq.ai/docs/fda), published report, sections 3–4 | 528 retried saves and 428 post-submit waits in one ATS workflow over 14 days. The published write-path proposal includes validation, idempotency and asynchronous confirmation. | Historical observations of user workflow friction. The report gives no independent transaction-level diagnosis or current production baseline. |
| [Attain product workflow](https://attainhq.ai/how-it-works), public description | Describes installation, observation, diagnosis and implementation. | Vendor description of the product workflow. |
| Supplied implementation brief, §§5–7 | Reports walkthrough figures of 245 discovered tasks, 187 potentially automatable tasks, 7 of 9 computers reporting, 80% and 50% example adoption, and a model of 339.64 weekly occurrences. | These figures are attributed to the supplied brief. The underlying recording was unavailable for direct inspection in this iteration. Endpoint reporting is a device ratio. |
| Supplied static inspector report, Attain Telemetry Agent v0.5.15 | Reports a macOS Universal background bundle and declared permissions. This informs separate enrolment, permission and heartbeat states in the future Agent Health module. | Reviewed the report. Runtime behaviour, Gatekeeper status and private implementation are unverified. Reported DMG SHA-256 `f4c637beb8e513b4560fe37bb4ded3dde269cd95d25fe1ec2f88e1992baee5e1`. |

The ATS application uses generated candidate codes and an independent schema. Request failures and test outcomes are local synthetic experiments. The lab records no workplace telemetry.
