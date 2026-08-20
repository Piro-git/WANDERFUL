import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import {
  assertDatabaseAdmission,
  runV4DatabaseAdmissionBoundary,
  validateLoopbackProofDatabaseUrls,
  validateV4DatabaseAdmissionRows
} from "../scripts/run-outdoor-adventure-targeted-live-route-quality-proof-v4.js";

const { Pool } = pg;
const RUNTIME_URL =
  "postgresql://proof_runtime@127.0.0.1:55432/v4_proof";
const OPERATOR_URL =
  "postgresql://proof_operator@127.0.0.1:55432/v4_proof";

describe("V4 PostgreSQL database admission", () => {
  it("normalizes at the SQL boundary and advances only after admission", async () => {
    const queries = [];
    let nextGateCount = 0;
    const result = await runV4DatabaseAdmissionBoundary({
      runtimePool: runtimePool(runtimeIdentity()),
      operatorPool: operatorPool(operatorIdentity(), queries),
      databaseIdentities: identities(),
      async nextGate() {
        nextGateCount += 1;
        return "next_mocked_gate";
      }
    });

    assert.equal(result, "next_mocked_gate");
    assert.equal(nextGateCount, 1);
    assert.equal(queries.length, 2);
    assert.match(queries[1], /host\(inet_server_addr\(\)\) AS server_address/);
    assert.doesNotMatch(queries[1], /inet_server_addr\(\)::text/);
    assert.match(queries[1], /role\.rolreplication OR role\.rolbypassrls\)/);
    assert.doesNotMatch(queries[1], /\) AND role\.rolbypassrls/);
  });

  it("uses the same strict normalized IPv4 or IPv6 server identity", () => {
    for (const serverAddress of ["127.0.0.1", "::1"]) {
      assert.equal(validateV4DatabaseAdmissionRows({
        operator: result(operatorIdentity({ serverAddress })),
        runtime: result(runtimeIdentity({ serverAddress })),
        databaseIdentities: identities()
      }), true);
    }
  });

  it("rejects masked, broad, unspecified, remote, mapped, and null addresses", () => {
    for (const serverAddress of [
      "127.0.0.1/32",
      "::1/128",
      "127.0.0.0/8",
      "127.0.0.2",
      "0.0.0.0",
      "::",
      "192.0.2.10",
      "2001:db8::10",
      "::ffff:127.0.0.1",
      null
    ]) {
      assert.throws(() => validateV4DatabaseAdmissionRows({
        operator: result(operatorIdentity({ serverAddress })),
        runtime: result(runtimeIdentity({ serverAddress })),
        databaseIdentities: identities()
      }), hasCode("database_runtime_role_admission_failed"),
      `server address ${String(serverAddress)}`);
    }
  });

  it("rejects runtime and operator server-address mismatch", () => {
    assert.throws(() => validateV4DatabaseAdmissionRows({
      operator: result(operatorIdentity()),
      runtime: result(runtimeIdentity({ serverAddress: "::1" })),
      databaseIdentities: identities()
    }), hasCode("database_runtime_role_admission_failed"));
  });

  it("rejects runtime and operator server-port mismatch", () => {
    assert.throws(() => validateV4DatabaseAdmissionRows({
      operator: result(operatorIdentity()),
      runtime: result(runtimeIdentity({ serverPort: 55433 })),
      databaseIdentities: identities()
    }), hasCode("database_runtime_role_admission_failed"));
  });

  it("rejects runtime and operator database mismatch", () => {
    assert.throws(() => validateV4DatabaseAdmissionRows({
      operator: result(operatorIdentity()),
      runtime: result(runtimeIdentity({ databaseName: "other_v4_proof" })),
      databaseIdentities: identities()
    }), hasCode("database_runtime_role_admission_failed"));
  });

  it("rejects runtime and operator role aliasing", () => {
    assert.throws(() => validateV4DatabaseAdmissionRows({
      operator: result(operatorIdentity()),
      runtime: result(runtimeIdentity({ username: "proof_operator" })),
      databaseIdentities: identities()
    }), hasCode("database_runtime_role_admission_failed"));
    assert.throws(() => validateLoopbackProofDatabaseUrls(
      RUNTIME_URL,
      RUNTIME_URL
    ), hasCode("database_unavailable"));
  });

  it("rejects runtime and operator pool aliasing", async () => {
    const aliasedPool = operatorPool(operatorIdentity());
    await assert.rejects(() => assertDatabaseAdmission({
      runtimePool: aliasedPool,
      operatorPool: aliasedPool,
      databaseIdentities: identities()
    }), hasCode("database_runtime_role_admission_failed"));
  });

  it("rejects URL overrides, fragments, decoded aliases, and host aliases", () => {
    for (const suffix of [
      "?host=remote.invalid",
      "?port=6543",
      "?user=proof_operator",
      "?options=-c%20role%3Delevated",
      "#ignored"
    ]) {
      assert.throws(() => validateLoopbackProofDatabaseUrls(
        `${RUNTIME_URL}${suffix}`,
        OPERATOR_URL
      ), hasCode("database_unavailable"));
    }
    for (const host of [
      "127.1",
      "127.000.000.001",
      "127.0.0.2",
      "0.0.0.0",
      "192.0.2.10",
      "[::ffff:127.0.0.1]",
      "[0:0:0:0:0:0:0:1]",
      "[2001:db8::10]"
    ]) {
      assert.throws(() => validateLoopbackProofDatabaseUrls(
        `postgresql://proof_runtime@${host}:55432/v4_proof`,
        OPERATOR_URL
      ), hasCode("database_unavailable"), host);
    }
    assert.throws(() => validateLoopbackProofDatabaseUrls(
      "postgresql://proof%5Fruntime@127.0.0.1:55432/v4_proof",
      RUNTIME_URL
    ), hasCode("database_unavailable"));
  });

  it("fails closed before credential, ledger, or provider scheduling", async () => {
    const reached = {
      credentialAdmission: 0,
      ledgerCreation: 0,
      providerScheduling: 0
    };
    await assert.rejects(() => runV4DatabaseAdmissionBoundary({
      runtimePool: runtimePool(runtimeIdentity({
        serverAddress: "127.0.0.1/32"
      })),
      operatorPool: operatorPool(operatorIdentity({
        serverAddress: "127.0.0.1/32"
      })),
      databaseIdentities: identities(),
      async nextGate() {
        reached.credentialAdmission += 1;
        reached.ledgerCreation += 1;
        reached.providerScheduling += 1;
      }
    }), hasCode("database_runtime_role_admission_failed"));
    assert.deepEqual(reached, {
      credentialAdmission: 0,
      ledgerCreation: 0,
      providerScheduling: 0
    });
  });

  it("rejects an RLS-bypassing operator and requires five runtime functions", async () => {
    assert.throws(() => validateV4DatabaseAdmissionRows({
      operator: result(operatorIdentity({ boundedReadAuditor: false })),
      runtime: result(runtimeIdentity()),
      databaseIdentities: identities()
    }), hasCode("database_runtime_role_admission_failed"));

    const queries = [];
    await assertDatabaseAdmission({
      runtimePool: runtimePool(runtimeIdentity(), queries),
      operatorPool: operatorPool(operatorIdentity(), queries),
      databaseIdentities: identities()
    });
    const runtimeQuery = queries.find((query) =>
      query.includes("snapshot_execute")
    );
    assert(runtimeQuery);
    for (const functionName of [
      "trailmind_runtime_outdoor_research_snapshot_context_v1",
      "trailmind_runtime_outdoor_research_highlights_v1",
      "trailmind_runtime_outdoor_research_route_memberships_v1",
      "trailmind_runtime_outdoor_research_route_assertions_v1",
      "trailmind_runtime_outdoor_research_trail_access_candidates_v1"
    ]) {
      assert.match(runtimeQuery, new RegExp(functionName));
    }
    assert.match(runtimeQuery, /SELECT count\(\*\) = 5/);
  });
});

