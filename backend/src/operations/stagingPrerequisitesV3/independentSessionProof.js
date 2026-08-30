import { randomBytes } from "node:crypto";
import { AUDITOR_ROLE, HEX_64, LIMITS } from "./constants.js";
import { canonicalSha256, exactKeys } from "./canonicalJson.js";
import { runCatalogAssertions } from "./catalogAssertion.js";
import { blocked } from "./errors.js";

const APPLICATION_NAME = /^trailmind_p1v2_auditor_[a-f0-9]{32}$/;
const IDENTITY_QUERY = `
SELECT pg_catalog.pg_backend_pid()::integer AS backend_pid,
       session_user AS session_user,
       current_user AS current_user,
       pg_catalog.current_setting('application_name') AS application_name,
       pg_catalog.pg_current_snapshot()::text AS snapshot_id
`;
const CLEANUP_QUERY = `
SELECT pid,
       usename,
       application_name,
       client_addr::text AS client_addr,
       backend_start,
       state,
       xact_start,
       query_start
  FROM pg_catalog.pg_stat_activity
 WHERE datname = pg_catalog.current_database()
   AND (pid = ANY($1::integer[]) OR application_name = ANY($2::text[]))
   AND pid <> pg_catalog.pg_backend_pid()
 ORDER BY pid
`;

export async function runIndependentAuditorSessionProof({
  expectedManifest,
  ...dependencies
}) {
  return runSessionProof({
    ...dependencies,
    authorizationEligible: true,
    primaryAssertion: (client) => runCatalogAssertions({ client, expectedManifest }),
    proofMode: "catalog-admission"
  });
}

export async function runDisposableLocalAuditorSessionProof(dependencies) {
  return runSessionProof({
    ...dependencies,
    authorizationEligible: false,
    primaryAssertion: runDisposableLocalAssertion,
    proofMode: "local-disposable-non-authorizing"
  });
}

async function runSessionProof({
  createConnection,
  primaryAssertion,
  proofMode,
  authorizationEligible,
  mutationIdentities = [],
  randomHex = () => randomBytes(16).toString("hex"),
  monotonicNowNanoseconds = () => process.hrtime.bigint(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  sampleSeparationMilliseconds = 250
}) {
  if (typeof createConnection !== "function" ||
      typeof primaryAssertion !== "function" ||
      typeof randomHex !== "function" ||
      typeof monotonicNowNanoseconds !== "function" || typeof wait !== "function" ||
      !Number.isSafeInteger(sampleSeparationMilliseconds) ||
      sampleSeparationMilliseconds < 100 || sampleSeparationMilliseconds > 5_000) {
    blocked("session_proof_dependencies");
  }
  const mutation = validateMutationIdentities(mutationIdentities);
  const applications = [applicationName(randomHex), applicationName(randomHex),
    applicationName(randomHex)];
  if (new Set(applications).size !== applications.length) blocked("session_names");

  const clients = [];
  const identities = [];
  try {
    const primaryClient = await independentConnection(
      createConnection, applications[0], clients
    );
    const primaryIdentity = await readIdentity(primaryClient, applications[0]);
    identities.push(primaryIdentity);
    const primaryResult = await primaryAssertion(primaryClient);
    if (!primaryResult || !HEX_64.test(primaryResult.resultSha256) ||
        primaryResult.status !== "pass") blocked("primary_assertion");
    await closeClient(primaryClient);

    const firstStarted = exactMonotonic(monotonicNowNanoseconds());
    const firstClient = await independentConnection(
      createConnection, applications[1], clients
    );
    const firstIdentity = await cleanupObservation({
      applicationName: applications[1],
      client: firstClient,
      targets: [...mutation, primaryIdentity]
    });
    identities.push(firstIdentity);
    await closeClient(firstClient);
    await wait(sampleSeparationMilliseconds);
    const secondStarted = exactMonotonic(monotonicNowNanoseconds());
    const separation = secondStarted - firstStarted;
    if (separation < BigInt(sampleSeparationMilliseconds) * 1_000_000n ||
        separation > 10_000_000_000n) blocked("cleanup_sample_timing");

    const secondClient = await independentConnection(
      createConnection, applications[2], clients
    );
    const secondIdentity = await cleanupObservation({
      applicationName: applications[2],
      client: secondClient,
      targets: [...mutation, primaryIdentity, firstIdentity]
    });
    identities.push(secondIdentity);
    await closeClient(secondClient);
    if (new Set(identities.map(({ backendPid }) => backendPid)).size !== 3 ||
        new Set(identities.map(({ sessionIdentitySha256 }) =>
          sessionIdentitySha256)).size !== 3) blocked("independent_sessions");
    const result = {
      authorizationEligible,
      cleanupObservations: [
        { applicationName: applications[1], zeroLeak: true },
        { applicationName: applications[2], zeroLeak: true }
      ],
      primaryResultSha256: primaryResult.resultSha256,
      proofMode,
      proofSchemaVersion: 1,
      sessionCount: 3,
      snapshotsFresh: true,
      status: "pass"
    };
    return Object.freeze({ ...result, resultSha256: canonicalSha256(result) });
  } catch (error) {
    await Promise.allSettled(clients.map(async (client) => {
      if (!client.__trailmindClosed) await closeClient(client);
    }));
    if (error?.name === "StagingPrerequisitesV3Error") throw error;
    blocked("session_proof_failed");
  }
}

async function runDisposableLocalAssertion(client) {
  let began = false;
  try {
    await beginReadOnly(client);
    began = true;
    const response = await client.query({
      name: "trailmind-staging-prerequisites-v3-local-environment-v1",
      text: `
SELECT pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'postgis'
       ) AS postgis_available
`,
      values: []
    });
    await client.query("ROLLBACK");
    began = false;
    if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) {
      blocked("local_environment_shape");
    }
    exactKeys(response.rows[0], ["postgis_available", "read_only"],
      "local_environment_keys");
    if (response.rows[0].postgis_available !== true ||
        response.rows[0].read_only !== true) blocked("local_environment_mismatch");
    const result = {
      postgisAvailable: true,
      readOnly: true,
      resultSchemaVersion: 1,
      status: "pass"
    };
    return Object.freeze({ ...result, resultSha256: canonicalSha256(result) });
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The caller will discard this connection.
      }
    }
    if (error?.name === "StagingPrerequisitesV3Error") throw error;
    blocked("local_environment_query_failed");
  }
}

