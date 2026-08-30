#!/usr/bin/env node
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReadinessContract,
  canonicalJson,
  catalogAssertionProgram,
  compileExpectedManifest
} from "../../src/operations/stagingPrerequisitesV3/index.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const ownedRoots = [
  resolve(repositoryRoot, "backend/src/operations/stagingPrerequisitesV3"),
  resolve(repositoryRoot, "backend/scripts/staging-prerequisites-v3"),
  resolve(repositoryRoot, "docs/operations/staging-v1/prerequisites-v3")
];
const maximumFiles = 64;
const maximumBytes = 2 * 1024 * 1024;

try {
  const files = ownedRoots.flatMap(listFiles).sort();
  if (files.length > maximumFiles) fail("owned_file_bound");
  let totalBytes = 0;
  for (const path of files) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail("owned_file_type");
    totalBytes += metadata.size;
    if (totalBytes > maximumBytes) fail("owned_byte_bound");
    const text = readFileSync(path, "utf8");
    if (/^(?:<<<<<<<|=======|>>>>>>>)/m.test(text)) fail("conflict_marker");
    if (/-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/.test(text)) {
      fail("private_key_material");
    }
    if (/postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/i.test(text) ||
        /(?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)\s*=\s*\S+/.test(text)) {
      fail("credential_pattern");
    }
    if (/[ \t]+$/m.test(text)) fail("trailing_whitespace");
  }
  const first = compileExpectedManifest({ repositoryRoot });
  const second = compileExpectedManifest({ repositoryRoot });
  if (first.canonical !== second.canonical || first.sha256 !== second.sha256) {
    fail("manifest_nondeterministic");
  }
  const readiness = buildReadinessContract({ repositoryRoot });
  if (readiness.contract.status !== "not_ready" ||
      readiness.contract.issueCodes.length !== 5) fail("readiness_false_green");
  const frozen = readFileSync(resolve(
    repositoryRoot,
    "docs/operations/staging-v1/prerequisites-v3/offline-readiness.default.json"
  ), "utf8");
  if (frozen !== `${readiness.canonical}\n`) fail("readiness_artifact_drift");
  const statements = catalogAssertionProgram().statements;
  if (statements.length !== 7 ||
      statements.some((statement) => typeof statement !== "string" ||
        statement.length > 64 * 1024) ||
      !statements[0].endsWith("READ ONLY") || statements.at(-1) !== "ROLLBACK") {
    fail("catalog_program_shape");
  }
  process.stdout.write(`${canonicalJson({
    candidateProgramSha256: readiness.contract.candidateEvidence
      .independentCatalogAssertionProgramSha256,
    candidateExpectedManifestSha256: first.sha256,
    fileCount: files.length,
    readinessStatus: "not_ready",
    status: "pass",
    totalBytes
  })}\n`);
} catch (error) {
  process.stdout.write(`${canonicalJson({
    code: error?.code ?? "offline_quality_failed",
    status: "blocked"
  })}\n`);
  process.exitCode = 1;
}

function listFiles(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail("owned_symlink");
    if (entry.isDirectory()) output.push(...listFiles(path));
    else if (entry.isFile()) output.push(path);
    else fail("owned_file_type");
  }
  return output;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
