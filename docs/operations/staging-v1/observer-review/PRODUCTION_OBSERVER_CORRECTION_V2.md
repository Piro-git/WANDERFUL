# Production Observer Correction V2

Status: **NO-GO**

Capability review date: 2026-08-30

Implementation baseline: `b59f432a1947154345f1629ecba50d14fcb1e7c8`

Independent review: `4821c9b29e070be53c0c22873cb7af124434b985`

This correction treats the independent review's P0/P1/P2 requirements as the
minimum acceptance contract. Production admission remains unreachable. No
Supabase project, Supabase database, staging environment, production
environment, GraphHopper service, or AI service was contacted while preparing
or verifying this change.

## Official capability findings

The following findings are pinned in source. A later correction must update the
literal policy and its tests through review; callers cannot register a factory,
transport, callback, URL, signer, or public key at runtime.

1. The Supabase Management API security- and performance-advisor GET endpoints
   remain documented as experimental and deprecated. Their documented response
   schema supplies lint results, but no provider recomputation timestamp, job
   identifier, generation, or other marker that proves the response was
   recomputed after this run's DDL. The database-advisor guide describes
   automatic and manual checks, but does not add a freshness marker to these
   GET responses. Therefore local request times, HTTP `Date`, ETags, cache keys,
   or repeated equal GETs cannot prove freshness. The fixed outcome is
   `advisor_freshness_unproved`.

   - <https://supabase.com/docs/reference/api/v1-get-security-advisors>
   - <https://supabase.com/docs/reference/api/v1-get-performance-advisors>
   - <https://supabase.com/docs/guides/database/database-advisors>

2. The project-addons endpoint is documented as a read-only exact endpoint for
   selected and available add-ons and names the fine-grained
   `infra_add_ons_read` permission. The OAuth scope documentation does not
   document a corresponding accepted OAuth scope. A fine-grained token can
   support a bounded point-in-time statement about selected add-ons and their
   published numeric price metadata, but it cannot prove an exact invoice or
   amount due. Current documentation also does not establish provider-enforced
   project-only token isolation for the fixed Free organization that contains
   protected refs. A free plan or nano compute size remains insufficient. The
   source-pinned outcomes are `control_plane_project_isolation_unproved` and
   `billing_evidence_unproved`.

   - <https://supabase.com/docs/reference/api/v1-list-project-addons>
   - <https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes>

3. Direct and session-pooler connections preserve PostgreSQL session state,
   but the current official material does not establish required SCRAM channel
   binding through Supavisor. The corrected auditor contract therefore permits
   only the direct IPv6 endpoint on port 5432. The exact proposed role is
   `trailmind_phase1_v2_stats_auditor`: a distinct pre-provisioned login with
   SET-only membership in `pg_read_all_stats`, no Supabase administrative or
   read-only service identity, and no data, mutation, role, or database creation
   powers.

   - <https://supabase.com/docs/guides/database/connecting-to-postgres>
   - <https://supabase.com/docs/guides/database/postgres/roles>
   - <https://www.postgresql.org/docs/17/predefined-roles.html>
   - <https://www.postgresql.org/docs/17/monitoring-stats.html>
   - <https://www.postgresql.org/docs/17/role-membership.html>

4. The Supabase changelog was reviewed for changes affecting these contracts;
   none supplied the missing advisor freshness marker, an accepted observer
   OAuth billing contract, or a production signing trust anchor.

   - <https://supabase.com/changelog>

The concurrent capability-policy result at commit
`b8fdcc8539dc149fd0cfac783602073ae5567f24` was reviewed after the final remote
staleness check. It is documentation-only and does not supersede this runtime
correction. It narrows the only future decision surface to one empty staging
initialization after all pins and gates close; advisor data is diagnostic with
unproved causal freshness, and closed beta or production remain NO-GO.

## Source-pinned blockers

- Advisor `ERROR` and `WARN` findings block. `INFO` is notice-only. Unknown
  levels, categories, or schemas block.
- Advisor freshness is always rejected until an accepted provider marker is
  added as a reviewed literal contract. The newer static replacement policy is
  also unavailable because its independent catalog program and expected result
  manifest digests are not pinned.
- Billing evidence is always rejected until an accepted fixed endpoint and
  credential-isolation contract are reviewed. OAuth is not accepted for the
  billing-addons endpoint under current documentation.
- Provider-enforced staging-only access for the required fine-grained reader is
  unproved on the fixed Free organization.
- The production factory is not registered.
- The production Ed25519 key ID, public key, and public-key digest are
  intentionally absent. Caller-provided keys are rejected.
- A live attempt therefore stops before Git inspection, prompts, CA access,
  network access, database connection, mutation, or artifact publication.

## Implemented fail-closed contract

The dormant source-pinned implementation has no generic extension seams. It
defines a distinct least-privilege auditor; exact PID, `backend_start`,
database, role, TLS, and run-derived `application_name` identity; two fresh
zero-session cleanup samples after setting `stats_fetch_consistency=none` and
clearing PostgreSQL's statistics snapshot; duplicate-key-rejecting bounded
JSON; a once-consumed OAuth descriptor; and exclusive, mode-0600, file- and
directory-fsynced Ed25519 artifact primitives.

This is not a completed production observer. In addition to the provider and
trust-anchor blockers above, the following reviewed acceptance work remains:

- provision and independently approve the exact auditor role and its distinct
  credential before any mutation;
- extract the byte-exact existing Phase 1 ACL/RLS/PostGIS catalog statements
  into the static auditor manifest and validate every expected object, grant,
  owner, policy, function, extension, fixture restoration, and ledger row;
- add a reviewed literal production package/source digest and pinned Ed25519
  key ID, public key, and public-key digest, then exercise the complete four-file
  signature and durable predecessor chain;
- reconcile the final artifact phase names, signature message, encoding, and
  one-run key lifecycle with the newer V2 capability policy before pinning those
  literals; the current unavailable primitives implement only the independent
  V1 review minimum and cannot be registered;
- establish a provider-enforced staging-only fine-grained reader, the restricted
  non-invoice billing claim, and the independently pinned static advisor
  replacement contract;
- complete credential containment for the final accepted control-plane token
  type without retaining credential-derived JavaScript strings;
- pass the complete disposable PostgreSQL 17/PostGIS/supautils acceptance
  harness in addition to the narrow auditor lifecycle proof.

Until every item is implemented and independently reviewed, no production
factory is registered and these primitives cannot authorize a database
connection, mutation, artifact publication, or terminal `ADMITTED` result.
