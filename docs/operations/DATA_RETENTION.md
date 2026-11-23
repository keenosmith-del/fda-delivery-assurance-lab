# Synthetic data retention

Use dedicated environments for fixtures, staging and any future production deployment. Only synthetic case identifiers, measurements, findings, interventions and audit records belong in this lab. Enter role labels or aliases for operators. Never enter personal data, client material or credentials into application forms.

| Data | Staging policy |
| --- | --- |
| Synthetic measurements and operational records | Retain for the staging review, with an initial target of 30 days after review closes. |
| Audit history | Retain with its associated operational data. Exports and copies follow the same scope. |
| Application logs | Restrict access to operators. Target a 14-day window where the provider permits it. |
| Backup and smoke-test records | Keep backups up to 30 days, subject to provider features. Remove local smoke state when verification ends. |
| Secrets | Keep in the provider's secret settings or the authorised credential store, separate from snapshots and evidence exports. |

These limits are an operational policy. The app has no background deletion task. At the end of the review, confirm the dedicated project and database identifiers, preserve approved evidence, then schedule environment removal with authorised operators. A normal application restart, migration or seed does not delete data. Final data removal must cover snapshots and exports if held.

## Investigation records

The application stores operator questions, bounded synthetic facts, citation references, validated selections, usage metadata and review history in PostgreSQL. Provider keys, raw response bodies and free-form retrieved notes are excluded from snapshots and exports. Apply the deployment’s review-evidence retention policy to the investigation tables and include those tables in database restoration checks. Configured model processing is an independent external boundary with its own approved retention settings.