const integrationRuntimeUrl =
  process.env.TRAILMIND_V4_LOOPBACK_INTEGRATION_RUNTIME_DATABASE_URL;
const integrationOperatorUrl =
  process.env.TRAILMIND_V4_LOOPBACK_INTEGRATION_OPERATOR_DATABASE_URL;
const integrationEnabled = Boolean(
  integrationRuntimeUrl && integrationOperatorUrl
);

describe("V4 real loopback PostgreSQL/PostGIS address normalization", {
  skip: !integrationEnabled
}, () => {
  let runtime;
  let operator;

  before(() => {
    validateLoopbackProofDatabaseUrls(
      integrationRuntimeUrl,
      integrationOperatorUrl
    );
    runtime = new Pool({
      connectionString: integrationRuntimeUrl,
      max: 1,
      allowExitOnIdle: true
    });
    operator = new Pool({
      connectionString: integrationOperatorUrl,
      max: 1,
      allowExitOnIdle: true
    });
  });

  after(async () => {
    await runtime?.end();
    await operator?.end();
  });

  it("strips real inet host masks for both roles at the PostgreSQL boundary", async () => {
    const query = `SELECT current_user,
                          inet_server_addr()::text AS raw_server_address,
                          host(inet_server_addr()) AS server_address,
                          inet_server_port() AS server_port,
                          host(inet '127.0.0.1/32') AS normalized_ipv4,
                          host(inet '::1/128') AS normalized_ipv6,
                          postgis_lib_version() AS postgis_version`;
    const runtimeRow = (await runtime.query(query)).rows[0];
    const operatorRow = (await operator.query(query)).rows[0];

    assert.equal(runtimeRow.raw_server_address, "127.0.0.1/32");
    assert.equal(operatorRow.raw_server_address, "127.0.0.1/32");
    assert.equal(runtimeRow.server_address, "127.0.0.1");
    assert.equal(operatorRow.server_address, "127.0.0.1");
    assert.equal(runtimeRow.normalized_ipv4, "127.0.0.1");
    assert.equal(runtimeRow.normalized_ipv6, "::1");
    assert.equal(runtimeRow.server_address, operatorRow.server_address);
    assert.equal(runtimeRow.server_port, operatorRow.server_port);
    assert.notEqual(runtimeRow.current_user, operatorRow.current_user);
    assert.match(runtimeRow.postgis_version, /^3\./);
  });
});

