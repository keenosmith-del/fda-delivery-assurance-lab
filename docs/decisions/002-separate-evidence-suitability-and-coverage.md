# 002 Separate evidence, suitability and endpoint coverage

**Status** Accepted.

Classification weights ordered sequence similarity at 45%, frequency at 20%, dominant-sequence consistency at 20% and device corroboration at 15%. Frequency reaches its cap at ten observations and corroboration at four devices. These are transparent reference heuristics and require representative labelled data before any calibration claim.

Suitability is a separate score. It combines eight persisted operational assumptions with observed exception frequency. High human judgment or risk calls for retaining manual review even if the composite score suggests a pilot. The model explains its factor contributions and operators can record independent decisions with reasons.

The same dataset stores heartbeat, permission, and successful observation events separately. The window end is the reference for the demo, giving stable replay even as wall-clock time changes. Reporting and observation freshness use a 90-minute threshold. Interval gaps describe the successful-observation sample. Device counts cannot estimate organisation-wide activity capture.
