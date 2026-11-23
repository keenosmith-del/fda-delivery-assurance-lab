# Iteration 15 · FDA integration gateway

Milestone 07 establishes an independent synthetic publisher and a lab-owned ingestion API. Legacy seed data remains available for regression and comparison. The publisher sends typed HTTP requests through Fastify and can be replaced without changing the canonical store or downstream workspaces.

## Integration boundary

1. The separate Node publisher sends the scoped `fda-lab.ingestion/v1` event to the gateway.
2. The transport checks a bounded Bearer credential before parsing the body. The configured credential grants access to one tenant and source. It grants no hosted workspace access.
3. The ingestion service validates the contract and event times, fingerprints normalized content and commits a receipt plus the initial event, if valid.
4. A second transaction locks the source event and writes its canonical record and terminal receipt. The read model joins the canonical record to its successful receipt and versioned event.
5. FDA Integration displays persisted receipt and source state. The existing Agent Health and Workflow Evidence navigation provides a simulated FDA dataset alongside the legacy fixtures.

HTTP reuses Fastify, supports an independently executable simulator, and lets integration tests exercise authentication and parsing. A file adapter or an authorized connector could submit the same typed records through a separate transport. The HTTP API, contract, identifiers and permission labels belong to this independent lab. Any integration with attain would require technical discovery, authorization and confirmation of source ownership, available fields, data rights, throttling, retention and incident handling.

## Persistence and delivery

Migration 006 adds tenant and source registrations, `fda_source_events`, `fda_canonical_records` and `fda_ingestion_receipts`. Composed keys enforce source isolation and event identity. Credentials come from process configuration. The registration stores the credential reference, and the API uses a constant-time digest comparison. No credential bytes or digests are available in browser responses.

Each accepted event has one durable source identity. Each authorized delivery has an independent receipt, including schema rejection, scope mismatch and conflict. Invalid JSON and oversized bodies are rejected before receipt creation. A same-content replay acknowledges the original canonical record. Reuse of an identity with changed content returns a conflict. Timestamps are normalized to UTC and object keys are canonicalized for hashing. Array order is part of the record.

Processing is synchronous for this slice. The committed receipt makes an interrupted request recoverable. A retry with an identical event can resume processing after an API restart. The lock serializes replays. Projection and its processed receipt commit atomically. A failed projection rolls back to a savepoint and records the failure. Processing can make three projection attempts, with manual replay as the trigger. Source acceptance remains durable at the limit. Processing is an in-transaction state, so readers normally see the committed received, processed, or failed state.

Receipt data records server receipt and completion times, source occurrence, source scope, normalization fingerprint, validation, error, canonical ID, and the accepting and processing application revisions when configured. The same ID and canonical payload stay stable across retries. There is no generalized replay scheduler or operator redrive in this slice.

## Event time and measurements

An event may be delayed or out of order. An event dated before 2000 or more than five minutes ahead of the server receipt is rejected. An embedded lifecycle timestamp cannot follow the source event, and each observation window has a positive duration of at most 31 days. Window membership uses observed time and the documented half-open window `[start, end)`. Agent Health uses the latest source event valid at the window end for status, reported time for permission, and actual observation times for interval coverage. A late-arriving observation can update a historical interval while older endpoint status leaves newer status intact.

The baseline records nine enrolled endpoints, seven recent online heartbeats, permission-limited capture, stale evidence on a reporting endpoint, missing intervals, a version update and a delayed observation. Workflow Evidence checks that referenced observations belong to the candidate and declared window and flags incomplete or unknown coverage and unresolved references. Imported workflow frequency and recommendation come from the simulated source. Legacy scoring and reviews continue on the separate fixture dataset. Automation measurements persist and can be retrieved as canonical records. Adoption and outcome workspaces continue to use the existing fixtures.

## Verification

The [verification matrix](../testing/VERIFICATION.md) tracks executable checks. Local publisher commands and scope setup are in the [operator runbook](../operations/RUNBOOK.md). The [API contract](../architecture/API_CONTRACTS.md) defines responses and limits.

The baseline snapshot corresponds to upstream commit `2edce23c63f84bad089cb4cc097cf8dd593a4d88`. Dependency installation, type-checking, build, evidence generation and 34 backend tests passed on the baseline using the repository's disposable PGlite setup. Five baseline tests require a native PostgreSQL connection. The local runner denied loopback binds, which prevented baseline Chromium startup.
