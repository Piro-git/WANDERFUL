import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(SCRIPT_DIRECTORY, "../../..");
const REQUIRED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "container/healthcheck.js",
  "container/stagingAdmission.js",
  "container/start.js"
]);
const REQUIRED_PREFIXES = Object.freeze([
  "src/",
  "config/outdoor-regions/"
]);
const OPERATOR_ONLY_FILES = new Set([
  "src/operations/migrationRunner.js",
  "src/operations/stagingMigrationCapability.js",
  "src/operations/stagingMigrationPolicy.js",
  "src/operations/stagingPhase1V2Admission.js",
  "src/operations/stagingPhase1V2LiveLauncher.js",
  "src/operations/stagingPhase1V2MachineObserver.js",
  "src/operations/stagingPhase1V2ProductionArtifacts.js",
  "src/operations/stagingPhase1V2ProductionAuditor.js",
  "src/operations/stagingPhase1V2ProductionObserverContract.js",
  "src/operations/stagingPhase1V2ProductionSourceManifest.js",
  "src/operations/stagingPhase1V2SingleSessionAdapter.js",
  "src/operations/stagingPhase1V2Operator.js"
]);
const FORBIDDEN_SUFFIXES = Object.freeze([
  ".env", ".xcconfig", ".pbf", ".log", ".pem", ".key"
]);
const OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256 =
  "730c9715a50e01394edff472b079a0742e6c34159c51329032d0bb8e8d7aa6b7";
const SECRET_PATTERNS = Object.freeze([
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
  /\b(?:eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{16,})\b/,
  /\b(?:sb_secret_|sk-or-v1-)[a-zA-Z0-9_-]{16,}\b/
]);

export async function verifyBuildContext(options = {}) {
  const root = resolve(options.root ?? BACKEND_ROOT);
  const candidates = (await filesBelow(root)).filter(includedInImageContext).sort();
  const failures = [];
  for (const name of candidates) {
    if (FORBIDDEN_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) {
      failures.push("forbidden_file_type");
      continue;
    }
    const content = await readFile(join(root, name));
    if (isText(content) && containsCredentialPattern(content.toString("utf8"))) {
      failures.push("credential_pattern");
    }
  }
  const digest = createHash("sha256");
  for (const name of candidates) {
    digest.update(name);
    digest.update("\0");
    digest.update(await readFile(join(root, name)));
    digest.update("\0");
  }
  return Object.freeze({
    schemaVersion: 1,
    decision: failures.length === 0 ? "pass" : "fail",
    fileCount: candidates.length,
    contentSha256: digest.digest("hex"),
    failureCategories: Object.freeze([...new Set(failures)].sort())
  });
}

function includedInImageContext(name) {
  return !OPERATOR_ONLY_FILES.has(name) && (
    REQUIRED_FILES.has(name) ||
    REQUIRED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

async function filesBelow(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      result.push(...await filesBelow(root, path));
      continue;
    }
    if (!(await stat(path)).isFile()) continue;
    result.push(relative(root, path).split(sep).join("/"));
  }
  return result;
}

function isText(buffer) {
  return !buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

function containsCredentialPattern(text) {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) return true;
  for (const candidate of text.matchAll(/\b[a-z]{20}\b/gi)) {
    if (createHash("sha256").update(candidate[0].toLowerCase()).digest("hex") ===
      OFF_LIMITS_PRODUCTION_PROJECT_REF_SHA256) return true;
  }
  return false;
}

const report = await verifyBuildContext();
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.decision !== "pass") process.exitCode = 1;
