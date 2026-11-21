# Iteration 13 · Railway staging

## Objective

Deploy the verified lab for private review using the existing Railway project, same-origin web/API, independent confirmation worker and private PostgreSQL 17 with persistent storage.

## Starting state and decisions

The source was `0a7f294d62bdfcbf4e2f818ca160b4a4da2a9632`. The Railway environment had no live services or volumes. Its 14 pending changes would have created separate frontend and backend builds from `main` using Railpack, workspace-scoped watch paths and a Vite development server. The reviewed release instead packages the frontend and Fastify in one Docker image, which the worker also uses with its own start command.

The existing drafts were preserved pending capacity to provision a third service. This kept the incompatible configuration unapplied and kept workspace billing settings untouched. The release candidate has a dedicated Git branch fixed to the reviewed source for the current deployment attempt.

## Changes and evidence

- [Deployment runbook](../operations/DEPLOYMENT_RUNBOOK.md) identifies the existing project and the pending configuration that needs reconciliation.
- [Staging verification](../testing/STAGING_VERIFICATION.md) records provider and service state, workspace usage and the exact provisioning failure.
- Database migrations, API routes, frontend and worker source did not change.
- [Release CI](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44933344304) concluded successfully for the exact candidate. The staging environment had no deployment available for hosted verification.

## Blocker and remaining acceptance

Railway rejected both image-backed and empty PostgreSQL service creation. The empty service attempt returned `Free plan resource provision limit exceeded. Please upgrade to provision more resources!` There was no successful provisioning or staging rollout. When the existing project can provision all required services, complete the private, fault-disabled deployment, migration and explicit synthetic seed. Run live smoke and Chromium against the protected HTTPS origin, restart the web/API and worker independently, and record the persisted operation and record IDs.
