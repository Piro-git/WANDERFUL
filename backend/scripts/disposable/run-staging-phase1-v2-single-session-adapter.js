import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repositoryRoot = dirname(backendRoot);
const port = 55_349;
const candidate = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8"
}).trim();

assertLocalPostgres17();
const requestedMode = process.argv[2];
const modes = requestedMode
  ? [requestedMode]
  : ["regression", "success", "compensation", "containment", "failures"];
if (modes.some((mode) =>
  ![
    "regression", "success", "compensation", "containment", "failures"
  ].includes(mode)
)) throw new Error("unknown disposable adapter proof mode");
for (const mode of modes) {
  await withTlsCluster(mode, async (cluster) => {
    provisionManagedFixture(cluster);
    run(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "test/stagingPhase1V2SingleSessionPostgresIntegration.test.js"
    ], {
      env: environment(cluster, {
        TRAILMIND_PHASE1_V2_ADAPTER_POSTGRES_INTEGRATION: "true",
        TRAILMIND_PHASE1_V2_ADAPTER_INTEGRATION_MODE: mode,
        TRAILMIND_PHASE1_V2_ADAPTER_CANDIDATE: candidate,
        TRAILMIND_PHASE1_V2_ADAPTER_CA_PATH: cluster.caCertificate,
        TRAILMIND_PHASE1_V2_ADAPTER_AUTH_ROOT: cluster.authorizationRoot,
        TRAILMIND_PHASE1_V2_ADAPTER_TCP_PORT: String(cluster.port)
      })
    });
  });
}

process.stdout.write(
  "Staging Phase 1 V2 single-session PostgreSQL 17 proof completed.\n"
);

async function withTlsCluster(label, operation) {
  const root = await mkdtemp(`/private/tmp/trailmind-phase1-v2-adapter.${label}.`);
  const data = join(root, "data");
  const socket = join(root, "socket");
  const authorizationRoot = join(root, "authorization");
  const certificates = join(root, "certificates");
  const caKey = join(certificates, "ca.key");
  const caCertificate = join(certificates, "ca.crt");
  const serverKey = join(certificates, "server.key");
  const serverRequest = join(certificates, "server.csr");
  const serverCertificate = join(certificates, "server.crt");
  const certificateConfig = join(certificates, "server.cnf");
  const passwordFile = join(root, "bootstrap-password");
  let started = false;
  try {
    await mkdir(socket, { mode: 0o700 });
    await mkdir(authorizationRoot, { mode: 0o700 });
    await mkdir(certificates, { mode: 0o700 });
    await writeFile(passwordFile, "test-only-bootstrap-password\n", {
      mode: 0o600
    });
    await writeFile(certificateConfig, `
[req]
distinguished_name = subject
prompt = no
req_extensions = extensions
[subject]
CN = db.mbvzwsrtqcrwhvykugcd.supabase.co
[extensions]
subjectAltName = DNS:db.mbvzwsrtqcrwhvykugcd.supabase.co
`, { mode: 0o600 });
    run("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", caKey,
      "-out", caCertificate,
      "-days", "1",
      "-subj", "/CN=TrailMind disposable PostgreSQL 17 CA"
    ], { capture: true });
    run("openssl", [
      "req", "-newkey", "rsa:2048", "-nodes",
      "-keyout", serverKey,
      "-out", serverRequest,
      "-config", certificateConfig
    ], { capture: true });
    run("openssl", [
      "x509", "-req",
      "-in", serverRequest,
      "-CA", caCertificate,
      "-CAkey", caKey,
      "-CAcreateserial",
      "-out", serverCertificate,
      "-days", "1",
      "-extensions", "extensions",
      "-extfile", certificateConfig
    ], { capture: true });
    await chmod(caCertificate, 0o600);
    await chmod(serverKey, 0o600);
    await chmod(serverCertificate, 0o600);
    run("initdb", [
      "-D", data,
      "--username=supabase_admin",
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
      `--pwfile=${passwordFile}`,
      "--encoding=UTF8",
      "--no-sync"
    ], { capture: true });
    run("pg_ctl", [
      "-D", data,
      "-l", join(root, "postgres.log"),
      "-o",
      `-c listen_addresses=127.0.0.1 ` +
        `-c unix_socket_directories=${socket} ` +
        `-c port=${port} -c ssl=on ` +
        `-c ssl_cert_file=${serverCertificate} ` +
        `-c ssl_key_file=${serverKey}`,
      "-w",
      "start"
    ], { capture: true });
    started = true;
    await operation(Object.freeze({
      authorizationRoot,
      caCertificate,
      data,
      port,
      root,
      socket
    }));
  } finally {
    if (started) {
      run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
        tolerateFailure: true,
        capture: true
      });
    }
    await rm(root, { recursive: true, force: true });
  }
}

