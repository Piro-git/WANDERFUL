# Staging Role and Cancellation-Control Contract V1

Status: **OFFLINE CONTRACT ONLY; LIVE CAPTURE NOT ADMITTED**

## Canonical role order

| Ordinal | Stable role ID | Intended purpose |
| --- | --- | --- |
| 1 | `platform_provisioner` | Provision the isolated staging platform. |
| 2 | `migration_role` | Apply reviewed migrations and ledger updates. |
| 3 | `regional_import_role` | Import approved bounded regional sources. |
| 4 | `projection_role` | Project reviewed active imports. |
| 5 | `app_security_runtime_role` | Serve durable App Attest transactions. |
| 6 | `outdoor_research_runtime_role` | Execute only the five bounded research reads. |
| 7 | `outdoor_research_cancellation_control_role` | Cancel only an active outdoor-research runtime backend. |
| 8 | `pruner_role` | Prune bounded expired App Attest state. |
| 9 | `readonly_auditor_role` | Read sanitized release evidence. |

Missing, duplicate, reordered, unknown or malformed role evidence is invalid.
Each role carries a stable purpose, identity digest, privilege-manifest digest,
boundary results and a recomputed evidence digest. The ordered role-set and
grant digests are included in the staging candidate binding.

The cancellation identity must differ from every role above and from the
ordered managed-identity guards `backup_restore_role`, `anon`, `authenticated`,
`service_role`, `postgres_administrator` and
`managed_platform_administrator`. Guard identities are digests only; raw role
names or connection values are not retained from a live environment.

## Exact cancellation/control privilege manifest

The executable source of truth is
`CANCELLATION_CONTROL_PRIVILEGE_MANIFEST` in
`backend/evaluation/stagingReadinessV1/constants.js`. Its canonical semantic
shape is:

```json
{"businessDataMutation":false,"bypassRls":false,"canLogin":true,"connectionLimit":1,"createDatabase":false,"createRole":false,"directBusinessDataRead":false,"directPgCancelBackendExecute":false,"functionExecuteIds":["trailmind_control.cancel_active_outdoor_research_backend_integer"],"inheritPrivileges":false,"membershipRoleIds":[],"ownedObjectCount":0,"productQueryExecutionDenied":true,"publicDataApiExposed":false,"replication":false,"schemaUsageIds":["trailmind_control"],"selfPrivilegeEscalationDenied":true,"sequencePrivilegeIds":[],"statementTimeoutMilliseconds":1000,"superuser":false,"tablePrivilegeIds":[],"targetRestrictionEnforced":true,"targetRoleId":"outdoor_research_runtime_role","version":"cancellation-control-privileges-v1"}
```

This contract permits one login connection, one-second statements, usage of
only the dedicated control schema, and execution of only the target-restricted
cancellation function. It forbids direct `pg_cancel_backend`, superuser,
`CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, membership/inheritance,
ownership, table/sequence privileges, broad schema access, product reads,
business-data mutation, public/Data API exposure and self-escalation.

The future live capture must prove the wrapper cannot target another role,
cannot run product queries, cannot bypass RLS and cannot mutate application or
business data. An application-side PID check alone is not sufficient role
evidence.

## Deterministic Markdown evidence

`renderStagingReadinessRolesMarkdownV1` reports the ordered role ID, purpose,
identity digest, privilege-manifest digest and boundary result, followed by the
exact cancellation manifest and ordered managed-identity guard digests. It
rejects malformed ordering or manifest substitution instead of rendering a
green role table.

No live role has been observed by this correction. The existing
`live_execution_not_admitted` hard stop remains mandatory.
