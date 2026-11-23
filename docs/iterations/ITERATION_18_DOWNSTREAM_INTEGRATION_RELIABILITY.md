# Iteration 18 · Downstream integration and delivery reliability

Milestone 09 produced scoped workflow decisions and delivery cases. Milestone 10 adds an execution record that links the exact approved assessment revision to the operation, each dispatch, and the independently verified synthetic effect. The ATS confirmation worker continues to run independently.

## Execution boundary

An operator attests to a single synthetic execution. The server resolves the case, decision, latest assessment revision, prerequisites and current evidence fingerprint under the same source lock used for publication and approval. The caller supplies an idempotency key and a reason. The service derives the effect from the approved case and source workflow category. The request cannot supply a destination or effect payload. A supervised pilot also requires confirmation of its review checkpoint, operating limits and stop criteria. It allows one logical effect and stops redispatch and redrive on failure.

Approval is scoped to the local lab and its loopback simulator. Hosted workspaces provide read access according to their existing role model. Synthetic operation writes are disabled in the hosted server configuration. No client credential or external deployment is involved.

## Runtime and operations

Migration 009 adds the scoped operation, transactional dispatch job, attempt history and audit table. The operation references the original case, assessment revision, decision and evidence fingerprint. Creation commits the execution attestation, operation and job together. An identical request replay returns the original operation. Changing the request under the same key produces a conflict. The case has one effect per approved revision.

The HTTP adapter uses a dedicated credential, a canonical numeric loopback origin, no redirects, a bounded response and a deadline. The independently executable simulator stores effects in its own database. Its versioned request contains a canonical effect identity and operation ID. A committed replay returns its original result. A payload conflict is rejected and the authoritative effect remains unchanged.

The worker claims one due job with PostgreSQL row locking and an expiring token. It commits the attempt before performing network I/O. Finishing requires the matching unexpired token. Expired leases trigger an authoritative lookup, including when dispatch might have happened before the process stopped. Retryable failures use bounded exponential backoff and respect a bounded Retry-After interval. Validation, credentials and idempotency conflicts terminate the operation. Queue processing and ATS confirmation use different entrypoints.

An acknowledgment moves the operation to reconciliation. The worker verifies the effect key, operation identity and canonical payload fingerprint against the independent lookup. A matching record verifies success. A mismatched record terminates for investigation. An unconfirmed write followed by an authoritative miss can be dispatched again with the same identity within policy. An acknowledged write with delayed lookup continues verification without redispatch. Bounded redrive allows one extra dispatch after a fresh case gate and an authoritative miss. An operator can cancel before the first claim or request lookup-only recovery after an eligible terminal result.

Dispatch may be repeated. The simulator durably enforces one effect per canonical business identity. The export records the planned scope, authorisation, every attempt, failure code, lease recovery, downstream acknowledgment, lookup evidence, timestamps and audit history.

## Verification

- Backend tests cover scoped creation, rollback, worker contention, lease expiry, reconciliation, idempotent replay, conflicting payload, rate limits, unavailability, validation, delayed lookup, mismatch, exhaustion, redrive, pilot restrictions and additive upgrade.
- The browser acceptance journey publishes source records, approves the delivery case, starts execution and downloads evidence after the simulator commits the effect and closes its HTTP socket. In native CI the simulator runs in a child process with a separate PostgreSQL schema.
- Evidence generation exercises lost acknowledgment and pre-commit failure with operator redrive. The backup check verifies restored case associations, attempt history, audit history and effect references in the lab database. The simulator database requires its own backup.
- The image check verifies the production build includes migration 009 and both downstream entrypoints.

## Follow-on work

Connect verified operations to adoption measurements and outcome evidence. Add evidence-grounded investigation, engagement-level reporting and hosted acceptance after those capabilities are defined. The configured simulator and its fault harness cover only synthetic lab flows.
