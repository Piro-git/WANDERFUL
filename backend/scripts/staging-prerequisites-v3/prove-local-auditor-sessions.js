#!/usr/bin/env node
import pg from "pg";
import { isAbsolute } from "node:path";
import {
  AUDITOR_ROLE,
  canonicalJson,
  compileExpectedManifest,
  runIndependentAuditorSessionProof
} from "../../src/operations/stagingPrerequisitesV3/index.js";

try {
  const options = parse(process.argv.slice(2));
  const manifest = compileExpectedManifest();
  const proof = await runIndependentAuditorSessionProof({
    createConnection: ({ applicationName }) => new pg.Client({
      application_name: applicationName,
      database: options.database,
      host: options.socketDirectory,
      port: options.port,
      user: AUDITOR_ROLE
    }),
    expectedManifest: manifest.manifest
  });
  process.stdout.write(`${canonicalJson(proof)}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJson({
    code: typeof error?.code === "string" ? error.code : "local_proof_failed",
    status: error?.status ?? "blocked"
  })}\n`);
  process.exitCode = 1;
}

function parse(argv) {
  if (argv.length !== 6) invalid();
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--database", "--port", "--socket-directory"].includes(key) ||
        Object.hasOwn(result, key)) invalid();
    result[key] = value;
  }
  const port = Number(result["--port"]);
  if (!isAbsolute(result["--socket-directory"] ?? "") ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(result["--database"] ?? "") ||
      !Number.isSafeInteger(port) || port < 1024 || port > 65535) invalid();
  return {
    database: result["--database"],
    port,
    socketDirectory: result["--socket-directory"]
  };
}

function invalid() {
  const error = new Error("arguments");
  error.code = "arguments";
  error.status = "blocked";
  throw error;
}
