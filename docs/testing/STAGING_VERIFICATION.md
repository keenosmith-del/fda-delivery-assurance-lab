# Staging verification

## Provider status

On 21 November 2026, Railway CLI authenticated and listed accessible projects. Creation of a dedicated staging project returned `Free plan resource provision limit exceeded. Please upgrade to provision more resources!` No staging project was created and no existing project was repurposed. Capacity in an authorised workspace is required for the API, worker and managed PostgreSQL services. Hosted smoke, staging browser acceptance, restart checks on Railway and a staging URL are pending.

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
