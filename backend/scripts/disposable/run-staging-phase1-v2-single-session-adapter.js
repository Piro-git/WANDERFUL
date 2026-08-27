import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod, copyFile, mkdir, mkdtemp, rm, stat, writeFile
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const repositoryRoot = dirname(backendRoot);
const port = 55_349;
const candidate = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8"
}).trim();
const candidateTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: repositoryRoot,
  encoding: "utf8"
}).trim();
const supautilsLibrary = await requiredSupautilsLibrary();

assertLocalPostgres17();
const requestedMode = process.argv[2];
const modes = requestedMode
  ? [requestedMode]
  : [
    "regression", "success", "privileges", "restart", "compensation",
    "containment", "failures"
  ];
if (modes.some((mode) =>
  ![
    "regression", "success", "privileges", "restart", "compensation",
    "containment", "failures"
  ].includes(mode)
)) throw new Error("unknown disposable adapter proof mode");
let authoritativeTestCount = 0;
for (const mode of modes) {
  await withTlsCluster(mode, async (cluster) => {
    provisionManagedFixture(cluster);
    const proof = run(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "test/stagingPhase1V2SingleSessionPostgresIntegration.test.js"
    ], {
      env: environment(cluster, {
        TRAILMIND_PHASE1_V2_ADAPTER_POSTGRES_INTEGRATION: "true",
        TRAILMIND_PHASE1_V2_ADAPTER_INTEGRATION_MODE: mode,
        TRAILMIND_PHASE1_V2_ADAPTER_CANDIDATE: candidate,
        TRAILMIND_PHASE1_V2_ADAPTER_CANDIDATE_TREE: candidateTree,
        TRAILMIND_PHASE1_V2_ADAPTER_CA_PATH: cluster.caCertificate,
        TRAILMIND_PHASE1_V2_ADAPTER_AUTH_ROOT: cluster.authorizationRoot,
        TRAILMIND_PHASE1_V2_ADAPTER_TCP_PORT: String(cluster.port)
      })
    });
    if (!requestedMode) {
      if (!/# fail 0\b/.test(proof.stdout ?? "") ||
          !/# skipped 0\b/.test(proof.stdout ?? "")) {
        throw new Error(`authoritative ${mode} proof reported a false green`);
      }
      const count = Number((proof.stdout ?? "").match(/# tests (\d+)\b/)?.[1]);
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error(`authoritative ${mode} proof executed zero tests`);
      }
      authoritativeTestCount += count;
    }
  });
}

process.stdout.write(requestedMode
  ? `Diagnostic PostgreSQL 17 adapter mode ${requestedMode} completed; ` +
    "this mode cannot confer release success.\n"
  : `Authoritative PostgreSQL 17 adapter aggregate completed ` +
    `${authoritativeTestCount} tests with zero skips.\n`);

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
  const localSupautilsLibrary = join(
    root, `supautils${extname(supautilsLibrary)}`
  );
  let started = false;
  try {
    await mkdir(socket, { mode: 0o700 });
    await mkdir(authorizationRoot, { mode: 0o700 });
    await mkdir(certificates, { mode: 0o700 });
    await copyFile(supautilsLibrary, localSupautilsLibrary);
    await chmod(localSupautilsLibrary, 0o500);
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
      "-set_serial", "1",
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
        `-c ssl_key_file=${serverKey} ` +
        `-c dynamic_library_path=${root} ` +
        `-c shared_preload_libraries=supautils ` +
        `-c supautils.privileged_role=postgres ` +
        `-c supautils.superuser=supabase_admin ` +
        `-c supautils.privileged_extensions_superuser=supabase_admin ` +
        `-c supautils.privileged_extensions=postgis`,
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
    GRANT pg_read_all_settings TO postgres
      WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
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
    CREATE FUNCTION fixture.raise_controlled_ddl_failure()
      RETURNS event_trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $fixture$
      BEGIN
        IF current_setting('trailmind.fixture_fail_ddl', true) = 'on' THEN
          RAISE EXCEPTION USING
            ERRCODE = 'XX000',
            MESSAGE = 'controlled disposable DDL failure';
        END IF;
      END
      $fixture$;
    REVOKE ALL ON FUNCTION fixture.raise_controlled_ddl_failure() FROM PUBLIC;
    CREATE EVENT TRIGGER trailmind_fixture_controlled_ddl_failure
      ON ddl_command_start
      EXECUTE FUNCTION fixture.raise_controlled_ddl_failure();
    DO $fixture$
    BEGIN
      IF current_setting('server_version_num')::integer / 10000 <> 17 THEN
        RAISE EXCEPTION 'disposable PostgreSQL major version is invalid';
      ELSIF current_setting('supautils.privileged_role') <> 'postgres' THEN
        RAISE EXCEPTION 'disposable supautils privileged role is invalid';
      ELSIF current_setting('supautils.superuser') <> 'supabase_admin' THEN
        RAISE EXCEPTION 'disposable supautils managed superuser is invalid';
      ELSIF current_setting('supautils.privileged_extensions') <> 'postgis' THEN
        RAISE EXCEPTION 'disposable supautils extension allowlist is invalid';
      END IF;
    END
    $fixture$;
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

async function requiredSupautilsLibrary() {
  const requested = process.env.TRAILMIND_SUPAUTILS_LIBRARY_PATH;
  if (typeof requested !== "string" || requested.length === 0) {
    throw new Error(
      "TRAILMIND_SUPAUTILS_LIBRARY_PATH is required for authoritative proof"
    );
  }
  const library = resolve(requested);
  const metadata = await stat(library);
  if (!metadata.isFile() || !/^supautils\.(?:dylib|so)$/.test(basename(library))) {
    throw new Error("the official PostgreSQL 17 supautils library is required");
  }
  return library;
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
