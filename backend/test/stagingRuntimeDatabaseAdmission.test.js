import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_ATTEST_CONTROL_PRIVILEGE_MANIFEST,
  APP_ATTEST_RUNTIME_PRIVILEGE_MANIFEST,
  applicationSchemaConfiguration,
  outdoorResearchDatabaseAdmissionProbe,
  OUTDOOR_RESEARCH_CANCELLATION_CONTROL_ROLE,
  OUTDOOR_RESEARCH_RUNTIME_FUNCTION_SIGNATURES,
  OUTDOOR_RESEARCH_RUNTIME_ROLE,
  quotePostgresIdentifier,
  stagingDatabaseAdmissionProbe,
  stagingDatabaseIdentityConfiguration
} from "../src/operations/stagingDatabaseAdmission.js";

describe("staging database admission contract", () => {
  it("builds a bounded private-schema search path without SQL interpolation", () => {
    const probe = stagingDatabaseAdmissionProbe(validEnvironment(), "runtime");
    assert.equal(probe.applicationSchema, "trailmind_app");
    assert.equal(probe.role, "trailmind_runtime");
    assert.equal(
      probe.startupOptions,
      '-c search_path=pg_catalog,"trailmind_app",pg_temp'
    );
    assert.equal(probe.query.includes("trailmind_app"), false);
    assert.equal(probe.values[0], "trailmind_app");
    assert.equal(probe.values[1], "pg_catalog,trailmind_app,pg_temp");
    assert.deepEqual(probe.values[3], [
      "trailmind_runtime", "trailmind_pruner", "trailmind_operator"
    ]);
    assert.equal(quotePostgresIdentifier("trailmind_app"), '"trailmind_app"');
  });

  it("rejects missing, exposed, system, quoted and composite schema names", () => {
    const invalidSchemas = [
      undefined,
      "",
      "public",
      "pg_catalog",
      "information_schema",
      "pg_shadow",
      "trailmind",
      "trailmind_App",
      "trailmind_app-1",
      "trailmind_app,public",
      "trailmind.app",
      '"trailmind_app"',
      "trailmind__app",
      "trailmind_app_",
      `trailmind_${"a".repeat(49)}`
    ];
    for (const value of invalidSchemas) {
      assert.throws(
        () => applicationSchemaConfiguration({ TRAILMIND_APPLICATION_SCHEMA: value }),
        /staging_database_admission_invalid/,
        String(value)
      );
    }
  });

  it("requires bounded pairwise-distinct runtime, control and operator roles", () => {
    assert.deepEqual(stagingDatabaseIdentityConfiguration(validEnvironment()), {
      runtimeRole: "trailmind_runtime",
      controlRole: "trailmind_pruner",
      operatorRole: "trailmind_operator"
    });
    for (const overrides of [
      { APP_ATTEST_RUNTIME_ROLE: "" },
      { APP_ATTEST_RUNTIME_ROLE: "TrailMind_Runtime" },
      { APP_ATTEST_RUNTIME_ROLE: "trailmind.runtime" },
      { APP_ATTEST_RUNTIME_ROLE: "postgres" },
      { APP_ATTEST_CONTROL_ROLE: "service_role" },
      { APP_ATTEST_OPERATOR_ROLE: "supabase_admin" },
      { APP_ATTEST_CONTROL_ROLE: "trailmind_runtime" },
      { APP_ATTEST_OPERATOR_ROLE: "trailmind_runtime" },
      { APP_ATTEST_OPERATOR_ROLE: "trailmind_pruner" }
    ]) {
      assert.throws(
        () => stagingDatabaseIdentityConfiguration(validEnvironment(overrides)),
        /staging_database_admission_invalid/
      );
    }
  });

  it("encodes exact runtime and control table privilege manifests", () => {
    assert.deepEqual(privileges(APP_ATTEST_RUNTIME_PRIVILEGE_MANIFEST), {
      app_attest_challenges: ["select", "insert", "update"],
      app_attest_keys: ["select", "insert", "update"],
      app_attest_route_sessions: ["select", "insert", "update"],
      app_attest_request_ids: ["insert"],
      app_attest_rate_windows: ["select", "insert", "update"],
      app_attest_provider_leases: ["select", "insert", "update"]
    });
    assert.deepEqual(privileges(APP_ATTEST_CONTROL_PRIVILEGE_MANIFEST), {
      app_attest_challenges: ["delete"],
      app_attest_keys: [],
      app_attest_route_sessions: ["delete"],
      app_attest_request_ids: [],
      app_attest_rate_windows: ["delete"],
      app_attest_provider_leases: ["delete"]
    });
    for (const manifest of [
      APP_ATTEST_RUNTIME_PRIVILEGE_MANIFEST,
      APP_ATTEST_CONTROL_PRIVILEGE_MANIFEST
    ]) {
      assert.deepEqual(manifest.database, {
        connect: true, create: false, temporary: false
      });
      assert.deepEqual(manifest.schemas.application, { usage: true, create: false });
      assert.deepEqual(manifest.schemas.public, { usage: false, create: false });
      assert.deepEqual(manifest.schemas.trailmindGis, { usage: false, create: false });
      assert.deepEqual(manifest.applicationSequences, []);
      assert.deepEqual(manifest.applicationFunctions, []);
      assert.deepEqual(manifest.publicFunctionExtensions, []);
      assert.equal(Object.isFrozen(manifest), true);
    }
  });

  it("admits only the V2 research functions and target-restricted cancellation boundary", () => {
    const runtime = outdoorResearchDatabaseAdmissionProbe(
      validEnvironment(),
      "runtime"
    );
    assert.equal(runtime.role, OUTDOOR_RESEARCH_RUNTIME_ROLE);
    assert.equal(
      runtime.startupOptions,
      '-c search_path=pg_catalog,"trailmind_app",pg_temp'
    );
    assert.deepEqual(
      runtime.values[2],
      OUTDOOR_RESEARCH_RUNTIME_FUNCTION_SIGNATURES
    );
    for (const required of [
      "rolbypassrls",
      "pg_auth_members",
      "has_table_privilege",
      "has_sequence_privilege",
      "has_function_privilege",
      "trailmind_app_owner",
      "search_path=pg_catalog,trailmind_app,trailmind_gis,pg_temp"
    ]) assert.match(runtime.query, new RegExp(escapePattern(required)));

    const cancellation = outdoorResearchDatabaseAdmissionProbe(
      validEnvironment(),
      "cancellation"
    );
    assert.equal(
      cancellation.role,
      OUTDOOR_RESEARCH_CANCELLATION_CONTROL_ROLE
    );
    assert.equal(
      cancellation.startupOptions,
      '-c search_path=pg_catalog,"trailmind_control",pg_temp'
    );
    assert.match(
      cancellation.query,
      /cancel_active_outdoor_research_backend_integer/
    );
    assert.match(cancellation.query, /rolconnlimit = 1/);
    assert.match(cancellation.query, /trailmind_control_owner/);
  });

  it("fails closed on all reviewed catalog privilege and shadow boundaries", () => {
    const sql = stagingDatabaseAdmissionProbe(validEnvironment(), "runtime").query;
    for (const requiredFragment of [
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolreplication",
      "rolbypassrls",
      "pg_auth_members",
      "pg_has_role",
      "USAGE WITH GRANT OPTION",
      "CONNECT WITH GRANT OPTION",
      "TEMPORARY",
      "row_security_active",
      "has_table_privilege",
      "has_any_column_privilege",
      "has_sequence_privilege",
      "has_function_privilege",
      "dependency.deptype = 'e'",
      "namespace.nspname = 'trailmind_gis'",
      "shadow.relname = ANY",
      "namespace.nspowner",
      "relation.relowner",
      "owned_function.proowner",
      "database_record.datdba"
    ]) assert.match(sql, new RegExp(escapePattern(requiredFragment)));
  });

  it("rejects an unknown runtime responsibility", () => {
    assert.throws(
      () => stagingDatabaseAdmissionProbe(validEnvironment(), "operator"),
      /staging_database_admission_invalid/
    );
    assert.throws(
      () => outdoorResearchDatabaseAdmissionProbe(
        validEnvironment(),
        "operator"
      ),
      /staging_database_admission_invalid/
    );
  });
});

function validEnvironment(overrides = {}) {
  return {
    TRAILMIND_APPLICATION_SCHEMA: "trailmind_app",
    APP_ATTEST_RUNTIME_ROLE: "trailmind_runtime",
    APP_ATTEST_CONTROL_ROLE: "trailmind_pruner",
    APP_ATTEST_OPERATOR_ROLE: "trailmind_operator",
    ...overrides
  };
}

function privileges(manifest) {
  return Object.fromEntries(manifest.tables.map((table) => [
    table.name,
    ["select", "insert", "update", "delete", "truncate", "references", "trigger"]
      .filter((privilege) => table[`can_${privilege}`])
  ]));
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
