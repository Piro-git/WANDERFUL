# Staging Dependency, Drain and Rollback Drills V1

Status: **LOCAL FAKE-DEPENDENCY DRILLS PASS; REMOTE RECEIPTS BLOCKED**

Every remote drill requires platform approval, the database lane's isolated
staging identities, and proof-lane coordination. No drill may target production
or make provider traffic. Receipt output is limited to timestamps, release/image
digests, fixed outcomes, status codes and bounded durations.

| Drill | Expected result with every capability false |
| --- | --- |
| Database unavailable at startup | App Attest schema/grant probe fails; process never binds; all constructed pools close; nonzero exit |
| Missing/private-schema mismatch or shadow object | Admission returns blocked without schema/table/role/URL detail; a `public` shadow cannot satisfy admission |
| Excess database privilege | Membership, inherited/direct excess DML, ownership, schema `CREATE`, sequence or function execution makes admission false |
| Database loss after readiness | Pool error or cached probe makes readiness false; late work returns bounded 503; liveness remains live; no raw stack |
| Database recovery | A later bounded probe restores readiness without restarting or duplicating pools |
| Statement timeout/cancellation | Typed bounded unavailable/cancelled result; transaction rollback; client released; no SQL/error payload |
| Malformed DB response | Typed safe failure and no unsafe response serialization |
| Provider disabled | Zero authorization transaction, rate window, lease, circuit clock/event or provider network work |
| Provider endpoint unavailable | No call is attempted because admission forbids the key and flag remains false |
| SIGTERM while idle | readiness false, socket stops accepting, idle connections close, pools end, graceful outcome before deadline |
| SIGTERM in flight | no late registration/body parsing; request abort at deadline; sockets/pools close; nonzero forced exit if deadline exceeded |
| Configuration drift | enabled/malformed flag, wrong stage/project/schema/role, weak TLS, unsafe Node/Postgres option, privileged/aliased DB identity or operator secret blocks before listen |
| Secret missing/rotation | missing source blocks; replacement candidate proves ready before prior credential revocation |
| Health reconnaissance | fixed live/ready bodies only; all methods/paths outside contract return bounded 404/503 without dependency detail |

## Immutable deployment and rollback

1. Build once from the reviewed branch and record the OCI image digest after the
   deterministic content/user/Node-version/write-permission/secret inspection passes.
2. Push that exact image to the approved registry. Deploy by digest, never by a
   mutable tag. Disable automatic deploy.
3. Keep the immediately prior reviewed digest and its sanitized non-secret
   configuration receipt available before replacing it.
4. Roll back by selecting the prior digest. Do not assume shared environment
   groups, current secrets or database migrations roll back with code.
5. Verify the platform actually runs the prior digest, then prove HTTPS,
   liveness, readiness, all-disabled capability events and database identity.
6. If the prior digest cannot use the current schema/credential, keep the
   service disabled and apply an approved forward recovery. Never compensate by
   enabling an insecure flag or production connection.

Render rollback is deterministic only for prior prebuilt digests. Service-local
environment follows the selected deploy, while shared environment-group values
do not. Avoid shared groups for release-critical staging config. Fly rollback is
a new deploy of the prior digest; config/secrets stay separate and prior image
retention must be ensured in an approved registry.

## Receipt checklist after approval

- platform/account/workspace/region/quoted cost approval ID;
- source commit, image ID and immutable repository digest;
- platform release ID and generated hostname digest, not hostname value in
  public proof artifacts;
- production preflight decision and staging admission decision;
- TLS, liveness and privacy-safe readiness outcomes;
- idle and in-flight drain duration/outcome;
- startup DB failure, post-ready loss and recovery outcomes;
- rollback requested digest and independently observed running digest;
- provider/research/evidence/intent flags all false and zero provider calls;
- log redaction/cardinality and alert-delivery outcomes;
- explicit confirmation that production and Attempt 13 were untouched.
