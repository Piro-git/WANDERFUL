import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = await mkdtemp(
  "/private/tmp/trailmind-phase1-v2-production-auditor."
);
const data = join(root, "data");
const socket = join(root, "socket");
const caKey = join(root, "ca.key");
const caCertificate = join(root, "ca.crt");
const serverKey = join(root, "server.key");
const serverRequest = join(root, "server.csr");
const serverCertificate = join(root, "server.crt");
const certificateConfig = join(root, "server.cnf");
const port = 55_351;
let started = false;

try {
  const version = run("pg_config", ["--version"], { capture: true }).stdout
    .trim();
  if (!/^PostgreSQL 17\./.test(version)) {
    throw new Error("PostgreSQL 17 is required");
  }
  await mkdir(socket, { mode: 0o700 });
  await writeFile(certificateConfig, `
[req]
distinguished_name = subject
prompt = no
req_extensions = extensions
[subject]
CN = localhost
[extensions]
subjectAltName = DNS:localhost,IP:127.0.0.1
`, { mode: 0o600 });
  run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
    "-days", "1", "-subj", "/CN=TrailMind disposable auditor CA",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-keyout", caKey, "-out", caCertificate
  ], { capture: true });
  run("openssl", [
    "req", "-newkey", "rsa:2048", "-nodes", "-keyout", serverKey,
    "-out", serverRequest, "-config", certificateConfig
  ], { capture: true });
  run("openssl", [
    "x509", "-req", "-in", serverRequest, "-CA", caCertificate,
    "-CAkey", caKey, "-set_serial", "1", "-out", serverCertificate,
    "-days", "1", "-extensions", "extensions", "-extfile",
    certificateConfig
  ], { capture: true });
  await chmod(caCertificate, 0o600);
  await chmod(serverKey, 0o600);
  await chmod(serverCertificate, 0o600);
  run("initdb", [
    "-D", data, "--username=trailmind_test_admin", "--auth=trust",
    "--encoding=UTF8", "--no-sync"
  ], { capture: true });
  run("pg_ctl", [
    "-D", data, "-l", join(root, "postgres.log"), "-o",
    `-c listen_addresses=127.0.0.1 -c port=${port} ` +
      `-c unix_socket_directories=${socket} -c ssl=on ` +
      `-c ssl_cert_file=${serverCertificate} -c ssl_key_file=${serverKey}`,
    "-w", "start"
  ], { capture: true });
  started = true;
  run("psql", [
    "-X", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", String(port),
    "-U", "trailmind_test_admin", "-d", "postgres"
  ], {
    input: `
      CREATE ROLE postgres LOGIN NOINHERIT NOSUPERUSER CREATEDB CREATEROLE
        NOREPLICATION NOBYPASSRLS;
      CREATE ROLE trailmind_phase1_v2_stats_auditor LOGIN NOINHERIT
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        CONNECTION LIMIT 1 VALID UNTIL '2099-01-01 00:00:00+00';
      REVOKE CREATE, TEMPORARY ON DATABASE postgres FROM PUBLIC;
      GRANT CONNECT ON DATABASE postgres
        TO trailmind_phase1_v2_stats_auditor;
      GRANT pg_read_all_stats TO trailmind_phase1_v2_stats_auditor
        WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
      ALTER ROLE trailmind_phase1_v2_stats_auditor
        SET default_transaction_read_only = on;
      ALTER ROLE trailmind_phase1_v2_stats_auditor
        SET search_path = pg_catalog;
      ALTER ROLE trailmind_phase1_v2_stats_auditor
        SET statement_timeout = '5s';
      ALTER ROLE trailmind_phase1_v2_stats_auditor
        SET lock_timeout = '1s';
      ALTER ROLE trailmind_phase1_v2_stats_auditor
        SET idle_in_transaction_session_timeout = '5s';
      CREATE SCHEMA trailmind_app AUTHORIZATION postgres;
      CREATE TABLE trailmind_app.private_route(id bigint PRIMARY KEY);
      REVOKE ALL ON SCHEMA trailmind_app
        FROM trailmind_phase1_v2_stats_auditor;
      REVOKE ALL ON ALL TABLES IN SCHEMA trailmind_app
        FROM trailmind_phase1_v2_stats_auditor;
    `
  });
  const proof = run(process.execPath, [
    "--test", "--test-concurrency=1",
    "test/stagingPhase1V2ProductionAuditorPostgresIntegration.test.js"
  ], {
    capture: true,
    env: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      TRAILMIND_PHASE1_V2_PRODUCTION_AUDITOR_POSTGRES_INTEGRATION: "true",
      TRAILMIND_PHASE1_V2_PRODUCTION_AUDITOR_CA_PATH: caCertificate,
      TRAILMIND_PHASE1_V2_PRODUCTION_AUDITOR_PORT: String(port)
    }
  });
  if (!/# fail 0\b/.test(proof.stdout) ||
      !/# skipped 0\b/.test(proof.stdout) ||
      !/# tests 1\b/.test(proof.stdout)) {
    throw new Error("auditor integration reported a false green");
  }
  process.stdout.write(
    "Disposable PostgreSQL 17 production auditor proof passed 1 test.\n"
  );
} finally {
  if (started) {
    run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
      capture: true,
      tolerateFailure: true
    });
  }
  await rm(root, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL("../..", import.meta.url),
    env: options.env ?? {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C"
    },
    input: options.input,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  if (!options.capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0 && !options.tolerateFailure) {
    if (options.capture && result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} failed with status ${result.status}`);
  }
  return result;
}
