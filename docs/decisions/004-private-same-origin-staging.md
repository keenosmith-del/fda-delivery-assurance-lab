# 004 Private same-origin staging

Deliver the compiled React bundle and Fastify through one Railway HTTPS origin. Use a separate worker and PostgreSQL on the private network. The Vite development proxy remains available for local use. A single hosted origin gives API and asset delivery one access policy and avoids cross-origin credentials.

Shared role credentials are suitable for a private, synthetic demo with TLS. Viewer, operator and optional demo capabilities have separate credentials. Only probes return publicly. The legacy write token remains specific to the local harness. Hosted faults require staging, an explicit switch, and a separate demo role. A public or per-user release would require identity, credential lifecycle and edge-rate-limit decisions beyond this scope.

The database owns migration versions, queued operations and worker heartbeat. Application probes separate readiness from worker status so an interrupted worker can recover independently without taking read access offline.
