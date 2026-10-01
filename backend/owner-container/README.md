# Personal-device container

This image starts the separate owner service at
`src/ownerAccess/startOwnerService.js`; it does not modify or skip the existing
production/App Attest container admission. The source is a prepared candidate,
not a deployed service or a proof that the real database accepts it.

Use repository-root `render-owner.yaml` for an isolated **Free** service. Its
Dockerfile is `backend/owner-container/Dockerfile`, with build context `backend`.
The Dockerfile-specific ignore file admits reviewed source/resources only; it
excludes local env files, Configuration, Git metadata and phone credentials.
The build uses the same pinned Node image as the ordinary backend, installs
locked production packages with scripts disabled, and runs as UID 65532.

The template deliberately keeps `OWNER_ACCESS_ENABLED=false`. Before activation:

1. Select the reviewed GitHub branch/revision rather than relying on Render's
   default branch. Keep automatic deploys off. Verify Free plan and no payment
   method, accepting suspension when included usage runs out.
2. Record the stable assigned HTTPS origin in `OWNER_ACCESS_ORIGIN` with no path
   or trailing slash. Temporary tunnel origins are rejected.
3. Provision the dedicated least-privilege owner database URL in the host's secret
   store. Mount its verified CA as `/etc/secrets/owner-database-ca.crt`. Never use
   any role other than `wanderful_owner_runtime`, or the database owner/control connection in this web service.
   Supabase session pooling uses `wanderful_owner_runtime.<projectRef>` on the
   verified `*.pooler.supabase.com:5432` endpoint and requires the matching
   `OWNER_ACCESS_SUPABASE_PROJECT_REF`. Port 6543 transaction pooling is rejected.
   The shared runtime/preflight validator checks this form; database admission
   still requires `current_user` to be exactly `wanderful_owner_runtime`. Apply the reviewed
   owner schema/enrollment separately; the image does not auto-migrate a database.
4. Set explicit per-installation and global daily route/intent cost limits and
   concurrency (1 or 2). Each daily limit must be an integer from 1 to 100. These are request-cost units, not dollars or guaranteed
   GraphHopper credit amounts. Establish provider allowances before enablement.
5. Set `AI_PROVIDER=google` and an explicit supported `GOOGLE_MODEL` (a `gemini-`
   model identifier). Verify model availability and costs in the deployment
   project; the template does not invent a model choice. Provision authorized deployment Google/GraphHopper keys in the host secret
   store. Do not copy expired phone-test credentials or embed provider keys in
   the app. Set `OWNER_ACCESS_ENABLED=true` only for the reviewed enrolled owner.

Local or CI configuration inspection:

```
node backend/owner-container/preflight.js
```

It emits only stable issue categories and boolean status. It never reads CA
contents, connects to the database, contacts providers or prints configuration
values. Passing means configuration is ready for **runtime admission**, not that
TLS, grants, migrations, enrollment or a live route work. The runtime owns those
checks. Missing configuration gives a nonzero exit status.

Offline verification:

```
node --test backend/test/ownerDeploymentPreflight.test.js
```

After actual deployment, `/healthz` must return the application JSON
`{"status":"live"}`, and `/readyz` must pass runtime checks. Observe a cold wake
and database continuity across a restart. Finally test the actual iPhone over
cellular with the Mac backend and tunnel off. Do not claim completion before this.

Rollback disables `OWNER_ACCESS_ENABLED`, preserves durable consumed counters and
replay history, and restores the prior image/config. Never truncate budgets or
replace the old production service as a rollback shortcut.
