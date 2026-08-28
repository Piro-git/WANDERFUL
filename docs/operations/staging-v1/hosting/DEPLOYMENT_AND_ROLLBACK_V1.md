# Free Staging Deployment and Rollback V1

This runbook is an owner action. Repository presence does not authorize a
deployment. Do not run it until the database lane has produced the approved
staging identity, least-privilege roles and CA material.

## Pre-deployment gates

1. Require a clean reviewed commit on
   `codex/integrate-staging-release-wave1` containing `render.yaml` and the
   existing OCI runtime tests. Never deploy or push `main` from this lane.
2. Confirm the Render workspace has no payment method. Do not accept a trial,
   add billing information or upgrade the `free` instance.
3. Confirm the target is exactly one service named `wanderful-staging-v1` in
   Frankfurt. Reject any existing same-name resource that was not created from
   this contract.
4. Require the database lane's approved staging project-ref SHA-256, private
   application schema, distinct runtime/control/operator role names, runtime
   connection source and Supabase CA. Reject the production project and every
   owner/admin/service-role identity.
5. Confirm all provider, research, evidence, routable-access, mock and insecure
   flags in `render.yaml` are exact string `false`.

## Create the candidate

1. In Render, create a Blueprint from the reviewed repository and the exact
   `codex/integrate-staging-release-wave1` commit approved by review. Preserve
   the disabled-backend receipt's older source commit as historical provenance;
   it is not a combined-tree deployment receipt.
2. Inspect the proposed diff before applying it. It must contain exactly one
   Free web service and no database, disk, worker, cron, custom domain or paid
   resource.
3. Supply each `sync: false` value directly in Render. Never paste a value into
   source, a prompt, terminal output or a receipt.
4. Add the public Supabase CA as the Render secret file
   `/etc/secrets/supabase-staging-ca.crt`. The runtime database URL must use
   `sslmode=verify-full` and that exact `sslrootcert` path.
5. Keep automatic deploys off. Trigger a manual deploy only after the service
   configuration and secret-file inventory pass review.

The first deploy must block before listen if identity, TLS, role, schema,
privileges or App Attest configuration is missing or inconsistent. Never fix a
blocked deploy by changing a flag, weakening TLS or using a database owner.

## Required zero-provider receipt

Record only coarse outcomes and public-safe identifiers. Do not retain the
database URL, hostname query values, credentials, assertion bodies, prompts,
coordinates, geometry, raw headers or provider errors.

1. Record source commit and Render deploy ID.
2. Verify the generated URL is HTTPS. Only now may a sanitized receipt assign
   `baseUrl.value`; repository source remains unassigned until that receipt is
   independently reviewed.
3. From a cold service, call `GET /healthz`. Record wake duration and the
   exact final `200 {"status":"live"}` result; a Render loading page is not an
   application pass.
4. Call `GET /readyz` and require exact
   `200 {"status":"ready"}` after database admission.
5. Call disabled provider endpoints with bounded synthetic inputs and require
   safe bounded 503 results (`authorization_unavailable`,
   `evidence_unavailable`, or `feature_unavailable` as appropriate) with zero
   authorization, budget, lease, provider and research work.
6. Inspect allowlisted logs for capability-disabled events and absence of
   secrets, prompts, coordinates, geometry, assertions and raw errors.
7. Run the outage, drain and restart drills in the adjacent document.
8. Confirm all provider calls equal zero and the Render plan still equals
   `free` before considering an iOS Staging connection.

## Rollback

Render Free retains only the two most recent prior deploys. Before every
candidate deploy, verify the immediately prior healthy deploy is still
available.

1. Select the prior deploy in the Render dashboard; do not rebuild from an
   unreviewed branch.
2. Verify the observed running commit/deploy matches the selected prior deploy.
3. Re-run HTTPS, live, ready, disabled-capability and privacy-log checks.
4. Treat database migrations, roles and credentials as separate state; code
   rollback never rolls them back.
5. If the prior deploy cannot use the current database contract, leave the
   service unavailable. Never enable an insecure fallback.

## Decommission

Delete only the single Render service after preserving sanitized receipts.
Remove its environment values and secret file through Render. Confirm the
generated hostname no longer serves the application. Database cleanup remains
owned by the database lane.
