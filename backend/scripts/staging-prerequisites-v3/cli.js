#!/usr/bin/env node
import { resolve } from "node:path";
import {
  acquireCandidateCaPin,
  atomicWriteFile,
  buildReadinessContract,
  catalogAssertionProgramSha256,
  compileAuditorProvisioningSql,
  compileAuditorRevocationSql,
  compileExpectedManifest,
  DEFAULT_REVIEWED_PINS_PATH,
  provisionCandidateSigningKey,
  readSafeRegularFile,
  signCanonicalReceipt,
  strictParseJson,
  validateReviewedPins,
  verifyCanonicalReceipt,
  writeSignedEnvelope
} from "../../src/operations/stagingPrerequisitesV3/index.js";
import { canonicalJson } from "../../src/operations/stagingPrerequisitesV3/canonicalJson.js";

const MAXIMUM_ARGUMENTS = 16;
const COMMANDS = new Set([
  "auditor-provisioning-sql",
  "auditor-revocation-sql",
  "ca-pin",
  "compile-manifest",
  "key-generate",
  "program-pin",
  "readiness",
  "sign-receipt",
  "verify-receipt"
]);

try {
  await main(process.argv.slice(2));
} catch (error) {
  const status = ["blocked", "not_ready"].includes(error?.status)
    ? error.status
    : "blocked";
  const code = typeof error?.code === "string" &&
    /^[a-z][a-z0-9_]{0,95}$/.test(error.code)
    ? error.code
    : "unexpected_failure";
  output({ code, status });
  process.exitCode = status === "not_ready" ? 2 : 1;
}

async function main(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > MAXIMUM_ARGUMENTS ||
      argv.some((value) => typeof value !== "string" || value.length > 1_024 ||
        value.includes("\0") || value.includes("\n") ||
        /postgres(?:ql)?:\/\//i.test(value))) fail("arguments");
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) fail("command");
  const options = parseOptions(rest);
  if (command === "program-pin") {
    exactOptions(options, []);
    output({
      candidateOnly: true,
      independentCatalogAssertionProgramSha256:
        catalogAssertionProgramSha256(),
      status: "candidate"
    });
    return;
  }
  if (command === "compile-manifest") {
    exactOptions(options, [], ["--output-file"]);
    const compiled = compileExpectedManifest();
    if (options["--output-file"]) {
      atomicWriteFile(
        absolute(options["--output-file"]),
        Buffer.from(`${compiled.canonical}\n`, "utf8"),
        { mode: 0o600 }
      );
    }
    output({
      candidateOnly: true,
      independentExpectedManifestSha256: compiled.sha256,
      outputWritten: Boolean(options["--output-file"]),
      status: "candidate"
    });
    return;
  }
  if (command === "readiness") {
    exactOptions(options, [], ["--reviewed-pins-file"]);
    const readiness = buildReadinessContract({
      reviewedPinsPath: options["--reviewed-pins-file"]
        ? absolute(options["--reviewed-pins-file"])
        : DEFAULT_REVIEWED_PINS_PATH
    });
    process.stdout.write(`${readiness.canonical}\n`);
    return;
  }
  if (command === "ca-pin") {
    exactOptions(options, ["--ca-file"]);
    output(acquireCandidateCaPin({
      caCertificatePath: absolute(options["--ca-file"])
    }));
    return;
  }
  if (command === "key-generate") {
    exactOptions(options, ["--candidate-only", "--output-directory"]);
    if (options["--candidate-only"] !== "acknowledged") fail("candidate_acknowledgement");
    output(provisionCandidateSigningKey({
      outputDirectory: absolute(options["--output-directory"])
    }));
    return;
  }
  if (command === "auditor-provisioning-sql") {
    exactOptions(options, ["--output-file", "--valid-until"]);
    const sql = compileAuditorProvisioningSql({
      validUntil: options["--valid-until"]
    });
    atomicWriteFile(absolute(options["--output-file"]), Buffer.from(sql), {
      mode: 0o600
    });
    output({ outputWritten: true, passwordIncluded: false, status: "candidate" });
    return;
  }
  if (command === "auditor-revocation-sql") {
    exactOptions(options, ["--output-file"]);
    atomicWriteFile(
      absolute(options["--output-file"]),
      Buffer.from(compileAuditorRevocationSql()),
      { mode: 0o600 }
    );
    output({ outputWritten: true, status: "candidate" });
    return;
  }
  if (command === "sign-receipt") {
    exactOptions(options, [
      "--output-file", "--private-key-file", "--receipt-file"
    ], ["--reviewed-pins-file"]);
    const pins = readPins(options["--reviewed-pins-file"]);
    const receipt = strictParseJson(readSafeRegularFile(
      absolute(options["--receipt-file"]), { maximumBytes: 32 * 1024 }
    ));
    const signed = signCanonicalReceipt({
      privateKeyPath: absolute(options["--private-key-file"]),
      receipt,
      requiredKeyId: pins.artifactContract.key.keyId,
      requiredPublicKeySpkiSha256:
        pins.artifactContract.key.requiredPinnedPublicKeySpkiSha256
    });
    writeSignedEnvelope(absolute(options["--output-file"]), signed);
    output({
      artifactSha256: signed.envelope.artifactSha256,
      outputWritten: true,
      status: "signed"
    });
    return;
  }
  if (command === "verify-receipt") {
    exactOptions(options, [
      "--envelope-file", "--public-key-file"
    ], ["--reviewed-pins-file"]);
    const pins = readPins(options["--reviewed-pins-file"]);
    const envelope = readSafeRegularFile(absolute(options["--envelope-file"]), {
      maximumBytes: 64 * 1024
    });
    output(verifyCanonicalReceipt({
      envelope,
      publicKeyPath: absolute(options["--public-key-file"]),
      requiredKeyId: pins.artifactContract.key.keyId,
      requiredPublicKeySpkiSha256:
        pins.artifactContract.key.requiredPinnedPublicKeySpkiSha256
    }));
  }
}

function parseOptions(argv) {
  if (argv.length % 2 !== 0) fail("arguments");
  const result = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z][a-z-]{0,47}$/.test(key) || !value ||
        value.startsWith("--") || Object.hasOwn(result, key)) fail("arguments");
    result[key] = value;
  }
  return result;
}

function exactOptions(options, required, optional = []) {
  const actual = Object.keys(options).sort();
  const allowed = [...required, ...optional];
  if (actual.some((key) => !allowed.includes(key)) ||
      required.some((key) => !actual.includes(key))) fail("arguments");
}

function readPins(path) {
  const bytes = readSafeRegularFile(
    path ? absolute(path) : DEFAULT_REVIEWED_PINS_PATH,
    { maximumBytes: 32 * 1024 }
  );
  const value = strictParseJson(bytes);
  validateReviewedPins(value);
  return value;
}

function absolute(value) {
  if (typeof value !== "string" || !value.startsWith("/")) fail("absolute_path");
  return resolve(value);
}

function output(value) {
  process.stdout.write(`${canonicalJson(value)}\n`);
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  error.status = "blocked";
  throw error;
}