function provisionManagedFixture(cluster) {
  executePsql(cluster, `
    SET password_encryption = 'scram-sha-256';
    CREATE ROLE anon NOLOGIN NOINHERIT;
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role LOGIN NOINHERIT;
    CREATE ROLE authenticator NOLOGIN NOINHERIT;
    CREATE ROLE dashboard_user NOLOGIN NOINHERIT;
    CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;
    CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT;
    CREATE ROLE postgres LOGIN PASSWORD 'test-only-password'
      NOINHERIT NOSUPERUSER CREATEDB CREATEROLE
      NOREPLICATION NOBYPASSRLS;
    GRANT pg_signal_backend TO postgres
      WITH INHERIT FALSE, SET FALSE, ADMIN TRUE;
    ALTER DATABASE postgres OWNER TO postgres;
    CREATE SCHEMA extensions AUTHORIZATION postgres;
    GRANT USAGE ON SCHEMA extensions TO PUBLIC;
    CREATE FUNCTION extensions.fixture_extension_routine()
      RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT 1';
    ALTER FUNCTION extensions.fixture_extension_routine()
      OWNER TO supabase_admin;
    GRANT EXECUTE ON FUNCTION extensions.fixture_extension_routine()
      TO PUBLIC;
    CREATE TABLE public.phase1_v2_lock_fixture(value integer);

    CREATE SCHEMA fixture AUTHORIZATION supabase_admin;
    REVOKE ALL ON SCHEMA fixture FROM PUBLIC;
    CREATE FUNCTION fixture.install_managed_postgis()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $fixture$
      BEGIN
        CREATE EXTENSION postgis WITH SCHEMA trailmind_gis;
      END
      $fixture$;
    REVOKE ALL ON FUNCTION
      fixture.install_managed_postgis()
      FROM PUBLIC;
    GRANT USAGE ON SCHEMA fixture TO postgres;
    GRANT EXECUTE ON FUNCTION
      fixture.install_managed_postgis()
      TO postgres;
    CREATE FUNCTION fixture.install_postgis_for_login_proof()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $fixture$
      BEGIN
        CREATE EXTENSION postgis WITH SCHEMA trailmind_gis;
      END
      $fixture$;
    REVOKE ALL ON FUNCTION
      fixture.install_postgis_for_login_proof()
      FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION
      fixture.install_postgis_for_login_proof()
      TO postgres;
  `);
}

function executePsql(cluster, sql) {
  const result = spawnSync("psql", [
    "-X",
    "-v", "ON_ERROR_STOP=1",
    "-h", cluster.socket,
    "-p", String(cluster.port),
    "-U", "supabase_admin",
    "-d", "postgres"
  ], {
    cwd: backendRoot,
    env: environment(cluster),
    input: sql,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    throw new Error(`psql fixture failed with status ${result.status}`);
  }
}

function environment(cluster, extra = {}) {
  return {
    PATH: process.env.PATH,
    LANG: "C",
    LC_ALL: "C",
    PGHOST: cluster.socket,
    PGPORT: String(cluster.port),
    PGDATABASE: "postgres",
    PGUSER: "supabase_admin",
    ...extra
  };
}

function assertLocalPostgres17() {
  const version = execFileSync("pg_config", ["--version"], {
    encoding: "utf8"
  }).trim();
  if (!/^PostgreSQL 17\./.test(version)) {
    throw new Error(`PostgreSQL 17 is required; found ${version}`);
  }
  const sharedDirectory = execFileSync("pg_config", ["--sharedir"], {
    encoding: "utf8"
  }).trim();
  try {
    execFileSync("test", [
      "-r", join(sharedDirectory, "extension", "postgis.control")
    ]);
  } catch {
    throw new Error("PostGIS for PostgreSQL 17 is required");
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env: options.env ?? {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C"
    },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  if (!options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0 && !options.tolerateFailure) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}
