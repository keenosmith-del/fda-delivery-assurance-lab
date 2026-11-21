# Staging verification

## Provider status

On 21 November 2026, the existing [Railway project](https://railway.com/project/8317c467-7b5b-4067-887a-00798a6f312b) (`delightful-learning`) was inspected in its `production` environment (`1ddfec7a-4ce9-421e-83c6-884d40654750`). This is the target for the lab's staging mode. The environment had 14 unapplied configuration changes in patch `ed94d087-cb3a-47dc-b24c-d4b54242bac3`, two service drafts and no deployed services or volumes.

| Required service | Provider state |
| --- | --- |
| Combined frontend and Fastify API | Undeployed. Existing draft `b1b7be84-61c2-4091-994f-ccc5f3601753` runs the backend as a separate workspace. |
| Confirmation worker | Undeployed. Existing draft `5a8bec92-3cf5-4d2f-905b-989501a8f063` runs the Vite development server and is a candidate for repurposing. |
| Private PostgreSQL 17 | Provisioning rejected. No service, volume or proxy created. |

Railway rejected creation of an additional staged service, including an empty service, with `INVALID_ARGUMENT` and the message `Free plan resource provision limit exceeded. Please upgrade to provision more resources!` The patch remained staged after the requests. Neither app draft was applied. No staging URL, deployment IDs, migrations, seed, worker heartbeat, hosted test output or hosted restart evidence exists.

Railway CLI reported $0.6074 in current workspace usage and no workspace-configured usage limit. The remainder of the $5 trial grant was approximately $4.39, consistent with the most recent dashboard reading of 20 days or $4.39 left. Trial credit and permission to provision a new resource are separate.

The authorised architecture requires capacity for all three services in this project. The [candidate source branch](https://github.com/keenosmith-del/fda-delivery-assurance-lab/tree/codex/railway-staging-0a7f294) points to `0a7f294d62bdfcbf4e2f818ca160b4a4da2a9632`. Once capacity is available, repurpose the two drafts and provision PostgreSQL as described in the [deployment runbook](../operations/DEPLOYMENT_RUNBOOK.md).

## Verified release checks

[GitHub Actions run 44933344304](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44933344304) passed for the exact staging candidate `0a7f294d62bdfcbf4e2f818ca160b4a4da2a9632`. It ran the GitHub CI workflow with disposable infrastructure.

[GitHub Actions run 44926893880](https://github.com/keenosmith-del/fda-delivery-assurance-lab/actions/runs/44926893880) passed on 21 November 2026 for `3a9d837de8b352d1f37e86bf647d89491640a5db`. It verified 33 backend tests with PostgreSQL 17, seven baseline Chromium cases, two private-origin cases, the container build and a successful backup and restore with matching version and fixture counts.

## Executable checks

- CI uses disposable PostgreSQL 17 for API integration, native concurrent and process recovery cases, then runs seven baseline Chromium cases and the separate private-origin browser suite.
- CI builds the deployment image and checks the packaged frontend, API, worker and migrations. Its disposable database backup test restores an archive into a separate database and compares version and fixture counts.
- The private-origin browser fixture tests real authentication and same-origin writes against the compiled frontend. It does not use a Railway environment.

For authorised staging set the origin, viewer password, operator password and explicit local state path as `LAB_SMOKE_ORIGIN`, `LAB_SMOKE_VIEWER_PASSWORD`, `LAB_SMOKE_OPERATOR_PASSWORD` and `LAB_SMOKE_STATE` using a protected shell environment. Do not publish their values. Then run:

```sh
node scripts/staging-smoke.mjs
npm run test:e2e:private
# After an independent API and worker restart
node scripts/staging-smoke.mjs after-restart
```

The smoke test checks authenticated UI and module reads, unauthorised access, viewer write denial and disabled faults, then creates a synthetic operation and waits for its worker confirmation. The follow-up checks that operation and its original record ID. With an HTTPS origin configured the private browser suite targets the deployed origin and does not start a local fixture. Keep the live target's fault flag disabled.
