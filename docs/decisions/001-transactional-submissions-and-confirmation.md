# 001 Transactional submissions and confirmation

**Status** Accepted for the initial ATS slice.

Use PostgreSQL for submission, operation, initial audit and confirmation job in one transaction. An independent queue would introduce a dual-write failure unless paired with an outbox. This job is small, local to PostgreSQL and requires no external side-effect coordination.

Operation identity and business identity are distinct. A request carries the browser-generated operation UUID. A candidate and requisition pair defines a business record. The UUID serialises identical retries and supports lookup. The unique constraint catches a fresh UUID submitted for an existing business record.

Use leases, a per-claim token and bounded retries to recover interrupted processing. These choices add a polling process and persistent job records. Confirmation remains asynchronous, and the operation state explicitly reports that gap. Competing native database connections are exercised by the CI integration suite.
