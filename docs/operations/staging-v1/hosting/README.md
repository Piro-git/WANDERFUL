# Wanderful Staging Hosting V1

Status: **SOURCE READY; REMOTE HOST AND BASE URL UNASSIGNED; IOS CONNECTION NO-GO**

This package defines the only canonical zero-cost hosting candidate for the
existing standalone Node staging runtime:

- Render Free Web Service;
- service identity `wanderful-staging-v1`;
- Frankfurt region;
- repository-built `backend/Dockerfile`;
- one instance, automatic deploys off;
- Render-generated managed HTTPS;
- liveness at `/health/live`;
- readiness at `/health/ready`;
- 30-second platform shutdown delay around the application's bounded
  10-second drain deadline.

The machine-readable source is `backend/container/staging-host-contract-v1.json`.
The infrastructure candidate is `render.yaml`. Neither file is a deployment
receipt. The base URL remains `null` until a remote deployment has passed the
gates in `DEPLOYMENT_AND_ROLLBACK_V1.md`. Do not insert the anticipated Render
hostname, or any placeholder, into iOS configuration.

## What already existed

The duplicate-work audit found the reviewed standalone runtime already present:
the pinned OCI source, strict staging admission, least-privilege database
admission, bounded liveness/readiness, privacy-safe operational events,
dependency monitoring, cancellation and graceful drain. This lane reuses that
implementation instead of creating a second server or lifecycle.

The older `backend/vercel.json` describes a request-scoped serverless export.
It is not the canonical staging runtime, does not run the container admission
entry point and must not be used to populate the iOS Staging base URL.

## Release boundary

Render Free is suitable only for developer staging because it spins down after
15 idle minutes, can take roughly a minute to wake and can restart without
advance notice. It cannot establish an uptime, closed-beta or production
readiness claim. The paid-container decision in the adjacent runtime package
remains the upgrade path when stable beta availability is required.

No Render account, Blueprint, service, hostname, certificate, secret, database,
monitor or deployment was created by this repository change. No provider flag
was enabled and no provider call was authorized.

Read in order:

1. `ZERO_COST_PLATFORM_DECISION_V1.md`
2. `DEPLOYMENT_AND_ROLLBACK_V1.md`
3. `OUTAGE_DRAIN_AND_COLD_START_V1.md`
4. `MONITORING_AND_ALERTING_V1.md`