function identities() {
  return validateLoopbackProofDatabaseUrls(RUNTIME_URL, OPERATOR_URL);
}

function result(row) {
  return { rowCount: 1, rows: [row] };
}

function operatorIdentity({
  username = "proof_operator",
  databaseName = "v4_proof",
  serverAddress = "127.0.0.1",
  serverPort = 55432,
  boundedReadAuditor = true
} = {}) {
  return {
    current_user: username,
    session_user: username,
    database_name: databaseName,
    server_address: serverAddress,
    server_port: serverPort,
    bounded_read_auditor: boundedReadAuditor,
    no_role_memberships: true,
    no_database_temporary: true,
    no_schema_create: true,
    no_relation_write: true,
    owns_no_database_objects: true
  };
}

function runtimeIdentity({
  username = "proof_runtime",
  databaseName = "v4_proof",
  serverAddress = "127.0.0.1",
  serverPort = 55432
} = {}) {
  return {
    current_user: username,
    session_user: username,
    database_name: databaseName,
    server_address: serverAddress,
    server_port: serverPort,
    direct_login: true,
    least_privilege: true,
    no_inherit: true,
    no_role_memberships: true,
    no_database_temporary: true,
    no_schema_create: true,
    no_projection_table_read: true,
    no_active_view_read: true,
    no_operational_relation_privileges: true,
    no_sequence_privileges: true,
    owns_no_database_objects: true,
    snapshot_execute: true,
    highlights_execute: true,
    memberships_execute: true,
    assertions_execute: true,
    access_execute: true,
    no_unexpected_runtime_execute: true,
    constrained_function_owner: true
  };
}

function operatorPool(identity, queries = []) {
  let callCount = 0;
  return {
    async query(query) {
      queries.push(query);
      callCount += 1;
      if (callCount === 1) {
        return result({
          migrations: "8",
          snapshots: "2",
          quarantines: "0",
          route_indexes: "2"
        });
      }
      return result(identity);
    }
  };
}

function runtimePool(identity, queries = []) {
  return {
    async query(query) {
      queries.push(query);
      return result(identity);
    }
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
