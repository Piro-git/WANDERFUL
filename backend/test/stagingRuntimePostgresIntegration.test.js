import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { stagingDatabaseAdmissionProbe } from "../src/operations/stagingDatabaseAdmission.js";

const disposable = disposableConfiguration(process.env);

describe("staging runtime disposable PostgreSQL admission", {
  skip: disposable ? false : "set the guarded disposable PostgreSQL contract"
}, () => {
  let admin;
  let runtime;
  let control;

  before(async () => {
    admin = new pg.Pool({ connectionString: disposable.adminUrl, max: 1 });
    runtime = rolePool(disposable.adminUrl, "trailmind_runtime", "runtime");
    control = rolePool(disposable.adminUrl, "trailmind_pruner", "control");
    await assertAdmitted(runtime, true);
    await assertAdmitted(control, true);
  });

  after(async () => {
    await Promise.all([runtime?.end(), control?.end(), admin?.end()]);
  });

  it("admits the exact private-schema runtime and control manifests", async () => {
    await assertAdmitted(runtime, true);
    await assertAdmitted(control, true);
  });

  it("rejects a public shadow object even though the private object exists", async () => {
    await withCatalogMutation(
      "CREATE TABLE public.app_attest_keys (id integer)",
      "DROP TABLE public.app_attest_keys",
      async () => assertAdmitted(runtime, false)
    );
  });

  it("rejects unexpected direct role membership", async () => {
    await admin.query("CREATE ROLE trailmind_runtime_extra NOLOGIN NOINHERIT");
    try {
      await withCatalogMutation(
        "GRANT trailmind_runtime_extra TO trailmind_runtime",
        "REVOKE trailmind_runtime_extra FROM trailmind_runtime",
        async () => assertAdmitted(runtime, false)
      );
    } finally {
      await admin.query("DROP ROLE trailmind_runtime_extra");
    }
  });

  it("rejects prohibited role attributes", async () => {
    await withCatalogMutation(
      "ALTER ROLE trailmind_runtime CREATEDB",
      "ALTER ROLE trailmind_runtime NOCREATEDB",
      async () => assertAdmitted(runtime, false)
    );
  });

  it("rejects excess inherited and direct table privileges", async () => {
    await withCatalogMutation(
      "GRANT DELETE ON trailmind_app.app_attest_keys TO PUBLIC",
      "REVOKE DELETE ON trailmind_app.app_attest_keys FROM PUBLIC",
      async () => assertAdmitted(runtime, false)
    );
    await withCatalogMutation(
      "GRANT DELETE ON trailmind_app.app_attest_keys TO trailmind_runtime",
      "REVOKE DELETE ON trailmind_app.app_attest_keys FROM trailmind_runtime",
      async () => assertAdmitted(runtime, false)
    );
    await withCatalogMutation(
      "GRANT SELECT (key_id_hash) ON trailmind_app.app_attest_keys " +
        "TO trailmind_runtime WITH GRANT OPTION",
      "REVOKE SELECT (key_id_hash) ON trailmind_app.app_attest_keys " +
        "FROM trailmind_runtime",
      async () => assertAdmitted(runtime, false)
    );
  });

  it("rejects schema ownership and CREATE on a trusted schema", async () => {
    await withCatalogMutation(
      "ALTER SCHEMA trailmind_app OWNER TO trailmind_runtime",
      "ALTER SCHEMA trailmind_app OWNER TO trailmind_owner; " +
        "GRANT USAGE ON SCHEMA trailmind_app TO trailmind_runtime",
      async () => assertAdmitted(runtime, false)
    );
    await withCatalogMutation(
      "GRANT CREATE ON SCHEMA public TO trailmind_runtime",
      "REVOKE CREATE ON SCHEMA public FROM trailmind_runtime",
      async () => assertAdmitted(runtime, false)
    );
    await withCatalogMutation(
      "GRANT CREATE ON SCHEMA trailmind_app TO trailmind_runtime",
      "REVOKE CREATE ON SCHEMA trailmind_app FROM trailmind_runtime; " +
        "GRANT USAGE ON SCHEMA trailmind_app TO trailmind_runtime",
      async () => assertAdmitted(runtime, false)
    );
  });

  it("rejects ownership of application relations and functions", async () => {
    await admin.query("CREATE TABLE trailmind_app.admission_owned_table (id integer)");
    try {
      await withCatalogMutation(
        "ALTER TABLE trailmind_app.admission_owned_table OWNER TO trailmind_runtime",
        "ALTER TABLE trailmind_app.admission_owned_table OWNER TO trailmind_admin",
        async () => assertAdmitted(runtime, false)
      );
    } finally {
      await admin.query("DROP TABLE trailmind_app.admission_owned_table");
    }

    await admin.query(
      "CREATE FUNCTION trailmind_app.admission_owned_function() " +
      "RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'"
    );
    await admin.query(
      "REVOKE EXECUTE ON FUNCTION trailmind_app.admission_owned_function() FROM PUBLIC"
    );
    try {
      await withCatalogMutation(
        "ALTER FUNCTION trailmind_app.admission_owned_function() OWNER TO trailmind_runtime",
        "ALTER FUNCTION trailmind_app.admission_owned_function() OWNER TO trailmind_admin",
        async () => assertAdmitted(runtime, false)
      );
    } finally {
      await admin.query("DROP FUNCTION trailmind_app.admission_owned_function()");
    }
  });

  it("rejects excess sequence and function privileges", async () => {
    await admin.query("CREATE SEQUENCE trailmind_app.admission_test_sequence");
    try {
      await withCatalogMutation(
        "GRANT USAGE ON SEQUENCE trailmind_app.admission_test_sequence TO trailmind_runtime",
        "REVOKE USAGE ON SEQUENCE trailmind_app.admission_test_sequence FROM trailmind_runtime",
        async () => assertAdmitted(runtime, false)
      );
    } finally {
      await admin.query("DROP SEQUENCE trailmind_app.admission_test_sequence");
    }

    await admin.query(
      "CREATE FUNCTION trailmind_app.admission_test_function() " +
      "RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1'"
    );
    await admin.query(
      "REVOKE EXECUTE ON FUNCTION trailmind_app.admission_test_function() FROM PUBLIC"
    );
    try {
      await withCatalogMutation(
        "GRANT EXECUTE ON FUNCTION trailmind_app.admission_test_function() TO trailmind_runtime",
        "REVOKE EXECUTE ON FUNCTION trailmind_app.admission_test_function() FROM trailmind_runtime",
        async () => assertAdmitted(runtime, false)
      );
    } finally {
      await admin.query("DROP FUNCTION trailmind_app.admission_test_function()");
    }
  });

  it("restores the exact baseline after all negative drills", async () => {
    await assertAdmitted(runtime, true);
    await assertAdmitted(control, true);
  });

  async function withCatalogMutation(applySql, restoreSql, assertion) {
    await admin.query(applySql);
    try {
      await assertion();
    } finally {
      await admin.query(restoreSql);
    }
  }
});