async function cleanupObservation({ applicationName, client, targets }) {
  await beginReadOnly(client);
  const identity = await identityInTransaction(client, applicationName);
  const pids = targets.map(({ backendPid }) => backendPid);
  const applications = targets.map(({ applicationName: name }) => name);
  await client.query("SET LOCAL ROLE pg_read_all_stats");
  const observation = await client.query({
    name: "trailmind-staging-prerequisites-v3-cleanup-v1",
    text: CLEANUP_QUERY,
    values: [pids, applications]
  });
  await client.query("RESET ROLE");
  await client.query("ROLLBACK");
  if (!observation || !Array.isArray(observation.rows) ||
      observation.rows.length !== 0) blocked("cleanup_leak");
  return identity;
}

async function readIdentity(client, expectedApplicationName) {
  await beginReadOnly(client);
  const identity = await identityInTransaction(client, expectedApplicationName);
  await client.query("ROLLBACK");
  return identity;
}

async function identityInTransaction(client, expectedApplicationName) {
  const response = await client.query(IDENTITY_QUERY);
  if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) {
    blocked("session_identity_shape");
  }
  const row = response.rows[0];
  exactKeys(row, [
    "application_name", "backend_pid", "current_user", "session_user", "snapshot_id"
  ], "session_identity_keys");
  if (row.session_user !== AUDITOR_ROLE || row.current_user !== AUDITOR_ROLE ||
      row.application_name !== expectedApplicationName ||
      !Number.isSafeInteger(row.backend_pid) || row.backend_pid <= 0 ||
      typeof row.snapshot_id !== "string" || row.snapshot_id.length > 256) {
    blocked("session_identity");
  }
  const publicIdentity = {
    applicationName: row.application_name,
    backendPid: row.backend_pid,
    snapshotSha256: canonicalSha256(row.snapshot_id)
  };
  return Object.freeze({
    ...publicIdentity,
    sessionIdentitySha256: canonicalSha256(publicIdentity)
  });
}

async function beginReadOnly(client) {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query(
    `SET LOCAL statement_timeout = '${LIMITS.statementTimeoutMilliseconds}ms'`
  );
  await client.query(`SET LOCAL lock_timeout = '${LIMITS.lockTimeoutMilliseconds}ms'`);
  await client.query(
    "SET LOCAL idle_in_transaction_session_timeout = " +
    `'${LIMITS.idleTransactionTimeoutMilliseconds}ms'`
  );
  await client.query("SET LOCAL search_path = pg_catalog, pg_temp");
}

async function independentConnection(createConnection, applicationName, clients) {
  const client = await createConnection({ applicationName });
  if (!client || typeof client.query !== "function" || typeof client.end !== "function" ||
      clients.includes(client)) blocked("independent_connection");
  clients.push(client);
  if (typeof client.connect === "function") await client.connect();
  return client;
}

async function closeClient(client) {
  await client.end();
  Object.defineProperty(client, "__trailmindClosed", { value: true });
}

function applicationName(randomHex) {
  const suffix = randomHex();
  const value = `trailmind_p1v2_auditor_${suffix}`;
  if (typeof suffix !== "string" || !/^[a-f0-9]{32}$/.test(suffix) ||
      !APPLICATION_NAME.test(value)) blocked("application_name");
  return value;
}

function validateMutationIdentities(values) {
  if (!Array.isArray(values) || values.length > 8) blocked("mutation_identities");
  return values.map((value) => {
    exactKeys(value, ["applicationName", "backendPid"], "mutation_identity_keys");
    if (typeof value.applicationName !== "string" ||
        value.applicationName.length < 1 || value.applicationName.length > 128 ||
        !Number.isSafeInteger(value.backendPid) || value.backendPid <= 0) {
      blocked("mutation_identity");
    }
    return Object.freeze({ ...value });
  });
}

function exactMonotonic(value) {
  if (typeof value !== "bigint" || value < 0n) blocked("monotonic_clock");
  return value;
}