function rolePool(adminUrl, user, responsibility) {
  const connection = new URL(adminUrl);
  connection.username = user;
  connection.password = "";
  connection.searchParams.delete("options");
  const probe = stagingDatabaseAdmissionProbe(admissionEnvironment(), responsibility);
  const pool = new pg.Pool({
    connectionString: connection.toString(),
    max: 1,
    options: probe.startupOptions
  });
  pool.stagingAdmissionProbe = probe;
  return pool;
}

async function assertAdmitted(pool, expected) {
  const probe = pool.stagingAdmissionProbe;
  const result = await pool.query(probe.query, probe.values);
  assert.equal(result.rows[0]?.admitted, expected);
}

function admissionEnvironment() {
  return {
    TRAILMIND_APPLICATION_SCHEMA: "trailmind_app",
    APP_ATTEST_RUNTIME_ROLE: "trailmind_runtime",
    APP_ATTEST_CONTROL_ROLE: "trailmind_pruner",
    APP_ATTEST_OPERATOR_ROLE: "trailmind_operator"
  };
}

function disposableConfiguration(env) {
  const requested = env.STAGING_RUNTIME_POSTGRES_DISPOSABLE !== undefined ||
    env.STAGING_RUNTIME_POSTGRES_ADMIN_URL !== undefined;
  if (!requested) return undefined;
  if (
    env.STAGING_RUNTIME_POSTGRES_DISPOSABLE !== "true" ||
    typeof env.STAGING_RUNTIME_POSTGRES_ADMIN_URL !== "string"
  ) throw new TypeError("disposable_postgres_configuration_invalid");
  let parsed;
  try {
    parsed = new URL(env.STAGING_RUNTIME_POSTGRES_ADMIN_URL);
  } catch {
    throw new TypeError("disposable_postgres_configuration_invalid");
  }
  const socket = parsed.searchParams.get("host") ?? "";
  const parameters = [...parsed.searchParams.keys()].sort();
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "localhost" ||
    parsed.username !== "trailmind_admin" ||
    parsed.pathname !== "/postgres" ||
    !socket.startsWith("/private/tmp/trailmind-staging-runtime-pg.") ||
    parsed.password ||
    parameters.join(",") !== "host,port" ||
    !/^5[0-9]{4}$/.test(parsed.searchParams.get("port") ?? "")
  ) throw new TypeError("disposable_postgres_configuration_invalid");
  return Object.freeze({ adminUrl: parsed.toString() });
}
